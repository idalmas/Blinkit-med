/*
 * migration.sql
 *
 * Run this in the Supabase SQL Editor (https://supabase.com/dashboard → SQL Editor).
 *
 * What it does:
 *   1. Enables the pgvector extension for vector similarity search.
 *   2. Creates the `documents` table to store transcript chunks + embeddings.
 *   3. Creates the `match_documents` RPC function used for cosine similarity search.
 *   4. Adds an HNSW index on the embedding column for fast approximate lookups.
 */

-- ─── 1. Enable pgvector ────────────────────────────────────────────────────────

create extension if not exists vector with schema extensions;

-- ─── 2. Documents table ────────────────────────────────────────────────────────

create table if not exists documents (
  id         bigint primary key generated always as identity,
  content    text not null,
  speaker    text,
  embedding  vector(1536) not null,  -- OpenAI text-embedding-3-small dimensions
  created_at timestamptz default now()
);

-- ─── 3. Similarity search function ─────────────────────────────────────────────
--
-- Called via supabase.rpc('match_documents', { ... }) from the backend.
--
-- Inputs:
--   query_embedding  — the embedding vector of the search query (1536-d).
--   match_threshold  — minimum cosine similarity score (0–1). Lower = more results.
--   match_count      — maximum number of rows to return.
--
-- Output:
--   A set of rows from `documents` plus a `similarity` score, ordered best-first.

create or replace function match_documents (
  query_embedding vector(1536),
  match_threshold float,
  match_count     int
)
returns table (
  id         bigint,
  content    text,
  speaker    text,
  similarity float
)
language sql stable
as $$
  select
    d.id,
    d.content,
    d.speaker,
    1 - (d.embedding <=> query_embedding) as similarity
  from documents d
  where 1 - (d.embedding <=> query_embedding) > match_threshold
  order by d.embedding <=> query_embedding
  limit match_count;
$$;

-- ─── 4. HNSW index for fast approximate nearest-neighbour lookups ──────────────

create index if not exists documents_embedding_idx
  on documents
  using hnsw (embedding vector_cosine_ops);
