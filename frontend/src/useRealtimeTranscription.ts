import { useState, useRef, useCallback } from 'react';
import type { Utterance } from './types';

interface TranscriptMessage {
  type: 'transcript';
  transcript: string;
  words: Array<{
    word: string;
    speaker: number;
    start: number;
    end: number;
    confidence: number;
  }>;
  is_final: boolean;
}

export function useRealtimeTranscription() {
  const [isRecording, setIsRecording] = useState(false);
  const [utterances, setUtterances] = useState<Utterance[]>([]);
  const [speakers, setSpeakers] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);

  const startRecording = useCallback(async () => {
    setError(null);

    try {
      // Open WebSocket to our server
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
      wsRef.current = ws;

      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.type === 'transcript') {
          const data = msg as TranscriptMessage;
          // Group words into utterances by speaker turns
          const newUtterances: Utterance[] = [];
          let current: Utterance | null = null;

          for (const w of data.words) {
            if (current && current.speaker === w.speaker) {
              current.text += ' ' + w.word;
              current.end = w.end;
            } else {
              if (current) newUtterances.push(current);
              current = {
                speaker: w.speaker,
                text: w.word,
                start: w.start,
                end: w.end,
              };
            }
          }
          if (current) newUtterances.push(current);

          setUtterances(prev => {
            const updated = [...prev, ...newUtterances];
            // Track unique speakers
            const uniqueSpeakers = new Set(updated.map(u => u.speaker));
            setSpeakers(uniqueSpeakers.size);
            return updated;
          });
        } else if (msg.type === 'error') {
          setError(msg.message);
        }
      };

      ws.onerror = () => setError('WebSocket connection failed');
      ws.onclose = () => {
        if (mediaRecorderRef.current?.state === 'recording') {
          stopRecording();
        }
      };

      // Wait for WebSocket to open
      await new Promise<void>((resolve, reject) => {
        ws.onopen = () => resolve();
        ws.onerror = () => reject(new Error('Failed to connect'));
      });

      // Get microphone and stream raw PCM at 16kHz to match server config
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const audioContext = new AudioContext({ sampleRate: 16000 });
      audioContextRef.current = audioContext;
      const source = audioContext.createMediaStreamSource(stream);
      const processor = audioContext.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;

      processor.onaudioprocess = (e) => {
        if (ws.readyState === WebSocket.OPEN) {
          const float32 = e.inputBuffer.getChannelData(0);
          // Convert float32 to int16 PCM
          const int16 = new Int16Array(float32.length);
          for (let i = 0; i < float32.length; i++) {
            const s = Math.max(-1, Math.min(1, float32[i]));
            int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
          }
          ws.send(int16.buffer);
        }
      };

      source.connect(processor);
      processor.connect(audioContext.destination);

      setIsRecording(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start recording');
    }
  }, []);

  const stopRecording = useCallback(() => {
    // Disconnect audio processing
    processorRef.current?.disconnect();
    processorRef.current = null;
    audioContextRef.current?.close();
    audioContextRef.current = null;

    // Release microphone
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;

    // Close WebSocket
    wsRef.current?.close();
    wsRef.current = null;

    setIsRecording(false);
  }, []);

  const clearTranscript = useCallback(() => {
    setUtterances([]);
    setSpeakers(0);
  }, []);

  return { isRecording, utterances, speakers, error, startRecording, stopRecording, clearTranscript };
}
