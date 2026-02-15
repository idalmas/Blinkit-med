# Backend Context: Blinket RAG & App Services

## Overview
The Blinket backend is a high-performance TypeScript service built on **Bun** and the **Hono** web framework. It serves as the central intelligence hub for the Blinket ecosystem, providing Retrieval-Augmented Generation (RAG) capabilities, specialized app integrations, and real-time communication support.

## Core Architecture
- **Runtime**: [Bun](https://bun.sh/)
- **Framework**: [Hono](https://hono.dev/)
- **Database**: [Elasticsearch](https://www.elastic.co/) (Vector Store for kNN search)
- **LLM Provider**: Cerebras (using `gpt-oss-120b`)
- **Embeddings**: OpenAI (`text-embedding-3-small`, 1536 dimensions)

## Key Components

### 1. Vector Database (Elasticsearch)
Located in `backend/src/lib/elasticsearch.ts`.
- Manages the `person-context` index.
- Stores text chunks with their corresponding vector embeddings.
- Supports kNN (k-Nearest Neighbors) search for semantic retrieval.
- Includes a `person` field to scope context to specific users (e.g., "ian").

### 2. RAG Pipeline
- **Ingestion**: `POST /upload` and `POST /long` endpoints handle text chunking, embedding generation via OpenAI, and indexing into Elasticsearch.
- **Retrieval**: `POST /generate` performs kNN search to find relevant context before querying the Cerebras LLM.

### 3. App Services (`backend/src/routes/apps.ts`)
The backend provides specialized endpoints for various frontend "apps":
- **Amazon Search**: BrightData integration for scraping product data.
- **Maps Search**: Google Maps API integration.
- **Web Search**: Google SERP API for real-time information.
- **Voice/Talk**: Fish Audio integration for voice cloning and TTS.
- **Books**: EPUB content extraction and management.

### 4. Real-time Communication
- **WebSocket (`/ws`)**: A minimal WebSocket implementation in `index.ts` designed for real-time speech-to-text (STT) streaming (placeholder for transcription engine).

## API Endpoints Summary
- `POST /upload`: Embed and index a single text chunk.
- `POST /long`: Bulk ingest and index long documents.
- `POST /generate`: RAG-powered chat completion.
- `POST /getContext`: Retrieve context chunks for specific apps.
- `GET /documents`: Debug endpoint to list all stored documents.
- `POST /apps/*`: Sub-routes for Amazon, Maps, Web Search, and Voice services.

## Development Commands
- `bun run dev`: Start with hot-reloading.
- `bun run start`: Production server.
