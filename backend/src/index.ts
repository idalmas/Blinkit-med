/**
 * index.ts — Hono App Entry Point
 *
 * Sets up the Hono web server with CORS middleware, mounts the API routes,
 * and exports the app for Bun to serve.
 *
 * Routes:
 *   POST /upload    — upload transcript text → embed → store in pgvector
 *   POST /generate  — dialog in → RAG + Cerebras → two response options out
 *
 * Run with:
 *   bun run dev      (hot-reload)
 *   bun run start    (production)
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import upload from "./routes/upload";
import generate from "./routes/generate";

const app = new Hono();

/* ── Middleware ──────────────────────────────────────────────── */

/** CORS — allow the Next.js frontend (default localhost:3000) and any origin. */
app.use(
  "/*",
  cors({
    origin: "*",
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type"],
  })
);

/** Request logger — prints method, path, status, and duration. */
app.use("/*", logger());

/* ── Routes ─────────────────────────────────────────────────── */

app.route("/upload", upload);
app.route("/generate", generate);

/** Health check — useful for uptime monitoring. */
app.get("/", (c) => c.json({ status: "ok", service: "revive-backend" }));

/* ── Export for Bun ─────────────────────────────────────────── */

const PORT = Number(process.env.PORT) || 3001;

console.log(`🚀 Revive backend listening on http://localhost:${PORT}`);

export default {
  port: PORT,
  fetch: app.fetch,
};
