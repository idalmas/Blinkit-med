import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FaArrowLeft, FaVideo } from 'react-icons/fa'
import ZoomMtgEmbedded from '@zoom/meetingsdk/embedded'

type ZoomClient = ReturnType<typeof ZoomMtgEmbedded.createClient>

interface CreateMeetingResponse {
  meetingNumber: string
  password: string
  zak?: string
  hostEmail?: string
}

interface SignatureResponse {
  signature: string
  sdkKey: string
}

interface RtmsLogsResponse {
  logs: string[]
}

function formatUnknownError(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === 'string') return err
  try {
    return JSON.stringify(err)
  } catch {
    return String(err)
  }
}

export default function ZoomPage() {
  const navigate = useNavigate()
  const zoomRootRef = useRef<HTMLDivElement | null>(null)
  const clientRef = useRef<ZoomClient | null>(null)
  const clientInitializedRef = useRef(false)

  const [topic, setTopic] = useState('Quick Meeting')
  const [hostUserId, setHostUserId] = useState('me')
  const [displayName, setDisplayName] = useState('Guest User')
  const [meetingNumber, setMeetingNumber] = useState('')
  const [password, setPassword] = useState('')
  const [zak, setZak] = useState('')
  const [hostEmail, setHostEmail] = useState('')
  const [rtmsLogs, setRtmsLogs] = useState<string[]>([])
  const [rtmsError, setRtmsError] = useState('')
  const [isBusy, setIsBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')

  const createMeeting = async () => {
    setIsBusy(true)
    setError('')
    setStatus('Creating meeting...')

    try {
      const response = await fetch('/api/zoom/create-meeting', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic, userId: hostUserId }),
      })
      const data = (await response.json()) as CreateMeetingResponse & { error?: string }
      if (!response.ok) {
        throw new Error(data.error || 'Failed to create meeting')
      }

      setMeetingNumber(data.meetingNumber)
      setPassword(data.password || '')
      setZak(data.zak || '')
      setHostEmail(data.hostEmail || '')
      setStatus(`Meeting created: ${data.meetingNumber}`)
    } catch (err) {
      setError(formatUnknownError(err))
      setStatus('')
    } finally {
      setIsBusy(false)
    }
  }

  const joinMeeting = async () => {
    if (!meetingNumber.trim()) {
      setError('Meeting number is required')
      return
    }

    if (!zoomRootRef.current) {
      setError('Zoom container not ready')
      return
    }

    setIsBusy(true)
    setError('')
    setStatus('Joining meeting...')

    try {
      const role = zak ? 1 : 0
      const signatureResponse = await fetch('/api/zoom/signature', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          meetingNumber: meetingNumber.trim(),
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
        meetingNumber: meetingNumber.trim(),
        password: password.trim(),
        userName: displayName.trim() || 'Guest User',
      }

      if (role === 1 && zak) {
        joinOptions.zak = zak
        if (hostEmail) {
          joinOptions.userEmail = hostEmail
        }
      }

      await client.join(joinOptions)

      setStatus('Joined meeting')
    } catch (err) {
      setError(formatUnknownError(err))
      setStatus('')
    } finally {
      setIsBusy(false)
    }
  }

  const loadRtmsLogs = async () => {
    try {
      const response = await fetch('/api/zoom/rtms/logs')
      const data = (await response.json()) as RtmsLogsResponse
      setRtmsLogs(data.logs || [])
      setRtmsError('')
    } catch (err) {
      setRtmsError(formatUnknownError(err))
    }
  }

  const clearRtmsLogs = async () => {
    try {
      await fetch('/api/zoom/rtms/logs/clear', { method: 'POST' })
      await loadRtmsLogs()
    } catch (err) {
      setRtmsError(formatUnknownError(err))
    }
  }

  useEffect(() => {
    loadRtmsLogs()
    const timer = setInterval(loadRtmsLogs, 2000)
    return () => clearInterval(timer)
  }, [])

  const rtmsDataLines = rtmsLogs
    .map((line) => {
      const jsonStart = line.indexOf('{')
      if (jsonStart < 0) return null

      try {
        const payload = JSON.parse(line.slice(jsonStart)) as {
          metadata?: { userName?: string }
          data?: unknown
        }
        if (payload.data === undefined) return null
        const userName = payload.metadata?.userName || 'Unknown'
        const dataText = typeof payload.data === 'string' ? payload.data : JSON.stringify(payload.data)
        return `${userName}: ${dataText}`
      } catch {
        return null
      }
    })
    .filter((line): line is string => Boolean(line))

  return (
    <div
      style={{
        minHeight: '100vh',
        padding: 24,
        boxSizing: 'border-box',
        background: 'linear-gradient(160deg, #0f172a 0%, #1e293b 55%, #0b1220 100%)',
        color: '#fff',
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}
    >
      <button
        onClick={() => navigate('/apps')}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          border: '1px solid rgba(255,255,255,0.2)',
          background: 'rgba(255,255,255,0.08)',
          color: '#fff',
          borderRadius: 10,
          padding: '8px 12px',
          cursor: 'pointer',
        }}
      >
        <FaArrowLeft />
        Back
      </button>

      <div style={{ maxWidth: 1180, margin: '20px auto 0 auto' }}>
        <h1 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
          <FaVideo />
          Zoom Meeting
        </h1>
        <p style={{ color: 'rgba(255,255,255,0.7)', marginTop: 8 }}>
          Create a meeting, then join it directly in this page.
        </p>

        <div
          style={{
            background: 'rgba(255,255,255,0.06)',
            border: '1px solid rgba(255,255,255,0.15)',
            borderRadius: 14,
            padding: 16,
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: 12,
          }}
        >
          <input
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="Meeting topic"
            style={{ padding: 10, borderRadius: 8, border: 'none' }}
          />
          <input
            value={hostUserId}
            onChange={(e) => setHostUserId(e.target.value)}
            placeholder="Host user (email or me)"
            style={{ padding: 10, borderRadius: 8, border: 'none' }}
          />
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Your display name"
            style={{ padding: 10, borderRadius: 8, border: 'none' }}
          />
          <input
            value={meetingNumber}
            onChange={(e) => setMeetingNumber(e.target.value)}
            placeholder="Meeting number"
            style={{ padding: 10, borderRadius: 8, border: 'none' }}
          />
          <input
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Passcode"
            style={{ padding: 10, borderRadius: 8, border: 'none' }}
          />
          <button
            onClick={createMeeting}
            disabled={isBusy}
            style={{
              padding: 10,
              borderRadius: 8,
              border: 'none',
              background: '#2563eb',
              color: '#fff',
              cursor: 'pointer',
            }}
          >
            Create Meeting
          </button>
          <button
            onClick={joinMeeting}
            disabled={isBusy}
            style={{
              padding: 10,
              borderRadius: 8,
              border: 'none',
              background: '#16a34a',
              color: '#fff',
              cursor: 'pointer',
            }}
          >
            Join Meeting
          </button>
        </div>

        {status ? <p style={{ color: '#86efac', marginTop: 14 }}>{status}</p> : null}
        {error ? <p style={{ color: '#fca5a5', marginTop: 14 }}>{error}</p> : null}

        <div
          style={{
            marginTop: 20,
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 2fr) minmax(320px, 1fr)',
            gap: 16,
            alignItems: 'start',
          }}
        >
          <div
            ref={zoomRootRef}
            style={{
              minHeight: 560,
              borderRadius: 14,
              border: '1px solid rgba(255,255,255,0.18)',
              overflow: 'hidden',
              background: '#000',
            }}
          />

          <div
            style={{
              borderRadius: 14,
              border: '1px solid rgba(255,255,255,0.18)',
              background: 'rgba(2,6,23,0.85)',
              padding: 12,
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            }}
          >
            <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
              <button onClick={loadRtmsLogs} style={{ cursor: 'pointer' }}>
                Refresh RTMS
              </button>
              <button onClick={clearRtmsLogs} style={{ cursor: 'pointer' }}>
                Clear RTMS
              </button>
            </div>
            <p style={{ marginTop: 0, color: 'rgba(255,255,255,0.75)' }}>Raw RTMS output</p>
            {rtmsError ? <p style={{ color: '#fca5a5' }}>{rtmsError}</p> : null}
            <pre
              style={{
                margin: 0,
                minHeight: 500,
                maxHeight: 500,
                overflow: 'auto',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                borderRadius: 10,
                border: '1px solid rgba(255,255,255,0.12)',
                background: '#020617',
                padding: 10,
                color: '#cbd5e1',
              }}
            >
              {rtmsDataLines.length > 0
                ? rtmsDataLines.join('\n')
                : 'No RTMS entries with data yet.'}
            </pre>
          </div>
        </div>
      </div>
    </div>
  )
}
