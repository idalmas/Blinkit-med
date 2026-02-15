/**
 * long.ts — POST /long Route
 *
 * Accepts a large body of text (e.g. an entire transcript, essay, or journal
 * entry), splits it into semantically coherent chunks using embedding
 * similarity, then uploads each chunk via the shared `uploadChunk()` helper
 * from routes/upload.ts.
 *
 * This is the "bulk ingest" counterpart to the single-chunk `/upload` route.
 * Use it when you have a big piece of text and want all of it stored as
 * searchable context without manually splitting it yourself.
 *
 * Semantic chunking strategy:
 *   1. Split the raw text into sentences.
 *   2. Embed every sentence via OpenAI.
 *   3. Compute cosine similarity between each consecutive pair of sentence
 *      embeddings.
 *   4. Where the similarity drops below a configurable threshold, mark a
 *      chunk boundary — that's where the topic shifts.
 *   5. Group the sentences between boundaries into chunks.
 *   6. Enforce min/max sentence counts per chunk so we don't get trivially
 *      small or absurdly large chunks.
 *   7. Upload each chunk through uploadChunk() (embed + index).
 *
 * Parent: mounted by src/index.ts at `/long`
 *
 * Request body (JSON):
 *   - text:            string  — the full text to chunk and upload (required).
 *   - speaker:         string  — optional label for who said it (e.g. "Ian").
 *   - source:          string  — optional data-source label. Defaults to
 *                                 "transcript".
 *   - threshold:       number  — cosine similarity threshold (0–1) below which
 *                                 a chunk boundary is placed. Lower = fewer,
 *                                 larger chunks. Defaults to 0.5.
 *   - minChunkSentences: number — minimum sentences per chunk. Defaults to 2.
 *   - maxChunkSentences: number — maximum sentences per chunk. Defaults to 20.
 *
 * Response (JSON):
 *   - success:    boolean
 *   - totalChunks: number   — how many semantic chunks were created.
 *   - ids:        string[]  — the Elasticsearch document IDs for every chunk.
 *
 * Dependencies: lib/embeddings.ts, routes/upload.ts (uploadChunk helper)
 */

import { Hono } from "hono";
import { embed } from "../lib/embeddings";
import { uploadChunk } from "./upload";

const long = new Hono();

/* ── Defaults ────────────────────────────────────────────────── */

/** Default cosine-similarity threshold for placing chunk boundaries. */
const DEFAULT_THRESHOLD = 0.5;

/** Minimum number of sentences in a single chunk. */
const DEFAULT_MIN_CHUNK_SENTENCES = 2;

/** Maximum number of sentences in a single chunk. */
const DEFAULT_MAX_CHUNK_SENTENCES = 20;

/** How many sentences to embed at once (rate-limit friendly). */
const EMBED_BATCH_SIZE = 10;

/* ── Helper functions ────────────────────────────────────────── */

/**
 * splitSentences — splits a body of text into individual sentences.
 *
 * Uses a regex that handles common abbreviations reasonably well while
 * splitting on `.` `!` `?` followed by whitespace or end-of-string.
 * Falls back to newline-based splitting if no sentence-ending punctuation
 * is found.
 *
 * @param text  The full text.
 * @returns     An array of sentence strings (trimmed, non-empty).
 */
function splitSentences(text: string): string[] {
  /* Split on sentence-ending punctuation followed by whitespace / EOL. */
  const raw = text.split(/(?<=[.!?])\s+/);

  const sentences = raw
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  /* If we only got 1 "sentence" the text may lack punctuation —
     fall back to splitting on newlines. */
  if (sentences.length <= 1) {
    const byLine = text.split(/\n+/).map((s) => s.trim()).filter((s) => s.length > 0);
    if (byLine.length > 1) return byLine;
  }

  return sentences;
}

/**
 * cosineSimilarity — computes the cosine similarity between two vectors.
 *
 * @param a  First vector (number[]).
 * @param b  Second vector (number[], same length as a).
 * @returns  A value between -1 and 1 (1 = identical direction).
 */
function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * embedBatched — embeds an array of texts in batches to stay within
 * rate limits.
 *
 * @param texts      The texts to embed.
 * @param batchSize  How many concurrent embed() calls per batch.
 * @returns          An array of embedding vectors in the same order as texts.
 */
async function embedBatched(
  texts: string[],
  batchSize: number
): Promise<number[][]> {
  const embeddings: number[][] = [];

  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map((t) => embed(t)));
    embeddings.push(...batchResults);
  }

  return embeddings;
}

/**
 * semanticChunk — groups sentences into semantically coherent chunks.
 *
 * Algorithm:
 *   1. Compute cosine similarity between each consecutive pair of sentence
 *      embeddings.
 *   2. Walk through the similarities and accumulate sentences. When
 *      similarity drops below `threshold`, emit the current group as a
 *      chunk and start a new one.
 *   3. Enforce `minChunkSentences` — if a pending chunk is too small when
 *      a boundary is detected, keep accumulating.
 *   4. Enforce `maxChunkSentences` — if a chunk hits the max, force a
 *      boundary even if similarity is still high.
 *
 * @param sentences   The sentence strings.
 * @param embeddings  The corresponding embedding vectors.
 * @param threshold   Similarity threshold for chunk boundaries.
 * @param minSentences  Minimum sentences per chunk.
 * @param maxSentences  Maximum sentences per chunk.
 * @returns           An array of chunk strings (sentences joined by spaces).
 */
function semanticChunk(
  sentences: string[],
  embeddings: number[][],
  threshold: number,
  minSentences: number,
  maxSentences: number
): string[] {
  if (sentences.length === 0) return [];
  if (sentences.length === 1) return [sentences[0]];

  const chunks: string[] = [];
  let currentGroup: string[] = [sentences[0]];

  for (let i = 1; i < sentences.length; i++) {
    const sim = cosineSimilarity(embeddings[i - 1], embeddings[i]);
    const atMax = currentGroup.length >= maxSentences;
    const atMin = currentGroup.length >= minSentences;

    /* Place a boundary if similarity dips below threshold (and we have
       enough sentences), OR if we've hit the max chunk size. */
    if ((sim < threshold && atMin) || atMax) {
      chunks.push(currentGroup.join(" "));
      currentGroup = [];
    }

    currentGroup.push(sentences[i]);
  }

  /* Flush the last group. */
  if (currentGroup.length > 0) {
    chunks.push(currentGroup.join(" "));
  }

  return chunks;
}

/* ── Route handler ───────────────────────────────────────────── */

/**
 * POST / — semantically chunk a long text and upload every chunk.
 *
 * @input  { text: string, speaker?: string, source?: string,
 *           threshold?: number, minChunkSentences?: number,
 *           maxChunkSentences?: number }
 * @output { success: true, totalChunks: number, ids: string[] }
 *       | { error: string }
 */
long.post("/", async (c) => {
  try {
    const body = await c.req.json<{
      text?: string;
      speaker?: string;
      source?: string;
      threshold?: number;
      minChunkSentences?: number;
      maxChunkSentences?: number;
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
    const threshold = body.threshold ?? DEFAULT_THRESHOLD;
    const minSentences = body.minChunkSentences ?? DEFAULT_MIN_CHUNK_SENTENCES;
    const maxSentences = body.maxChunkSentences ?? DEFAULT_MAX_CHUNK_SENTENCES;

    /* ── Split into sentences ──────────────────────────────── */
    const sentences = splitSentences(text);

    if (sentences.length === 0) {
      return c.json(
        { error: "Text produced no usable sentences after splitting." },
        400
      );
    }

    console.log(
      `📝 Long upload: ${text.length} chars → ${sentences.length} sentences ` +
        `(threshold ${threshold}, min ${minSentences}, max ${maxSentences})`
    );

    /* ── Embed every sentence ──────────────────────────────── */
    const sentenceEmbeddings = await embedBatched(sentences, EMBED_BATCH_SIZE);

    /* ── Semantic chunking ─────────────────────────────────── */
    const chunks = semanticChunk(
      sentences,
      sentenceEmbeddings,
      threshold,
      minSentences,
      maxSentences
    );

    console.log(
      `✂️  Semantic chunking produced ${chunks.length} chunks from ` +
        `${sentences.length} sentences`
    );

    /* ── Upload each chunk via the shared helper ───────────── */
    const ids: string[] = [];
    const errors: string[] = [];

    for (let i = 0; i < chunks.length; i++) {
      try {
        const { id } = await uploadChunk(chunks[i], speaker, source);
        ids.push(id);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "unknown error";
        errors.push(`Chunk ${i + 1} failed: ${msg}`);
        console.error(`Chunk ${i + 1} upload error:`, err);
      }
    }

    if (errors.length > 0) {
      console.error("Some chunks failed to upload:", errors);
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
