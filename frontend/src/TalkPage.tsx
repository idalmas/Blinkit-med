import { useState, useRef, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { FaArrowLeft, FaMicrophone, FaPlay, FaSpinner, FaCheckCircle, FaStop } from 'react-icons/fa'

const API_BASE = 'http://localhost:3003'

const RECORD_DURATION = 20

const READING_PROMPT =
  'The quick brown fox jumps over the lazy dog. ' +
  'She sells seashells by the seashore. ' +
  'How vexingly quick daft zebras jump. ' +
  'Pack my box with five dozen liquor jugs. ' +
  'A wizard\'s job is to vex chumps quickly in fog. ' +
  'The five boxing wizards jump quickly at dawn. ' +
  'Bright vixens jump, dozy fowl quack. ' +
  'Jinxed wizards pluck ivy from the big quilt.'

export default function TalkPage() {
  const navigate = useNavigate()

  // Recording state
  const [recording, setRecording] = useState(false)
  const duration = RECORD_DURATION
  const [secondsLeft, setSecondsLeft] = useState(0)
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Voice cloning state
  const [modelId, setModelId] = useState<string | null>(null)
  const [cloning, setCloning] = useState(false)
  const [cloneError, setCloneError] = useState<string | null>(null)

  // TTS state
  const [text, setText] = useState('')
  const [generating, setGenerating] = useState(false)
  const [genError, setGenError] = useState<string | null>(null)
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const audioRef = useRef<HTMLAudioElement>(null)

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop()
    }
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
    setRecording(false)
    setSecondsLeft(0)
  }, [])

  async function startRecording() {
    setRecordedBlob(null)
    setModelId(null)
    setCloneError(null)
    chunksRef.current = []

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mr = new MediaRecorder(stream, { mimeType: 'audio/webm' })
      mediaRecorderRef.current = mr

      mr.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }

      mr.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' })
        setRecordedBlob(blob)
        stream.getTracks().forEach((t) => t.stop())
      }

      mr.start()
      setRecording(true)
      setSecondsLeft(duration)

      // Countdown
      const start = Date.now()
      timerRef.current = setInterval(() => {
        const elapsed = Math.floor((Date.now() - start) / 1000)
        const remaining = duration - elapsed
        if (remaining <= 0) {
          stopRecording()
        } else {
          setSecondsLeft(remaining)
        }
      }, 250)
    } catch {
      setCloneError('Microphone access denied. Please allow microphone permissions.')
    }
  }

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop()
      }
    }
  }, [])

  async function handleClone() {
    if (!recordedBlob) return
    setCloning(true)
    setCloneError(null)
    try {
      const form = new FormData()
      form.append('audio', recordedBlob, 'recording.webm')
      form.append('title', 'Voice Recording')
      const res = await fetch(`${API_BASE}/apps/talk/clone`, { method: 'POST', body: form })
      if (!res.ok) throw new Error('Cloning failed')
      const data = await res.json()
      setModelId(data.modelId)
    } catch {
      setCloneError('Voice cloning failed. Try recording again.')
    } finally {
      setCloning(false)
    }
  }

  async function handleGenerate() {
    if (!text.trim() || !modelId) return
    setGenerating(true)
    setGenError(null)
    if (audioUrl) {
      URL.revokeObjectURL(audioUrl)
      setAudioUrl(null)
    }
    try {
      const res = await fetch(`${API_BASE}/apps/talk/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, referenceId: modelId }),
      })
      if (!res.ok) throw new Error('Generation failed')
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      setAudioUrl(url)
      setTimeout(() => audioRef.current?.play(), 100)
    } catch {
      setGenError('Audio generation failed. Try again.')
    } finally {
      setGenerating(false)
    }
  }

  const buttonBase: React.CSSProperties = {
    border: 'none',
    borderRadius: 14,
    color: '#fff',
    padding: '14px 28px',
    cursor: 'pointer',
    fontSize: 15,
    fontWeight: 600,
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    transition: 'all 0.2s',
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
        paddingTop: 80,
      }}
    >
      {/* Back button */}
      <button
        onClick={() => navigate('/apps')}
        style={{
          position: 'fixed',
          top: 72,
          left: 24,
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

      {/* Title */}
      <h1 style={{ color: '#fff', fontSize: 40, fontWeight: 700, letterSpacing: '-1.5px', margin: '24px 0 8px' }}>
        Talk
      </h1>
      <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 15, margin: '0 0 48px' }}>
        Clone a voice, then make it say anything
      </p>

      {/* Card container */}
      <div style={{ width: '100%', maxWidth: 520, padding: '0 24px', display: 'flex', flexDirection: 'column', gap: 24, paddingBottom: 48 }}>

        {/* Step 1: Record voice */}
        <div
          style={{
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 20,
            padding: 28,
          }}
        >
          <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12, fontWeight: 600, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 16 }}>
            Step 1 — Record Your Voice
          </div>

          {/* Reading prompt */}
          <div
            style={{
              background: 'rgba(139, 92, 246, 0.08)',
              border: '1px solid rgba(139, 92, 246, 0.2)',
              borderRadius: 12,
              padding: '16px 18px',
              marginBottom: 20,
            }}
          >
            <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 11, fontWeight: 600, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8 }}>
              Read this aloud:
            </div>
            <div style={{ color: 'rgba(255,255,255,0.8)', fontSize: 15, lineHeight: 1.6, fontStyle: 'italic' }}>
              "{READING_PROMPT}"
            </div>
          </div>

          {/* Record / Stop button */}
          {!recordedBlob || recording ? (
            <button
              onClick={recording ? stopRecording : startRecording}
              style={{
                ...buttonBase,
                width: '100%',
                justifyContent: 'center',
                background: recording
                  ? 'linear-gradient(135deg, #EF4444, #F87171)'
                  : 'linear-gradient(135deg, #8B5CF6, #A78BFA)',
              }}
            >
              {recording ? (
                <>
                  <FaStop size={14} />
                  <span>Stop Recording ({secondsLeft}s left)</span>
                </>
              ) : (
                <>
                  <FaMicrophone size={14} />
                  <span>Start Recording</span>
                </>
              )}
            </button>
          ) : (
            /* After recording: show playback + clone */
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <audio
                  src={URL.createObjectURL(recordedBlob)}
                  controls
                  style={{ flex: 1, height: 36, borderRadius: 8 }}
                />
                <button
                  onClick={() => {
                    setRecordedBlob(null)
                    setModelId(null)
                  }}
                  style={{
                    background: 'rgba(255,255,255,0.08)',
                    border: '1px solid rgba(255,255,255,0.12)',
                    borderRadius: 10,
                    color: 'rgba(255,255,255,0.6)',
                    padding: '8px 14px',
                    cursor: 'pointer',
                    fontSize: 13,
                    fontWeight: 500,
                    whiteSpace: 'nowrap',
                  }}
                >
                  Re-record
                </button>
              </div>

              {!modelId && (
                <button
                  onClick={handleClone}
                  disabled={cloning}
                  style={{
                    ...buttonBase,
                    width: '100%',
                    justifyContent: 'center',
                    background: cloning ? 'rgba(139, 92, 246, 0.3)' : 'linear-gradient(135deg, #8B5CF6, #A78BFA)',
                    opacity: cloning ? 0.7 : 1,
                  }}
                >
                  {cloning ? <><FaSpinner size={14} className="spin" /> Cloning Voice...</> : <><FaMicrophone size={14} /> Clone Voice</>}
                </button>
              )}
            </div>
          )}

          {/* Success indicator */}
          {modelId && (
            <div style={{ marginTop: 16, display: 'flex', alignItems: 'center', gap: 8, color: '#34d399', fontSize: 14, fontWeight: 500 }}>
              <FaCheckCircle size={14} /> Voice cloned successfully
            </div>
          )}

          {cloneError && (
            <div style={{ marginTop: 12, color: '#f87171', fontSize: 13 }}>{cloneError}</div>
          )}
        </div>

        {/* Step 2: Generate speech */}
        <div
          style={{
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 20,
            padding: 28,
            opacity: modelId ? 1 : 0.4,
            pointerEvents: modelId ? 'auto' : 'none',
            transition: 'opacity 0.3s',
          }}
        >
          <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12, fontWeight: 600, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 16 }}>
            Step 2 — Enter Text &amp; Generate
          </div>

          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Type what you want the cloned voice to say..."
            rows={4}
            style={{
              width: '100%',
              background: 'rgba(255,255,255,0.06)',
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: 12,
              color: '#fff',
              fontSize: 15,
              padding: '14px 16px',
              resize: 'vertical',
              outline: 'none',
              fontFamily: 'inherit',
              boxSizing: 'border-box',
              transition: 'border-color 0.2s',
            }}
            onFocus={(e) => (e.currentTarget.style.borderColor = 'rgba(139, 92, 246, 0.5)')}
            onBlur={(e) => (e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)')}
          />

          <button
            onClick={handleGenerate}
            disabled={generating || !text.trim()}
            style={{
              ...buttonBase,
              marginTop: 16,
              width: '100%',
              justifyContent: 'center',
              background: generating || !text.trim() ? 'rgba(139, 92, 246, 0.3)' : 'linear-gradient(135deg, #8B5CF6, #A78BFA)',
              opacity: generating || !text.trim() ? 0.7 : 1,
            }}
          >
            {generating ? <><FaSpinner size={14} className="spin" /> Generating...</> : <><FaPlay size={12} /> Generate &amp; Play</>}
          </button>

          {genError && (
            <div style={{ marginTop: 12, color: '#f87171', fontSize: 13 }}>{genError}</div>
          )}

          {/* Audio player */}
          {audioUrl && (
            <audio
              ref={audioRef}
              src={audioUrl}
              controls
              style={{ width: '100%', marginTop: 20, borderRadius: 12 }}
            />
          )}
        </div>
      </div>

      {/* Spinner animation */}
      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .spin { animation: spin 1s linear infinite; }
      `}</style>
    </div>
  )
}
