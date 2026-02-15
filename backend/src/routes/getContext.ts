/**
 * getContext.ts — POST /getContext Route
 *
 * Given an app name (e.g. "Amazon") and optional free-text, retrieves
 * relevant personal context from Elasticsearch via kNN vector search,
 * then feeds it into an app-specific Cerebras prompt to generate
 * structured output (e.g. 20 product ideas for Amazon).
 *
 * Each supported app has its own prompt template and output shape,
 * defined in the APP_CONFIGS map. To add a new app, add an entry there.
 *
 * Parent: mounted by src/index.ts at `/getContext`
 *
 * Request body (JSON):
 *   - app:  string  — the app name to generate for (required).
 *                      Must match a key in APP_CONFIGS (case-insensitive).
 *                      Currently supported: "Amazon".
 *   - text: string  — optional text to focus/narrow the generation.
 *                      E.g. "camping gear" to get camping-related product ideas.
 *   - k:    number  — how many context chunks to retrieve (default 5, max 20).
 *
 * Response (JSON):
 *   - app:     string  — the app that was queried.
 *   - query:   string  — the full query string that was embedded.
 *   - context: Array<{ content, speaker, source, score }> — retrieved chunks.
 *   - result:  object  — the app-specific generated output (shape varies by app).
 *              For Amazon: string[] (20 product idea names)
 *   - rawResult?: string — present only if the LLM output could not be parsed
 *                          as JSON; contains the raw text so the client still
 *                          gets something useful.
 *
 * Dependencies: lib/elasticsearch.ts, lib/embeddings.ts, lib/cerebras.ts
 */

import { Hono } from "hono";
import { esClient, INDEX_NAME } from "../lib/elasticsearch";
import { embed } from "../lib/embeddings";
import { generateResponse, type DialogMessage } from "../lib/cerebras";

const getContext = new Hono();

/* ── Constants ─────────────────────────────────────────────── */

/** Default number of context chunks to retrieve. */
const DEFAULT_K = 5;

/** Maximum allowed value for k. */
const MAX_K = 20;

/** How many candidates Elasticsearch considers during the kNN graph walk. */
const KNN_NUM_CANDIDATES = 100;

/* ── Types ─────────────────────────────────────────────────── */

/** Shape of a retrieved context chunk (returned by kNN search). */
interface ContextChunk {
  content: string;
  speaker: string | null;
  source: string | null;
  score: number;
}

/**
 * AppConfig — configuration for a single supported app.
 *
 * Each app defines how to build its Cerebras prompt and how many
 * max tokens the LLM should use for generation.
 */
interface AppConfig {
  /** Human-readable label for the app. */
  label: string;

  /**
   * buildPrompt — creates the system prompt for Cerebras.
   *
   * @param chunks  The relevant context chunks from Elasticsearch.
   * @param text    Optional user-supplied text to focus the output.
   * @returns       A system prompt string.
   */
  buildPrompt: (chunks: ContextChunk[], text?: string) => string;

  /** Max tokens for the Cerebras response (needs to be higher for large outputs). */
  maxTokens: number;
}

/* ── App Configs ───────────────────────────────────────────── */

/**
 * APP_CONFIGS — maps lowercase app names to their configuration.
 *
 * To add a new app, create an entry here with a buildPrompt function
 * and maxTokens value. The route handler picks the right config
 * automatically based on the incoming `app` field.
 */
const APP_CONFIGS: Record<string, AppConfig> = {
  amazon: {
    label: "Amazon",
    maxTokens: 1024,

    /**
     * Amazon prompt — generates 20 Amazon search queries grounded in personal context.
     *
     * Each query is phrased the way a real person would type into Amazon's
     * search bar (2-5 words). These are used directly as BrightData scrape
     * keywords, so they must be concrete and searchable.
     *
     * If `text` is provided, the queries are narrowed to that topic/keyword.
     * Otherwise, broad queries are generated from the context alone.
     * Returns a flat JSON array of 20 strings.
     *
     * @param chunks  Retrieved personal context chunks.
     * @param text    Optional focus keyword(s).
     * @returns       System prompt string.
     */
    buildPrompt(chunks: ContextChunk[], text?: string): string {
      const contextBlock =
        chunks.length > 0
          ? chunks
              .map(
                (c, i) =>
                  `[${i + 1}] ${c.speaker ? `(${c.speaker}) ` : ""}${c.content}`
              )
              .join("\n")
          : "(No relevant context found.)";

      const focusLine = text
        ? `The user is specifically interested in: "${text}". Focus the search queries around this topic.`
        : "Generate broad product search queries based on the person's interests, needs, and context.";

      return `You are a personalized product recommendation engine for Amazon. You have access to personal context about a user — their interests, conversations, habits, and preferences. Use this context to generate Amazon search queries for products that would genuinely appeal to this specific person.

Personal context:
${contextBlock}

${focusLine}

Instructions:
- Generate exactly 20 product ideas.
- Each idea should be a short product name (2-8 words). Just the name, nothing else.
- Ground every idea in something from the context — don't just make generic products.
- Be creative and specific.
- Return ONLY a JSON array of 20 strings. No descriptions, no objects, no extra text, no markdown fences, no explanation.

Example format:
["camping solar lantern","portable espresso maker","waterproof hiking journal"]`;
    },
  },
};

/** List of supported app names (for error messages). */
const SUPPORTED_APPS = Object.values(APP_CONFIGS).map((c) => c.label);

/* ── Helpers ───────────────────────────────────────────────── */

/**
 * buildQuery — assembles the search query from the app name and optional text.
 *
 * If only the app is provided the query is just the app name. When text
 * is also supplied, the two are combined so the embedding captures both
 * the app context and the specific question / topic.
 *
 * @param app   The app / product name (e.g. "Amazon").
 * @param text  Optional additional search text.
 * @returns     A single query string ready to be embedded.
 */
function buildQuery(app: string, text?: string): string {
  if (text && text.trim().length > 0) {
    return `${app}: ${text.trim()}`;
  }
  return app;
}

/**
 * tryParseJson — attempts to parse a string as JSON.
 *
 * The LLM sometimes wraps JSON in markdown code fences or adds preamble
 * text. This helper strips common wrappers before parsing.
 *
 * @param raw  The raw string from the LLM.
 * @returns    The parsed value, or null if parsing fails.
 */
function tryParseJson(raw: string): unknown | null {
  /* Strip markdown code fences if present. */
  let cleaned = raw.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
  }

  /* Try to extract a JSON array even if there's surrounding text. */
  const arrayMatch = cleaned.match(/\[[\s\S]*\]/);
  if (arrayMatch) {
    try {
      return JSON.parse(arrayMatch[0]);
    } catch {
      /* fall through */
    }
  }

  /* Direct parse as a last resort. */
  try {
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

/* ── Route handler ─────────────────────────────────────────── */

/**
 * POST / — retrieve personal context and generate app-specific output.
 *
 * @input  { app: string, text?: string, k?: number }
 * @output { app, query, context, result }
 *       | { app, query, context, rawResult } (if JSON parse fails)
 *       | { error, supportedApps? }
 */
getContext.post("/", async (c) => {
  try {
    const body = await c.req.json<{
      app?: string;
      text?: string;
      k?: number;
    }>();

    /* ── Validate app ─────────────────────────────────────── */
    if (!body.app || body.app.trim().length === 0) {
      return c.json(
        { error: '"app" is required and must be a non-empty string.' },
        400
      );
    }

    const appRaw = body.app.trim();
    const appKey = appRaw.toLowerCase();
    const config = APP_CONFIGS[appKey];

    if (!config) {
      return c.json(
        {
          error: `Unsupported app "${appRaw}". Supported apps: ${SUPPORTED_APPS.join(", ")}.`,
          supportedApps: SUPPORTED_APPS,
        },
        400
      );
    }

    const text = body.text?.trim() || undefined;
    const k = Math.min(Math.max(body.k ?? DEFAULT_K, 1), MAX_K);

    /* ── Build & embed the query ──────────────────────────── */
    const query = buildQuery(config.label, text);
    console.log(
      `🔍 getContext: app="${config.label}" query="${query}" k=${k}`
    );

    const queryEmbedding = await embed(query);

    /* ── kNN search against Elasticsearch ─────────────────── */
    const searchResult = await esClient.search({
      index: INDEX_NAME,
      knn: {
        field: "embedding",
        query_vector: queryEmbedding,
        k,
        num_candidates: KNN_NUM_CANDIDATES,
      },
      _source: ["content", "speaker", "source"],
    });

    const context: ContextChunk[] = searchResult.hits.hits.map((hit) => {
      const src = hit._source as {
        content: string;
        speaker: string | null;
        source: string | null;
      };
      return {
        content: src.content,
        speaker: src.speaker,
        source: src.source,
        score: hit._score ?? 0,
      };
    });

    /* ── Generate app-specific output via Cerebras ────────── */
    const systemPrompt = config.buildPrompt(context, text);

    const userMessage = text
      ? `Generate product ideas focused on: ${text}`
      : "Generate product ideas based on my context.";

    const dialog: DialogMessage[] = [{ role: "user", content: userMessage }];

    const rawLlmOutput = await generateResponse(
      systemPrompt,
      dialog,
      config.maxTokens
    );

    /* ── Parse the LLM output ─────────────────────────────── */
    const parsed = tryParseJson(rawLlmOutput);

    if (parsed !== null) {
      return c.json({
        app: config.label,
        query,
        context,
        result: parsed,
      });
    }

    /* JSON parse failed — return raw text so client still gets value. */
    console.warn(
      `⚠️  getContext: LLM output for "${config.label}" was not valid JSON. Returning rawResult.`
    );
    return c.json({
      app: config.label,
      query,
      context,
      result: null,
      rawResult: rawLlmOutput,
    });
  } catch (err) {
    console.error("getContext error:", err);
    return c.json({ error: "Internal server error." }, 500);
  }
});

export default getContext;
