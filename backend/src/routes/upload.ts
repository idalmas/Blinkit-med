/**
 * upload.ts — POST /upload Route
 *
 * Accepts a piece of text (e.g. a transcript chunk from the onboarding flow),
 * generates an embedding via OpenAI, and stores the text + embedding in the
 * Supabase `documents` table for later RAG retrieval.
 *
 * Parent: mounted by src/index.ts at `/upload`
 *
 * Request body (JSON):
 *   - text:    string  — the transcript text to store (required).
 *   - speaker: string  — optional label for who said it (e.g. "Ian").
 *
 * Response (JSON):
 *   - success: boolean
 *   - id:      number  — the auto-generated row id in the documents table.
 *
 * Dependencies: lib/supabase.ts, lib/embeddings.ts
 */

import { Hono } from "hono";
import { supabase } from "../lib/supabase";
import { embed } from "../lib/embeddings";

const upload = new Hono();

/**
 * POST / — upload a transcript chunk.
 *
 * @input  { text: string, speaker?: string }
 * @output { success: true, id: number } | { error: string }
 */
upload.post("/", async (c) => {
  try {
    const body = await c.req.json<{ text?: string; speaker?: string }>();

    /* ── Validate ──────────────────────────────────────────── */
    if (!body.text || body.text.trim().length === 0) {
      return c.json({ error: "\"text\" is required and must be non-empty." }, 400);
    }

    const text = body.text.trim();
    const speaker = body.speaker?.trim() || null;

    /* ── Embed ─────────────────────────────────────────────── */
    const embedding = await embed(text);

    /* ── Store in Supabase ─────────────────────────────────── */
    const { data, error } = await supabase
      .from("documents")
      .insert({ content: text, speaker, embedding: JSON.stringify(embedding) })
      .select("id")
      .single();

    if (error) {
      console.error("Supabase insert error:", error);
      return c.json({ error: "Failed to store document." }, 500);
    }

    return c.json({ success: true, id: data.id });
  } catch (err) {
    console.error("Upload error:", err);
    return c.json({ error: "Internal server error." }, 500);
  }
});

export default upload;
