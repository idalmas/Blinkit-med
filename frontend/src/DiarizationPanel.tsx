import { useEffect, useRef } from 'react';
import type { Utterance } from './types';

interface Props {
  utterances: Utterance[];
  interimUtterance?: Utterance | null;
  speakers: number;
  isRecording: boolean;
  error: string | null;
}

export function DiarizationPanel({ utterances, interimUtterance, isRecording, error }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [utterances]);

  return (
    <div
      style={{
        position: 'fixed',
        top: 60,
        left: 20,
        bottom: 80,
        width: 380,
        backgroundColor: 'rgba(0, 0, 0, 0.85)',
        borderRadius: 12,
        padding: 16,
        display: 'flex',
        flexDirection: 'column',
        zIndex: 20,
        backdropFilter: 'blur(10px)',
        border: '1px solid rgba(255, 255, 255, 0.1)',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 12,
          paddingBottom: 8,
          borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
        }}
      >
        <span style={{ color: '#fff', fontSize: 14, fontWeight: 600 }}>
          Live Transcript
        </span>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {isRecording && (
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                backgroundColor: '#ef4444',
                animation: 'pulse 1.5s infinite',
              }}
            />
          )}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div style={{ color: '#ef4444', fontSize: 13, marginBottom: 8 }}>
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
          lineHeight: 1.6,
        }}
      >
        {utterances.length === 0 && !isRecording && (
          <div style={{ color: '#666', textAlign: 'center', marginTop: 40 }}>
            Click "Start Recording" to begin
          </div>
        )}
        {utterances.length === 0 && isRecording && (
          <div style={{ color: '#666', textAlign: 'center', marginTop: 40 }}>
            Listening...
          </div>
        )}
        {utterances.map((u, i) => (
          <span key={i} style={{ color: '#e0e0e0' }}>{u.text} </span>
        ))}
        {interimUtterance && (
          <span style={{ color: '#e0e0e0', opacity: 0.5, fontStyle: 'italic' }}>{interimUtterance.text}</span>
        )}
      </div>

      {/* Pulse animation */}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
      `}</style>
    </div>
  );
}
