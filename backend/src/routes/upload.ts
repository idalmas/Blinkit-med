/**
 * upload.ts — POST /upload Route
 *
 * Accepts a piece of text (e.g. a transcript chunk), generates an embedding
 * via OpenAI, and indexes the text + embedding into the Elasticsearch
 * `person-context` index for later kNN retrieval.
 *
 * This is how the vector DB builds up over time — each call adds more
 * personal context that future queries can draw from.
 *
 * Parent: mounted by src/index.ts at `/upload`
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
 */

import { Hono } from "hono";
import { esClient, INDEX_NAME } from "../lib/elasticsearch";
import { embed } from "../lib/embeddings";

const upload = new Hono();

/**
 * POST / — upload a chunk of personal context.
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

    /* ── Embed ─────────────────────────────────────────────── */
    const embedding = await embed(text);

    /* ── Index into Elasticsearch ──────────────────────────── */
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

    return c.json({ success: true, id: result._id });
  } catch (err) {
    console.error("Upload error:", err);
    return c.json({ error: "Internal server error." }, 500);
  }
});

export default upload;
