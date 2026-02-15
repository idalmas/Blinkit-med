/**
 * long.ts — POST /long Route
 *
 * Accepts a large body of text (e.g. an entire transcript, essay, or journal
 * entry), splits it into overlapping chunks, embeds each chunk via OpenAI,
 * and indexes every chunk into the Elasticsearch `person-context` index.
 *
 * This is the "bulk ingest" counterpart to the single-chunk `/upload` route.
 * Use it when you have a big piece of text and want all of it stored as
 * searchable context without manually splitting it yourself.
 *
 * Chunking strategy:
 *   1. Split on paragraph boundaries (double newlines).
 *   2. Merge consecutive paragraphs until the target chunk size is reached.
 *   3. Adjacent chunks overlap by `chunkOverlap` characters so that
 *      sentences straddling a boundary aren't lost.
 *
 * Parent: mounted by src/index.ts at `/long`
 *
 * Request body (JSON):
 *   - text:         string  — the full text to chunk and upload (required).
 *   - speaker:      string  — optional label for who said it (e.g. "Ian").
 *   - source:       string  — optional label for the data source. Defaults
 *                              to "transcript".
 *   - chunkSize:    number  — target max characters per chunk. Defaults to 800.
 *   - chunkOverlap: number  — character overlap between adjacent chunks.
 *                              Defaults to 100.
 *
 * Response (JSON):
 *   - success:    boolean
 *   - totalChunks: number   — how many chunks were created.
 *   - ids:        string[]  — the Elasticsearch document IDs for every chunk.
 *
 * Dependencies: lib/elasticsearch.ts, lib/embeddings.ts
 */

import { Hono } from "hono";
import { esClient, INDEX_NAME } from "../lib/elasticsearch";
import { embed } from "../lib/embeddings";

const long = new Hono();

/** Default target size (in characters) for each chunk. */
const DEFAULT_CHUNK_SIZE = 800;

/** Default overlap (in characters) between adjacent chunks. */
const DEFAULT_CHUNK_OVERLAP = 100;

/**
 * chunkText — splits a long string into overlapping chunks.
 *
 * Strategy:
 *   1. Split the text on paragraph boundaries (double newlines).
 *   2. Walk through the paragraphs, accumulating them into a "window" until
 *      the window exceeds `chunkSize`.
 *   3. Emit the window as a chunk and start the next window with enough
 *      trailing content to provide `chunkOverlap` characters of overlap.
 *   4. If a single paragraph is longer than `chunkSize`, hard-split it at
 *      the character level so nothing is silently dropped.
 *
 * @param text          The full text to chunk.
 * @param chunkSize     Target max characters per chunk.
 * @param chunkOverlap  Character overlap between adjacent chunks.
 * @returns             An array of chunk strings.
 */
function chunkText(
  text: string,
  chunkSize: number,
  chunkOverlap: number
): string[] {
  /* Normalise whitespace and split on paragraph boundaries. */
  const paragraphs = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);

  if (paragraphs.length === 0) return [];

  const chunks: string[] = [];
  let window = "";

  for (const para of paragraphs) {
    /* If adding this paragraph stays within the limit, accumulate. */
    if (window.length + (window.length > 0 ? 2 : 0) + para.length <= chunkSize) {
      window += (window.length > 0 ? "\n\n" : "") + para;
      continue;
    }

    /* If the window already has content, emit it before starting fresh. */
    if (window.length > 0) {
      chunks.push(window);
      /* Start the next window with an overlap tail from the previous. */
      const overlapStart = Math.max(0, window.length - chunkOverlap);
      window = window.slice(overlapStart).trimStart();
    }

    /* Handle paragraphs that are themselves larger than the chunk size. */
    if (para.length > chunkSize) {
      let offset = 0;
      while (offset < para.length) {
        const slice = para.slice(offset, offset + chunkSize);
        if (window.length > 0) {
          chunks.push(window);
          window = "";
        }
        chunks.push(slice);
        offset += chunkSize - chunkOverlap;
      }
      /* Carry over the tail of the last hard-split slice as the new window. */
      const lastChunk = chunks[chunks.length - 1];
      window = lastChunk.slice(Math.max(0, lastChunk.length - chunkOverlap)).trimStart();
      continue;
    }

    /* Begin a new window with the current paragraph. */
    window += (window.length > 0 ? "\n\n" : "") + para;
  }

  /* Flush any remaining content in the window. */
  if (window.trim().length > 0) {
    chunks.push(window.trim());
  }

  return chunks;
}

/**
 * POST / — chunk a long text and bulk-upload all chunks.
 *
 * @input  { text: string, speaker?: string, source?: string,
 *           chunkSize?: number, chunkOverlap?: number }
 * @output { success: true, totalChunks: number, ids: string[] }
 *       | { error: string }
 */
long.post("/", async (c) => {
  try {
    const body = await c.req.json<{
      text?: string;
      speaker?: string;
      source?: string;
      chunkSize?: number;
      chunkOverlap?: number;
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
    const chunkSize = body.chunkSize ?? DEFAULT_CHUNK_SIZE;
    const chunkOverlap = body.chunkOverlap ?? DEFAULT_CHUNK_OVERLAP;

    if (chunkOverlap >= chunkSize) {
      return c.json(
        { error: '"chunkOverlap" must be less than "chunkSize".' },
        400
      );
    }

    /* ── Chunk ─────────────────────────────────────────────── */
    const chunks = chunkText(text, chunkSize, chunkOverlap);

    if (chunks.length === 0) {
      return c.json(
        { error: "Text produced no usable chunks after splitting." },
        400
      );
    }

    console.log(
      `📝 Long upload: ${text.length} chars → ${chunks.length} chunks ` +
        `(target ${chunkSize}, overlap ${chunkOverlap})`
    );

    /* ── Embed all chunks (parallel, batched by 5 to respect rate limits) ── */
    const BATCH_SIZE = 5;
    const embeddings: number[][] = [];

    for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
      const batch = chunks.slice(i, i + BATCH_SIZE);
      const batchEmbeddings = await Promise.all(batch.map((ch) => embed(ch)));
      embeddings.push(...batchEmbeddings);
    }

    /* ── Bulk-index into Elasticsearch ─────────────────────── */
    const now = new Date().toISOString();
    const bulkBody = chunks.flatMap((chunk, idx) => [
      { index: { _index: INDEX_NAME } },
      {
        content: chunk,
        speaker,
        source,
        embedding: embeddings[idx],
        created_at: now,
      },
    ]);

    const bulkResult = await esClient.bulk({ body: bulkBody });

    /* Collect the IDs from the bulk response. */
    const ids: string[] = [];
    const errors: string[] = [];

    for (const item of bulkResult.items) {
      if (item.index?.error) {
        errors.push(
          `Chunk failed: ${item.index.error.reason ?? "unknown error"}`
        );
      } else if (item.index?._id) {
        ids.push(item.index._id);
      }
    }

    if (errors.length > 0) {
      console.error("Bulk index errors:", errors);
    }

    return c.json({
      success: true,
      totalChunks: chunks.length,
      indexed: ids.length,
      ids,
      ...(errors.length > 0 && { errors }),
    });
  } catch (err) {
    console.error("Long upload error:", err);
    return c.json({ error: "Internal server error." }, 500);
  }
});

export default long;
