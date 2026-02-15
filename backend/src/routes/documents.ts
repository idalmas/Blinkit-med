/**
 * documents.ts — GET /documents Route
 *
 * Returns all documents stored in the Elasticsearch vector DB, newest-first.
 * Excludes raw embedding vectors to keep payloads small. Useful for browsing
 * stored context on the frontend or for debugging/demos.
 *
 * Parent: mounted by src/index.ts at `/documents`
 *
 * Query params:
 *   - size: number of docs to return (default 100)
 *
 * Response (JSON):
 *   - total:     number | object — total documents in the index.
 *   - documents: Array<{ id, content, speaker, source, created_at }>
 *
 * Dependencies: lib/elasticsearch.ts
 */

import { Hono } from "hono";
import { getAllDocuments } from "../lib/elasticsearch";

const documents = new Hono();

/**
 * GET / — retrieve all stored documents from the vector DB.
 *
 * @input  ?size=100 (query param, optional)
 * @output { total: number, documents: StoredDocument[] }
 */
documents.get("/", async (c) => {
  try {
    const size = Number(c.req.query("size")) || 100;
    const result = await getAllDocuments(size);
    return c.json(result);
  } catch (err) {
    console.error("Documents fetch error:", err);
    return c.json({ error: "Failed to fetch documents." }, 500);
  }
});

export default documents;
