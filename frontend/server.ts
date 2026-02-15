import 'dotenv/config';
import express from 'express';
import http from 'http';
import crypto from 'crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { createClient, LiveTranscriptionEvents } from '@deepgram/sdk';
import rtms from '@zoom/rtms';

const PORT = 3003;
const app = express();
const server = http.createServer(app);
app.use(express.json());
const rtmsClients = new Map<string, any>();
const rtmsLogs: string[] = [];
const RTMS_MAX_LOGS = 500;
const RTMS_TRANSCRIPT_BUFFER_SIZE = 20;

interface RtmsTranscriptEntry {
  username: string;
  conferenceTime: string;
  text: string;
  streamId: string;
}

const recentRtmsTranscripts: RtmsTranscriptEntry[] = [];

const ZOOM_MEETING_SDK_KEY = process.env.ZOOM_MEETING_SDK_KEY;
const ZOOM_MEETING_SDK_SECRET = process.env.ZOOM_MEETING_SDK_SECRET;
const ZOOM_ACCOUNT_ID = process.env.ZOOM_ACCOUNT_ID;
const ZOOM_CLIENT_ID = process.env.ZOOM_CLIENT_ID;
const ZOOM_CLIENT_SECRET = process.env.ZOOM_CLIENT_SECRET;
const ZM_RTMS_CLIENT = (process.env.ZM_RTMS_CLIENT || '').trim();
const ZM_RTMS_SECRET = (process.env.ZM_RTMS_SECRET || '').trim();

function looksLikeSerializedObject(value: string): boolean {
  return value.startsWith('{') || value.startsWith('{"') || value.startsWith('["');
}

function validateRtmsCredentials(): void {
  if (!ZM_RTMS_CLIENT || !ZM_RTMS_SECRET) {
    console.warn('[rtms] Missing ZM_RTMS_CLIENT or ZM_RTMS_SECRET');
    return;
  }

  if (looksLikeSerializedObject(ZM_RTMS_CLIENT) || looksLikeSerializedObject(ZM_RTMS_SECRET)) {
    console.error(
      '[rtms] ZM_RTMS_CLIENT/SECRET look malformed (object/json string). Use plain text values only.',
    );
  }

  if (ZM_RTMS_CLIENT.includes('"') || ZM_RTMS_SECRET.includes('"')) {
    console.warn('[rtms] ZM_RTMS_CLIENT/SECRET include quotes. Remove wrapping quotes in .env.');
  }

  console.log(
    `[rtms] creds loaded clientLen=${ZM_RTMS_CLIENT.length} secretLen=${ZM_RTMS_SECRET.length}`,
  );
}

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

validateRtmsCredentials();

function appendRtmsLog(label: string, payload: unknown): void {
  const serialized = typeof payload === 'string' ? payload : JSON.stringify(payload);
  const line = `[${new Date().toISOString()}] ${label} ${serialized}`;
  rtmsLogs.push(line);
  if (rtmsLogs.length > RTMS_MAX_LOGS) {
    rtmsLogs.splice(0, rtmsLogs.length - RTMS_MAX_LOGS);
  }
  console.log(`[rtms] ${label}`, payload);
}

function tryParseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function extractFirstString(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function extractTranscriptText(rawData: string): string {
  const parsed = tryParseJson(rawData);
  const parsedRecord = asRecord(parsed);
  if (!parsedRecord) return rawData.trim();
  return (
    extractFirstString(parsedRecord, ['text', 'transcript', 'content', 'message', 'utterance']) ??
    rawData.trim()
  );
}

function extractUsername(metadata: unknown, rawData: string): string {
  const metadataRecord = asRecord(metadata);
  if (metadataRecord) {
    const direct = extractFirstString(metadataRecord, [
      'userName',
      'username',
      'user_name',
      'display_name',
      'participant_name',
      'speaker',
      'name',
    ]);
    if (direct) return direct;
  }

  const parsed = tryParseJson(rawData);
  const parsedRecord = asRecord(parsed);
  if (parsedRecord) {
    const fromData = extractFirstString(parsedRecord, [
      'userName',
      'username',
      'user_name',
      'display_name',
      'participant_name',
      'speaker',
      'name',
    ]);
    if (fromData) return fromData;
  }

  return 'unknown';
}

function toConferenceIso(timestamp: number): string {
  if (typeof timestamp !== 'number' || !Number.isFinite(timestamp) || timestamp <= 0) {
    return new Date().toISOString();
  }
  const ms = timestamp > 1_000_000_000_000 ? timestamp : timestamp * 1000;
  return new Date(ms).toISOString();
}

function appendRtmsTranscript(entry: RtmsTranscriptEntry): void {
  recentRtmsTranscripts.push(entry);
  if (recentRtmsTranscripts.length > RTMS_TRANSCRIPT_BUFFER_SIZE) {
    recentRtmsTranscripts.splice(0, recentRtmsTranscripts.length - RTMS_TRANSCRIPT_BUFFER_SIZE);
  }
}

app.get('/api/zoom/rtms/logs', (_req, res) => {
  res.json({ logs: rtmsLogs });
});

app.post('/api/zoom/rtms/logs/clear', (_req, res) => {
  rtmsLogs.length = 0;
  res.json({ ok: true });
});

app.get('/api/zoom/rtms/recent-transcripts', (_req, res) => {
  res.json({
    size: RTMS_TRANSCRIPT_BUFFER_SIZE,
    count: recentRtmsTranscripts.length,
    items: recentRtmsTranscripts,
  });
});

function toBase64Url(value: string): string {
  return Buffer.from(value)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function createMeetingSdkSignature(meetingNumber: string, role: 0 | 1): string {
  if (!ZOOM_MEETING_SDK_KEY || !ZOOM_MEETING_SDK_SECRET) {
    throw new Error('Missing ZOOM_MEETING_SDK_KEY or ZOOM_MEETING_SDK_SECRET');
  }

  const iat = Math.floor(Date.now() / 1000) - 30;
  const exp = iat + 60 * 60 * 2;
  const header = toBase64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = toBase64Url(
    JSON.stringify({
      appKey: ZOOM_MEETING_SDK_KEY,
      sdkKey: ZOOM_MEETING_SDK_KEY,
      mn: meetingNumber,
      role,
      iat,
      exp,
      tokenExp: exp,
    }),
  );

  const message = `${header}.${payload}`;
  const hash = crypto
    .createHmac('sha256', ZOOM_MEETING_SDK_SECRET)
    .update(message)
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

  return `${message}.${hash}`;
}

async function getZoomAccessToken(): Promise<string> {
  if (!ZOOM_ACCOUNT_ID || !ZOOM_CLIENT_ID || !ZOOM_CLIENT_SECRET) {
    throw new Error('Missing Zoom OAuth env vars: ZOOM_ACCOUNT_ID, ZOOM_CLIENT_ID, ZOOM_CLIENT_SECRET');
  }

  const body = new URLSearchParams({
    grant_type: 'account_credentials',
    account_id: ZOOM_ACCOUNT_ID,
  });

  const auth = Buffer.from(`${ZOOM_CLIENT_ID}:${ZOOM_CLIENT_SECRET}`).toString('base64');
  const response = await fetch('https://zoom.us/oauth/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to get Zoom access token: ${response.status} ${text}`);
  }

  const data = (await response.json()) as { access_token?: string };
  if (!data.access_token) {
    throw new Error('Zoom token response missing access_token');
  }
  return data.access_token;
}

app.post('/api/zoom/signature', (req, res) => {
  try {
    const meetingNumber = String(req.body?.meetingNumber || '').trim();
    const roleRaw = req.body?.role;
    const role = roleRaw === 1 ? 1 : 0;

    if (!meetingNumber) {
      return res.status(400).json({ error: 'meetingNumber is required' });
    }

    const signature = createMeetingSdkSignature(meetingNumber, role);
    return res.json({ signature, sdkKey: ZOOM_MEETING_SDK_KEY });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: message });
  }
});

app.post('/api/zoom/create-meeting', async (req, res) => {
  try {
    const topic = String(req.body?.topic || 'New Meeting').trim() || 'New Meeting';
    const userId = String(req.body?.userId || 'me').trim() || 'me';

    const accessToken = await getZoomAccessToken();
    const response = await fetch(`https://api.zoom.us/v2/users/${encodeURIComponent(userId)}/meetings`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        topic,
        type: 2,
        settings: {
          use_pmi: false,
          host_video: true,
          participant_video: true,
          join_before_host: true,
        },
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      return res.status(response.status).json({ error: `Zoom meeting create failed: ${text}` });
    }

    const data = (await response.json()) as {
      id: number;
      password?: string;
      join_url?: string;
      start_url?: string;
      topic?: string;
      host_email?: string;
    };
    const startUrl = data.start_url ?? '';
    let zak = '';
    if (startUrl) {
      try {
        const parsed = new URL(startUrl);
        zak = parsed.searchParams.get('zak') ?? '';
      } catch {
        zak = '';
      }
    }

    return res.json({
      meetingNumber: String(data.id),
      password: data.password ?? '',
      joinUrl: data.join_url ?? '',
      startUrl,
      zak,
      hostEmail: data.host_email ?? '',
      topic: data.topic ?? topic,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: message });
  }
});

app.post('/api/zoom/end-all-meetings', async (req, res) => {
  try {
    const userId = String(req.body?.userId || 'me').trim() || 'me';
    const accessToken = await getZoomAccessToken();

    // List live meetings
    const listRes = await fetch(
      `https://api.zoom.us/v2/users/${encodeURIComponent(userId)}/meetings?type=live&page_size=50`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    );

    if (!listRes.ok) {
      const text = await listRes.text();
      return res.status(listRes.status).json({ error: `Failed to list meetings: ${text}` });
    }

    const listData = (await listRes.json()) as { meetings?: { id: number }[] };
    const meetings = listData.meetings ?? [];

    // End each live meeting
    const results: { id: number; ended: boolean; error?: string }[] = [];
    for (const meeting of meetings) {
      try {
        const endRes = await fetch(
          `https://api.zoom.us/v2/meetings/${meeting.id}/status`,
          {
            method: 'PUT',
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ action: 'end' }),
          },
        );
        results.push({
          id: meeting.id,
          ended: endRes.ok || endRes.status === 204,
          error: endRes.ok || endRes.status === 204 ? undefined : await endRes.text(),
        });
      } catch (err) {
        results.push({
          id: meeting.id,
          ended: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    console.log(`[zoom] Ended ${results.filter((r) => r.ended).length}/${meetings.length} live meetings`);
    return res.json({ ended: results.filter((r) => r.ended).length, total: meetings.length, results });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: message });
  }
});

rtms.onWebhookEvent(({ event, payload }) => {
  appendRtmsLog('webhook_event', { event, payload });

  const streamId = String(payload?.rtms_stream_id || '');
  if (event === 'meeting.rtms_stopped') {
    if (!streamId) {
      appendRtmsLog('stop_missing_stream_id', payload);
      return;
    }

    const client = rtmsClients.get(streamId);
    if (!client) {
      appendRtmsLog('stop_unknown_stream_id', { streamId });
      return;
    }

    client.leave();
    rtmsClients.delete(streamId);
    appendRtmsLog('client_left', { streamId });
    return;
  }

  if (event !== 'meeting.rtms_started') {
    appendRtmsLog('ignored_event', { event });
    return;
  }

  if (!streamId) {
    appendRtmsLog('start_missing_stream_id', payload);
    return;
  }

  const client = new rtms.Client();
  rtmsClients.set(streamId, client);
  appendRtmsLog('client_created', { streamId });

  client.onJoinConfirm((reason: unknown) => appendRtmsLog('join_confirm', { streamId, reason }));
  client.onSessionUpdate((op: unknown, sessionInfo: unknown) =>
    appendRtmsLog('session_update', { streamId, op, sessionInfo }),
  );
  client.onUserUpdate((op: unknown, participantInfo: unknown) =>
    appendRtmsLog('user_update', { streamId, op, participantInfo }),
  );
  client.onAudioData((_data: unknown, size: number, timestamp: number, metadata: unknown) =>
    appendRtmsLog('audio_data', { streamId, size, timestamp, metadata }),
  );
  client.onVideoData((_data: unknown, size: number, timestamp: number, metadata: unknown) =>
    appendRtmsLog('video_data', { streamId, size, timestamp, metadata }),
  );
  client.onTranscriptData((data: unknown, size: number, timestamp: number, metadata: unknown) => {
    const text = Buffer.isBuffer(data) ? data.toString('utf8') : String(data);
    const transcript = extractTranscriptText(text);
    if (transcript) {
      appendRtmsTranscript({
        username: extractUsername(metadata, text),
        conferenceTime: toConferenceIso(timestamp),
        text: transcript,
        streamId,
      });
    }

    appendRtmsLog('transcript_data', {
      streamId,
      size,
      timestamp,
      metadata,
      data: text,
    });
  },
  );
  client.onLeave((reason: unknown) => {
    appendRtmsLog('leave', { streamId, reason });
    rtmsClients.delete(streamId);
  });

  try {
    client.join(payload);
    appendRtmsLog('join_called', { streamId });
  } catch (error) {
    appendRtmsLog('join_error', {
      streamId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (browserSocket: WebSocket) => {
  console.log('[ws] Browser connected');

  const deepgram = createClient(process.env.DEEPGRAM_API_KEY!);

  const dgConnection = deepgram.listen.live({
    model: 'nova-3',
    diarize: true,
    smart_format: true,
    punctuate: true,
    interim_results: false,
    encoding: 'linear16',
    sample_rate: 16000,
  });

  dgConnection.on(LiveTranscriptionEvents.Open, () => {
    console.log('[deepgram] Connection opened');
  });

  dgConnection.on(LiveTranscriptionEvents.Transcript, (data: any) => {
    const words = data.channel?.alternatives?.[0]?.words;
    const transcript = data.channel?.alternatives?.[0]?.transcript;

    if (transcript && words?.length > 0) {
      browserSocket.send(
        JSON.stringify({
          type: 'transcript',
          transcript,
          words: words.map((w: any) => ({
            word: w.punctuated_word || w.word,
            speaker: w.speaker,
            start: w.start,
            end: w.end,
            confidence: w.confidence,
          })),
          is_final: data.is_final,
        })
      );
    }
  });

  dgConnection.on(LiveTranscriptionEvents.Error, (err: any) => {
    console.error('[deepgram] Error:', err);
    browserSocket.send(JSON.stringify({ type: 'error', message: String(err) }));
  });

  dgConnection.on(LiveTranscriptionEvents.Close, () => {
    console.log('[deepgram] Connection closed');
  });

  browserSocket.on('message', (data: Buffer) => {
    if (dgConnection.getReadyState() === WebSocket.OPEN) {
      dgConnection.send(data);
    }
  });

  browserSocket.on('close', () => {
    console.log('[ws] Browser disconnected');
    dgConnection.requestClose();
  });
});

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
