import { useState, useCallback, useEffect, useRef, forwardRef, useImperativeHandle } from 'react'
import type { BlinkType } from './useBlinkDetection'

const MORSE_TABLE: Record<string, string> = {
  A: '.-',    B: '-...',  C: '-.-.',  D: '-..',
  E: '.',     F: '..-.',  G: '--.',   H: '....',
  I: '..',    J: '.---',  K: '-.-',   L: '.-..',
  M: '--',    N: '-.',    O: '---',   P: '.--.',
  Q: '--.-',  R: '.-.',   S: '...',   T: '-',
  U: '..-',   V: '...-',  W: '.--',   X: '-..-',
  Y: '-.--',  Z: '--..',
  '0': '-----', '1': '.----', '2': '..---', '3': '...--',
  '4': '....-', '5': '.....', '6': '-....', '7': '--...',
  '8': '---..', '9': '----.',
}

const MORSE_DECODE: Record<string, string> = {}
for (const [char, code] of Object.entries(MORSE_TABLE)) {
  MORSE_DECODE[code] = char
}

function decodeMorse(sequence: string): string | null {
  return MORSE_DECODE[sequence] ?? null
}

function displayMorse(internal: string): string {
  return internal.replace(/\./g, '\u00B7').replace(/-/g, '\u2013')
}

export interface MorseKeyboardHandle {
  handleBlink: (type: BlinkType) => void
  getComposedText: () => string
}

interface MorseKeyboardProps {
  isOpen: boolean
  onClose: (composedText: string) => void
}

const REFERENCE_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.split('')

export const MorseKeyboard = forwardRef<MorseKeyboardHandle, MorseKeyboardProps>(
  function MorseKeyboard({ isOpen, onClose: _onClose }, ref) {
    const [currentSequence, setCurrentSequence] = useState('')
    const [composedText, setComposedText] = useState('')
    const [flashKey, setFlashKey] = useState(0)
    const composedTextRef = useRef('')
    const currentSequenceRef = useRef('')

    useEffect(() => { composedTextRef.current = composedText }, [composedText])
    useEffect(() => { currentSequenceRef.current = currentSequence }, [currentSequence])

    useEffect(() => {
      if (isOpen) {
        setCurrentSequence('')
        setComposedText('')
      }
    }, [isOpen])

    const handleMorseBlink = useCallback((type: BlinkType) => {
      if (type === 'single') {
        setCurrentSequence(prev => prev + '.')
        setFlashKey(k => k + 1)
      } else if (type === 'wink-left') {
        setCurrentSequence(prev => prev + '-')
        setFlashKey(k => k + 1)
      } else if (type === 'double') {
        const seq = currentSequenceRef.current
        if (seq.length > 0) {
          const decoded = decodeMorse(seq)
          if (decoded) {
            setComposedText(text => text + decoded)
          }
        }
        setCurrentSequence('')
      } else if (type === 'triple') {
        setComposedText(prev => prev + ' ')
        setCurrentSequence('')
      } else if (type === 'wink-right' || type === 'long-close') {
        // Delete: wink-right removes last dot/dash, or last composed char
        if (currentSequenceRef.current.length > 0) {
          setCurrentSequence(prev => prev.slice(0, -1))
        } else {
          setComposedText(text => text.slice(0, -1))
        }
      }
    }, [])

    useImperativeHandle(ref, () => ({
      handleBlink: handleMorseBlink,
      getComposedText: () => composedTextRef.current,
    }), [handleMorseBlink])

    const previewChar = decodeMorse(currentSequence)

    if (!isOpen) return null

    return (
      <div
        style={{
          position: 'fixed',
          top: 60,
          right: 20,
          bottom: 160,
          width: 340,
          backgroundColor: 'rgba(0, 0, 0, 0.9)',
          borderRadius: 12,
          padding: 16,
          display: 'flex',
          flexDirection: 'column',
          zIndex: 20,
          backdropFilter: 'blur(10px)',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          fontFamily: 'system-ui, -apple-system, sans-serif',
          animation: 'morseSlideIn 0.3s ease-out',
        }}
      >
        {/* Header */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 12,
          paddingBottom: 10,
          borderBottom: '1px solid rgba(255,255,255,0.08)',
        }}>
          <div style={{ color: '#fff', fontSize: 15, fontWeight: 600 }}>Morse Keyboard</div>
          <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: 10 }}>4x blink to close</div>
        </div>

        {/* Current input */}
        <div style={{
          background: 'rgba(255,255,255,0.04)',
          borderRadius: 8,
          padding: 12,
          marginBottom: 10,
          minHeight: 48,
          display: 'flex',
          alignItems: 'center',
          gap: 12,
        }}>
          <div key={flashKey} style={{
            flex: 1,
            fontFamily: 'monospace',
            fontSize: 22,
            color: '#fff',
            letterSpacing: 4,
            minHeight: 28,
            animation: flashKey > 0 ? 'morseFlash 0.2s ease' : undefined,
          }}>
            {currentSequence.length > 0 ? displayMorse(currentSequence) : (
              <span style={{ color: 'rgba(255,255,255,0.15)', fontSize: 13, letterSpacing: 0 }}>
                Blink or wink...
              </span>
            )}
          </div>
          {previewChar && (
            <div style={{
              background: 'rgba(99, 102, 241, 0.25)',
              border: '1px solid rgba(99, 102, 241, 0.4)',
              borderRadius: 6,
              padding: '4px 10px',
              color: '#a5b4fc',
              fontSize: 18,
              fontWeight: 700,
              minWidth: 32,
              textAlign: 'center',
            }}>
              {previewChar}
            </div>
          )}
        </div>

        {/* Composed text */}
        <div style={{
          background: 'rgba(255,255,255,0.03)',
          borderRadius: 8,
          padding: 10,
          marginBottom: 10,
          minHeight: 40,
          maxHeight: 80,
          overflow: 'auto',
        }}>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', marginBottom: 4 }}>Composed</div>
          <div style={{
            color: '#fff',
            fontSize: 15,
            fontFamily: 'monospace',
            wordBreak: 'break-all',
          }}>
            {composedText || <span style={{ color: 'rgba(255,255,255,0.12)' }}>...</span>}
            <span style={{
              display: 'inline-block',
              width: 2,
              height: 14,
              background: '#6366f1',
              marginLeft: 1,
              verticalAlign: 'text-bottom',
              animation: 'cursorBlink 1s infinite',
            }} />
          </div>
        </div>

        {/* Gesture legend */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '4px 12px',
          marginBottom: 10,
          padding: '8px 10px',
          background: 'rgba(255,255,255,0.02)',
          borderRadius: 6,
          fontSize: 10,
          color: 'rgba(255,255,255,0.4)',
        }}>
          <div>Blink = <span style={{ color: '#a5b4fc' }}>{'\u00B7'} dot</span></div>
          <div>Wink L = <span style={{ color: '#a5b4fc' }}>{'\u2013'} dash</span></div>
          <div>2x Blink = <span style={{ color: '#4ade80' }}>confirm</span></div>
          <div>3x Blink = <span style={{ color: '#4ade80' }}>space</span></div>
          <div style={{ gridColumn: 'span 2' }}>Wink R = <span style={{ color: '#f87171' }}>delete</span></div>
        </div>

        {/* Morse reference chart */}
        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', marginBottom: 6 }}>Reference</div>
        <div style={{
          flex: 1,
          overflow: 'auto',
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '2px 8px',
          alignContent: 'start',
        }}>
          {REFERENCE_CHARS.map(char => {
            const code = MORSE_TABLE[char]
            const isActive = currentSequence.length > 0 && code.startsWith(currentSequence)
            return (
              <div key={char} style={{
                display: 'flex',
                justifyContent: 'space-between',
                padding: '3px 6px',
                borderRadius: 4,
                fontSize: 12,
                background: isActive ? 'rgba(99, 102, 241, 0.12)' : 'transparent',
                transition: 'background 0.15s',
              }}>
                <span style={{
                  color: isActive ? '#a5b4fc' : 'rgba(255,255,255,0.5)',
                  fontWeight: 600,
                }}>{char}</span>
                <span style={{
                  color: isActive ? '#a5b4fc' : 'rgba(255,255,255,0.25)',
                  fontFamily: 'monospace',
                  letterSpacing: 2,
                }}>{displayMorse(code)}</span>
              </div>
            )
          })}
        </div>

        <style>{`
          @keyframes morseSlideIn {
            from { transform: translateX(100%); opacity: 0; }
            to { transform: translateX(0); opacity: 1; }
          }
          @keyframes morseFlash {
            0% { background: rgba(99, 102, 241, 0.3); border-radius: 4px; }
            100% { background: transparent; }
          }
          @keyframes cursorBlink {
            0%, 50% { opacity: 1; }
            51%, 100% { opacity: 0; }
          }
        `}</style>
      </div>
    )
  }
)
