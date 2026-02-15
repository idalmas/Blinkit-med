import { useInputMode } from '../inputMode'

export default function InputModeToggle() {
  const { mode, setMode } = useInputMode()

  return (
    <div
      style={{
        position: 'fixed',
        top: 16,
        right: 16,
        zIndex: 1000,
        background: 'rgba(10, 10, 10, 0.78)',
        border: '1px solid rgba(255,255,255,0.16)',
        borderRadius: 12,
        padding: 4,
        display: 'flex',
        gap: 4,
        backdropFilter: 'blur(10px)',
      }}
    >
      <button
        onClick={() => setMode('blink')}
        style={{
          border: 'none',
          borderRadius: 8,
          padding: '6px 10px',
          fontSize: 12,
          fontWeight: 600,
          cursor: 'pointer',
          color: mode === 'blink' ? '#fff' : 'rgba(255,255,255,0.65)',
          background: mode === 'blink' ? 'rgba(99,102,241,0.8)' : 'transparent',
        }}
      >
        Blink
      </button>
      <button
        onClick={() => setMode('eog')}
        style={{
          border: 'none',
          borderRadius: 8,
          padding: '6px 10px',
          fontSize: 12,
          fontWeight: 600,
          cursor: 'pointer',
          color: mode === 'eog' ? '#fff' : 'rgba(255,255,255,0.65)',
          background: mode === 'eog' ? 'rgba(16,185,129,0.82)' : 'transparent',
        }}
      >
        EOG
      </button>
    </div>
  )
}
