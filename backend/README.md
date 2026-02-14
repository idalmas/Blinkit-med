# Revive Backend

RAG-powered conversational API built with **Bun + Hono + Supabase pgvector + Cerebras**.

Upload transcript text, store it as vector embeddings, then generate two AI response options grounded in that person's real speech patterns.

## Prerequisites

- [Bun](https://bun.sh/) (v1.0+)
- A [Supabase](https://supabase.com/) project
- An [OpenAI](https://platform.openai.com/) API key (for embeddings)
- A [Cerebras](https://cloud.cerebras.ai/) API key (for LLM inference)

## Setup

### 1. Install dependencies

```bash
cd backend
bun install
```

### 2. Create your Supabase database

1. Go to your Supabase dashboard → **SQL Editor**.
2. Paste and run the contents of `supabase/migration.sql`.
3. This creates the `documents` table and the `match_documents` search function.

### 3. Configure environment variables

```bash
cp .env.example .env
```

Fill in the four keys in `.env`:

| Variable               | Where to get it                              |
| ---------------------- | -------------------------------------------- |
| `SUPABASE_URL`         | Supabase → Settings → API → Project URL      |
| `SUPABASE_SERVICE_KEY` | Supabase → Settings → API → service_role key  |
| `OPENAI_API_KEY`       | platform.openai.com → API Keys               |
| `CEREBRAS_API_KEY`     | cloud.cerebras.ai → API Keys                 |

### 4. Run the server

```bash
bun run dev    # hot-reload mode on http://localhost:3001
```

## API Endpoints

### `POST /upload`

Upload a transcript chunk to the vector store.

```bash
curl -X POST http://localhost:3001/upload \
  -H "Content-Type: application/json" \
  -d '{"text": "I really love building things that help people.", "speaker": "Ian"}'
```

**Response:**

```json
{ "success": true, "id": 1 }
```

### `POST /generate`

Generate two AI response options for a conversation.

```bash
curl -X POST http://localhost:3001/generate \
  -H "Content-Type: application/json" \
  -d '{
    "dialog": [
      { "role": "user", "content": "What motivates you to build things?" }
    ]
  }'
```

**Response:**

```json
{
  "options": [
    "I'm driven by the impact...",
    "Building things that help people..."
  ],
  "context": [
    { "content": "I really love building things...", "speaker": "Ian", "similarity": 0.87 }
  ]
}
```

### `GET /`

Health check.

```json
{ "status": "ok", "service": "revive-backend" }
```

## Project Structure

```
backend/
├── src/
│   ├── index.ts            # Hono app entry point, CORS, route mounting
│   ├── routes/
│   │   ├── upload.ts       # POST /upload — embed & store transcript text
│   │   └── generate.ts     # POST /generate — RAG search + Cerebras generation
│   └── lib/
│       ├── supabase.ts     # Supabase client singleton
│       ├── embeddings.ts   # OpenAI embedding helper
│       └── cerebras.ts     # Cerebras client + two-option generation
├── supabase/
│   └── migration.sql       # SQL to set up pgvector table & search function
├── package.json
├── tsconfig.json
└── .env.example
```
