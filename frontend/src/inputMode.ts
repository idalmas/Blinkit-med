import { useEffect, useState } from 'react'

export type InputMode = 'blink' | 'eog'

const STORAGE_KEY = 'blinket-input-mode'
const EVENT_NAME = 'blinket-input-mode-change'

export function getInputMode(): InputMode {
  if (typeof window === 'undefined') return 'blink'
  const stored = window.localStorage.getItem(STORAGE_KEY)
  return stored === 'eog' ? 'eog' : 'blink'
}

export function setInputMode(mode: InputMode) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(STORAGE_KEY, mode)
  window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: mode }))
}

export function useInputMode() {
  const [mode, setMode] = useState<InputMode>(() => getInputMode())

  useEffect(() => {
    const onModeChange = (evt: Event) => {
      const custom = evt as CustomEvent<InputMode>
      const next = custom.detail === 'eog' ? 'eog' : 'blink'
      setMode(next)
    }
    const onStorage = () => setMode(getInputMode())

    window.addEventListener(EVENT_NAME, onModeChange)
    window.addEventListener('storage', onStorage)
    return () => {
      window.removeEventListener(EVENT_NAME, onModeChange)
      window.removeEventListener('storage', onStorage)
    }
  }, [])

  return {
    mode,
    setMode: (next: InputMode) => setInputMode(next),
  }
}
