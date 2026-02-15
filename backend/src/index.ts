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
import zoom from "./routes/zoom";

const DEEPGRAM_API_KEY = process.env.DEEPGRAM_API_KEY || "";
let deepgramSdk: any = null;
try {
  deepgramSdk = require("@deepgram/sdk");
} catch {
  // Optional dependency; EOG pipeline works without Deepgram installed.
}

const app = new Hono();
const { upgradeWebSocket, websocket } = createBunWebSocket();
const signalClients = new Set<any>();

type Direction = -1 | 0 | 1;

interface SignalInput {
  type: "signal";
  raw: number;
  voltage: number;
  timestamp?: number;
}

interface ProcessedSignal extends SignalInput {
  yMin: number;
  yMax: number;
  leftLimit: number;
  rightLimit: number;
  noiseThreshold: number;
  direction: Direction;
  eogConfig: EogConfig;
}

interface EogConfig {
  yMin: number;
  yMax: number;
  leftLimit: number;
  rightLimit: number;
  releaseMargin: number;
  noiseThreshold: number;
  holdMs: number;
}

class EogProcessor {
  private config: EogConfig = {
    yMin: 1750,
    yMax: 2250,
    leftLimit: 2030,
    rightLimit: 1880,
    releaseMargin: 12,
    noiseThreshold: 250,
    holdMs: 300,
  };

  private direction: Direction = 0;
  private holdUntilMs = 0;

  updateConfig(partial: Partial<EogConfig>) {
    const next: EogConfig = { ...this.config, ...partial };
    next.yMin = Number(next.yMin);
    next.yMax = Number(next.yMax);
    if (next.yMax <= next.yMin + 10) next.yMax = next.yMin + 10;
    next.leftLimit = Number(next.leftLimit);
    next.rightLimit = Number(next.rightLimit);
    if (next.leftLimit <= next.rightLimit + 5) next.leftLimit = next.rightLimit + 5;
    next.releaseMargin = Math.max(0, Number(next.releaseMargin));
    next.noiseThreshold = Math.max(0, Number(next.noiseThreshold));
    next.holdMs = Math.max(0, Number(next.holdMs));
    this.config = next;
  }

  getConfig() {
    return { ...this.config };
  }

  process(input: SignalInput): ProcessedSignal {
    const nowMs = Date.now();
    const raw = Number(input.raw);
    const voltage = Number(input.voltage);

    // Noise rejector in absolute ADC units:
    // - too high above left bound => noise
    // - too low below right bound => noise
    // This only guards extreme excursions; regular in-range behavior is unchanged.
    const tooHigh = raw > this.config.leftLimit + this.config.noiseThreshold;
    const tooLow = raw < this.config.rightLimit - this.config.noiseThreshold;
    const isExtremeNoise = tooHigh || tooLow;

    if (isExtremeNoise) {
      this.direction = 0;
      this.holdUntilMs = 0;
    } else {
      // While in hold window, keep the current direction stable.
      if (this.direction !== 0 && nowMs < this.holdUntilMs) {
        return {
          type: "signal",
          raw,
          voltage,
          timestamp: input.timestamp ?? Date.now() / 1000,
          yMin: this.config.yMin,
          yMax: this.config.yMax,
          leftLimit: this.config.leftLimit,
          rightLimit: this.config.rightLimit,
          noiseThreshold: this.config.noiseThreshold,
          direction: this.direction,
          eogConfig: this.getConfig(),
        };
      }

      // Immediate edge-hit activation:
      // - Hit leftLimit => LEFT
      // - Hit rightLimit => RIGHT
      // - Return to CENTER once signal comes back inside hysteresis band.
      if (raw >= this.config.leftLimit) {
        if (this.direction !== 1) {
          this.direction = 1;
          this.holdUntilMs = nowMs + this.config.holdMs;
        }
      } else if (raw <= this.config.rightLimit) {
        if (this.direction !== -1) {
          this.direction = -1;
          this.holdUntilMs = nowMs + this.config.holdMs;
        }
      } else if (
        this.direction === 1 &&
        raw < this.config.leftLimit - this.config.releaseMargin
      ) {
        this.direction = 0;
        this.holdUntilMs = 0;
      } else if (
        this.direction === -1 &&
        raw > this.config.rightLimit + this.config.releaseMargin
      ) {
        this.direction = 0;
        this.holdUntilMs = 0;
      }
    }

    return {
      type: "signal",
      raw,
      voltage,
      timestamp: input.timestamp ?? Date.now() / 1000,
      yMin: this.config.yMin,
      yMax: this.config.yMax,
      leftLimit: this.config.leftLimit,
      rightLimit: this.config.rightLimit,
      noiseThreshold: this.config.noiseThreshold,
      direction: this.direction,
      eogConfig: this.getConfig(),
    };
  }
}

const eogProcessor = new EogProcessor();

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
app.route("/zoom", zoom);
/**
 * GET /ws — combined WebSocket endpoint.
 *
 * Handles two types of traffic on a single socket:
 *   1. Binary frames (audio PCM) → forwarded to Deepgram for transcription
 *   2. JSON string frames → signal processing (EOG) or subscribe messages
 */
app.get(
  "/ws",
  upgradeWebSocket(() => {
    let dgConnection: any = null;

    return {
      onOpen(_, ws) {
        signalClients.add(ws);
        ws.send(JSON.stringify({ type: "connected" }));

        if (!DEEPGRAM_API_KEY || !deepgramSdk) return;

        const deepgram = deepgramSdk.createClient(DEEPGRAM_API_KEY);
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

        dgConnection.on(deepgramSdk.LiveTranscriptionEvents.Open, () => {
          console.log("[deepgram] Connection opened");
        });

        dgConnection.on(deepgramSdk.LiveTranscriptionEvents.Transcript, (data: any) => {
          const alt = data.channel?.alternatives?.[0];
          if (!alt || !alt.transcript) return;

          const words = (alt.words || []).map((w: any) => ({
            word: w.word,
            speaker: w.speaker ?? 0,
            start: w.start,
            end: w.end,
            confidence: w.confidence,
          }));

          ws.send(
            JSON.stringify({
              type: "transcript",
              transcript: alt.transcript,
              words,
              is_final: data.is_final ?? false,
            })
          );
        });

        dgConnection.on(deepgramSdk.LiveTranscriptionEvents.Error, (err: any) => {
          console.error("[deepgram] Error:", err);
          ws.send(JSON.stringify({ type: "error", message: "Deepgram error" }));
        });

        dgConnection.on(deepgramSdk.LiveTranscriptionEvents.Close, () => {
          console.log("[deepgram] Connection closed");
        });
      },

      onMessage(event, ws) {
        // Binary data → forward to Deepgram for transcription
        if (typeof event.data !== "string") {
          if (dgConnection) dgConnection.send(event.data);
          return;
        }

        // JSON string data → handle signal processing and tuning messages
        try {
          const data = JSON.parse(event.data);
          if (data.type === "signal") {
            const processed = eogProcessor.process(data as SignalInput);
            const payload = JSON.stringify(processed);
            for (const client of signalClients) {
              if (client === ws) continue;
              try {
                client.send(payload);
              } catch {
                // Ignore send errors for stale sockets; onClose will prune.
              }
            }
          } else if (data.type === "subscribe") {
            ws.send(JSON.stringify({ type: "subscribed", eogConfig: eogProcessor.getConfig() }));
          } else if (data.type === "eog-config") {
            eogProcessor.updateConfig(data.config ?? {});
            ws.send(JSON.stringify({ type: "eog-config-updated", eogConfig: eogProcessor.getConfig() }));
          }
        } catch {
          // Non-JSON string → try forwarding to Deepgram as audio
          if (dgConnection) dgConnection.send(Buffer.from(event.data));
        }
      },

      onClose(_evt, ws) {
        signalClients.delete(ws);
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

/* ── RTMS Transcript Bridge ──────────────────────────────────
 * Listens for Zoom RTMS webhook events on ZM_RTMS_PORT (8080)
 * and broadcasts transcript data to all connected WebSocket clients.
 * Only loads when @zoom/rtms native addon is available (local dev).
 */
try {
  const rtms = require("@zoom/rtms");
  const rtmsClients = new Map<string, any>();

  rtms.onWebhookEvent(({ event, payload }: any) => {
    console.log(`[rtms] Received webhook event: ${event}`);
    const streamId = payload?.rtms_stream_id;

    if (event === "meeting.rtms_stopped") {
      if (!streamId) {
        console.log("[rtms] meeting.rtms_stopped without stream ID");
        return;
      }
      const client = rtmsClients.get(streamId);
      if (!client) {
        console.log(`[rtms] meeting.rtms_stopped for unknown stream: ${streamId}`);
        return;
      }
      console.log(`[rtms] Meeting RTMS stopped for stream: ${streamId}`);
      client.leave();
      rtmsClients.delete(streamId);
      return;
    }

    if (event !== "meeting.rtms_started") {
      console.log(`[rtms] Ignoring event: ${event}`);
      return;
    }

    console.log(`[rtms] Meeting RTMS started! Stream ID: ${streamId}`);
    const client = new rtms.Client();
    rtmsClients.set(streamId, client);

    client.onJoinConfirm((reason: any) => {
      console.log(`[rtms] Join confirmed — reason: ${reason}`);
    });

    client.onSessionUpdate((op: any, sessionInfo: any) => {
      console.log(`[rtms] Session update — op: ${op}`, sessionInfo);
    });

    client.onUserUpdate((op: any, participantInfo: any) => {
      console.log(`[rtms] User update — op: ${op}`, participantInfo);
    });

    client.onTranscriptData((data: any, size: any, timestamp: any, metadata: any) => {
      const text = typeof data === "string" ? data : data.toString("utf8");
      console.log(`[${timestamp}] -- ${metadata.userName}: ${text}`);

      const msg = JSON.stringify({
        type: "zoom_transcript",
        userName: metadata.userName,
        userId: metadata.userId,
        text,
        timestamp,
      });
      for (const wsClient of signalClients) {
        try {
          wsClient.send(msg);
        } catch {
          // Stale socket — onClose will prune
        }
      }
    });

    client.onLeave((reason: any) => {
      console.log(`[rtms] Left meeting — reason: ${reason}`);
      rtmsClients.delete(streamId);
    });

    console.log("[rtms] Joining meeting via RTMS...");
    client.join(payload);
  });

  console.log("[rtms] RTMS bridge loaded successfully");
} catch {
  console.log("[rtms] @zoom/rtms not available — RTMS bridge disabled (expected on cloud deployments)");
}

export default {
  port: PORT,
  fetch: app.fetch,
  websocket,
};
