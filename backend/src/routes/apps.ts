import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import OpenAI from "openai";
import JSZip from "jszip";

const apps = new Hono();

const BRIGHTDATA_BASE = "https://api.brightdata.com/datasets/v3";

/* ══════════════════════════════════════════════════════════════════
   Web Search (Google SERP via BrightData /request endpoint)
   ══════════════════════════════════════════════════════════════════ */

interface WebSearchJob {
  status: "running" | "ready" | "failed";
  query: string;
  startedAt: number;
  data?: unknown;
  error?: string;
}

/** In-memory store for async web-search jobs */
const webSearchJobs = new Map<string, WebSearchJob>();

/** Server-side cache: query → results (avoids repeat BrightData calls) */
const webSearchCache = new Map<string, { data: unknown; cachedAt: number }>();
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

/** Clean up old jobs, keeping only the most recent 50 */
function pruneWebSearchJobs() {
  if (webSearchJobs.size <= 50) return;
  const keys = [...webSearchJobs.keys()];
  const toDelete = keys.slice(0, keys.length - 50);
  for (const k of toDelete) webSearchJobs.delete(k);
}

/** Try to extract structured search results from whatever BrightData returns */
function normalizeSearchResults(raw: unknown): Record<string, unknown>[] {
  // Already an array
  if (Array.isArray(raw)) return raw;

  // Wrapped in a known key
  if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    for (const key of ["organic", "results", "organic_results", "data", "items"]) {
      if (Array.isArray(obj[key])) return obj[key] as Record<string, unknown>[];
    }
    // Single result object
    return [obj];
  }

  // Raw HTML string — attempt basic extraction
  if (typeof raw === "string") {
    return parseHTMLtoResults(raw);
  }

  return [];
}

/** Best-effort parser for raw Google SERP HTML */
function parseHTMLtoResults(html: string): Record<string, unknown>[] {
  const results: Record<string, unknown>[] = [];

  // Pattern: <a href="..."><h3>Title</h3></a>
  const titlePattern = /<a[^>]+href="([^"]*)"[^>]*>[\s\S]*?<h3[^>]*>([\s\S]*?)<\/h3>/gi;
  let match: RegExpExecArray | null;
  let position = 1;

  while ((match = titlePattern.exec(html)) !== null) {
    let url = match[1];
    const title = match[2].replace(/<[^>]+>/g, "").trim();

    // Google wraps URLs in /url?q=…
    if (url.startsWith("/url?q=")) {
      url = decodeURIComponent(url.replace("/url?q=", "").split("&")[0]);
    }
    // Skip internal / irrelevant links
    if (url.startsWith("/") || url.includes("google.com/search") || !title) continue;

    // Try to extract a snippet from the HTML following this match.
    // Google puts snippets in <span> tags within nearby <div> elements.
    // Look at the next ~2000 chars after the match for snippet-like text.
    const afterMatch = html.slice(match.index + match[0].length, match.index + match[0].length + 2000);

    let description = "";

    // Look for VwiC3b class (Google's snippet container) or data-sncf attributes
    const snippetPatterns = [
      /<div[^>]+class="[^"]*VwiC3b[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
      /<span[^>]+class="[^"]*VwiC3b[^"]*"[^>]*>([\s\S]*?)<\/span>/i,
      /<div[^>]+data-sncf="[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
    ];

    for (const sp of snippetPatterns) {
      const snippetMatch = sp.exec(afterMatch);
      if (snippetMatch) {
        description = snippetMatch[1].replace(/<[^>]+>/g, "").trim();
        if (description.length > 20) break; // Good enough snippet
        description = ""; // Too short, try next pattern
      }
    }

    // Fallback: grab the longest text block near the result
    if (!description) {
      const textBlocks = afterMatch.match(/>([^<]{40,})</g);
      if (textBlocks && textBlocks.length > 0) {
        // Pick the longest one as the most likely snippet
        const best = textBlocks
          .map((t) => t.slice(1, -1).trim())
          .filter((t) => !t.includes("{") && !t.includes("function"))
          .sort((a, b) => b.length - a.length)[0];
        if (best) description = best;
      }
    }

    // Trim to a reasonable length
    if (description.length > 300) {
      description = description.slice(0, 297) + "...";
    }

    results.push({ title, url, description, position: position++ });
  }

  // If regex extraction failed, wrap the whole HTML so the frontend can display it
  if (results.length === 0) {
    return [{ title: "Raw search results", url: "", description: "", rawHtml: html, position: 1 }];
  }

  console.log(`[html-parser] Extracted ${results.length} results, ${results.filter((r) => r.description).length} with snippets`);
  return results;
}

/**
 * POST /apps/amazon-search
 *
 * Kicks off an Amazon product search via BrightData's Web Scraper.
 * Returns immediately with a snapshot_id — poll /apps/amazon-status/:id for results.
 *
 * Request body (JSON):
 *   - keyword:  string          — search term (required unless keywords provided)
 *   - keywords: string[]        — multiple search terms
 *   - limit:    number          — max results per keyword (default 20, max 100)
 *
 * Response (JSON):
 *   202: { success: true, snapshot_id: string, status: "running" }
 */
apps.post("/amazon-search", async (c) => {
  try {
    const apiKey = process.env.BRIGHTDATA_API_KEY;
    const datasetId = process.env.BRIGHTDATA_DATASET_ID;

    if (!apiKey || !datasetId) {
      return c.json(
        { error: "Missing BRIGHTDATA_API_KEY or BRIGHTDATA_DATASET_ID env vars." },
        500
      );
    }

    const body = await c.req.json<{
      keyword?: string;
      keywords?: string[];
      limit?: number;
    }>();

    /* ── Build the input array ──────────────────────────────── */
    let input: { keyword: string }[] = [];

    if (body.keywords && Array.isArray(body.keywords) && body.keywords.length > 0) {
      input = body.keywords.map((kw) => ({ keyword: kw }));
    } else if (body.keyword && body.keyword.trim().length > 0) {
      input = [{ keyword: body.keyword.trim() }];
    } else {
      return c.json(
        { error: "\"keyword\" (string) or \"keywords\" (string[]) is required." },
        400
      );
    }

    const limit = Math.min(Math.max(body.limit ?? 20, 1), 100);

    /* ── Call BrightData trigger (always returns immediately) ── */
    const url = new URL(`${BRIGHTDATA_BASE}/trigger`);
    url.searchParams.set("dataset_id", datasetId);
    url.searchParams.set("notify", "false");
    url.searchParams.set("include_errors", "true");
    url.searchParams.set("type", "discover_new");
    url.searchParams.set("discover_by", "keyword");
    url.searchParams.set("limit_per_input", String(limit));

    const response = await fetch(url.toString(), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(input),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("BrightData API error:", response.status, errorText);
      return c.json(
        { error: "BrightData API request failed.", status: response.status, details: errorText },
        502
      );
    }

    const data = await response.json();
    return c.json(
      { success: true, snapshot_id: data.snapshot_id, status: "running" },
      202
    );
  } catch (err) {
    console.error("Amazon search error:", err);
    return c.json({ error: "Internal server error." }, 500);
  }
});

/**
 * GET /apps/amazon-status/:snapshot_id
 *
 * Checks progress of a BrightData scrape job, and returns the data when ready.
 *
 * Response (JSON):
 *   - status "starting" | "running": { status, snapshot_id }
 *   - status "ready":                { status, snapshot_id, data: object[] }
 *   - status "failed":               { status, snapshot_id, error }
 */
apps.get("/amazon-status/:snapshot_id", async (c) => {
  try {
    const apiKey = process.env.BRIGHTDATA_API_KEY;
    if (!apiKey) {
      return c.json({ error: "Missing BRIGHTDATA_API_KEY env var." }, 500);
    }

    const snapshotId = c.req.param("snapshot_id");

    /* ── Check progress ─────────────────────────────────────── */
    const progressRes = await fetch(
      `${BRIGHTDATA_BASE}/progress/${snapshotId}`,
      { headers: { Authorization: `Bearer ${apiKey}` } }
    );

    if (!progressRes.ok) {
      const errorText = await progressRes.text();
      return c.json(
        { error: "Failed to check progress.", status: progressRes.status, details: errorText },
        progressRes.status === 404 ? 404 : 502
      );
    }

    const progress = await progressRes.json();

    /* ── Not ready yet (includes "closing" while BrightData finalizes) ── */
    if (progress.status !== "ready" && progress.status !== "failed") {
      return c.json({ status: progress.status, snapshot_id: snapshotId });
    }

    /* ── Failed ─────────────────────────────────────────────── */
    if (progress.status === "failed") {
      return c.json(
        { status: "failed", snapshot_id: snapshotId, error: "Scrape job failed." },
        500
      );
    }

    /* ── Ready — download the snapshot ──────────────────────── */
    const snapshotRes = await fetch(
      `${BRIGHTDATA_BASE}/snapshot/${snapshotId}?format=json`,
      { headers: { Authorization: `Bearer ${apiKey}` } }
    );

    if (!snapshotRes.ok) {
      const errorText = await snapshotRes.text();
      return c.json(
        { error: "Failed to download snapshot.", status: snapshotRes.status, details: errorText },
        502
      );
    }

    /* BrightData may return NDJSON (one JSON object per line) instead of
       a proper JSON array.  Handle both formats gracefully. */
    const rawText = await snapshotRes.text();
    let data: unknown;
    try {
      data = JSON.parse(rawText);
    } catch {
      // Likely NDJSON — split on newlines and parse each line
      const lines = rawText.split("\n").filter((l) => l.trim().length > 0);
      const parsed: unknown[] = [];
      for (const line of lines) {
        try {
          parsed.push(JSON.parse(line));
        } catch {
          // skip unparseable lines
        }
      }
      data = parsed;
      console.log(`[snapshot] Parsed ${parsed.length} products from NDJSON`);
    }

    // Ensure data is always an array
    if (!Array.isArray(data)) {
      data = [data];
    }

    /* BrightData sometimes returns a "not ready" message even after progress
       says "ready" (e.g. {"status":"building",...} or {"status":"closing",...}).
       Detect this and tell the frontend to keep polling. */
    if (
      Array.isArray(data) &&
      data.length === 1 &&
      data[0] &&
      typeof data[0] === "object" &&
      "message" in (data[0] as Record<string, unknown>) &&
      !("title" in (data[0] as Record<string, unknown>))
    ) {
      const msg = data[0] as Record<string, unknown>;
      console.log(`[snapshot] Not actually ready: ${msg.status} — ${msg.message}`);
      return c.json({ status: String(msg.status || "building"), snapshot_id: snapshotId });
    }

    return c.json({ status: "ready", snapshot_id: snapshotId, data });
  } catch (err) {
    console.error("Amazon status error:", err);
    return c.json({ error: "Internal server error." }, 500);
  }
});

/**
 * POST /apps/send-email
 *
 * Sends a product link via email using Resend.
 *
 * Request body (JSON):
 *   - productUrl:   string  — the Amazon product URL
 *   - productTitle: string  — product title for the email subject
 *
 * Response (JSON):
 *   200: { success: true, id: string }
 */
apps.post("/send-email", async (c) => {
  try {
    const resendKey = process.env.RESEND_API_KEY;
    const toEmail = process.env.NOTIFICATION_EMAIL;

    if (!resendKey || !toEmail) {
      return c.json(
        { error: "Missing RESEND_API_KEY or NOTIFICATION_EMAIL env vars." },
        500
      );
    }

    const body = await c.req.json<{
      productUrl?: string;
      productTitle?: string;
    }>();

    if (!body.productUrl) {
      return c.json({ error: "\"productUrl\" is required." }, 400);
    }

    const title = body.productTitle || "Amazon Product";

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "Revive <onboarding@resend.dev>",
        to: [toEmail],
        subject: `Blink Selected: ${title.slice(0, 60)}`,
        html: `
          <div style="font-family: system-ui, sans-serif; max-width: 560px; margin: 0 auto; padding: 32px;">
            <h2 style="color: #111; margin-bottom: 8px;">You selected a product</h2>
            <p style="color: #555; font-size: 16px; margin-bottom: 24px;">${title}</p>
            <a href="${body.productUrl}" style="display: inline-block; background: #FF9900; color: #fff; text-decoration: none; padding: 12px 28px; border-radius: 8px; font-weight: 600; font-size: 15px;">
              View on Amazon
            </a>
            <p style="color: #999; font-size: 13px; margin-top: 32px;">Sent by Revive via blink selection</p>
          </div>
        `,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error("Resend error:", res.status, errText);
      return c.json({ error: "Failed to send email.", details: errText }, 502);
    }

    const data = await res.json();
    console.log("[email] Sent to", toEmail, "id:", data.id);
    return c.json({ success: true, id: data.id });
  } catch (err) {
    console.error("Send email error:", err);
    return c.json({ error: "Internal server error." }, 500);
  }
});

/**
 * POST /apps/maps-search
 *
 * Searches Google Maps for a place/location via BrightData.
 * Returns immediately with a snapshot_id — poll /apps/amazon-status/:id for results.
 *
 * Request body (JSON):
 *   - query: string — place or location to search (required)
 *
 * Response (JSON):
 *   202: { success: true, snapshot_id: string, status: "running" }
 */
apps.post("/maps-search", async (c) => {
  try {
    const apiKey = process.env.BRIGHTDATA_API_KEY;
    const datasetId = process.env.BRIGHTDATA_MAPS_DATASET_ID;

    if (!apiKey || !datasetId) {
      return c.json(
        { error: "Missing BRIGHTDATA_API_KEY or BRIGHTDATA_MAPS_DATASET_ID env vars." },
        500
      );
    }

    const body = await c.req.json<{ query?: string }>();

    if (!body.query || body.query.trim().length === 0) {
      return c.json({ error: "\"query\" is required." }, 400);
    }

    const searchUrl = `https://www.google.com/maps/search/${encodeURIComponent(body.query.trim())}`;
    const input = [{ url: searchUrl }];

    const url = new URL(`${BRIGHTDATA_BASE}/trigger`);
    url.searchParams.set("dataset_id", datasetId);
    url.searchParams.set("notify", "false");
    url.searchParams.set("include_errors", "true");

    const response = await fetch(url.toString(), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(input),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("BrightData Maps API error:", response.status, errorText);
      return c.json(
        { error: "BrightData API request failed.", status: response.status, details: errorText },
        502
      );
    }

    const data = await response.json();
    return c.json(
      { success: true, snapshot_id: data.snapshot_id, status: "running" },
      202
    );
  } catch (err) {
    console.error("Maps search error:", err);
    return c.json({ error: "Internal server error." }, 500);
  }
});

/**
 * POST /apps/chat
 *
 * Streams a ChatGPT response via SSE.
 *
 * Request body (JSON):
 *   - messages: { role: "user" | "assistant"; content: string }[]
 *
 * Response: text/event-stream with delta chunks
 */
apps.post("/chat", async (c) => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return c.json({ error: "Missing OPENAI_API_KEY env var." }, 500);
  }

  const body = await c.req.json<{
    messages?: { role: "user" | "assistant"; content: string }[];
  }>();

  if (!body.messages || body.messages.length === 0) {
    return c.json({ error: '"messages" array is required.' }, 400);
  }

  const openai = new OpenAI({ apiKey });

  return streamSSE(c, async (stream) => {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: body.messages!,
      stream: true,
    });

    for await (const chunk of completion) {
      const delta = chunk.choices[0]?.delta?.content;
      if (delta) {
        await stream.writeSSE({ data: JSON.stringify({ content: delta }) });
      }
    }

    await stream.writeSSE({ data: "[DONE]" });
  });
});

/**
 * POST /apps/web-search
 *
 * Kicks off a Google SERP search via BrightData's /request API.
 * The call blocks until data is ready, so we fire it in the background
 * and let the client poll for results — same pattern as Amazon.
 *
 * Request body (JSON):
 *   - query: string — search term (required)
 *
 * Response (JSON):
 *   202: { success: true, request_id: string, status: "running" }
 */
apps.post("/web-search", async (c) => {
  try {
    const apiKey = process.env.BRIGHTDATA_API_KEY;
    if (!apiKey) {
      return c.json({ error: "Missing BRIGHTDATA_API_KEY env var." }, 500);
    }

    const body = await c.req.json<{ query?: string }>();

    if (!body.query || body.query.trim().length === 0) {
      return c.json({ error: '"query" is required.' }, 400);
    }

    const query = body.query.trim();
    const cacheKey = query.toLowerCase();

    /* ── Check server-side cache first ───────────────────────── */
    const cached = webSearchCache.get(cacheKey);
    if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
      console.log(`[web-search] Cache hit for "${cacheKey}"`);
      const requestId = crypto.randomUUID();
      webSearchJobs.set(requestId, {
        status: "ready",
        query,
        startedAt: Date.now(),
        data: cached.data,
      });
      return c.json({ success: true, request_id: requestId, status: "running" }, 202);
    }

    const requestId = crypto.randomUUID();

    webSearchJobs.set(requestId, {
      status: "running",
      query,
      startedAt: Date.now(),
    });

    console.log(`[web-search] Job ${requestId} started for query="${query}"`);

    /* ── Fire BrightData /request in the background ──────────── */
    (async () => {
      try {
        const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}&brd_mobile=desktop`;

        console.log(`[web-search] ${requestId} → calling BrightData /request`);
        console.log(`[web-search] ${requestId} → url: ${searchUrl}`);

        const res = await fetch("https://api.brightdata.com/request", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            zone: "serp_api1",
            url: searchUrl,
            format: "raw",
          }),
        });

        if (!res.ok) {
          const errorText = await res.text();
          console.error(`[web-search] ${requestId} SERP error ${res.status}:`, errorText.slice(0, 500));
          const job = webSearchJobs.get(requestId);
          if (job) webSearchJobs.set(requestId, { ...job, status: "failed", error: `BrightData returned ${res.status}` });
          return;
        }

        const contentType = res.headers.get("content-type") || "";
        let data: unknown;
        if (contentType.includes("application/json")) {
          data = await res.json();
          console.log(`[web-search] ${requestId} received JSON response`);
        } else {
          data = await res.text();
          console.log(`[web-search] ${requestId} received HTML response (${(data as string).length} chars)`);
        }

        const normalized = normalizeSearchResults(data);
        console.log(`[web-search] ${requestId} → ${normalized.length} results extracted`);

        const job = webSearchJobs.get(requestId);
        if (job) webSearchJobs.set(requestId, { ...job, status: "ready", data: normalized });

        // Save to server-side cache
        webSearchCache.set(cacheKey, { data: normalized, cachedAt: Date.now() });
        if (webSearchCache.size > 100) {
          const oldest = webSearchCache.keys().next().value;
          if (oldest !== undefined) webSearchCache.delete(oldest);
        }
        console.log(`[web-search] ${requestId} cached results for "${cacheKey}"`);

        pruneWebSearchJobs();
      } catch (err) {
        console.error(`[web-search] ${requestId} background error:`, err);
        const job = webSearchJobs.get(requestId);
        if (job) webSearchJobs.set(requestId, { ...job, status: "failed", error: String(err) });
      }
    })();

    return c.json({ success: true, request_id: requestId, status: "running" }, 202);
  } catch (err) {
    console.error("Web search error:", err);
    return c.json({ error: "Internal server error." }, 500);
  }
});

/**
 * GET /apps/web-search-status/:request_id
 *
 * Polls a web-search job.  Same status contract as /apps/amazon-status/:id.
 *
 * Response (JSON):
 *   - status "running":  { status, request_id, elapsed }
 *   - status "ready":    { status, request_id, data: object[] }
 *   - status "failed":   { status, request_id, error }
 */
apps.get("/web-search-status/:request_id", async (c) => {
  try {
    const requestId = c.req.param("request_id");
    const job = webSearchJobs.get(requestId);

    if (!job) {
      return c.json({ error: "Request not found.", request_id: requestId }, 404);
    }

    if (job.status === "running") {
      const elapsed = Math.round((Date.now() - job.startedAt) / 1000);
      console.log(`[web-search] Poll ${requestId}: running (${elapsed}s elapsed)`);
      return c.json({ status: "running", request_id: requestId, elapsed });
    }

    if (job.status === "failed") {
      console.log(`[web-search] Poll ${requestId}: failed`);
      return c.json(
        { status: "failed", request_id: requestId, error: job.error || "SERP request failed." },
        500
      );
    }

    /* ── Ready ────────────────────────────────────────────────── */
    console.log(`[web-search] Poll ${requestId}: ready — returning ${Array.isArray(job.data) ? job.data.length : "?"} results`);
    return c.json({ status: "ready", request_id: requestId, data: job.data });
  } catch (err) {
    console.error("Web search status error:", err);
    return c.json({ error: "Internal server error." }, 500);
  }
});

/**
 * GET /apps/web-proxy?url=...
 *
 * Proxies a web page so it can be loaded in a same-origin iframe,
 * allowing programmatic scrolling via contentWindow.scrollBy().
 */
apps.get("/web-proxy", async (c) => {
  const targetUrl = c.req.query("url");
  if (!targetUrl) {
    return c.json({ error: '"url" query parameter is required.' }, 400);
  }

  try {
    console.log(`[web-proxy] Fetching: ${targetUrl}`);
    const res = await fetch(targetUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
      redirect: "follow",
    });

    if (!res.ok) {
      return c.json({ error: `Upstream returned ${res.status}` }, 502);
    }

    let html = await res.text();

    // Inject a <base> tag so relative URLs resolve against the original site,
    // plus a scroll-listener script so the parent can scroll via postMessage.
    const injected = `
      <base href="${targetUrl}">
      <script>
        window.addEventListener('message', function(e) {
          if (e.data && e.data.type === 'scroll') {
            window.scrollBy({ top: e.data.amount, behavior: 'smooth' });
          }
        });
      </script>
    `;
    if (html.includes("<head>")) {
      html = html.replace("<head>", `<head>${injected}`);
    } else if (html.includes("<HEAD>")) {
      html = html.replace("<HEAD>", `<HEAD>${injected}`);
    } else {
      html = injected + html;
    }

    return new Response(html, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "public, max-age=300",
      },
    });
  } catch (err) {
    console.error("[web-proxy] Error:", err);
    return c.json({ error: "Failed to fetch page." }, 502);
  }
});

/* ══════════════════════════════════════════════════════════════════
   Books (Standard Ebooks primary, Gutenberg fallback — EPUB-based)
   ══════════════════════════════════════════════════════════════════ */

interface BookMeta {
  id: number;
  title: string;
  author: string;
  coverUrl: string;
  seSlug?: string; // Standard Ebooks repo slug for reliable EPUB source
}

/** Build Standard Ebooks EPUB download URL from slug */
function seEpubUrl(slug: string): string {
  // Slug format: "author_title" or "author_title_contributor"
  // URL path: /ebooks/author/title[/contributor]/downloads/slug.epub
  // ?source=download bypasses the HTML download page and returns the actual file
  const parts = slug.split("_");
  const pathSegments = parts.join("/");
  return `https://standardebooks.org/ebooks/${pathSegments}/downloads/${slug}.epub?source=download`;
}

const CURATED_BOOKS: BookMeta[] = [
  { id: 1342, title: "Pride and Prejudice", author: "Jane Austen", coverUrl: "https://www.gutenberg.org/cache/epub/1342/pg1342.cover.medium.jpg", seSlug: "jane-austen_pride-and-prejudice" },
  { id: 11, title: "Alice's Adventures in Wonderland", author: "Lewis Carroll", coverUrl: "https://www.gutenberg.org/cache/epub/11/pg11.cover.medium.jpg", seSlug: "lewis-carroll_alices-adventures-in-wonderland_john-tenniel" },
  { id: 84, title: "Frankenstein", author: "Mary Shelley", coverUrl: "https://www.gutenberg.org/cache/epub/84/pg84.cover.medium.jpg", seSlug: "mary-shelley_frankenstein" },
  { id: 2701, title: "Moby Dick", author: "Herman Melville", coverUrl: "https://www.gutenberg.org/cache/epub/2701/pg2701.cover.medium.jpg", seSlug: "herman-melville_moby-dick" },
  { id: 98, title: "A Tale of Two Cities", author: "Charles Dickens", coverUrl: "https://www.gutenberg.org/cache/epub/98/pg98.cover.medium.jpg", seSlug: "charles-dickens_a-tale-of-two-cities" },
  { id: 1661, title: "The Adventures of Sherlock Holmes", author: "Arthur Conan Doyle", coverUrl: "https://www.gutenberg.org/cache/epub/1661/pg1661.cover.medium.jpg", seSlug: "arthur-conan-doyle_the-adventures-of-sherlock-holmes" },
  { id: 345, title: "Dracula", author: "Bram Stoker", coverUrl: "https://www.gutenberg.org/cache/epub/345/pg345.cover.medium.jpg", seSlug: "bram-stoker_dracula" },
  { id: 132, title: "The Art of War", author: "Sun Tzu", coverUrl: "https://www.gutenberg.org/cache/epub/132/pg132.cover.medium.jpg", seSlug: "sun-tzu_the-art-of-war_lionel-giles" },
  { id: 174, title: "The Picture of Dorian Gray", author: "Oscar Wilde", coverUrl: "https://www.gutenberg.org/cache/epub/174/pg174.cover.medium.jpg", seSlug: "oscar-wilde_the-picture-of-dorian-gray" },
  { id: 76, title: "Adventures of Huckleberry Finn", author: "Mark Twain", coverUrl: "https://www.gutenberg.org/cache/epub/76/pg76.cover.medium.jpg", seSlug: "mark-twain_the-adventures-of-huckleberry-finn" },
];

interface Chapter {
  title: string;
  content: string;
}

/** Server-side cache: gutenberg_id → parsed chapters */
const bookChapterCache = new Map<number, Chapter[]>();

const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "*/*",
  "Accept-Language": "en-US,en;q=0.9",
};

/** Strip HTML tags and decode entities from XHTML content */
function xhtmlToText(xhtml: string): string {
  return xhtml
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<\/h[1-6]>/gi, "\n\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, code) => String.fromCharCode(parseInt(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/\t/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Fetch and parse an EPUB, trying Standard Ebooks first then Gutenberg */
async function fetchAndParseEpub(book: BookMeta): Promise<Chapter[]> {
  const urls: string[] = [];

  // Standard Ebooks first — much more reliable than Gutenberg
  if (book.seSlug) {
    urls.push(seEpubUrl(book.seSlug));
  }

  // Gutenberg fallbacks
  urls.push(
    `https://www.gutenberg.org/ebooks/${book.id}.epub.noimages`,
    `https://www.gutenberg.org/cache/epub/${book.id}/pg${book.id}-images-3.epub`,
    `https://www.gutenberg.org/ebooks/${book.id}.epub3.images`,
  );

  let epubBuffer: ArrayBuffer | null = null;
  for (const url of urls) {
    try {
      console.log(`[books] Trying EPUB: ${url}`);
      const res = await fetch(url, { headers: BROWSER_HEADERS, redirect: "follow" });
      if (res.ok) {
        epubBuffer = await res.arrayBuffer();
        console.log(`[books] Got EPUB from: ${url} (${epubBuffer.byteLength} bytes)`);
        break;
      }
      console.log(`[books] ${url} returned ${res.status}`);
    } catch (e) {
      console.log(`[books] ${url} failed: ${e}`);
    }
  }

  if (!epubBuffer) throw new Error("Failed to fetch EPUB from all sources");

  const zip = await JSZip.loadAsync(epubBuffer);

  // Find OPF file from container.xml
  const containerXml = await zip.file("META-INF/container.xml")?.async("string");
  if (!containerXml) throw new Error("No container.xml in EPUB");

  const rootfileMatch = containerXml.match(/rootfile[^>]+full-path="([^"]+)"/);
  if (!rootfileMatch) throw new Error("No rootfile in container.xml");

  const opfPath = rootfileMatch[1];
  const opfDir = opfPath.includes("/") ? opfPath.substring(0, opfPath.lastIndexOf("/") + 1) : "";

  const opfXml = await zip.file(opfPath)?.async("string");
  if (!opfXml) throw new Error("OPF file not found");

  // Parse manifest: id → href
  const manifest = new Map<string, string>();
  const itemRegex = /<item\s[^>]*>/gi;
  let m;
  while ((m = itemRegex.exec(opfXml)) !== null) {
    const tag = m[0];
    const idMatch = tag.match(/id="([^"]+)"/);
    const hrefMatch = tag.match(/href="([^"]+)"/);
    if (idMatch && hrefMatch) {
      manifest.set(idMatch[1], hrefMatch[1]);
    }
  }

  // Parse spine: reading order
  const spineMatch = opfXml.match(/<spine[^>]*>([\s\S]*?)<\/spine>/i);
  if (!spineMatch) throw new Error("No spine in OPF");

  const spineIds: string[] = [];
  const itemrefRegex = /<itemref[^>]+idref="([^"]+)"[^>]*>/gi;
  while ((m = itemrefRegex.exec(spineMatch[1])) !== null) {
    spineIds.push(m[1]);
  }

  // Extract chapters from spine items
  const chapters: Chapter[] = [];
  let chapterNum = 1;
  for (const id of spineIds) {
    const href = manifest.get(id);
    if (!href) continue;

    // Resolve path relative to OPF directory
    const filePath = opfDir + decodeURIComponent(href);
    const xhtml = await zip.file(filePath)?.async("string");
    if (!xhtml) continue;

    // Extract title from <title> or first heading
    const titleMatch =
      xhtml.match(/<h[12][^>]*>([\s\S]*?)<\/h[12]>/i) ||
      xhtml.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    let title = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, "").trim() : "";

    // Clean up generic titles
    if (!title || title.length > 80 || title.toLowerCase().includes("gutenberg")) {
      title = `Chapter ${chapterNum}`;
    }

    // Skip Standard Ebooks boilerplate sections
    const titleLower = title.toLowerCase();
    if (["titlepage", "imprint", "colophon", "uncopyright", "endnotes", "loi"].includes(titleLower)) continue;

    const text = xhtmlToText(xhtml);
    if (text.length < 100) continue; // Skip empty/very short boilerplate chapters

    chapters.push({ title, content: text });
    chapterNum++;
  }

  return chapters;
}

apps.get("/books", async (c) => {
  return c.json({ books: CURATED_BOOKS });
});

apps.get("/book-content/:id", async (c) => {
  const gutenbergId = parseInt(c.req.param("id"), 10);
  if (isNaN(gutenbergId)) {
    return c.json({ error: "Invalid book ID." }, 400);
  }

  const book = CURATED_BOOKS.find((b) => b.id === gutenbergId);
  if (!book) {
    return c.json({ error: "Book not found." }, 404);
  }

  const chapter = parseInt(c.req.query("chapter") || c.req.query("page") || "0", 10);

  try {
    let chapters = bookChapterCache.get(gutenbergId);

    if (!chapters) {
      console.log(`[books] Fetching EPUB for "${book.title}" (ID ${gutenbergId}, SE: ${book.seSlug || "none"})`);
      chapters = await fetchAndParseEpub(book);
      bookChapterCache.set(gutenbergId, chapters);

      if (bookChapterCache.size > 20) {
        const oldest = bookChapterCache.keys().next().value;
        if (oldest !== undefined) bookChapterCache.delete(oldest);
      }

      console.log(`[books] Cached ${gutenbergId}: ${chapters.length} chapters`);
    }

    if (chapters.length === 0) {
      return c.json({ error: "No readable chapters found." }, 500);
    }

    const safeChapter = Math.max(0, Math.min(chapter, chapters.length - 1));
    const ch = chapters[safeChapter];

    return c.json({
      content: ch.content,
      chapterTitle: ch.title,
      chapter: safeChapter,
      totalChapters: chapters.length,
      // Backwards-compat aliases
      page: safeChapter,
      totalPages: chapters.length,
    });
  } catch (err) {
    console.error("[books] Error:", err);
    return c.json({ error: "Failed to fetch book content." }, 500);
  }
});

export default apps;
