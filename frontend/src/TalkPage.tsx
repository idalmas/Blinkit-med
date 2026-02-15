import { useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { FaArrowLeft, FaPlay, FaSpinner } from 'react-icons/fa'

const API_BASE = 'http://localhost:3003'

export default function TalkPage() {
  const navigate = useNavigate()

  const [text, setText] = useState('')
  const [generating, setGenerating] = useState(false)
  const [genError, setGenError] = useState<string | null>(null)
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const audioRef = useRef<HTMLAudioElement>(null)

  async function handleGenerate() {
    if (!text.trim()) return
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
        body: JSON.stringify({ text }),
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
        Type anything and hear it spoken
      </p>

      {/* Card container */}
      <div style={{ width: '100%', maxWidth: 520, padding: '0 24px', display: 'flex', flexDirection: 'column', gap: 24, paddingBottom: 48 }}>

        <div
          style={{
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 20,
            padding: 28,
          }}
        >
          <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12, fontWeight: 600, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 16 }}>
            Enter Text &amp; Generate
          </div>

          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Type what you want to hear spoken..."
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
