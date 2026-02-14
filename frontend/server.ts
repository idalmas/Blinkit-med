import 'dotenv/config';
import express from 'express';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { createClient, LiveTranscriptionEvents } from '@deepgram/sdk';

const PORT = 3002;
const app = express();
const server = http.createServer(app);

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
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
