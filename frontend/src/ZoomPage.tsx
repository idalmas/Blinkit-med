import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  FaArrowLeft,
  FaCheckCircle,
  FaKeyboard,
  FaMicrophone,
  FaPhoneAlt,
  FaSpinner,
  FaVideo,
  FaVolumeUp,
} from 'react-icons/fa'
import ZoomMtgEmbedded from '@zoom/meetingsdk/embedded'
import Webcam from 'react-webcam'
import { useBlinkDetection, type BlinkType } from './useBlinkDetection'
import { MorseKeyboard, type MorseKeyboardHandle } from './MorseKeyboard'
import { API_BASE, PERSON } from './config'

type ZoomClient = ReturnType<typeof ZoomMtgEmbedded.createClient>

type UiState = 'PICK_CONTACT' | 'STARTING' | 'IN_CALL'

/** Response-generation sub-state while IN_CALL */
type ResponseState =
  | 'IDLE'
  | 'LOADING_OPTIONS'
  | 'PICKING_OPTION'
  | 'GENERATING_AUDIO'
  | 'PLAYING_AUDIO'

interface Contact {
  name: string
  email: string
  relationship: string
}

interface CreateMeetingResponse {
  meetingNumber: string
  password: string
  joinUrl: string
  zak?: string
  hostEmail?: string
}

interface SignatureResponse {
  signature: string
  sdkKey: string
}

interface RtmsTranscriptEntry {
  username: string
  conferenceTime: string
  text: string
  streamId: string
}

interface RtmsRecentTranscriptsResponse {
  size: number
  count: number
  items: RtmsTranscriptEntry[]
}

const CONTACTS: Contact[] = [
  { name: 'Pranav', email: 'pranavponns@gmail.com', relationship: 'Primary caregiver' },
  { name: 'Michael', email: 'michael.family@example.com', relationship: 'Family' },
  { name: 'Aisha', email: 'aisha.friend@example.com', relationship: 'Friend' },
  { name: 'Daniel', email: 'daniel.therapist@example.com', relationship: 'Therapist' },
  { name: 'Nurse Team', email: 'nurse.team@example.com', relationship: 'Care team' },
]

function formatUnknownError(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === 'string') return err
  try {
    return JSON.stringify(err)
  } catch {
    return String(err)
  }
}

function prettyTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export default function ZoomPage() {
  const DOUBLE_BLINK_COOLDOWN_MS = 1500
  const FLOW_LOCK_MS = 4500

  const navigate = useNavigate()
  const zoomRootRef = useRef<HTMLDivElement | null>(null)
  const clientRef = useRef<ZoomClient | null>(null)
  const clientInitializedRef = useRef(false)
  const lastDoubleBlinkAtRef = useRef(0)
  const flowLockUntilRef = useRef(0)
  const transcriptScrollRef = useRef<HTMLDivElement | null>(null)

  const [topic] = useState('Revive Care Session')
  const [hostUserId] = useState('me')
  const [displayName] = useState('Revive Assistant')

  const [uiState, setUiState] = useState<UiState>('PICK_CONTACT')
  const [selectedContactIdx, setSelectedContactIdx] = useState(0)
  const [meetingNumber, setMeetingNumber] = useState('')

  const [recentTranscripts, setRecentTranscripts] = useState<RtmsTranscriptEntry[]>([])
  const [status, setStatus] = useState('Select a contact to start a Zoom call.')
  const [error, setError] = useState<string | null>(null)
  const [isBusy, setIsBusy] = useState(false)

  // ─── Response flow state (active during IN_CALL) ──────────────────────────
  const [responseState, setResponseState] = useState<ResponseState>('IDLE')
  const [options, setOptions] = useState<string[]>([])
  const [optionIdx, setOptionIdx] = useState(0)
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const audioRef = useRef<HTMLAudioElement>(null)
  const [spokenText, setSpokenText] = useState('')

  // Morse keyboard
  const [morseOpen, setMorseOpen] = useState(false)
  const morseRef = useRef<MorseKeyboardHandle>(null)

  const selectedContact = CONTACTS[selectedContactIdx]
  const inCall = uiState === 'STARTING' || uiState === 'IN_CALL'

  // ─── Meeting helpers ──────────────────────────────────────────────────────
  const endAllMeetings = async () => {
    try {
      await fetch('/api/zoom/end-all-meetings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: hostUserId }),
      })
    } catch {
      // Best-effort — continue even if this fails
    }
  }

  const createMeeting = async (): Promise<CreateMeetingResponse> => {
    const response = await fetch('/api/zoom/create-meeting', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topic, userId: hostUserId }),
    })
    const data = (await response.json()) as CreateMeetingResponse & { error?: string }
    if (!response.ok) {
      throw new Error(data.error || 'Failed to create meeting')
    }
    return data
  }

  const sendInviteEmail = async (meeting: CreateMeetingResponse, contact: Contact) => {
    const res = await fetch(`${API_BASE}/apps/zoom/send-invite`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        toEmail: contact.email,
        toName: contact.name,
        topic,
        meetingNumber: meeting.meetingNumber,
        joinUrl: meeting.joinUrl,
        password: meeting.password,
      }),
    })

    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body?.error || 'Failed to send invite email')
    }
  }

  const joinMeeting = async (meeting: CreateMeetingResponse) => {
    if (!zoomRootRef.current) throw new Error('Zoom container not ready')

    // Leave any previous meeting to avoid errorCode 5012 (duplicated join)
    if (clientRef.current) {
      try {
        await (clientRef.current as any).leave()
      } catch {
        // Ignore — no active session to leave
      }
    }

    const role = meeting.zak ? 1 : 0
    const signatureResponse = await fetch('/api/zoom/signature', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        meetingNumber: meeting.meetingNumber.trim(),
        role,
      }),
    })

    const signatureData = (await signatureResponse.json()) as SignatureResponse & { error?: string }
    if (!signatureResponse.ok) {
      throw new Error(signatureData.error || 'Failed to generate signature')
    }

    const client = clientRef.current || ZoomMtgEmbedded.createClient()
    clientRef.current = client

    if (!clientInitializedRef.current) {
      await client.init({
        zoomAppRoot: zoomRootRef.current,
        language: 'en-US',
      })
      clientInitializedRef.current = true
    }

    const joinOptions: {
      signature: string
      meetingNumber: string
      password: string
      userName: string
      zak?: string
      userEmail?: string
    } = {
      signature: signatureData.signature,
      meetingNumber: meeting.meetingNumber.trim(),
      password: meeting.password.trim(),
      userName: displayName,
    }

    if (role === 1 && meeting.zak) {
      joinOptions.zak = meeting.zak
      if (meeting.hostEmail) joinOptions.userEmail = meeting.hostEmail
    }

    await client.join(joinOptions)
  }

  const startFlow = async () => {
    if (isBusy) return

    const now = Date.now()
    if (now < flowLockUntilRef.current) return
    flowLockUntilRef.current = now + FLOW_LOCK_MS

    setIsBusy(true)
    setError(null)
    setUiState('STARTING')

    try {
      setStatus('Ending any existing meetings...')
      await endAllMeetings()

      setStatus(`Creating meeting for ${selectedContact.name}...`)
      const meeting = await createMeeting()

      setMeetingNumber(meeting.meetingNumber)

      setStatus(`Sending invite email to ${selectedContact.name}...`)
      await sendInviteEmail(meeting, selectedContact)

      setStatus('Joining Zoom meeting...')
      await joinMeeting(meeting)

      setStatus(`In call with ${selectedContact.name}`)
      setUiState('IN_CALL')
    } catch (err) {
      setError(formatUnknownError(err))
      setStatus('Could not start session. Double-blink to retry.')
      setUiState('PICK_CONTACT')
    } finally {
      setIsBusy(false)
    }
  }

  // ─── Response flow helpers (same as TalkPage) ─────────────────────────────
  const fetchOptions = useCallback(async () => {
    setResponseState('LOADING_OPTIONS')
    setError(null)

    // Build transcript from RTMS transcripts
    const transcript = recentTranscripts
      .map((t) => `${t.username || 'Unknown'}: ${t.text}`)
      .join('\n')

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
            speakerCount: 1,
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
        setResponseState('PICKING_OPTION')
      } else {
        setError('No response options generated. Try again.')
        setResponseState('IDLE')
      }
    } catch {
      setError('Failed to generate options. Try again.')
      setResponseState('IDLE')
    }
  }, [recentTranscripts])

  const speakText = useCallback(
    async (text: string) => {
      setSpokenText(text)
      setResponseState('GENERATING_AUDIO')
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
        setResponseState('PLAYING_AUDIO')

        setTimeout(() => audioRef.current?.play(), 100)
      } catch {
        setError('Audio generation failed. Try again.')
        setResponseState('IDLE')
      }
    },
    [audioUrl]
  )

  const selectOption = useCallback(
    async (idx: number) => {
      await speakText(options[idx])
    },
    [options, speakText]
  )

  const handleAudioEnded = useCallback(() => {
    if (audioUrl) URL.revokeObjectURL(audioUrl)
    setAudioUrl(null)
    setResponseState('IDLE')
  }, [audioUrl])

  const totalOptions = options.length + 1

  // ─── Transcript polling ───────────────────────────────────────────────────
  const loadRecentTranscripts = async () => {
    try {
      const response = await fetch('/api/zoom/rtms/recent-transcripts')
      const data = (await response.json()) as RtmsRecentTranscriptsResponse
      setRecentTranscripts(Array.isArray(data.items) ? data.items : [])
    } catch {
      // Keep transcript panel resilient.
    }
  }

  useEffect(() => {
    loadRecentTranscripts()
    const timer = setInterval(loadRecentTranscripts, 2000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    if (transcriptScrollRef.current) {
      transcriptScrollRef.current.scrollTop = transcriptScrollRef.current.scrollHeight
    }
  }, [recentTranscripts])

  // ─── Blink handler ────────────────────────────────────────────────────────
  const handleBlink = useCallback(
    (type: BlinkType) => {
      // Route to morse keyboard when open
      if (morseOpen) {
        if (type === 'quadruple') {
          const text = morseRef.current?.getComposedText() || ''
          setMorseOpen(false)
          if (text.trim()) {
            speakText(text.trim())
          }
          return
        }
        morseRef.current?.handleBlink(type)
        return
      }

      // Global exit
      if (type === 'long-close') {
        navigate('/apps')
        return
      }

      // ── PICK_CONTACT phase ──
      if (uiState === 'PICK_CONTACT') {
        if (type === 'triple') {
          navigate('/apps')
          return
        }
        if (type === 'wink-left') {
          setSelectedContactIdx((prev) => (prev - 1 + CONTACTS.length) % CONTACTS.length)
          return
        }
        if (type === 'wink-right') {
          setSelectedContactIdx((prev) => (prev + 1) % CONTACTS.length)
          return
        }
        if (type === 'double') {
          const now = Date.now()
          if (now - lastDoubleBlinkAtRef.current < DOUBLE_BLINK_COOLDOWN_MS) return
          lastDoubleBlinkAtRef.current = now
          void startFlow()
        }
        return
      }

      // ── IN_CALL phase — response sub-state machine ──
      if (uiState === 'IN_CALL') {
        switch (responseState) {
          case 'IDLE':
            if (type === 'triple') {
              navigate('/apps')
              return
            }
            if (type === 'double') {
              if (recentTranscripts.length === 0) {
                setError('No conversation detected yet.')
                setTimeout(() => setError(null), 2000)
                return
              }
              fetchOptions()
            }
            break

          case 'LOADING_OPTIONS':
            if (type === 'triple') {
              setResponseState('IDLE')
            }
            break

          case 'PICKING_OPTION':
            if (type === 'wink-left') {
              setOptionIdx((prev) => (prev - 1 + totalOptions) % totalOptions)
            } else if (type === 'wink-right') {
              setOptionIdx((prev) => (prev + 1) % totalOptions)
            } else if (type === 'double') {
              if (optionIdx === options.length) {
                // Open Morse keyboard
                setMorseOpen(true)
              } else {
                selectOption(optionIdx)
              }
            } else if (type === 'triple') {
              setResponseState('IDLE')
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
              setResponseState('IDLE')
            }
            break
        }
      }
    },
    [
      morseOpen, uiState, responseState, recentTranscripts, options, totalOptions,
      optionIdx, navigate, fetchOptions, selectOption, speakText, audioUrl,
    ]
  )

  const { webcamRef, status: blinkStatus } = useBlinkDetection({ onBlink: handleBlink })

  const transcriptLines = useMemo(
    () =>
      recentTranscripts.map((item, idx) => ({
        id: `${item.streamId}-${idx}-${item.conferenceTime}`,
        who: item.username || 'Unknown',
        text: item.text,
        at: prettyTime(item.conferenceTime),
      })),
    [recentTranscripts]
  )

  // Subtitle for in-call response state
  const responseSubtitle: Record<ResponseState, string> = {
    IDLE: 'Listening... double-blink to respond',
    LOADING_OPTIONS: 'Generating responses...',
    PICKING_OPTION: 'Wink to browse, double-blink to speak',
    GENERATING_AUDIO: 'Generating speech...',
    PLAYING_AUDIO: 'Speaking...',
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Contact Selection Screen
  // ═══════════════════════════════════════════════════════════════════════════
  if (!inCall) {
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
          justifyContent: 'center',
          overflow: 'auto',
        }}
      >
        {/* Back button */}
        <button
          onClick={() => navigate('/apps')}
          style={{
            position: 'fixed',
            top: 24,
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

        {/* Center content */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            maxWidth: 700,
            width: '100%',
            padding: '0 24px',
          }}
        >
          {/* Icon */}
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
              marginBottom: 24,
              animation: 'pulseGlow 2s ease-in-out infinite',
            }}
          >
            <FaVideo size={36} color="rgba(139, 92, 246, 0.8)" />
          </div>

          {/* Title */}
          <h1
            style={{
              color: '#fff',
              fontSize: 40,
              fontWeight: 700,
              letterSpacing: '-1.5px',
              margin: '0 0 8px',
            }}
          >
            Zoom Care Call
          </h1>
          <p
            style={{
              color: 'rgba(255,255,255,0.4)',
              fontSize: 15,
              margin: '0 0 40px',
              textAlign: 'center',
            }}
          >
            Wink to pick contact · Double-blink to invite and start · Triple/long-close to exit
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

          {/* Contact cards */}
          <div
            style={{
              display: 'flex',
              gap: 12,
              width: '100%',
              justifyContent: 'center',
              flexWrap: 'wrap',
            }}
          >
            {CONTACTS.map((contact, idx) => {
              const focused = idx === selectedContactIdx
              return (
                <div
                  key={contact.email}
                  onClick={() => setSelectedContactIdx(idx)}
                  style={{
                    borderRadius: 16,
                    border: focused
                      ? '2px solid rgba(139, 92, 246, 0.6)'
                      : '1px solid rgba(255,255,255,0.08)',
                    background: focused ? 'rgba(139, 92, 246, 0.15)' : 'rgba(255,255,255,0.04)',
                    padding: '14px 18px',
                    transform: focused ? 'scale(1.03)' : 'scale(1)',
                    transition: 'all 0.2s ease',
                    boxShadow: focused ? '0 0 30px rgba(139, 92, 246, 0.2)' : 'none',
                    minWidth: 150,
                    flex: '1 1 150px',
                    maxWidth: 200,
                    cursor: 'pointer',
                  }}
                >
                  <div style={{ fontSize: 18, fontWeight: 700, color: '#fff' }}>{contact.name}</div>
                  <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 12, marginTop: 4 }}>
                    {contact.relationship}
                  </div>
                  <div style={{ color: 'rgba(255,255,255,0.55)', fontSize: 13, marginTop: 6 }}>
                    {contact.email}
                  </div>
                </div>
              )
            })}
          </div>

          {/* Call button hint */}
          <div
            style={{
              marginTop: 32,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <div
              style={{
                width: 56,
                height: 56,
                borderRadius: '50%',
                background: 'rgba(34, 197, 94, 0.15)',
                border: '2px solid rgba(34, 197, 94, 0.3)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <FaPhoneAlt size={22} color="rgba(34, 197, 94, 0.8)" />
            </div>
            <div style={{ color: 'rgba(255,255,255,0.35)', fontSize: 13 }}>
              Double-blink to call{' '}
              <strong style={{ color: 'rgba(255,255,255,0.6)' }}>{selectedContact.name}</strong>
            </div>
          </div>
        </div>

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
            audio={false}
            mirrored
            videoConstraints={{ facingMode: 'user', width: 320, height: 240 }}
            style={{ width: 160, height: 120, objectFit: 'cover', display: 'block' }}
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

        <style>{`
          @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
          .spin { animation: spin 1s linear infinite; }
          @keyframes pulseGlow {
            0%, 100% { opacity: 1; box-shadow: 0 0 20px rgba(139, 92, 246, 0.2); }
            50% { opacity: 0.7; box-shadow: 0 0 40px rgba(139, 92, 246, 0.4); }
          }
          @keyframes pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.3; }
          }
        `}
        </style>
      </div>
    )
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // In-Call View (sidebar transcript + response options + main Zoom)
  // ═══════════════════════════════════════════════════════════════════════════
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
      {/* Back button — offset right for sidebar */}
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

      {/* ── Left sidebar: Transcript + Response options ── */}
      <div
        style={{
          position: 'fixed',
          top: 60,
          left: 20,
          bottom: 20,
          width: 380,
          backgroundColor: 'rgba(0, 0, 0, 0.85)',
          borderRadius: 16,
          padding: 0,
          display: 'flex',
          flexDirection: 'column',
          zIndex: 20,
          backdropFilter: 'blur(10px)',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          overflow: 'hidden',
        }}
      >
        {/* ─ Sidebar header ─ */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '14px 16px 10px',
            borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
            flexShrink: 0,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ color: '#fff', fontSize: 14, fontWeight: 700, letterSpacing: '-0.3px' }}>
              Live Transcript
            </span>
            {uiState === 'IN_CALL' && (
              <span
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: '50%',
                  backgroundColor: '#22c55e',
                  animation: 'pulse 1.5s infinite',
                  display: 'inline-block',
                }}
              />
            )}
            {uiState === 'STARTING' && (
              <FaSpinner size={11} color="rgba(139, 92, 246, 0.8)" className="spin" />
            )}
          </div>
          {meetingNumber && (
            <span
              style={{
                color: 'rgba(255,255,255,0.35)',
                fontSize: 10,
                padding: '2px 8px',
                borderRadius: 6,
                backgroundColor: 'rgba(255, 255, 255, 0.06)',
                fontFamily: 'monospace',
              }}
            >
              #{meetingNumber}
            </span>
          )}
        </div>

        {/* ─ Connection status ─ */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            margin: '8px 12px',
            padding: '6px 10px',
            borderRadius: 8,
            background: 'rgba(255,255,255,0.04)',
            fontSize: 12,
            color: 'rgba(255,255,255,0.5)',
            flexShrink: 0,
          }}
        >
          {isBusy ? (
            <FaSpinner className="spin" size={10} color="rgba(139, 92, 246, 0.8)" />
          ) : (
            <FaCheckCircle size={10} color="#4ade80" />
          )}
          <span>{status}</span>
        </div>

        {/* Error */}
        {error && (
          <div
            style={{
              color: '#f87171',
              fontSize: 12,
              margin: '0 12px 4px',
              padding: '6px 10px',
              borderRadius: 8,
              background: 'rgba(239,68,68,0.1)',
              border: '1px solid rgba(239,68,68,0.15)',
              flexShrink: 0,
            }}
          >
            {error}
          </div>
        )}

        {/* ─ Transcript entries (scrollable) ─ */}
        <div
          ref={transcriptScrollRef}
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '8px 12px',
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
          }}
        >
          {transcriptLines.length === 0 ? (
            <div
              style={{
                color: 'rgba(255,255,255,0.25)',
                textAlign: 'center',
                marginTop: 40,
                fontSize: 13,
                fontStyle: 'italic',
              }}
            >
              {uiState === 'STARTING' ? 'Connecting…' : 'Waiting for speech…'}
            </div>
          ) : (
            transcriptLines.map((line) => (
              <div
                key={line.id}
                style={{
                  padding: '8px 10px',
                  borderRadius: 10,
                  background: 'rgba(255,255,255,0.03)',
                  borderLeft: '3px solid rgba(139, 92, 246, 0.4)',
                  marginBottom: 2,
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: 3,
                  }}
                >
                  <span
                    style={{
                      color: '#a78bfa',
                      fontWeight: 700,
                      fontSize: 11,
                      textTransform: 'uppercase',
                      letterSpacing: '0.5px',
                    }}
                  >
                    {line.who}
                  </span>
                  {line.at && (
                    <span
                      style={{
                        color: 'rgba(255,255,255,0.2)',
                        fontSize: 10,
                        fontFamily: 'monospace',
                      }}
                    >
                      {line.at}
                    </span>
                  )}
                </div>
                <div
                  style={{
                    color: 'rgba(255,255,255,0.8)',
                    fontSize: 13,
                    lineHeight: 1.5,
                    wordBreak: 'break-word',
                  }}
                >
                  {line.text}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Sidebar ends with transcript — no response UI here */}
      </div>

      {/* ── Main content — offset right for sidebar ── */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          marginLeft: 200,
          paddingTop: 60,
          width: '100%',
          maxWidth: 800,
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
            display: 'flex',
            alignItems: 'center',
            gap: 12,
          }}
        >
          <FaVideo size={34} /> Zoom Care Call
        </h1>
        <p
          style={{
            color: 'rgba(255,255,255,0.4)',
            fontSize: 15,
            margin: '0 0 24px',
            textAlign: 'center',
          }}
        >
          {uiState === 'IN_CALL'
            ? `In call with ${selectedContact.name} · ${responseSubtitle[responseState]}`
            : `Connecting with ${selectedContact.name}...`}
        </p>

        {/* Zoom SDK embedded container — fills main area */}
        <div
          ref={zoomRootRef}
          style={{
            width: '100%',
            minHeight: 'clamp(600px, 75vh, 900px)',
            borderRadius: 20,
            border: '1px solid rgba(255,255,255,0.12)',
            overflow: 'hidden',
            background: '#000',
            boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
          }}
        />
      </div>

      {/* ── Right-side response panel ── */}
      {uiState === 'IN_CALL' && (
        <div
          style={{
            position: 'fixed',
            top: 60,
            right: 20,
            bottom: 160,
            width: 300,
            backgroundColor: 'rgba(0, 0, 0, 0.85)',
            borderRadius: 16,
            padding: 0,
            display: 'flex',
            flexDirection: 'column',
            zIndex: 20,
            backdropFilter: 'blur(10px)',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            overflow: 'hidden',
          }}
        >
          {/* Header */}
          <div
            style={{
              padding: '12px 14px 8px',
              borderBottom: '1px solid rgba(255,255,255,0.08)',
              flexShrink: 0,
            }}
          >
            <span style={{ color: '#fff', fontSize: 13, fontWeight: 700, letterSpacing: '-0.3px' }}>
              Response Options
            </span>
          </div>

          {/* Content area */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '10px 12px' }}>
            {/* IDLE — prompt */}
            {responseState === 'IDLE' && (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 12,
                  paddingTop: 24,
                }}
              >
                <div
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: '50%',
                    background: 'rgba(139, 92, 246, 0.15)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    animation: 'pulseGlow 2s ease-in-out infinite',
                  }}
                >
                  <FaMicrophone size={16} color="rgba(139, 92, 246, 0.8)" />
                </div>
                <div style={{ color: 'rgba(255,255,255,0.35)', fontSize: 12, textAlign: 'center' }}>
                  Double-blink to generate responses
                </div>
              </div>
            )}

            {/* LOADING */}
            {responseState === 'LOADING_OPTIONS' && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '16px 0',
                  justifyContent: 'center',
                }}
              >
                <FaSpinner size={16} color="rgba(139, 92, 246, 0.8)" className="spin" />
                <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13 }}>
                  Thinking…
                </span>
              </div>
            )}

            {/* PICKING — option cards */}
            {responseState === 'PICKING_OPTION' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div
                  style={{
                    color: 'rgba(255,255,255,0.3)',
                    fontSize: 9,
                    fontWeight: 600,
                    letterSpacing: 0.5,
                    textTransform: 'uppercase',
                    marginBottom: 4,
                    textAlign: 'center',
                  }}
                >
                  Wink to browse · Double-blink to speak
                </div>

                {options.map((opt, i) => {
                  const isFocused = i === optionIdx
                  return (
                    <div
                      key={i}
                      onClick={() => selectOption(i)}
                      style={{
                        padding: '8px 10px',
                        borderRadius: 10,
                        background: isFocused ? 'rgba(139, 92, 246, 0.15)' : 'rgba(255,255,255,0.03)',
                        border: isFocused
                          ? '1.5px solid rgba(139, 92, 246, 0.5)'
                          : '1px solid rgba(255,255,255,0.06)',
                        color: isFocused ? '#fff' : 'rgba(255,255,255,0.5)',
                        fontSize: isFocused ? 13 : 12,
                        fontWeight: isFocused ? 600 : 400,
                        transition: 'all 0.15s ease',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        cursor: 'pointer',
                        transform: isFocused ? 'scale(1.01)' : 'scale(1)',
                      }}
                    >
                      <span
                        style={{
                          width: 22,
                          height: 22,
                          borderRadius: 6,
                          background: isFocused
                            ? 'rgba(139, 92, 246, 0.3)'
                            : 'rgba(255,255,255,0.06)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: 11,
                          fontWeight: 700,
                          flexShrink: 0,
                          color: isFocused ? '#fff' : 'rgba(255,255,255,0.4)',
                        }}
                      >
                        {i + 1}
                      </span>
                      <span style={{ lineHeight: 1.3 }}>{opt}</span>
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
                        padding: '8px 10px',
                        borderRadius: 10,
                        background: isFocused ? 'rgba(34, 197, 94, 0.12)' : 'rgba(255,255,255,0.03)',
                        border: isFocused
                          ? '1.5px solid rgba(34, 197, 94, 0.5)'
                          : '1px dashed rgba(255,255,255,0.1)',
                        color: isFocused ? '#fff' : 'rgba(255,255,255,0.4)',
                        fontSize: isFocused ? 13 : 12,
                        fontWeight: isFocused ? 600 : 400,
                        transition: 'all 0.15s ease',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        cursor: 'pointer',
                      }}
                    >
                      <span
                        style={{
                          width: 22,
                          height: 22,
                          borderRadius: 6,
                          background: isFocused
                            ? 'rgba(34, 197, 94, 0.25)'
                            : 'rgba(255,255,255,0.06)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          flexShrink: 0,
                        }}
                      >
                        <FaKeyboard size={10} />
                      </span>
                      Type your own…
                    </div>
                  )
                })()}
              </div>
            )}

            {/* GENERATING */}
            {responseState === 'GENERATING_AUDIO' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center', paddingTop: 8 }}>
                <div
                  style={{
                    color: '#fff',
                    fontSize: 13,
                    fontWeight: 600,
                    lineHeight: 1.4,
                    padding: '10px 14px',
                    background: 'rgba(139, 92, 246, 0.1)',
                    border: '1px solid rgba(139, 92, 246, 0.25)',
                    borderRadius: 10,
                    width: '100%',
                    textAlign: 'center',
                  }}
                >
                  "{spokenText}"
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <FaSpinner size={14} color="rgba(139, 92, 246, 0.8)" className="spin" />
                  <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: 11 }}>
                    Generating speech…
                  </span>
                </div>
              </div>
            )}

            {/* PLAYING */}
            {responseState === 'PLAYING_AUDIO' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center', paddingTop: 8 }}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '10px 14px',
                    borderRadius: 10,
                    background: 'rgba(34, 197, 94, 0.1)',
                    border: '1px solid rgba(34, 197, 94, 0.25)',
                    width: '100%',
                  }}
                >
                  <div
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: '50%',
                      background: 'rgba(34, 197, 94, 0.2)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                      animation: 'pulseGlow 1s ease-in-out infinite',
                    }}
                  >
                    <FaVolumeUp size={12} color="rgba(34, 197, 94, 0.8)" />
                  </div>
                  <span style={{ color: '#fff', fontSize: 13, fontWeight: 600, lineHeight: 1.3 }}>
                    "{spokenText}"
                  </span>
                </div>
                <span style={{ color: 'rgba(255,255,255,0.25)', fontSize: 10 }}>
                  Triple-blink to stop
                </span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Morse keyboard */}
      <MorseKeyboard
        ref={morseRef}
        isOpen={morseOpen}
        onClose={(text) => {
          setMorseOpen(false)
          if (text.trim()) {
            speakText(text.trim())
          }
        }}
      />

      {/* Morse mode indicator */}
      {morseOpen && (
        <div
          style={{
            position: 'fixed',
            top: 24,
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
          audio={false}
          mirrored
          videoConstraints={{ facingMode: 'user', width: 320, height: 240 }}
          style={{ width: 160, height: 120, objectFit: 'cover', display: 'block' }}
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
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
      `}
      </style>
    </div>
  )
}
