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
 *   - app:    string  — the app name to generate for (required).
 *                        Must match a key in APP_CONFIGS (case-insensitive).
 *                        Currently supported: "Amazon", "Web Search".
 *   - person: string  — the persona whose context to search (required,
 *                        e.g. "ian", "hagrid"). Used as a kNN filter so only
 *                        that person's data is retrieved.
 *   - text:   string  — optional text to focus/narrow the generation.
 *                        E.g. "camping gear" to get camping-related product ideas.
 *   - k:      number  — how many context chunks to retrieve (default 5, max 20).
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

  /**
   * buildUserMessage — creates the user message sent to Cerebras.
   *
   * @param text  Optional user-supplied text to focus the output.
   * @returns     A user message string.
   */
  buildUserMessage: (text?: string) => string;

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
    /**
     * Amazon user message — asks for product ideas with optional focus text.
     *
     * @param text  Optional focus keyword(s).
     * @returns     User message string.
     */
    buildUserMessage(text?: string): string {
      return text
        ? `Generate product ideas focused on: ${text}`
        : "Generate product ideas based on my context.";
    },
  },
  websearch: {
    label: "Web Search",
    maxTokens: 1024,

    /**
     * Web Search prompt — generates 20 practical web search queries grounded in personal context.
     *
     * The prompt explicitly asks: "What are 20 search queries that make sense?"
     * If `text` is provided, the queries are constrained to that topic.
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
        : "Generate broad web search queries based on the person's interests, needs, and current context.";

      return `You are a personalized web research assistant.

Question to answer:
"What are 20 search queries that make sense?"

Personal context:
${contextBlock}

${focusLine}

Instructions:
- Generate exactly 20 search queries.
- Each query should be realistic and useful in a web search engine.
- Keep each query concise (3-12 words).
- Ground every query in the context; avoid generic filler.
- Return ONLY a JSON array of 20 strings. No descriptions, no objects, no extra text, no markdown fences, no explanation.

Example format:
["best lightweight camping stove","how to improve deep sleep routine","beginner trail running hydration tips"]`;
    },
    /**
     * Web Search user message — asks for search queries with optional focus text.
     *
     * @param text  Optional focus keyword(s).
     * @returns     User message string.
     */
    buildUserMessage(text?: string): string {
      return text
        ? `Generate web search queries focused on: ${text}`
        : "Generate web search queries based on my context.";
    },
  },
  "web search": {
    label: "Web Search",
    maxTokens: 1024,

    /**
     * Web Search alias prompt — delegates to the primary websearch config.
     *
     * @param chunks  Retrieved personal context chunks.
     * @param text    Optional focus keyword(s).
     * @returns       System prompt string.
     */
    buildPrompt(chunks: ContextChunk[], text?: string): string {
      return APP_CONFIGS.websearch.buildPrompt(chunks, text);
    },
    /**
     * Web Search alias user message — delegates to the primary websearch config.
     *
     * @param text  Optional focus keyword(s).
     * @returns     User message string.
     */
    buildUserMessage(text?: string): string {
      return APP_CONFIGS.websearch.buildUserMessage(text);
    },
  },

  chat: {
    label: "Chat",
    maxTokens: 1024,

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
        ? `The user just received this response from ChatGPT: "${text}". Generate follow-up messages the user would type next to continue or deepen the conversation.`
        : "Generate messages the user would type into ChatGPT based on their interests and life context.";

      return `You are generating suggested messages that a user would TYPE INTO ChatGPT. These are things the user wants to SAY TO the AI, not things the AI says to the user.

You have personal context about this user — their interests, conversations, habits, and preferences. Use it to generate messages they'd actually want to send to ChatGPT.

Personal context:
${contextBlock}

${focusLine}

Instructions:
- Generate exactly 8 messages that the user would type into ChatGPT's text input.
- Write them in FIRST PERSON from the user's perspective — as if the user is typing them.
- Each should be 5-20 words, phrased naturally as a request, question, or command to ChatGPT.
- Ground every message in the user's personal context — don't generate generic prompts.
- Mix types: some asking for help, some requesting explanations, some creative requests, some practical tasks.
- Return ONLY a JSON array of 8 strings. No descriptions, no objects, no extra text, no markdown fences, no explanation.

Example format:
["Help me plan a weekend camping trip near Seattle","What's the best way to train for a half marathon?","Write me a meal plan for this week","Explain how noise-canceling headphones work"]`;
    },

    buildUserMessage(text?: string): string {
      return text
        ? `Generate messages the user would type as follow-ups after receiving: ${text}`
        : "Generate messages the user would type into ChatGPT based on their context.";
    },
  },

  chatgpt: {
    label: "Chat",
    maxTokens: 1024,
    buildPrompt(chunks: ContextChunk[], text?: string): string {
      return APP_CONFIGS.chat.buildPrompt(chunks, text);
    },
    buildUserMessage(text?: string): string {
      return APP_CONFIGS.chat.buildUserMessage(text);
    },
  },

  talk: {
    label: "Talk",
    maxTokens: 1024,

    buildPrompt(chunks: ContextChunk[], text?: string): string {
      let transcript = "(No conversation captured yet.)";
      let speakerInfo = "";

      if (text) {
        try {
          const parsed = JSON.parse(text);
          transcript = parsed.transcript || transcript;
          const sp = parsed.selectedSpeaker;
          const count = parsed.speakerCount || 2;
          speakerInfo = `The user wants to respond to Speaker ${sp + 1} (out of ${count} speakers). Generate replies to what Speaker ${sp + 1} has been saying in the conversation.`;
        } catch {
          transcript = text;
        }
      }

      const contextBlock =
        chunks.length > 0
          ? chunks
              .map(
                (c, i) =>
                  `[${i + 1}] ${c.speaker ? `(${c.speaker}) ` : ""}${c.content}`
              )
              .join("\n")
          : "(No additional personal context found.)";

      return `You are a conversational response generator for a person who communicates through an assistive blink-detection interface. You have access to both the live conversation transcript and personal context about the user.

Live conversation transcript:
${transcript}

${speakerInfo}

Personal context about the user:
${contextBlock}

Instructions:
- Based on the conversation above, generate 6 short response options that the user could say in reply to the identified speaker.
- Each response should be 3-15 words — short enough to be spoken naturally.
- Make responses contextually appropriate to what was just said in the conversation.
- Vary the tone: include some agreeable, some questioning, some redirecting options.
- Use the personal context to personalize responses where relevant.
- The first option should be the most natural/likely response.
- Return ONLY a JSON array of 6 strings. No descriptions, no objects, no extra text, no markdown fences, no explanation.

Example format:
["That sounds great, let's do it","I'm not sure about that","Can you tell me more?","I was actually thinking about something else","Yeah, I agree completely","What time works for you?"]`;
    },
    /**
     * Talk user message — asks for short conversational response options.
     *
     * @param text  Optional serialized transcript payload.
     * @returns     User message string.
     */
    buildUserMessage(text?: string): string {
      return text
        ? "Generate reply options based on this conversation context."
        : "Generate reply options based on the current conversation.";
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
 * @input  { app: string, person: string, text?: string, k?: number }
 * @output { app, query, context, result }
 *       | { app, query, context, rawResult } (if JSON parse fails)
 *       | { error, supportedApps? }
 */
getContext.post("/", async (c) => {
  try {
    const body = await c.req.json<{
      app?: string;
      person?: string;
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

    /* ── Validate person ──────────────────────────────────── */
    if (!body.person || body.person.trim().length === 0) {
      return c.json(
        { error: '"person" is required and must be a non-empty string.' },
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

    const person = body.person.trim().toLowerCase();
    const text = body.text?.trim() || undefined;
    const k = Math.min(Math.max(body.k ?? DEFAULT_K, 1), MAX_K);

    /* ── Build & embed the query ──────────────────────────── */
    const query = buildQuery(config.label, text);
    console.log(
      `🔍 getContext: app="${config.label}" person="${person}" query="${query}" k=${k}`
    );

    const queryEmbedding = await embed(query);

    /* ── kNN search against Elasticsearch (scoped to person) ── */
    const searchResult = await esClient.search({
      index: INDEX_NAME,
      knn: {
        field: "embedding",
        query_vector: queryEmbedding,
        k,
        num_candidates: KNN_NUM_CANDIDATES,
        filter: { term: { person } },
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

    const userMessage = config.buildUserMessage(text);

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
