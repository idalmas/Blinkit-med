import { useState, useRef, useCallback, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import Webcam from 'react-webcam'
import { FaArrowLeft, FaSpinner, FaVolumeUp, FaKeyboard, FaVideo } from 'react-icons/fa'
import { useBlinkDetection, type BlinkType } from './useBlinkDetection'
import { ZoomTranscriptPanel, type ZoomTranscriptEntry } from './ZoomTranscriptPanel'
import { MorseKeyboard, type MorseKeyboardHandle } from './MorseKeyboard'
import { API_BASE, PERSON } from './config'

type ZoomState =
  | 'JOIN_FORM'
  | 'JOINING'
  | 'IN_MEETING'
  | 'LOADING_OPTIONS'
  | 'PICKING_OPTION'
  | 'GENERATING_AUDIO'
  | 'PLAYING_AUDIO'

function toWebSocketUrl(apiBase: string): string {
  try {
    const url = new URL(apiBase)
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    url.pathname = ''
    url.search = ''
    url.hash = ''
    return url.toString().replace(/\/$/, '')
  } catch {
    return apiBase.replace(/^https:/, 'wss:').replace(/^http:/, 'ws:').replace(/\/$/, '')
  }
}

export default function ZoomPage() {
  const navigate = useNavigate()

  // Zoom join form
  const [zoomState, setZoomState] = useState<ZoomState>('JOIN_FORM')
  const [meetingNumber, setMeetingNumber] = useState('')
  const [meetingPassword, setMeetingPassword] = useState('')
  const [userName, setUserName] = useState('Revive User')

  // Zoom SDK
  const zoomContainerRef = useRef<HTMLDivElement>(null)
  const zmClientRef = useRef<any>(null)

  // RTMS transcripts via WebSocket
  const [transcripts, setTranscripts] = useState<ZoomTranscriptEntry[]>([])
  const [wsConnected, setWsConnected] = useState(false)
  const wsRef = useRef<WebSocket | null>(null)

  // Response options
  const [options, setOptions] = useState<string[]>([])
  const [optionIdx, setOptionIdx] = useState(0)
  const [error, setError] = useState<string | null>(null)

  // Audio playback
  const [spokenText, setSpokenText] = useState('')
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const audioRef = useRef<HTMLAudioElement>(null)

  // Morse keyboard
  const [morseOpen, setMorseOpen] = useState(false)
  const morseRef = useRef<MorseKeyboardHandle>(null)

  // Connect WebSocket for RTMS transcripts
  useEffect(() => {
    const wsBase = toWebSocketUrl(API_BASE)
    const currentHostWs = `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws`
    const candidates = Array.from(new Set([`${wsBase}/ws`, currentHostWs]))

    let ws: WebSocket | null = null
    let cancelled = false

    async function connect() {
      for (const url of candidates) {
        if (cancelled) return
        try {
          ws = await new Promise<WebSocket>((resolve, reject) => {
            const socket = new WebSocket(url)
            socket.onopen = () => resolve(socket)
            socket.onerror = () => {
              socket.close()
              reject()
            }
          })
          break
        } catch {
          continue
        }
      }

      if (!ws || cancelled) return

      wsRef.current = ws
      setWsConnected(true)

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data)
          if (msg.type === 'zoom_transcript') {
            setTranscripts((prev) => [
              ...prev,
              {
                userName: msg.userName,
                userId: msg.userId,
                text: msg.text,
                timestamp: msg.timestamp,
              },
            ])
          }
        } catch {
          // Ignore non-JSON messages
        }
      }

      ws.onclose = () => {
        setWsConnected(false)
        wsRef.current = null
      }
    }

    connect()

    return () => {
      cancelled = true
      ws?.close()
      wsRef.current = null
    }
  }, [])

  // Join Zoom meeting
  const joinMeeting = useCallback(async () => {
    if (!meetingNumber.trim()) {
      setError('Please enter a meeting number')
      return
    }

    setZoomState('JOINING')
    setError(null)

    try {
      // 1. Get signature from backend
      console.log('[zoom] Fetching signature for meeting:', meetingNumber)
      const sigRes = await fetch(`${API_BASE}/zoom/signature`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ meetingNumber: meetingNumber.replace(/\s/g, ''), role: 0 }),
      })

      if (!sigRes.ok) {
        const errData = await sigRes.json().catch(() => ({}))
        throw new Error(errData.error || 'Failed to get signature')
      }

      const { signature, sdkKey } = await sigRes.json()
      console.log('[zoom] Got signature, initializing SDK...')

      // 2. Initialize Zoom SDK
      const ZoomMtgEmbedded = (await import('@zoom/meetingsdk/embedded')).default
      const zmClient = ZoomMtgEmbedded.createClient()
      zmClientRef.current = zmClient

      await zmClient.init({
        zoomAppRoot: zoomContainerRef.current!,
        language: 'en-US',
        patchJsMedia: true,
      })
      console.log('[zoom] SDK initialized, joining meeting...')

      // 3. Join meeting
      await zmClient.join({
        signature,
        sdkKey,
        meetingNumber: meetingNumber.replace(/\s/g, ''),
        userName,
        password: meetingPassword,
      })
      console.log('[zoom] Joined meeting successfully!')

      setZoomState('IN_MEETING')
    } catch (err: any) {
      console.error('[zoom] Error:', err)
      setError(err.message || 'Failed to join meeting')
      setZoomState('JOIN_FORM')
    }
  }, [meetingNumber, meetingPassword, userName])

  // Fetch response options from getContext
  const fetchOptions = useCallback(async () => {
    if (transcripts.length === 0) {
      setError('No conversation detected yet.')
      setTimeout(() => setError(null), 2000)
      return
    }

    setZoomState('LOADING_OPTIONS')
    setError(null)

    const transcript = transcripts.map((t) => `${t.userName}: ${t.text}`).join('\n')

    try {
      const res = await fetch(`${API_BASE}/getContext`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          app: 'Talk',
          person: PERSON,
          text: JSON.stringify({
            transcript,
            selectedSpeaker: 0,
            speakerCount: new Set(transcripts.map((t) => t.userName)).size,
          }),
          k: 5,
        }),
      })

      if (!res.ok) throw new Error('Failed to get context')
      const data = await res.json()

      if (Array.isArray(data.result) && data.result.length > 0) {
        setOptions(data.result)
        setOptionIdx(0)
        setZoomState('PICKING_OPTION')
      } else {
        setError('No response options generated. Try again.')
        setZoomState('IN_MEETING')
      }
    } catch {
      setError('Failed to generate options. Try again.')
      setZoomState('IN_MEETING')
    }
  }, [transcripts])

  // Generate and play TTS
  const speakText = useCallback(
    async (text: string) => {
      setSpokenText(text)
      setZoomState('GENERATING_AUDIO')
      setError(null)

      try {
        const res = await fetch(`${API_BASE}/apps/talk/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text }),
        })

        if (!res.ok) throw new Error('Audio generation failed')
        const blob = await res.blob()
        const url = URL.createObjectURL(blob)

        if (audioUrl) URL.revokeObjectURL(audioUrl)
        setAudioUrl(url)
        setZoomState('PLAYING_AUDIO')

        setTimeout(() => audioRef.current?.play(), 100)
      } catch {
        setError('Audio generation failed. Try again.')
        setZoomState('IN_MEETING')
      }
    },
    [audioUrl]
  )

  // Select a response option
  const selectOption = useCallback(
    async (idx: number) => {
      const text = options[idx]
      // Add the user's response to the transcript display
      setTranscripts((prev) => [
        ...prev,
        {
          userName: `${userName} (You)`,
          userId: 0,
          text,
          timestamp: Date.now() / 1000,
        },
      ])
      await speakText(text)
    },
    [options, speakText, userName]
  )

  // Audio ended
  const handleAudioEnded = useCallback(() => {
    if (audioUrl) URL.revokeObjectURL(audioUrl)
    setAudioUrl(null)
    setZoomState('IN_MEETING')
  }, [audioUrl])

  const totalOptions = options.length + 1

  // Blink handler
  const handleBlink = useCallback(
    (type: BlinkType) => {
      // Route to morse keyboard when open
      if (morseOpen) {
        if (type === 'quadruple') {
          const text = morseRef.current?.getComposedText() || ''
          setMorseOpen(false)
          if (text.trim()) {
            setTranscripts((prev) => [
              ...prev,
              {
                userName: `${userName} (You)`,
                userId: 0,
                text: text.trim(),
                timestamp: Date.now() / 1000,
              },
            ])
            speakText(text.trim())
          }
          return
        }
        morseRef.current?.handleBlink(type)
        return
      }

      // Global: long-close goes back to apps
      if (type === 'long-close') {
        navigate('/apps')
        return
      }

      switch (zoomState) {
        case 'JOIN_FORM':
          if (type === 'double') joinMeeting()
          if (type === 'triple') navigate('/apps')
          break

        case 'IN_MEETING':
          if (type === 'double') fetchOptions()
          if (type === 'triple') navigate('/apps')
          break

        case 'LOADING_OPTIONS':
          if (type === 'triple') setZoomState('IN_MEETING')
          break

        case 'PICKING_OPTION':
          if (type === 'wink-left') setOptionIdx((prev) => (prev - 1 + totalOptions) % totalOptions)
          else if (type === 'wink-right') setOptionIdx((prev) => (prev + 1) % totalOptions)
          else if (type === 'double') {
            if (optionIdx === options.length) {
              setMorseOpen(true)
            } else {
              selectOption(optionIdx)
            }
          } else if (type === 'triple') {
            setZoomState('IN_MEETING')
          }
          break

        case 'PLAYING_AUDIO':
          if (type === 'triple') {
            audioRef.current?.pause()
            if (audioUrl) URL.revokeObjectURL(audioUrl)
            setAudioUrl(null)
            setZoomState('IN_MEETING')
          }
          break
      }
    },
    [
      morseOpen,
      zoomState,
      transcripts,
      options,
      totalOptions,
      optionIdx,
      audioUrl,
      userName,
      navigate,
      joinMeeting,
      fetchOptions,
      selectOption,
      speakText,
    ]
  )

  const { webcamRef, status: blinkStatus } = useBlinkDetection({ onBlink: handleBlink })

  const subtitle: Record<ZoomState, string> = {
    JOIN_FORM: 'Enter meeting details to join',
    JOINING: 'Connecting to Zoom...',
    IN_MEETING: 'In meeting — double-blink to generate responses',
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
      }}
    >
      {/* Top bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          padding: '12px 20px',
          borderBottom: '1px solid rgba(255,255,255,0.08)',
          flexShrink: 0,
          gap: 16,
        }}
      >
        <button
          onClick={() => navigate('/apps')}
          style={{
            background: 'rgba(255,255,255,0.08)',
            border: '1px solid rgba(255,255,255,0.12)',
            borderRadius: 10,
            color: '#fff',
            padding: '6px 14px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 13,
            fontWeight: 500,
          }}
        >
          <FaArrowLeft size={11} /> Back
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <FaVideo size={16} color="#2D8CFF" />
          <span style={{ color: '#fff', fontSize: 17, fontWeight: 700 }}>Zoom Meeting</span>
        </div>

        <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: 13 }}>{subtitle[zoomState]}</span>

        {error && (
          <span
            style={{
              color: '#f87171',
              fontSize: 13,
              marginLeft: 'auto',
              background: 'rgba(239, 68, 68, 0.15)',
              padding: '4px 12px',
              borderRadius: 8,
            }}
          >
            {error}
          </span>
        )}
      </div>

      {/* Main content */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* Left — Zoom meeting or join form */}
        <div
          style={{
            flex: zoomState === 'JOIN_FORM' || zoomState === 'JOINING' ? 1 : 0.6,
            display: 'flex',
            flexDirection: 'column',
            position: 'relative',
          }}
        >
          {/* Join form */}
          {(zoomState === 'JOIN_FORM' || zoomState === 'JOINING') && (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                flex: 1,
                padding: 40,
              }}
            >
              <div
                style={{
                  width: 88,
                  height: 88,
                  borderRadius: 22,
                  background: 'linear-gradient(135deg, #2D8CFF 0%, #0B5CFF 100%)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginBottom: 32,
                  boxShadow: '0 12px 40px rgba(45, 140, 255, 0.3)',
                }}
              >
                <FaVideo size={40} color="#fff" />
              </div>

              <h2 style={{ color: '#fff', fontSize: 28, fontWeight: 700, marginBottom: 8 }}>
                Join Zoom Meeting
              </h2>
              <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 14, marginBottom: 32 }}>
                Enter your meeting details below
              </p>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 16, width: '100%', maxWidth: 400 }}>
                <input
                  type="text"
                  placeholder="Meeting Number"
                  value={meetingNumber}
                  onChange={(e) => setMeetingNumber(e.target.value)}
                  style={{
                    padding: '14px 18px',
                    borderRadius: 12,
                    border: '1px solid rgba(255,255,255,0.15)',
                    background: 'rgba(255,255,255,0.06)',
                    color: '#fff',
                    fontSize: 15,
                    outline: 'none',
                  }}
                />
                <input
                  type="text"
                  placeholder="Meeting Password (optional)"
                  value={meetingPassword}
                  onChange={(e) => setMeetingPassword(e.target.value)}
                  style={{
                    padding: '14px 18px',
                    borderRadius: 12,
                    border: '1px solid rgba(255,255,255,0.15)',
                    background: 'rgba(255,255,255,0.06)',
                    color: '#fff',
                    fontSize: 15,
                    outline: 'none',
                  }}
                />
                <input
                  type="text"
                  placeholder="Display Name"
                  value={userName}
                  onChange={(e) => setUserName(e.target.value)}
                  style={{
                    padding: '14px 18px',
                    borderRadius: 12,
                    border: '1px solid rgba(255,255,255,0.15)',
                    background: 'rgba(255,255,255,0.06)',
                    color: '#fff',
                    fontSize: 15,
                    outline: 'none',
                  }}
                />

                <button
                  onClick={joinMeeting}
                  disabled={zoomState === 'JOINING'}
                  style={{
                    padding: '14px 24px',
                    borderRadius: 12,
                    border: 'none',
                    background: zoomState === 'JOINING'
                      ? 'rgba(45, 140, 255, 0.3)'
                      : 'linear-gradient(135deg, #2D8CFF, #0B5CFF)',
                    color: '#fff',
                    fontSize: 16,
                    fontWeight: 600,
                    cursor: zoomState === 'JOINING' ? 'not-allowed' : 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 10,
                    marginTop: 8,
                  }}
                >
                  {zoomState === 'JOINING' ? (
                    <>
                      <FaSpinner size={16} className="spin" /> Joining...
                    </>
                  ) : (
                    'Join Meeting'
                  )}
                </button>

                <p style={{ color: 'rgba(255,255,255,0.25)', fontSize: 12, textAlign: 'center' }}>
                  Double-blink to join &middot; Triple-blink to go back
                </p>
              </div>
            </div>
          )}

          {/* Zoom embedded container — always rendered so SDK has a mount target */}
          <div
            ref={zoomContainerRef}
            style={{
              flex: 1,
              display: zoomState !== 'JOIN_FORM' && zoomState !== 'JOINING' ? 'block' : 'none',
              position: 'relative',
            }}
          />
        </div>

        {/* Right — Transcript + Response options */}
        <div
          style={{
            width: zoomState === 'JOIN_FORM' || zoomState === 'JOINING' ? 360 : '40%',
            display: 'flex',
            flexDirection: 'column',
            flexShrink: 0,
          }}
        >
          {/* Transcript panel — top portion */}
          <div style={{ flex: 1, overflow: 'hidden' }}>
            <ZoomTranscriptPanel transcripts={transcripts} isConnected={wsConnected} />
          </div>

          {/* Response options — bottom portion (when active) */}
          {(zoomState === 'LOADING_OPTIONS' ||
            zoomState === 'PICKING_OPTION' ||
            zoomState === 'GENERATING_AUDIO' ||
            zoomState === 'PLAYING_AUDIO') && (
            <div
              style={{
                borderTop: '1px solid rgba(255,255,255,0.08)',
                background: 'rgba(0,0,0,0.4)',
                padding: 16,
                maxHeight: '45%',
                overflowY: 'auto',
              }}
            >
              {/* Loading */}
              {zoomState === 'LOADING_OPTIONS' && (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 10,
                    padding: 20,
                  }}
                >
                  <FaSpinner size={18} color="rgba(45, 140, 255, 0.8)" className="spin" />
                  <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: 14 }}>
                    Thinking of responses...
                  </span>
                </div>
              )}

              {/* Picking options */}
              {zoomState === 'PICKING_OPTION' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div
                    style={{
                      color: 'rgba(255,255,255,0.35)',
                      fontSize: 11,
                      fontWeight: 600,
                      letterSpacing: 1,
                      textTransform: 'uppercase',
                      marginBottom: 4,
                    }}
                  >
                    Wink to browse &middot; Double-blink to speak
                  </div>

                  {options.map((opt, i) => {
                    const isFocused = i === optionIdx
                    return (
                      <div
                        key={i}
                        onClick={() => selectOption(i)}
                        style={{
                          padding: '10px 14px',
                          borderRadius: 12,
                          background: isFocused ? 'rgba(45, 140, 255, 0.15)' : 'rgba(255,255,255,0.04)',
                          border: isFocused
                            ? '2px solid rgba(45, 140, 255, 0.6)'
                            : '1px solid rgba(255,255,255,0.08)',
                          color: isFocused ? '#fff' : 'rgba(255,255,255,0.55)',
                          fontSize: isFocused ? 15 : 14,
                          fontWeight: isFocused ? 600 : 400,
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 10,
                          transition: 'all 0.2s ease',
                        }}
                      >
                        <span
                          style={{
                            width: 24,
                            height: 24,
                            borderRadius: 6,
                            background: isFocused ? 'rgba(45, 140, 255, 0.3)' : 'rgba(255,255,255,0.08)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: 12,
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

                  {/* Type your own */}
                  {(() => {
                    const isFocused = optionIdx === options.length
                    return (
                      <div
                        onClick={() => setMorseOpen(true)}
                        style={{
                          padding: '10px 14px',
                          borderRadius: 12,
                          background: isFocused ? 'rgba(34, 197, 94, 0.15)' : 'rgba(255,255,255,0.04)',
                          border: isFocused
                            ? '2px solid rgba(34, 197, 94, 0.6)'
                            : '1px dashed rgba(255,255,255,0.15)',
                          color: isFocused ? '#fff' : 'rgba(255,255,255,0.55)',
                          fontSize: isFocused ? 15 : 14,
                          fontWeight: isFocused ? 600 : 400,
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 10,
                          transition: 'all 0.2s ease',
                        }}
                      >
                        <span
                          style={{
                            width: 24,
                            height: 24,
                            borderRadius: 6,
                            background: isFocused ? 'rgba(34, 197, 94, 0.3)' : 'rgba(255,255,255,0.08)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            flexShrink: 0,
                          }}
                        >
                          <FaKeyboard size={12} />
                        </span>
                        Type your own...
                      </div>
                    )
                  })()}
                </div>
              )}

              {/* Generating audio */}
              {zoomState === 'GENERATING_AUDIO' && (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, padding: 16 }}>
                  <div
                    style={{
                      color: '#fff',
                      fontSize: 16,
                      fontWeight: 600,
                      padding: '12px 18px',
                      background: 'rgba(45, 140, 255, 0.1)',
                      border: '1px solid rgba(45, 140, 255, 0.3)',
                      borderRadius: 12,
                      textAlign: 'center',
                    }}
                  >
                    "{spokenText}"
                  </div>
                  <FaSpinner size={20} color="rgba(45, 140, 255, 0.8)" className="spin" />
                  <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: 12 }}>Generating speech...</span>
                </div>
              )}

              {/* Playing audio */}
              {zoomState === 'PLAYING_AUDIO' && (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, padding: 16 }}>
                  <div
                    style={{
                      width: 56,
                      height: 56,
                      borderRadius: '50%',
                      background: 'rgba(34, 197, 94, 0.12)',
                      border: '2px solid rgba(34, 197, 94, 0.3)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      animation: 'pulseGlow 1s ease-in-out infinite',
                    }}
                  >
                    <FaVolumeUp size={24} color="rgba(34, 197, 94, 0.8)" />
                  </div>
                  <div style={{ color: '#fff', fontSize: 15, fontWeight: 600, textAlign: 'center' }}>
                    "{spokenText}"
                  </div>
                  <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: 11 }}>
                    Triple-blink to stop
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Morse keyboard */}
      <MorseKeyboard
        ref={morseRef}
        isOpen={morseOpen}
        onClose={(text) => {
          setMorseOpen(false)
          if (text.trim()) {
            setTranscripts((prev) => [
              ...prev,
              {
                userName: `${userName} (You)`,
                userId: 0,
                text: text.trim(),
                timestamp: Date.now() / 1000,
              },
            ])
            speakText(text.trim())
          }
        }}
      />

      {/* Morse mode indicator */}
      {morseOpen && (
        <div
          style={{
            position: 'fixed',
            top: 64,
            left: '50%',
            transform: 'translateX(-50%)',
            padding: '6px 16px',
            borderRadius: 20,
            background: 'rgba(34, 197, 94, 0.2)',
            border: '1px solid rgba(34, 197, 94, 0.4)',
            color: '#4ade80',
            fontSize: 12,
            fontWeight: 700,
            letterSpacing: 1,
            zIndex: 40,
          }}
        >
          MORSE MODE — 4x blink to send
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
          0%, 100% { opacity: 1; box-shadow: 0 0 20px rgba(34, 197, 94, 0.2); }
          50% { opacity: 0.7; box-shadow: 0 0 40px rgba(34, 197, 94, 0.4); }
        }
      `}</style>
    </div>
  )
}
