/**
 * upload.ts — POST /upload Route & uploadChunk() Helper
 *
 * Accepts a piece of text (e.g. a transcript chunk), generates an embedding
 * via OpenAI, and indexes the text + embedding into the Elasticsearch
 * `person-context` index for later kNN retrieval.
 *
 * Also exports the `uploadChunk()` helper so other routes (e.g. `/long`)
 * can reuse the embed-and-index pipeline without duplicating logic.
 *
 * This is how the vector DB builds up over time — each call adds more
 * personal context that future queries can draw from.
 *
 * Parent: mounted by src/index.ts at `/upload`
 *
 * Exported helper:
 *   uploadChunk(text, speaker, source) → { id: string }
 *
 * Request body (JSON):
 *   - text:    string — the content to store (required).
 *   - speaker: string — optional label for who said it (e.g. "Ian").
 *   - source:  string — optional label for the data source (e.g. "transcript",
 *                        "notes", "calendar"). Defaults to "transcript".
 *
 * Response (JSON):
 *   - success: boolean
 *   - id:      string — the Elasticsearch document ID.
 *
 * Dependencies: lib/elasticsearch.ts, lib/embeddings.ts
 * Used by: routes/long.ts (imports uploadChunk)
 */

import { Hono } from "hono";
import { esClient, INDEX_NAME } from "../lib/elasticsearch";
import { embed } from "../lib/embeddings";

const upload = new Hono();

/**
 * uploadChunk — embeds a piece of text and indexes it into Elasticsearch.
 *
 * This is the core "embed + store" logic extracted so it can be called
 * from the /upload route handler AND from routes/long.ts for bulk ingestion.
 *
 * @param text     The text content to embed and store.
 * @param speaker  Who said it (nullable, e.g. "Ian").
 * @param source   Data-source label (e.g. "transcript", "notes"). Non-nullable.
 * @returns        An object with the Elasticsearch document `id`.
 */
export async function uploadChunk(
  text: string,
  speaker: string | null,
  source: string
): Promise<{ id: string }> {
  const embedding = await embed(text);

  const result = await esClient.index({
    index: INDEX_NAME,
    document: {
      content: text,
      speaker,
      source,
      embedding,
      created_at: new Date().toISOString(),
    },
  });

  return { id: result._id };
}

/**
 * POST / — upload a single chunk of personal context.
 *
 * @input  { text: string, speaker?: string, source?: string }
 * @output { success: true, id: string } | { error: string }
 */
upload.post("/", async (c) => {
  try {
    const body = await c.req.json<{
      text?: string;
      speaker?: string;
      source?: string;
    }>();

    /* ── Validate ──────────────────────────────────────────── */
    if (!body.text || body.text.trim().length === 0) {
      return c.json(
        { error: '"text" is required and must be non-empty.' },
        400
      );
    }

    const text = body.text.trim();
    const speaker = body.speaker?.trim() || null;
    const source = body.source?.trim() || "transcript";

    /* ── Embed & index via helper ─────────────────────────── */
    const { id } = await uploadChunk(text, speaker, source);

    return c.json({ success: true, id });
  } catch (err) {
    console.error("Upload error:", err);
    return c.json({ error: "Internal server error." }, 500);
  }
});

export default upload;
