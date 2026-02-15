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
 *   - person     (keyword)      — the persona this data belongs to (filterable,
 *                                  used to segment data per person, e.g. "ian")
 *   - embedding  (dense_vector) — 1536-dim OpenAI cosine vector
 *   - created_at (date)         — when the chunk was indexed
 *
 * Exports:
 *   - esClient          — the singleton client
 *   - INDEX_NAME        — the index name ("person-context")
 *   - ensureIndex       — creates the index on first boot
 *   - ensurePersonField — adds the `person` field to an existing index (migration)
 *   - getAllDocuments    — retrieves all stored documents (no embeddings),
 *                          optionally filtered by person
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
        person: { type: "keyword" },
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

/**
 * ensurePersonField — adds the `person` keyword field to an existing index.
 *
 * This is a one-time migration helper. If the index already existed before
 * the `person` field was introduced, calling this on startup will add the
 * field to the mapping without requiring a full re-index. Elasticsearch
 * allows adding new fields to an existing mapping non-destructively.
 *
 * Safe to call repeatedly — Elasticsearch silently accepts a PUT mapping
 * that matches what's already there.
 *
 * Note: existing documents will have `person: null` until they are
 * re-indexed with a value.
 *
 * @returns void (logs result to console)
 */
export async function ensurePersonField(): Promise<void> {
  try {
    await esClient.indices.putMapping({
      index: INDEX_NAME,
      properties: {
        person: { type: "keyword" },
      },
    });
    console.log(`✅ Ensured "person" field exists in "${INDEX_NAME}" mapping.`);
  } catch (err) {
    console.error(`⚠️  Failed to add "person" field to mapping:`, err);
  }
}

/** Shape of a document returned by getAllDocuments (no embedding). */
export interface StoredDocument {
  id: string;
  content: string;
  speaker: string | null;
  source: string | null;
  person: string | null;
  created_at: string;
}

/**
 * getAllDocuments — retrieves all documents from the index, newest-first.
 *
 * Returns content + metadata but excludes the raw embedding vectors to
 * keep payloads small. Useful for browsing / displaying stored data.
 *
 * When `person` is provided, only documents belonging to that person are
 * returned. When omitted, all documents are returned (unfiltered).
 *
 * @param size    Maximum number of documents to return (default 100).
 * @param person  Optional person filter (e.g. "ian", "hagrid").
 * @returns       { total: number | object, documents: StoredDocument[] }
 */
export async function getAllDocuments(
  size = 100,
  person?: string
): Promise<{
  total: number | object;
  documents: StoredDocument[];
}> {
  const result = await esClient.search({
    index: INDEX_NAME,
    size,
    _source: ["content", "speaker", "source", "person", "created_at"],
    sort: [{ created_at: "desc" }],
    ...(person ? { query: { term: { person } } } : {}),
  });

  const documents: StoredDocument[] = result.hits.hits.map((hit) => {
    const src = hit._source as Omit<StoredDocument, "id">;
    return { id: hit._id!, ...src };
  });

  return { total: result.hits.total!, documents };
}
