/**
 * generate.ts — POST /generate Route
 *
 * Takes a conversation dialog, performs RAG against the Supabase vector store
 * to retrieve relevant transcript context, then calls Cerebras twice
 * (different temperature/seed) to return two distinct response options.
 *
 * Parent: mounted by src/index.ts at `/generate`
 *
 * Request body (JSON):
 *   - dialog: Array<{ role: "user" | "assistant", content: string }>
 *             The conversation so far. The last user message is used as the
 *             RAG query.
 *
 * Response (JSON):
 *   - options: [string, string] — two response suggestions.
 *   - context: Array<{ content: string, speaker: string | null, similarity: number }>
 *              The retrieved RAG chunks (for transparency / debugging).
 *
 * Dependencies: lib/supabase.ts, lib/embeddings.ts, lib/cerebras.ts
 */

import { Hono } from "hono";
import { supabase } from "../lib/supabase";
import { embed } from "../lib/embeddings";
import { generateTwoOptions, type DialogMessage } from "../lib/cerebras";

const generate = new Hono();

/** How many chunks to retrieve from the vector store. */
const RAG_TOP_K = 5;

/** Minimum cosine similarity to include a chunk. */
const RAG_THRESHOLD = 0.3;

/**
 * buildSystemPrompt — constructs the system prompt with RAG context injected.
 *
 * @param chunks  The relevant transcript chunks retrieved from Supabase.
 * @returns       A system prompt string for the LLM.
 */
function buildSystemPrompt(
  chunks: { content: string; speaker: string | null; similarity: number }[]
): string {
  const contextBlock =
    chunks.length > 0
      ? chunks
          .map(
            (c, i) =>
              `[${i + 1}] ${c.speaker ? `(${c.speaker}) ` : ""}${c.content}`
          )
          .join("\n")
      : "(No relevant context found.)";

  return `You are a helpful conversational assistant. You have access to relevant transcript excerpts from a real person. Use them to ground your responses in that person's actual voice, style, and knowledge.

Relevant transcript context:
${contextBlock}

Instructions:
- Respond naturally and conversationally.
- Draw on the transcript context when relevant, but don't force it.
- Keep responses concise (1-3 sentences unless more detail is clearly needed).`;
}

/**
 * POST / — generate two response options for a dialog.
 *
 * @input  { dialog: DialogMessage[] }
 * @output { options: [string, string], context: object[] } | { error: string }
 */
generate.post("/", async (c) => {
  try {
    const body = await c.req.json<{ dialog?: DialogMessage[] }>();

    /* ── Validate ──────────────────────────────────────────── */
    if (!body.dialog || !Array.isArray(body.dialog) || body.dialog.length === 0) {
      return c.json(
        { error: "\"dialog\" is required and must be a non-empty array." },
        400
      );
    }

    /* ── Find the last user message to use as RAG query ───── */
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

    /* ── RAG: similarity search ────────────────────────────── */
    const { data: chunks, error: ragError } = await supabase.rpc(
      "match_documents",
      {
        query_embedding: JSON.stringify(queryEmbedding),
        match_threshold: RAG_THRESHOLD,
        match_count: RAG_TOP_K,
      }
    );

    if (ragError) {
      console.error("RAG search error:", ragError);
      // Don't fail — just proceed without context.
    }

    const relevantChunks: {
      content: string;
      speaker: string | null;
      similarity: number;
    }[] = chunks ?? [];

    /* ── Build prompt & generate ───────────────────────────── */
    const systemPrompt = buildSystemPrompt(relevantChunks);
    const options = await generateTwoOptions(systemPrompt, body.dialog);

    return c.json({ options, context: relevantChunks });
  } catch (err) {
    console.error("Generate error:", err);
    return c.json({ error: "Internal server error." }, 500);
  }
});

export default generate;
