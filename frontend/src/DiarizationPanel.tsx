/**
 * DiarizationPanel.tsx — Live transcript sidebar with speaker diarization.
 *
 * Displays real-time transcription from Deepgram with per-speaker color coding.
 * Positioned as a fixed sidebar on the left side of the Home page.
 *
 * Features:
 *   - Auto-scrolling transcript list
 *   - Speaker count badge
 *   - Recording status indicator (pulsing red dot)
 *   - Glassmorphism card styling
 *   - Empty/listening state messages
 *
 * Inputs:
 *   @param utterances - Array of Utterance objects (speaker + text + timestamps)
 *   @param speakers - Number of detected speakers
 *   @param isRecording - Whether audio recording is active
 *   @param error - Error message string or null
 *
 * Parent: App.tsx (Home page)
 * Children: None
 */

import { useEffect, useRef } from 'react';
import type { Utterance } from './types';

/** Color palette for speaker identification (up to 6 speakers) */
const SPEAKER_COLORS = [
  '#6366f1', // indigo
  '#ef4444', // red
  '#10b981', // green
  '#f59e0b', // amber
  '#8b5cf6', // violet
  '#ec4899', // pink
];

interface Props {
  utterances: Utterance[];
  speakers: number;
  isRecording: boolean;
  error: string | null;
}

export function DiarizationPanel({ utterances, speakers, isRecording, error }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to the latest utterance
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [utterances]);

  return (
    <div
      style={{
        position: 'fixed',
        top: 'calc(var(--navbar-height) + 44px)',
        left: 20,
        bottom: 80,
        width: 360,
        background: 'var(--bg-glass)',
        borderRadius: 'var(--radius-lg)',
        padding: 16,
        display: 'flex',
        flexDirection: 'column',
        zIndex: 20,
        backdropFilter: 'blur(16px) saturate(180%)',
        WebkitBackdropFilter: 'blur(16px) saturate(180%)',
        border: '1px solid var(--border-subtle)',
        boxShadow: 'var(--shadow-lg)',
        animation: 'slideInUp 0.4s var(--ease-out-expo)',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 12,
          paddingBottom: 10,
          borderBottom: '1px solid var(--border-subtle)',
        }}
      >
        <span style={{ color: 'var(--text-primary)', fontSize: 13, fontWeight: 600, letterSpacing: '-0.2px' }}>
          Live Transcript
        </span>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {speakers > 0 && (
            <span
              style={{
                color: 'var(--text-tertiary)',
                fontSize: 11,
                padding: '3px 8px',
                borderRadius: 'var(--radius-full)',
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border-subtle)',
                fontWeight: 500,
              }}
            >
              {speakers} speaker{speakers !== 1 ? 's' : ''}
            </span>
          )}
          {isRecording && (
            <span
              style={{
                width: 7,
                height: 7,
                borderRadius: '50%',
                background: 'var(--accent-red)',
                animation: 'statusPulse 1.5s infinite',
              }}
            />
          )}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div style={{ color: 'var(--accent-red)', fontSize: 13, marginBottom: 8, fontWeight: 500 }}>
          {error}
        </div>
      )}

      {/* Transcript */}
      <div
        ref={scrollRef}
        style={{
          flex: 1,
          overflowY: 'auto',
          fontSize: 14,
          lineHeight: 1.65,
        }}
      >
        {utterances.length === 0 && !isRecording && (
          <div style={{ color: 'var(--text-muted)', textAlign: 'center', marginTop: 40, fontSize: 13 }}>
            Click "Start Recording" to begin
          </div>
        )}
        {utterances.length === 0 && isRecording && (
          <div style={{ color: 'var(--text-tertiary)', textAlign: 'center', marginTop: 40, fontSize: 13 }}>
            Listening...
          </div>
        )}
        {utterances.map((u, i) => (
          <div key={i} style={{ marginBottom: 8, animation: 'fadeIn 0.2s ease' }}>
            <span
              style={{
                color: SPEAKER_COLORS[u.speaker % SPEAKER_COLORS.length],
                fontWeight: 600,
                fontSize: 12,
              }}
            >
              Speaker {u.speaker + 1}
            </span>
            <span style={{ color: 'var(--text-tertiary)', fontSize: 12 }}> · </span>
            <span style={{ color: 'var(--text-primary)', fontSize: 14, opacity: 0.85 }}>{u.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
