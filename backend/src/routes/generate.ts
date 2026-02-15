/**
 * generate.ts — POST /generate Route
 *
 * Takes a user prompt (and optional conversation history), performs kNN
 * vector search against the Elasticsearch `person-context` index to
 * retrieve the most relevant stored context, then calls Cerebras to
 * return a single personalized response.
 *
 * The more data that has been uploaded over time, the better the context
 * retrieval — and therefore the more personalized the response.
 *
 * Parent: mounted by src/index.ts at `/generate`
 *
 * Request body (JSON):
 *   - dialog: Array<{ role: "user" | "assistant", content: string }>
 *             The conversation so far. The last user message is used as
 *             the kNN query.
 *
 * Response (JSON):
 *   - response: string           — the generated response.
 *   - context:  Array<{ content, speaker, source, score }> — the retrieved
 *               chunks (for transparency / debugging).
 *
 * Dependencies: lib/elasticsearch.ts, lib/embeddings.ts, lib/cerebras.ts
 */

import { Hono } from "hono";
import { esClient, INDEX_NAME } from "../lib/elasticsearch";
import { embed } from "../lib/embeddings";
import { generateResponse, type DialogMessage } from "../lib/cerebras";

const generate = new Hono();

/** How many chunks to retrieve from the vector store. */
const RAG_TOP_K = 5;

/** How many candidates Elasticsearch considers during kNN graph walk. */
const KNN_NUM_CANDIDATES = 100;

/**
 * buildSystemPrompt — constructs the system prompt with RAG context injected.
 *
 * @param chunks  The relevant context chunks retrieved from Elasticsearch.
 * @returns       A system prompt string for the LLM.
 */
function buildSystemPrompt(
  chunks: { content: string; speaker: string | null; source: string | null; score: number }[]
): string {
  const contextBlock =
    chunks.length > 0
      ? chunks
          .map(
            (c, i) =>
              `[${i + 1}] ${c.speaker ? `(${c.speaker}) ` : ""}${c.content}`
          )
          .join("\n")
      : "(No relevant context found yet.)";

  return `You are a helpful conversational assistant. You have access to relevant personal context excerpts that have been collected over time. Use them to ground your responses in that person's actual voice, style, and knowledge.

Relevant context:
${contextBlock}

Instructions:
- Respond naturally and conversationally.
- Draw on the context when relevant, but don't force it.
- Keep responses concise (1-3 sentences unless more detail is clearly needed).
- As more context becomes available over time, your responses will become more personalized.`;
}

/**
 * POST / — generate a personalized response for a dialog.
 *
 * @input  { dialog: DialogMessage[] }
 * @output { response: string, context: object[] } | { error: string }
 */
generate.post("/", async (c) => {
  try {
    const body = await c.req.json<{ dialog?: DialogMessage[] }>();

    /* ── Validate ──────────────────────────────────────────── */
    if (
      !body.dialog ||
      !Array.isArray(body.dialog) ||
      body.dialog.length === 0
    ) {
      return c.json(
        { error: '"dialog" is required and must be a non-empty array.' },
        400
      );
    }

    /* ── Find the last user message to use as kNN query ───── */
    const lastUserMsg = [...body.dialog]
      .reverse()
      .find((m) => m.role === "user");

    if (!lastUserMsg) {
      return c.json(
        { error: "Dialog must contain at least one user message." },
        400
      );
    }

    /* ── Embed the query ───────────────────────────────────── */
    const queryEmbedding = await embed(lastUserMsg.content);

    /* ── kNN search against Elasticsearch ──────────────────── */
    const searchResult = await esClient.search({
      index: INDEX_NAME,
      knn: {
        field: "embedding",
        query_vector: queryEmbedding,
        k: RAG_TOP_K,
        num_candidates: KNN_NUM_CANDIDATES,
      },
      _source: ["content", "speaker", "source"],
    });

    const relevantChunks = searchResult.hits.hits.map((hit) => {
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

    /* ── Build prompt & generate ───────────────────────────── */
    const systemPrompt = buildSystemPrompt(relevantChunks);
    const response = await generateResponse(systemPrompt, body.dialog);

    return c.json({ response, context: relevantChunks });
  } catch (err) {
    console.error("Generate error:", err);
    return c.json({ error: "Internal server error." }, 500);
  }
});

export default generate;
