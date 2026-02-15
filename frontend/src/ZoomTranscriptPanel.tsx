import { useRef, useEffect } from 'react'

export interface ZoomTranscriptEntry {
  userName: string
  userId: number
  text: string
  timestamp: number
}

const SPEAKER_COLORS = [
  '#3b82f6', '#ef4444', '#22c55e', '#f59e0b', '#8b5cf6',
  '#ec4899', '#14b8a6', '#f97316', '#6366f1', '#84cc16',
]

function hashColor(name: string): string {
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash)
  }
  return SPEAKER_COLORS[Math.abs(hash) % SPEAKER_COLORS.length]
}

interface Props {
  transcripts: ZoomTranscriptEntry[]
  isConnected: boolean
}

export function ZoomTranscriptPanel({ transcripts, isConnected }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [transcripts])

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        background: 'rgba(0,0,0,0.3)',
        borderLeft: '1px solid rgba(255,255,255,0.08)',
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '16px 20px',
          borderBottom: '1px solid rgba(255,255,255,0.08)',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          flexShrink: 0,
        }}
      >
        <div
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: isConnected ? '#22c55e' : '#ef4444',
          }}
        />
        <span style={{ color: '#fff', fontSize: 15, fontWeight: 600 }}>
          Live Transcript
        </span>
        <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: 12, marginLeft: 'auto' }}>
          {transcripts.length} message{transcripts.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Transcript entries */}
      <div
        ref={scrollRef}
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '12px 16px',
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
        }}
      >
        {transcripts.length === 0 && (
          <div
            style={{
              color: 'rgba(255,255,255,0.3)',
              fontSize: 13,
              textAlign: 'center',
              marginTop: 40,
            }}
          >
            {isConnected
              ? 'Waiting for transcript data...'
              : 'Connecting to transcript stream...'}
          </div>
        )}

        {transcripts.map((t, i) => {
          const color = hashColor(t.userName)
          return (
            <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                <span style={{ color, fontSize: 13, fontWeight: 600 }}>
                  {t.userName}
                </span>
                <span style={{ color: 'rgba(255,255,255,0.2)', fontSize: 10 }}>
                  {new Date(t.timestamp * 1000).toLocaleTimeString()}
                </span>
              </div>
              <div
                style={{
                  color: 'rgba(255,255,255,0.75)',
                  fontSize: 14,
                  lineHeight: 1.4,
                  borderLeft: `3px solid ${color}40`,
                  paddingLeft: 10,
                }}
              >
                {t.text}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
