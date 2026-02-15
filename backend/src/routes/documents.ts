/**
 * documents.ts — GET /documents Route
 *
 * Returns all documents stored in the Elasticsearch vector DB, newest-first.
 * Excludes raw embedding vectors to keep payloads small. Useful for browsing
 * stored context on the frontend or for debugging/demos.
 *
 * When the optional `person` query param is provided, only documents
 * belonging to that person are returned. Without it, all documents are
 * returned (unfiltered).
 *
 * Parent: mounted by src/index.ts at `/documents`
 *
 * Query params:
 *   - size:   number of docs to return (default 100)
 *   - person: optional person filter (e.g. "ian", "hagrid")
 *
 * Response (JSON):
 *   - total:     number | object — total documents in the index.
 *   - documents: Array<{ id, content, speaker, source, person, created_at }>
 *
 * Dependencies: lib/elasticsearch.ts
 */

import { Hono } from "hono";
import { getAllDocuments } from "../lib/elasticsearch";

const documents = new Hono();

/**
 * GET / — retrieve stored documents from the vector DB.
 *
 * @input  ?size=100&person=ian (query params, both optional)
 * @output { total: number, documents: StoredDocument[] }
 */
documents.get("/", async (c) => {
  try {
    const size = Number(c.req.query("size")) || 100;
    const person = c.req.query("person")?.trim().toLowerCase() || undefined;
    const result = await getAllDocuments(size, person);
    return c.json(result);
  } catch (err) {
    console.error("Documents fetch error:", err);
    return c.json({ error: "Failed to fetch documents." }, 500);
  }
});

export default documents;
