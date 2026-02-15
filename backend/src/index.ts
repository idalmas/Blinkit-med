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
import zoom from "./routes/zoom";

const DEEPGRAM_API_KEY = process.env.DEEPGRAM_API_KEY || "";

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
  movingAvg: number;
  lowerBound: number;
  upperBound: number;
  convScore: number;
  convThreshold: number;
  direction: Direction;
  calibrated: boolean;
  calibrationRemainingMs: number;
}

class EogProcessor {
  private readonly calibrationMs = 15_000;
  private readonly kernel = [-1, -0.5, 0, 0.5, 1];
  private readonly refractoryMs = 180;
  private readonly directionHoldMs = 160;
  private readonly minConvThreshold = 12;
  private readonly minMargin = 35;

  private startedAt = 0;
  private lastSampleAt = 0;
  private isCalibrated = false;

  private movingAvg = 0;
  private noiseEma = 0;
  private convNoiseEma = 0;
  private detrendedWindow: number[] = [];
  private calibrationValues: number[] = [];

  private calibratedStd = 18;
  private calibratedMean = 0;

  private lastEventAt = 0;
  private holdUntil = 0;
  private direction: Direction = 0;
  private readyForNextEvent = true;

  reset(nowMs: number) {
    this.startedAt = nowMs;
    this.lastSampleAt = nowMs;
    this.isCalibrated = false;
    this.movingAvg = 0;
    this.noiseEma = 0;
    this.convNoiseEma = 0;
    this.detrendedWindow = [];
    this.calibrationValues = [];
    this.calibratedStd = 18;
    this.calibratedMean = 0;
    this.lastEventAt = 0;
    this.holdUntil = 0;
    this.direction = 0;
    this.readyForNextEvent = true;
  }

  process(input: SignalInput): ProcessedSignal {
    const nowMs = Date.now();
    if (!this.startedAt) this.reset(nowMs);
    if (this.lastSampleAt && nowMs - this.lastSampleAt > 2_000) {
      // Stream gap usually means a new user/session. Recalibrate automatically.
      this.reset(nowMs);
    }
    this.lastSampleAt = nowMs;

    const raw = Number(input.raw);
    const voltage = Number(input.voltage);

    if (this.movingAvg === 0) this.movingAvg = raw;
    const avgAlpha = 0.02; // moving average baseline
    this.movingAvg = this.movingAvg + avgAlpha * (raw - this.movingAvg);

    const detrended = raw - this.movingAvg;
    this.noiseEma = this.noiseEma + 0.05 * (Math.abs(detrended) - this.noiseEma);

    this.detrendedWindow.push(detrended);
    if (this.detrendedWindow.length > this.kernel.length) this.detrendedWindow.shift();

    let convScore = 0;
    if (this.detrendedWindow.length === this.kernel.length) {
      for (let i = 0; i < this.kernel.length; i++) {
        convScore += this.kernel[i] * this.detrendedWindow[i];
      }
    }
    this.convNoiseEma = this.convNoiseEma + 0.05 * (Math.abs(convScore) - this.convNoiseEma);

    if (!this.isCalibrated) {
      this.calibrationValues.push(raw);
      if (nowMs - this.startedAt >= this.calibrationMs && this.calibrationValues.length > 50) {
        let sum = 0;
        for (const v of this.calibrationValues) sum += v;
        this.calibratedMean = sum / this.calibrationValues.length;
        let varSum = 0;
        for (const v of this.calibrationValues) varSum += (v - this.calibratedMean) ** 2;
        this.calibratedStd = Math.sqrt(varSum / this.calibrationValues.length) || 18;
        this.isCalibrated = true;
      }
    }

    const calibratedMargin = Math.max(
      this.minMargin,
      this.calibratedStd * 4,
      this.noiseEma * 7
    );
    const lowerBound = this.movingAvg - calibratedMargin;
    const upperBound = this.movingAvg + calibratedMargin;

    const convThreshold = Math.max(
      this.minConvThreshold,
      this.convNoiseEma * 3.6,
      this.calibratedStd * 0.9
    );

    if (Math.abs(convScore) < convThreshold * 0.35) {
      this.readyForNextEvent = true;
    }

    if (
      this.readyForNextEvent &&
      nowMs - this.lastEventAt > this.refractoryMs &&
      Math.abs(convScore) > convThreshold
    ) {
      this.direction = convScore > 0 ? -1 : 1;
      this.lastEventAt = nowMs;
      this.holdUntil = nowMs + this.directionHoldMs;
      this.readyForNextEvent = false;
    } else if (nowMs > this.holdUntil) {
      this.direction = 0;
    }

    return {
      type: "signal",
      raw,
      voltage,
      timestamp: input.timestamp ?? nowMs / 1000,
      movingAvg: this.movingAvg,
      lowerBound,
      upperBound,
      convScore,
      convThreshold,
      direction: this.direction,
      calibrated: this.isCalibrated,
      calibrationRemainingMs: this.isCalibrated
        ? 0
        : Math.max(0, this.calibrationMs - (nowMs - this.startedAt)),
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
    let dgConnection: ReturnType<ReturnType<typeof createClient>["listen"]["live"]> | null = null;

    return {
      onOpen(_evt, ws) {
        signalClients.add(ws);
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

      onMessage(event, ws) {
        // Binary data → forward to Deepgram for transcription
        if (typeof event.data !== "string") {
          if (dgConnection) {
            dgConnection.send(event.data);
          }
          return;
        }

        // JSON string data → handle signal processing and subscribe
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
            ws.send(JSON.stringify({ type: "subscribed" }));
          }
        } catch {
          // Non-JSON string → try forwarding to Deepgram as audio
          if (dgConnection) {
            dgConnection.send(Buffer.from(event.data));
          }
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

const PORT = Number(process.env.PORT) || 3003;

// Create the Elasticsearch index if it doesn't exist, then add the `person`
// field to the mapping (safe no-op if it already exists), then start serving.
ensureIndex()
  .then(() => ensurePersonField())
  .then(() => {
    console.log(`🚀 Blinket backend listening on http://localhost:${PORT}`);
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
