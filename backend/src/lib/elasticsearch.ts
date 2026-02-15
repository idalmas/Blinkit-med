/**
 * elasticsearch.ts — Elasticsearch Client & Index Bootstrap
 *
 * Creates a singleton Elasticsearch client and provides an `ensureIndex()`
 * function that creates the `person-context` index on first boot if it
 * doesn't already exist.
 *
 * Index mapping:
 *   - content    (text)         — the transcript / data chunk
 *   - speaker    (keyword)      — who said it (filterable)
 *   - source     (keyword)      — data source label, e.g. "transcript", "notes"
 *   - embedding  (dense_vector) — 1536-dim OpenAI cosine vector
 *   - created_at (date)         — when the chunk was indexed
 *
 * Used by: routes/upload.ts, routes/generate.ts, index.ts (bootstrap)
 *
 * Requires env vars:
 *   - ELASTICSEARCH_URL
 *   - ELASTICSEARCH_API_KEY
 */

import { Client } from "@elastic/elasticsearch";
import { HttpConnection } from "@elastic/transport";

const esUrl = process.env.ELASTICSEARCH_URL;
const esApiKey = process.env.ELASTICSEARCH_API_KEY;

if (!esUrl || !esApiKey) {
  throw new Error(
    "Missing ELASTICSEARCH_URL or ELASTICSEARCH_API_KEY environment variables. " +
      "Copy .env.example to .env and fill in your values."
  );
}

/**
 * esClient — the singleton Elasticsearch client.
 *
 * Configured with the Cloud URL and API key from env vars.
 * Used by: routes/upload.ts, routes/generate.ts
 */
export const esClient = new Client({
  node: esUrl,
  auth: { apiKey: esApiKey },
  Connection: HttpConnection, // Use Node HTTP instead of Undici (Bun compat)
});

/** The name of the Elasticsearch index that stores all personal context. */
export const INDEX_NAME = "person-context";

/**
 * ensureIndex — creates the `person-context` index if it doesn't exist.
 *
 * Called once on server startup from index.ts. Defines the dense_vector
 * mapping for kNN search and keyword/text fields for metadata filtering.
 *
 * @returns void (logs success or skip to console)
 */
export async function ensureIndex(): Promise<void> {
  const exists = await esClient.indices.exists({ index: INDEX_NAME });

  if (exists) {
    console.log(`✅ Elasticsearch index "${INDEX_NAME}" already exists.`);
    return;
  }

  await esClient.indices.create({
    index: INDEX_NAME,
    mappings: {
      properties: {
        content: { type: "text" },
        speaker: { type: "keyword" },
        source: { type: "keyword" },
        embedding: {
          type: "dense_vector",
          dims: 1536,
          index: true,
          similarity: "cosine",
        },
        created_at: { type: "date" },
      },
    },
  });

  console.log(`🆕 Created Elasticsearch index "${INDEX_NAME}".`);
}
