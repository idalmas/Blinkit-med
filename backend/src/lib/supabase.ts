/**
 * supabase.ts — Supabase Client Singleton
 *
 * Creates and exports a single Supabase client instance used by the rest of
 * the backend. Uses the service-role key so we can write to the database
 * without RLS restrictions.
 *
 * Requires env vars:
 *   - SUPABASE_URL
 *   - SUPABASE_SERVICE_KEY
 */

import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error(
    "Missing SUPABASE_URL or SUPABASE_SERVICE_KEY environment variables. " +
      "Copy .env.example to .env and fill in your values."
  );
}

/**
 * supabase — the singleton Supabase client.
 *
 * Configured with the service-role key for full DB access.
 * Used by: routes/upload.ts, routes/generate.ts
 */
export const supabase = createClient(supabaseUrl, supabaseKey);
