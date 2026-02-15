import { useEffect, useRef, useState } from 'react'
import { useInputMode } from '../inputMode'

interface EogConfig {
  yMin: number
  yMax: number
  leftLimit: number
  rightLimit: number
  releaseMargin: number
  noiseThreshold: number
  holdMs: number
}

interface SignalDebug {
  raw?: number
  yMin?: number
  yMax?: number
  leftLimit?: number
  rightLimit?: number
  noiseThreshold?: number
  direction?: -1 | 0 | 1
}

const DEFAULT_CONFIG: EogConfig = {
  yMin: 1750,
  yMax: 2250,
  leftLimit: 2030,
  rightLimit: 1880,
  releaseMargin: 12,
  noiseThreshold: 250,
  holdMs: 300,
}

function NumberInput({
  label,
  value,
  onCommit,
  step = 1,
}: {
  label: string
  value: number
  onCommit: (v: number) => void
  step?: number
}) {
  const [text, setText] = useState(String(value))

  useEffect(() => {
    setText(String(value))
  }, [value])

  const commit = () => {
    const parsed = Number(text)
    if (!Number.isNaN(parsed) && Number.isFinite(parsed)) onCommit(parsed)
    else setText(String(value))
  }

  return (
    <label style={{ display: 'grid', gap: 6 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', color: 'rgba(255,255,255,0.8)', fontSize: 11 }}>
        <span>{label}</span>
        <span>{value.toFixed(step < 1 ? 3 : 0)}</span>
      </div>
      <input
        type="number"
        value={text}
        step={step}
        onChange={(e) => setText(e.currentTarget.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            commit()
          }
        }}
        style={{
          width: '100%',
          background: 'rgba(255,255,255,0.06)',
          border: '1px solid rgba(255,255,255,0.2)',
          borderRadius: 8,
          color: '#fff',
          fontSize: 12,
          padding: '8px 10px',
          outline: 'none',
          boxSizing: 'border-box',
        }}
      />
    </label>
  )
}

export default function EogTuningPanel() {
  const { mode } = useInputMode()
  const [open, setOpen] = useState(false)
  const [config, setConfig] = useState<EogConfig>(DEFAULT_CONFIG)
  const [latest, setLatest] = useState<SignalDebug>({})
  const wsRef = useRef<WebSocket | null>(null)
  const sendTimerRef = useRef<number | null>(null)

  useEffect(() => {
    const ws = new WebSocket('ws://localhost:3001/ws')
    wsRef.current = ws

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'subscribe' }))
    }

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data)
        if (msg.type === 'subscribed' && msg.eogConfig) {
          setConfig((prev) => ({ ...prev, ...msg.eogConfig }))
          return
        }
        if (msg.type === 'eog-config-updated' && msg.eogConfig) {
          setConfig((prev) => ({ ...prev, ...msg.eogConfig }))
          return
        }
        if (msg.type !== 'signal') return
        const raw = Number(msg.raw ?? 0)
        setLatest({
          raw,
          yMin: Number(msg.yMin ?? 0),
          yMax: Number(msg.yMax ?? 0),
          leftLimit: Number(msg.leftLimit ?? 0),
          rightLimit: Number(msg.rightLimit ?? 0),
          noiseThreshold: Number(msg.noiseThreshold ?? 0),
          direction: msg.direction,
        })
      } catch {
        // Ignore malformed frames.
      }
    }

    return () => {
      ws.close()
      wsRef.current = null
      if (sendTimerRef.current) window.clearTimeout(sendTimerRef.current)
    }
  }, [])

  const queueConfigSend = (next: EogConfig) => {
    setConfig(next)
    if (sendTimerRef.current) window.clearTimeout(sendTimerRef.current)
    sendTimerRef.current = window.setTimeout(() => {
      wsRef.current?.send(JSON.stringify({ type: 'eog-config', config: next }))
    }, 80)
  }

  if (mode !== 'eog') return null

  return (
    <div style={{ position: 'fixed', top: 56, right: 16, zIndex: 1000 }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          border: '1px solid rgba(255,255,255,0.2)',
          borderRadius: 10,
          background: 'rgba(0,0,0,0.7)',
          color: '#fff',
          fontSize: 12,
          fontWeight: 700,
          padding: '6px 10px',
          cursor: 'pointer',
          marginBottom: 6,
        }}
      >
        {open ? 'Hide EOG Tune' : 'Show EOG Tune'}
      </button>

      {open && (
        <div
          style={{
            width: 320,
            maxHeight: '70vh',
            overflow: 'auto',
            borderRadius: 12,
            padding: 10,
            background: 'rgba(0,0,0,0.82)',
            border: '1px solid rgba(255,255,255,0.2)',
            display: 'grid',
            gap: 8,
          }}
        >
          <div style={{ color: '#fff', fontWeight: 700, fontSize: 12 }}>EOG Tune</div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.75)', lineHeight: 1.4 }}>
            raw {latest.raw?.toFixed(1) ?? '-'} | y [{(latest.yMin ?? config.yMin).toFixed(0)}, {(latest.yMax ?? config.yMax).toFixed(0)}] | dir{' '}
            {latest.direction === 1 ? 'LEFT' : latest.direction === -1 ? 'RIGHT' : 'CENTER'}
          </div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.75)', lineHeight: 1.4 }}>
            left limit {(latest.leftLimit ?? config.leftLimit).toFixed(1)} | right limit {(latest.rightLimit ?? config.rightLimit).toFixed(1)} | noise {(latest.noiseThreshold ?? config.noiseThreshold).toFixed(0)}
          </div>

          <NumberInput
            label="Y minimum"
            step={1}
            value={config.yMin}
            onCommit={(v) => queueConfigSend({ ...config, yMin: v })}
          />
          <NumberInput
            label="Y maximum"
            step={1}
            value={config.yMax}
            onCommit={(v) => queueConfigSend({ ...config, yMax: v })}
          />
          <NumberInput
            label="Left limit (look left)"
            step={1}
            value={config.leftLimit}
            onCommit={(v) => queueConfigSend({ ...config, leftLimit: v })}
          />
          <NumberInput
            label="Right limit (look right)"
            step={1}
            value={config.rightLimit}
            onCommit={(v) => queueConfigSend({ ...config, rightLimit: v })}
          />
          <NumberInput
            label="Release margin (hysteresis)"
            step={1}
            value={config.releaseMargin}
            onCommit={(v) => queueConfigSend({ ...config, releaseMargin: v })}
          />
          <NumberInput
            label="Noise threshold (ADC)"
            step={1}
            value={config.noiseThreshold}
            onCommit={(v) => queueConfigSend({ ...config, noiseThreshold: v })}
          />
          <NumberInput
            label="Direction hold (ms)"
            step={10}
            value={config.holdMs}
            onCommit={(v) => queueConfigSend({ ...config, holdMs: v })}
          />
        </div>
      )}
    </div>
  )
}
