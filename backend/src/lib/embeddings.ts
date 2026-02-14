/**
 * embeddings.ts — OpenAI Embedding Helper
 *
 * Provides a single function to generate a 1536-dimensional embedding vector
 * for a piece of text using OpenAI's text-embedding-3-small model.
 *
 * Used by: routes/upload.ts (to embed transcript text before storage),
 *          routes/generate.ts (to embed the user query for similarity search).
 *
 * Requires env var:
 *   - OPENAI_API_KEY
 */

import OpenAI from "openai";

const apiKey = process.env.OPENAI_API_KEY;

if (!apiKey) {
  throw new Error(
    "Missing OPENAI_API_KEY environment variable. " +
      "Copy .env.example to .env and fill in your values."
  );
}

const openai = new OpenAI({ apiKey });

/** The embedding model we use — 1536 dimensions, cheap and fast. */
const EMBEDDING_MODEL = "text-embedding-3-small";

/**
 * embed — generates an embedding vector for the given text.
 *
 * @param text  The text to embed.
 * @returns     A 1536-dimensional number array suitable for pgvector storage.
 */
export async function embed(text: string): Promise<number[]> {
  const response = await openai.embeddings.create({
    model: EMBEDDING_MODEL,
    input: text,
  });

  return response.data[0].embedding;
}
