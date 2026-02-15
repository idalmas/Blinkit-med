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
          const processed = eogProcessor.process(data as SignalInput);
          const payload = JSON.stringify(processed);
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
