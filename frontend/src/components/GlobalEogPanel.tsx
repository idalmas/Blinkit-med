import { SignalVisualizer } from './SignalVisualizer'

export default function GlobalEogPanel() {
  return (
    <div
      style={{
        position: 'fixed',
        bottom: 20,
        left: 20,
        width: 160,
        height: 120,
        borderRadius: 12,
        overflow: 'hidden',
        border: '2px solid rgba(255,255,255,0.15)',
        zIndex: 10,
      }}
    >
      <SignalVisualizer compact />
    </div>
  )
}
