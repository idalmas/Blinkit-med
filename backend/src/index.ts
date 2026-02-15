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
import { createClient, LiveTranscriptionEvents } from "@deepgram/sdk";
import { ensureIndex, ensurePersonField } from "./lib/elasticsearch";
import upload from "./routes/upload";
import generate from "./routes/generate";
import long from "./routes/long";
import documents from "./routes/documents";
import getContext from "./routes/getContext";
import apps from "./routes/apps";

const DEEPGRAM_API_KEY = process.env.DEEPGRAM_API_KEY || "";

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
 * GET /ws — realtime transcription via Deepgram.
 *
 * Accepts 16kHz int16 PCM audio from the Talk page, forwards it to Deepgram's
 * streaming API, and relays transcript results back to the client.
 */
app.get(
  "/ws",
  upgradeWebSocket(() => {
    let dgConnection: ReturnType<ReturnType<typeof createClient>["listen"]["live"]> | null = null;

    return {
      onOpen(_evt, ws) {
        ws.send(JSON.stringify({ type: "connected" }));

        if (!DEEPGRAM_API_KEY) {
          ws.send(JSON.stringify({ type: "error", message: "DEEPGRAM_API_KEY not set" }));
          return;
        }

        const deepgram = createClient(DEEPGRAM_API_KEY);
        dgConnection = deepgram.listen.live({
          model: "nova-2",
          language: "en",
          smart_format: true,
          diarize: true,
          encoding: "linear16",
          sample_rate: 16000,
          channels: 1,
          interim_results: true,
          utterance_end_ms: 1000,
        });

        dgConnection.on(LiveTranscriptionEvents.Open, () => {
          console.log("[deepgram] Connection opened");
        });

        dgConnection.on(LiveTranscriptionEvents.Transcript, (data: any) => {
          const alt = data.channel?.alternatives?.[0];
          if (!alt || !alt.transcript) return;

          const words = (alt.words || []).map((w: any) => ({
            word: w.word,
            speaker: w.speaker ?? 0,
            start: w.start,
            end: w.end,
            confidence: w.confidence,
          }));

          // Debug: log speaker values from Deepgram
          if (data.is_final) {
            const speakerVals = words.map((w: any) => w.speaker);
            const unique = [...new Set(speakerVals)];
            console.log(`[deepgram] final transcript: "${alt.transcript}" speakers: [${unique}]`);
          }

          ws.send(JSON.stringify({
            type: "transcript",
            transcript: alt.transcript,
            words,
            is_final: data.is_final ?? false,
          }));
        });

        dgConnection.on(LiveTranscriptionEvents.Error, (err: any) => {
          console.error("[deepgram] Error:", err);
          ws.send(JSON.stringify({ type: "error", message: "Deepgram error" }));
        });

        dgConnection.on(LiveTranscriptionEvents.Close, () => {
          console.log("[deepgram] Connection closed");
        });
      },

      onMessage(event) {
        if (dgConnection) {
          const data = typeof event.data === "string"
            ? Buffer.from(event.data)
            : event.data;
          dgConnection.send(data);
        }
      },

      onClose() {
        if (dgConnection) {
          dgConnection.requestClose();
          dgConnection = null;
        }
      },
    };
  })
);

/** Health check — useful for uptime monitoring. */
app.get("/", (c) => c.json({ status: "ok", service: "revive-backend" }));

/* ── Bootstrap & Export for Bun ─────────────────────────────── */

const PORT = Number(process.env.PORT) || 3003;

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
