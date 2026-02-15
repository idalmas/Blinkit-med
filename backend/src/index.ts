/**
 * index.ts — Hono App Entry Point
 *
 * Sets up the Hono web server with CORS middleware, bootstraps the
 * Elasticsearch index, mounts the API routes, and exports the app for
 * Bun to serve.
 *
 * Routes:
 *   POST /upload    — upload text → embed → index into Elasticsearch
 *   POST /generate  — dialog in → kNN RAG + Cerebras → personalized response
 *   POST /long      — bulk ingest: chunk long text → embed all → bulk index
 *   POST /getContext — retrieve relevant context chunks for a given app (+optional text)
 *   GET  /documents — browse everything stored in the vector DB (debug/demo)
 *   POST /apps/amazon-search        — kick off a BrightData Amazon scrape
 *   GET  /apps/amazon-status/:id    — poll for scrape results
 *   POST /apps/send-email           — email a product link via Resend
 *
 * On startup:
 *   - Calls ensureIndex() to create the Elasticsearch `person-context` index
 *     if it doesn't already exist.
 *   - Calls ensurePersonField() to add the `person` keyword field to the
 *     mapping if the index already existed before the field was introduced.
 *
 * Run with:
 *   bun run dev      (hot-reload)
 *   bun run start    (production)
 */

import { Hono } from "hono";
import { createBunWebSocket } from "hono/bun";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { ensureIndex, ensurePersonField } from "./lib/elasticsearch";
import upload from "./routes/upload";
import generate from "./routes/generate";
import long from "./routes/long";
import documents from "./routes/documents";
import getContext from "./routes/getContext";
import apps from "./routes/apps";

const app = new Hono();
const { upgradeWebSocket, websocket } = createBunWebSocket();
const signalClients = new Set<any>();

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
app.route("/long", long);
app.route("/documents", documents);
app.route("/getContext", getContext);
app.route("/apps", apps);
/**
 * GET /ws — minimal realtime transcription socket endpoint.
 *
 * This endpoint accepts the Talk page WebSocket connection so the client can
 * start microphone streaming without failing handshake. Incoming audio frames
 * are currently ignored until a transcription engine is wired in.
 */
app.get(
  "/ws",
  upgradeWebSocket(() => ({
    onOpen(_, ws) {
      signalClients.add(ws);
      ws.send(JSON.stringify({ type: "connected" }));
    },
    onMessage(event, ws) {
      try {
        const raw = event.data;
        if (typeof raw !== "string") return;
        const data = JSON.parse(raw);
        if (data.type === "signal") {
          const payload = JSON.stringify(data);
          // Fan out to all other connected clients.
          for (const client of signalClients) {
            if (client === ws) continue;
            try {
              client.send(payload);
            } catch {
              // Ignore send errors for stale sockets; onClose will prune.
            }
          }
        } else if (data.type === "subscribe") {
          ws.send(JSON.stringify({ type: "subscribed" }));
        }
      } catch {
        // Ignore non-JSON/binary frames from other clients.
      }
    },
    onClose(_, ws) {
      signalClients.delete(ws);
    },
  }))
);

/** Health check — useful for uptime monitoring. */
app.get("/", (c) => c.json({ status: "ok", service: "revive-backend" }));

/* ── Bootstrap & Export for Bun ─────────────────────────────── */

const PORT = Number(process.env.PORT) || 3001;

// Create the Elasticsearch index if it doesn't exist, then add the `person`
// field to the mapping (safe no-op if it already exists), then start serving.
ensureIndex()
  .then(() => ensurePersonField())
  .then(() => {
    console.log(`🚀 Revive backend listening on http://localhost:${PORT}`);
  })
  .catch((err) => {
    console.error("❌ Failed to bootstrap Elasticsearch index:", err);
    process.exit(1);
  });

export default {
  port: PORT,
  fetch: app.fetch,
  websocket,
};
