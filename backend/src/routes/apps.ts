import { Hono } from "hono";

const apps = new Hono();

const BRIGHTDATA_BASE = "https://api.brightdata.com/datasets/v3";

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

export default apps;
