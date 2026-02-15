import { useState, useRef, useCallback, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import Webcam from 'react-webcam'
import { FaArrowLeft, FaSpinner, FaMicrophone, FaVolumeUp } from 'react-icons/fa'
import { useBlinkDetection, type BlinkType } from './useBlinkDetection'
import { useRealtimeTranscription } from './useRealtimeTranscription'
import { DiarizationPanel } from './DiarizationPanel'
import type { Utterance } from './types'

const API_BASE = 'http://localhost:3003'

type TalkState =
  | 'IDLE'
  | 'SPEAKER_SELECT'
  | 'LOADING_OPTIONS'
  | 'PICKING_OPTION'
  | 'GENERATING_AUDIO'
  | 'PLAYING_AUDIO'

const SPEAKER_COLORS = ['#3b82f6', '#ef4444', '#22c55e', '#f59e0b', '#8b5cf6', '#ec4899']

export default function TalkPage() {
  const navigate = useNavigate()

  // Core state machine
  const [talkState, setTalkState] = useState<TalkState>('IDLE')

  // Response options from getContext
  const [options, setOptions] = useState<string[]>([])
  const [optionIdx, setOptionIdx] = useState(0)

  // Audio playback
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const audioRef = useRef<HTMLAudioElement>(null)

  // Error handling
  const [error, setError] = useState<string | null>(null)

  // Snapshot of utterances used for getContext call
  const utteranceSnapshotRef = useRef<Utterance[]>([])

  // Transcription — always running
  const {
    isRecording,
    utterances,
    speakers,
    error: transcriptionError,
    startRecording,
    stopRecording,
  } = useRealtimeTranscription()

  // Auto-start recording on mount
  useEffect(() => {
    startRecording()
    return () => stopRecording()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Fetch response options from getContext
  const fetchOptions = useCallback(
    async (speakerNum: number) => {
      setTalkState('LOADING_OPTIONS')
      setError(null)

      // Snapshot current utterances
      const snapshot = utterances
      utteranceSnapshotRef.current = snapshot

      const transcript = snapshot
        .map((u) => `Speaker ${u.speaker + 1}: ${u.text}`)
        .join('\n')

      try {
        const res = await fetch(`${API_BASE}/getContext`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            app: 'Talk',
            text: JSON.stringify({
              transcript,
              selectedSpeaker: speakerNum,
              speakerCount: speakers || 1,
            }),
            k: 5,
          }),
        })

        if (!res.ok) throw new Error('Failed to get context')
        const data = await res.json()

        const result = data.result
        if (Array.isArray(result) && result.length > 0) {
          setOptions(result)
          setOptionIdx(0)
          setTalkState('PICKING_OPTION')
        } else {
          setError('No response options generated. Try again.')
          setTalkState('IDLE')
        }
      } catch {
        setError('Failed to generate options. Try again.')
        setTalkState('IDLE')
      }
    },
    [utterances, speakers]
  )

  // Generate and play TTS for selected option
  const selectOption = useCallback(
    async (idx: number) => {
      setTalkState('GENERATING_AUDIO')
      setError(null)

      try {
        const res = await fetch(`${API_BASE}/apps/talk/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: options[idx] }),
        })

        if (!res.ok) throw new Error('Audio generation failed')
        const blob = await res.blob()
        const url = URL.createObjectURL(blob)

        if (audioUrl) URL.revokeObjectURL(audioUrl)
        setAudioUrl(url)
        setTalkState('PLAYING_AUDIO')

        // Auto-play after a tick
        setTimeout(() => audioRef.current?.play(), 100)
      } catch {
        setError('Audio generation failed. Try again.')
        setTalkState('IDLE')
      }
    },
    [options, audioUrl]
  )

  // Audio ended → back to IDLE
  const handleAudioEnded = useCallback(() => {
    if (audioUrl) URL.revokeObjectURL(audioUrl)
    setAudioUrl(null)
    setTalkState('IDLE')
  }, [audioUrl])

  // Blink handler — dispatches based on current state
  const handleBlink = useCallback(
    (type: BlinkType) => {
      // Global: long-close always goes back to apps
      if (type === 'long-close') {
        navigate('/apps')
        return
      }

      switch (talkState) {
        case 'IDLE':
          if (type === 'triple') {
            navigate('/apps')
            return
          }
          if (type === 'double') {
            if (utterances.length === 0) {
              setError('No conversation detected yet.')
              setTimeout(() => setError(null), 2000)
              return
            }
            if (speakers <= 1) {
              // Auto-select the only speaker
              fetchOptions(0)
            } else {
              setTalkState('SPEAKER_SELECT')
            }
          }
          break

        case 'SPEAKER_SELECT':
          if (type === 'wink-left') {
            fetchOptions(0)
          } else if (type === 'wink-right') {
            fetchOptions(1)
          } else if (type === 'triple') {
            setTalkState('IDLE')
          }
          break

        case 'LOADING_OPTIONS':
          if (type === 'triple') {
            setTalkState('IDLE')
          }
          break

        case 'PICKING_OPTION':
          if (type === 'wink-left') {
            setOptionIdx((prev) => (prev - 1 + options.length) % options.length)
          } else if (type === 'wink-right') {
            setOptionIdx((prev) => (prev + 1) % options.length)
          } else if (type === 'double') {
            selectOption(optionIdx)
          } else if (type === 'triple') {
            setTalkState('IDLE')
          }
          break

        case 'GENERATING_AUDIO':
          // No actions during generation
          break

        case 'PLAYING_AUDIO':
          if (type === 'triple') {
            audioRef.current?.pause()
            if (audioUrl) URL.revokeObjectURL(audioUrl)
            setAudioUrl(null)
            setTalkState('IDLE')
          }
          break
      }
    },
    [talkState, utterances, speakers, options, optionIdx, navigate, fetchOptions, selectOption, audioUrl]
  )

  const { webcamRef, status: blinkStatus } = useBlinkDetection({ onBlink: handleBlink })

  // Status subtitle based on state
  const subtitle: Record<TalkState, string> = {
    IDLE: 'Listening... double-blink to respond',
    SPEAKER_SELECT: 'Who do you want to respond to?',
    LOADING_OPTIONS: 'Generating responses...',
    PICKING_OPTION: 'Wink to browse, double-blink to speak',
    GENERATING_AUDIO: 'Generating speech...',
    PLAYING_AUDIO: 'Speaking...',
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'linear-gradient(160deg, #0a0a0a 0%, #111827 50%, #0a0a0a 100%)',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        overflow: 'auto',
      }}
    >
      {/* Back button */}
      <button
        onClick={() => navigate('/apps')}
        style={{
          position: 'fixed',
          top: 24,
          left: 420,
          background: 'rgba(255,255,255,0.08)',
          border: '1px solid rgba(255,255,255,0.12)',
          borderRadius: 12,
          color: '#fff',
          padding: '8px 16px',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          fontSize: 14,
          fontWeight: 500,
          transition: 'background 0.2s',
          zIndex: 10,
        }}
        onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.14)')}
        onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.08)')}
      >
        <FaArrowLeft size={12} /> Back
      </button>

      {/* Diarization panel — always visible on left */}
      <DiarizationPanel
        utterances={utterances}
        speakers={speakers}
        isRecording={isRecording}
        error={transcriptionError}
      />

      {/* Main content area — centered, offset right for the panel */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          marginLeft: 200,
          paddingTop: 60,
          width: '100%',
          maxWidth: 600,
        }}
      >
        {/* Title */}
        <h1
          style={{
            color: '#fff',
            fontSize: 40,
            fontWeight: 700,
            letterSpacing: '-1.5px',
            margin: '24px 0 8px',
          }}
        >
          Talk
        </h1>
        <p
          style={{
            color: 'rgba(255,255,255,0.4)',
            fontSize: 15,
            margin: '0 0 40px',
            textAlign: 'center',
          }}
        >
          {subtitle[talkState]}
        </p>

        {/* Error display */}
        {error && (
          <div
            style={{
              background: 'rgba(239, 68, 68, 0.15)',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              borderRadius: 12,
              padding: '12px 20px',
              color: '#f87171',
              fontSize: 14,
              marginBottom: 24,
              maxWidth: 480,
              textAlign: 'center',
            }}
          >
            {error}
          </div>
        )}

        {/* IDLE state — pulsing mic */}
        {talkState === 'IDLE' && (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 20,
              marginTop: 40,
            }}
          >
            <div
              style={{
                width: 100,
                height: 100,
                borderRadius: '50%',
                background: 'rgba(139, 92, 246, 0.12)',
                border: '2px solid rgba(139, 92, 246, 0.3)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                animation: 'pulseGlow 2s ease-in-out infinite',
              }}
            >
              <FaMicrophone size={36} color="rgba(139, 92, 246, 0.8)" />
            </div>
            <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: 13 }}>
              {isRecording ? `${speakers} speaker${speakers !== 1 ? 's' : ''} detected` : 'Connecting...'}
            </div>
          </div>
        )}

        {/* LOADING_OPTIONS state — spinner */}
        {talkState === 'LOADING_OPTIONS' && (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 16,
              marginTop: 40,
            }}
          >
            <FaSpinner size={32} color="rgba(139, 92, 246, 0.8)" className="spin" />
            <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 15 }}>
              Thinking of responses...
            </div>
          </div>
        )}

        {/* PICKING_OPTION state — option cards */}
        {talkState === 'PICKING_OPTION' && (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 10,
              width: '100%',
              maxWidth: 560,
              padding: '0 24px',
            }}
          >
            <div
              style={{
                color: 'rgba(255,255,255,0.4)',
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: 1,
                textTransform: 'uppercase',
                marginBottom: 8,
              }}
            >
              Wink to browse &middot; Double-blink to speak &middot; Triple-blink to go back
            </div>

            {options.map((opt, i) => {
              const isFocused = i === optionIdx
              return (
                <div
                  key={i}
                  style={{
                    width: '100%',
                    padding: '14px 18px',
                    borderRadius: 16,
                    background: isFocused ? 'rgba(139, 92, 246, 0.15)' : 'rgba(255,255,255,0.04)',
                    border: isFocused
                      ? '2px solid rgba(139, 92, 246, 0.6)'
                      : '1px solid rgba(255,255,255,0.08)',
                    color: isFocused ? '#fff' : 'rgba(255,255,255,0.55)',
                    fontSize: isFocused ? 17 : 15,
                    fontWeight: isFocused ? 600 : 400,
                    transition: 'all 0.2s ease',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 14,
                    transform: isFocused ? 'scale(1.02)' : 'scale(1)',
                    boxShadow: isFocused ? '0 0 30px rgba(139, 92, 246, 0.2)' : 'none',
                    cursor: 'pointer',
                  }}
                  onClick={() => selectOption(i)}
                >
                  <span
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: 8,
                      background: isFocused ? 'rgba(139, 92, 246, 0.3)' : 'rgba(255,255,255,0.08)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 13,
                      fontWeight: 700,
                      flexShrink: 0,
                    }}
                  >
                    {i + 1}
                  </span>
                  {opt}
                </div>
              )
            })}
          </div>
        )}

        {/* GENERATING_AUDIO state */}
        {talkState === 'GENERATING_AUDIO' && (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 16,
              marginTop: 40,
              maxWidth: 480,
              textAlign: 'center',
            }}
          >
            <div
              style={{
                color: '#fff',
                fontSize: 20,
                fontWeight: 600,
                lineHeight: 1.4,
                padding: '16px 24px',
                background: 'rgba(139, 92, 246, 0.1)',
                border: '1px solid rgba(139, 92, 246, 0.3)',
                borderRadius: 16,
              }}
            >
              "{options[optionIdx]}"
            </div>
            <FaSpinner size={24} color="rgba(139, 92, 246, 0.8)" className="spin" />
            <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 13 }}>Generating speech...</div>
          </div>
        )}

        {/* PLAYING_AUDIO state */}
        {talkState === 'PLAYING_AUDIO' && (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 20,
              marginTop: 40,
            }}
          >
            <div
              style={{
                width: 100,
                height: 100,
                borderRadius: '50%',
                background: 'rgba(34, 197, 94, 0.12)',
                border: '2px solid rgba(34, 197, 94, 0.3)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                animation: 'pulseGlow 1s ease-in-out infinite',
              }}
            >
              <FaVolumeUp size={36} color="rgba(34, 197, 94, 0.8)" />
            </div>
            <div
              style={{
                color: '#fff',
                fontSize: 18,
                fontWeight: 600,
                maxWidth: 400,
                textAlign: 'center',
                lineHeight: 1.4,
              }}
            >
              "{options[optionIdx]}"
            </div>
            <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: 12 }}>
              Triple-blink to go back
            </div>
          </div>
        )}
      </div>

      {/* Speaker selection modal */}
      {talkState === 'SPEAKER_SELECT' && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 50,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(0, 0, 0, 0.85)',
            animation: 'modalIn 0.3s ease-out',
          }}
        >
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 32,
            }}
          >
            <h2 style={{ color: '#fff', fontSize: 28, fontWeight: 700 }}>Who do you want to respond to?</h2>
            <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 14 }}>
              Wink left for Speaker 1 &middot; Wink right for Speaker 2 &middot; Triple-blink to go
              back
            </p>
            <div style={{ display: 'flex', gap: 32 }}>
              {Array.from({ length: Math.min(speakers, 2) }, (_, speakerNum) => {
                const color = SPEAKER_COLORS[speakerNum % SPEAKER_COLORS.length]
                const recentUtts = utterances.filter((u) => u.speaker === speakerNum).slice(-3)
                return (
                  <div
                    key={speakerNum}
                    style={{
                      width: 280,
                      padding: 24,
                      borderRadius: 20,
                      background: 'rgba(255,255,255,0.06)',
                      border: `2px solid ${color}40`,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 12,
                      cursor: 'pointer',
                      transition: 'all 0.2s',
                    }}
                    onClick={() => fetchOptions(speakerNum)}
                    onMouseEnter={(e) =>
                      (e.currentTarget.style.background = 'rgba(255,255,255,0.1)')
                    }
                    onMouseLeave={(e) =>
                      (e.currentTarget.style.background = 'rgba(255,255,255,0.06)')
                    }
                  >
                    <div style={{ color, fontSize: 20, fontWeight: 700 }}>
                      Speaker {speakerNum + 1}
                    </div>
                    <div
                      style={{
                        color: 'rgba(255,255,255,0.3)',
                        fontSize: 11,
                        textTransform: 'uppercase',
                        letterSpacing: 1,
                      }}
                    >
                      {speakerNum === 0 ? 'Wink Left' : 'Wink Right'}
                    </div>
                    {recentUtts.length > 0 ? (
                      recentUtts.map((u, i) => (
                        <div
                          key={i}
                          style={{
                            color: 'rgba(255,255,255,0.5)',
                            fontSize: 13,
                            lineHeight: 1.4,
                            borderLeft: `3px solid ${color}40`,
                            paddingLeft: 10,
                          }}
                        >
                          "{u.text.slice(0, 80)}
                          {u.text.length > 80 ? '...' : ''}"
                        </div>
                      ))
                    ) : (
                      <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: 13 }}>
                        No speech detected yet
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {/* Hidden audio element */}
      {audioUrl && (
        <audio ref={audioRef} src={audioUrl} onEnded={handleAudioEnded} style={{ display: 'none' }} />
      )}

      {/* Webcam preview — bottom right */}
      <div
        style={{
          position: 'fixed',
          bottom: 20,
          right: 20,
          zIndex: 30,
          borderRadius: 12,
          overflow: 'hidden',
          border: '2px solid rgba(255,255,255,0.15)',
          boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
        }}
      >
        <Webcam
          ref={webcamRef}
          mirrored
          style={{ width: 160, height: 120, objectFit: 'cover', display: 'block' }}
          videoConstraints={{ facingMode: 'user', width: 320, height: 240 }}
        />
        <div
          style={{
            position: 'absolute',
            bottom: 6,
            left: 6,
            padding: '2px 8px',
            borderRadius: 6,
            background:
              blinkStatus === 'detecting'
                ? 'rgba(34, 197, 94, 0.8)'
                : blinkStatus === 'loading'
                  ? 'rgba(234, 179, 8, 0.8)'
                  : 'rgba(239, 68, 68, 0.8)',
            color: '#fff',
            fontSize: 10,
            fontWeight: 600,
          }}
        >
          {blinkStatus === 'detecting' ? 'Tracking' : blinkStatus === 'loading' ? 'Loading...' : 'Ready'}
        </div>
      </div>

      {/* Animations */}
      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .spin { animation: spin 1s linear infinite; }
        @keyframes pulseGlow {
          0%, 100% { opacity: 1; box-shadow: 0 0 20px rgba(139, 92, 246, 0.2); }
          50% { opacity: 0.7; box-shadow: 0 0 40px rgba(139, 92, 246, 0.4); }
        }
        @keyframes modalIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
      `}</style>
    </div>
  )
}
