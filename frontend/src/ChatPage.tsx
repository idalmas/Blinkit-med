import { useState, useRef, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import Webcam from 'react-webcam'
import { FaArrowLeft, FaPaperPlane } from 'react-icons/fa'

import { useBlinkDetection, type BlinkType } from './useBlinkDetection'
import { MorseKeyboard, type MorseKeyboardHandle } from './MorseKeyboard'
import { API_BASE, PERSON } from './config'

interface Message {
  role: 'user' | 'assistant'
  content: string
}

export default function ChatPage() {
  const navigate = useNavigate()
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [suggestionsLoading, setSuggestionsLoading] = useState(true)
  const [highlightedIdx, setHighlightedIdx] = useState(0)
  const highlightedIdxRef = useRef(0)
  const handleSendRef = useRef<() => void>(() => {})
  const suggestionClickRef = useRef<(s: string) => void>(() => {})
  const [morseOpen, setMorseOpen] = useState(false)
  const morseOpenRef = useRef(false)
  const morseRef = useRef<MorseKeyboardHandle>(null)

  // Keep refs in sync
  useEffect(() => { highlightedIdxRef.current = highlightedIdx }, [highlightedIdx])
  useEffect(() => { morseOpenRef.current = morseOpen }, [morseOpen])

  const handleBlink = useCallback(
    (type: BlinkType) => {
      // Quadruple blink toggles Morse keyboard
      if (type === 'quadruple') {
        if (morseOpenRef.current && morseRef.current) {
          const text = morseRef.current.getComposedText()
          if (text.trim()) {
            setInput(prevInput => prevInput + text)
          }
          setTimeout(() => inputRef.current?.focus(), 50)
        }
        setMorseOpen(prev => !prev)
        return
      }

      // When Morse keyboard is open, route all events to it
      if (morseOpenRef.current) {
        morseRef.current?.handleBlink(type)
        return
      }

      if (type === 'long-close' || type === 'triple') {
        navigate('/apps')
        return
      }

      // Suggestion navigation mode (when suggestions are visible)
      if (suggestions.length > 0) {
        if (type === 'wink-right') {
          setHighlightedIdx((prev) => Math.min(prev + 1, suggestions.length - 1))
        } else if (type === 'wink-left') {
          setHighlightedIdx((prev) => Math.max(prev - 1, 0))
        } else if (type === 'double') {
          const idx = highlightedIdxRef.current
          if (idx >= 0 && idx < suggestions.length) {
            suggestionClickRef.current(suggestions[idx])
          }
        }
        return
      }

      // Chat mode — scroll and send
      if (type === 'wink-left') {
        messagesContainerRef.current?.scrollBy({ top: -300, behavior: 'smooth' })
      } else if (type === 'wink-right') {
        messagesContainerRef.current?.scrollBy({ top: 300, behavior: 'smooth' })
      } else if (type === 'double') {
        handleSendRef.current()
      }
    },
    [navigate, suggestions, messages.length]
  )

  const { webcamRef, status: blinkStatus } = useBlinkDetection({ onBlink: handleBlink })

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [])

  useEffect(() => {
    scrollToBottom()
  }, [messages, scrollToBottom])

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // Reusable function to fetch suggestions from getContext
  const fetchSuggestions = useCallback(async (contextText?: string) => {
    setSuggestionsLoading(true)
    setHighlightedIdx(0)
    try {
      const res = await fetch(`${API_BASE}/getContext`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ app: 'chat', person: PERSON, k: 5, ...(contextText ? { text: contextText } : {}) }),
      })
      if (!res.ok) throw new Error('Failed')
      const data = await res.json()
      if (Array.isArray(data.result)) {
        setSuggestions(data.result)
      }
    } catch {
      // Silently fail — suggestions are optional
    } finally {
      setSuggestionsLoading(false)
    }
  }, [])

  // Fetch initial suggestions on mount
  useEffect(() => {
    fetchSuggestions()
  }, [fetchSuggestions])

  const handleSend = async () => {
    const text = input.trim()
    if (!text || isStreaming) return

    setSuggestions([]) // Hide suggestions once user sends a message
    const userMsg: Message = { role: 'user', content: text }
    const newMessages = [...messages, userMsg]
    setMessages(newMessages)
    setInput('')
    setIsStreaming(true)

    // Add empty assistant message to stream into
    setMessages((prev) => [...prev, { role: 'assistant', content: '' }])

    try {
      const res = await fetch(`${API_BASE}/apps/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: newMessages }),
      })

      if (!res.ok) {
        const err = await res.text()
        setMessages((prev) => {
          const updated = [...prev]
          updated[updated.length - 1] = { role: 'assistant', content: `Error: ${err}` }
          return updated
        })
        setIsStreaming(false)
        return
      }

      const reader = res.body?.getReader()
      const decoder = new TextDecoder()

      if (!reader) {
        setIsStreaming(false)
        return
      }

      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const payload = line.slice(6)
            if (payload === '[DONE]') break
            try {
              const parsed = JSON.parse(payload)
              if (parsed.content) {
                setMessages((prev) => {
                  const updated = [...prev]
                  const last = updated[updated.length - 1]
                  updated[updated.length - 1] = { ...last, content: last.content + parsed.content }
                  return updated
                })
              }
            } catch { /* skip malformed */ }
          }
        }
      }
    } catch (err) {
      setMessages((prev) => {
        const updated = [...prev]
        updated[updated.length - 1] = {
          role: 'assistant',
          content: `Error: ${err instanceof Error ? err.message : 'Connection failed'}`,
        }
        return updated
      })
    }

    setIsStreaming(false)
    inputRef.current?.focus()

    // Fetch new follow-up suggestions based on the last assistant response
    setMessages((prev) => {
      const lastAssistant = [...prev].reverse().find((m) => m.role === 'assistant')
      if (lastAssistant?.content) {
        fetchSuggestions(lastAssistant.content)
      }
      return prev
    })
  }

  // Keep ref in sync so blink handler can call latest version
  handleSendRef.current = handleSend

  const handleSuggestionClick = useCallback((suggestion: string) => {
    setInput(suggestion)
    // Auto-send after a tick so the input state updates
    setTimeout(() => {
      handleSendRef.current()
    }, 0)
  }, [])

  // Keep ref in sync so blink handler can call latest version
  suggestionClickRef.current = handleSuggestionClick

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
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
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          padding: '20px 24px',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
        }}
      >
        <button
          onClick={() => navigate('/apps')}
          style={{
            background: 'rgba(255,255,255,0.06)',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 10,
            color: 'rgba(255,255,255,0.5)',
            cursor: 'pointer',
            padding: '8px 12px',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 13,
            transition: 'all 0.2s',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'rgba(255,255,255,0.1)'
            e.currentTarget.style.color = '#fff'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'rgba(255,255,255,0.06)'
            e.currentTarget.style.color = 'rgba(255,255,255,0.5)'
          }}
        >
          <FaArrowLeft size={12} /> Apps
        </button>
        <h1 style={{ color: '#fff', fontSize: 20, fontWeight: 600, margin: 0 }}>ChatGPT</h1>
      </div>

      {/* Messages area */}
      <div
        ref={messagesContainerRef}
        style={{
          flex: 1,
          overflow: 'auto',
          padding: '24px 0',
          display: 'flex',
          flexDirection: 'column',
          gap: 0,
        }}
      >
        {messages.length === 0 && (
          <div
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 12,
              color: 'rgba(255,255,255,0.25)',
            }}
          >
            <div style={{ fontSize: 48, marginBottom: 8 }}>
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z" />
                <path d="M12 6v6l4 2" />
              </svg>
            </div>
            <div style={{ fontSize: 18, fontWeight: 500 }}>Start a conversation</div>
            <div style={{ fontSize: 14 }}>
              {suggestionsLoading ? 'Loading suggestions...' : 'Pick a suggestion or type a message'}
            </div>

            {/* Suggestion chips */}
            {suggestions.length > 0 && (
              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: 10,
                  justifyContent: 'center',
                  maxWidth: 640,
                  marginTop: 16,
                }}
              >
                {suggestions.map((s, i) => {
                  const isHighlighted = i === highlightedIdx
                  return (
                    <button
                      key={i}
                      onClick={() => handleSuggestionClick(s)}
                      style={{
                        background: isHighlighted ? 'rgba(99, 102, 241, 0.2)' : 'rgba(255,255,255,0.06)',
                        border: isHighlighted
                          ? '1px solid rgba(99, 102, 241, 0.5)'
                          : '1px solid rgba(255,255,255,0.12)',
                        borderRadius: 12,
                        color: isHighlighted ? '#fff' : 'rgba(255,255,255,0.7)',
                        padding: '10px 16px',
                        fontSize: 13,
                        cursor: 'pointer',
                        transition: 'all 0.2s',
                        fontFamily: 'inherit',
                        maxWidth: 300,
                        textAlign: 'left',
                        lineHeight: 1.4,
                        boxShadow: isHighlighted ? '0 0 12px rgba(99, 102, 241, 0.3)' : 'none',
                        transform: isHighlighted ? 'scale(1.05)' : 'scale(1)',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = 'rgba(99, 102, 241, 0.15)'
                        e.currentTarget.style.borderColor = 'rgba(99, 102, 241, 0.4)'
                        e.currentTarget.style.color = '#fff'
                      }}
                      onMouseLeave={(e) => {
                        if (!isHighlighted) {
                          e.currentTarget.style.background = 'rgba(255,255,255,0.06)'
                          e.currentTarget.style.borderColor = 'rgba(255,255,255,0.12)'
                          e.currentTarget.style.color = 'rgba(255,255,255,0.7)'
                        } else {
                          e.currentTarget.style.background = 'rgba(99, 102, 241, 0.2)'
                          e.currentTarget.style.borderColor = 'rgba(99, 102, 241, 0.5)'
                          e.currentTarget.style.color = '#fff'
                        }
                      }}
                    >
                      {s}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {messages.map((msg, i) => (
          <div
            key={i}
            style={{
              padding: '16px 24px',
              maxWidth: 720,
              width: '100%',
              margin: '0 auto',
              display: 'flex',
              gap: 16,
            }}
          >
            {/* Avatar */}
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: 8,
                background: msg.role === 'user'
                  ? 'linear-gradient(135deg, #6366f1, #8b5cf6)'
                  : 'linear-gradient(135deg, #10b981, #34d399)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#fff',
                fontSize: 13,
                fontWeight: 700,
                flexShrink: 0,
              }}
            >
              {msg.role === 'user' ? 'U' : 'G'}
            </div>

            {/* Message content */}
            <div
              style={{
                color: 'rgba(255,255,255,0.85)',
                fontSize: 15,
                lineHeight: 1.7,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                flex: 1,
              }}
            >
              {msg.content}
              {isStreaming && i === messages.length - 1 && msg.role === 'assistant' && (
                <span
                  style={{
                    display: 'inline-block',
                    width: 6,
                    height: 18,
                    background: '#10b981',
                    marginLeft: 2,
                    animation: 'cursorBlink 1s infinite',
                    verticalAlign: 'text-bottom',
                  }}
                />
              )}
            </div>
          </div>
        ))}
        {/* Follow-up suggestion chips (after messages) */}
        {messages.length > 0 && suggestions.length > 0 && !isStreaming && (
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 8,
              padding: '12px 24px',
              maxWidth: 720,
              margin: '0 auto',
              width: '100%',
            }}
          >
            <div style={{ width: '100%', fontSize: 12, color: 'rgba(255,255,255,0.3)', marginBottom: 4 }}>
              Suggested follow-ups
            </div>
            {suggestions.map((s, i) => {
              const isHighlighted = i === highlightedIdx
              return (
                <button
                  key={i}
                  onClick={() => handleSuggestionClick(s)}
                  style={{
                    background: isHighlighted ? 'rgba(99, 102, 241, 0.2)' : 'rgba(255,255,255,0.06)',
                    border: isHighlighted
                      ? '1px solid rgba(99, 102, 241, 0.5)'
                      : '1px solid rgba(255,255,255,0.12)',
                    borderRadius: 12,
                    color: isHighlighted ? '#fff' : 'rgba(255,255,255,0.7)',
                    padding: '8px 14px',
                    fontSize: 13,
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                    fontFamily: 'inherit',
                    maxWidth: 300,
                    textAlign: 'left',
                    lineHeight: 1.4,
                    boxShadow: isHighlighted ? '0 0 12px rgba(99, 102, 241, 0.3)' : 'none',
                    transform: isHighlighted ? 'scale(1.05)' : 'scale(1)',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'rgba(99, 102, 241, 0.15)'
                    e.currentTarget.style.borderColor = 'rgba(99, 102, 241, 0.4)'
                    e.currentTarget.style.color = '#fff'
                  }}
                  onMouseLeave={(e) => {
                    if (!isHighlighted) {
                      e.currentTarget.style.background = 'rgba(255,255,255,0.06)'
                      e.currentTarget.style.borderColor = 'rgba(255,255,255,0.12)'
                      e.currentTarget.style.color = 'rgba(255,255,255,0.7)'
                    } else {
                      e.currentTarget.style.background = 'rgba(99, 102, 241, 0.2)'
                      e.currentTarget.style.borderColor = 'rgba(99, 102, 241, 0.5)'
                      e.currentTarget.style.color = '#fff'
                    }
                  }}
                >
                  {s}
                </button>
              )
            })}
          </div>
        )}

        {/* Loading indicator for follow-up suggestions */}
        {messages.length > 0 && suggestionsLoading && !isStreaming && (
          <div style={{ padding: '12px 24px', maxWidth: 720, margin: '0 auto', width: '100%' }}>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.25)' }}>Loading follow-up suggestions...</div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input area */}
      <div
        style={{
          padding: '16px 24px 24px',
          borderTop: '1px solid rgba(255,255,255,0.06)',
        }}
      >
        <div
          style={{
            maxWidth: 720,
            margin: '0 auto',
            position: 'relative',
            display: 'flex',
            alignItems: 'flex-end',
            gap: 12,
          }}
        >
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a message..."
            rows={1}
            style={{
              flex: 1,
              background: 'rgba(255,255,255,0.06)',
              border: '1px solid rgba(255,255,255,0.12)',
              borderRadius: 14,
              color: '#fff',
              fontSize: 15,
              padding: '14px 18px',
              outline: 'none',
              resize: 'none',
              fontFamily: 'inherit',
              lineHeight: 1.5,
              maxHeight: 160,
              overflow: 'auto',
              transition: 'border-color 0.2s',
            }}
            onFocus={(e) => {
              e.currentTarget.style.borderColor = 'rgba(99, 102, 241, 0.5)'
            }}
            onBlur={(e) => {
              e.currentTarget.style.borderColor = 'rgba(255,255,255,0.12)'
            }}
            onInput={(e) => {
              const el = e.currentTarget
              el.style.height = 'auto'
              el.style.height = Math.min(el.scrollHeight, 160) + 'px'
            }}
          />
          <button
            onClick={handleSend}
            disabled={isStreaming || !input.trim()}
            style={{
              width: 44,
              height: 44,
              borderRadius: 12,
              border: 'none',
              background: isStreaming || !input.trim()
                ? 'rgba(255,255,255,0.06)'
                : 'linear-gradient(135deg, #6366f1, #8b5cf6)',
              color: isStreaming || !input.trim() ? 'rgba(255,255,255,0.2)' : '#fff',
              cursor: isStreaming || !input.trim() ? 'default' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'all 0.2s',
              flexShrink: 0,
            }}
          >
            <FaPaperPlane size={16} />
          </button>
        </div>
        <p style={{ color: 'rgba(255,255,255,0.2)', fontSize: 11, textAlign: 'center', margin: '8px 0 0' }}>
          Wink to scroll &middot; Double-blink to send &middot; Triple-blink to go back &middot; 4x blink for Morse keyboard
        </p>
      </div>

      {/* Morse mode indicator */}
      {morseOpen && (
        <div style={{
          position: 'fixed',
          top: 20,
          right: 380,
          background: 'rgba(99, 102, 241, 0.2)',
          border: '1px solid rgba(99, 102, 241, 0.4)',
          borderRadius: 8,
          padding: '4px 10px',
          fontSize: 11,
          color: '#a5b4fc',
          fontWeight: 600,
          zIndex: 25,
        }}>
          MORSE MODE
        </div>
      )}

      {/* Morse Keyboard Panel */}
      <MorseKeyboard
        ref={morseRef}
        isOpen={morseOpen}
        onClose={(text) => {
          if (text.trim()) setInput(prev => prev + text)
          setMorseOpen(false)
        }}
      />

      {/* Webcam preview */}
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
        <Webcam
          ref={webcamRef}
          audio={false}
          videoConstraints={{ facingMode: 'user', width: 640, height: 480 }}
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          mirrored
        />
        <div
          style={{
            position: 'absolute',
            bottom: 4,
            left: 4,
            fontSize: 10,
            color: blinkStatus === 'detecting' ? '#4ade80' : 'rgba(255,255,255,0.5)',
            background: 'rgba(0,0,0,0.6)',
            padding: '2px 6px',
            borderRadius: 4,
          }}
        >
          {blinkStatus === 'loading' ? 'Loading...' : blinkStatus === 'detecting' ? 'Blink active' : blinkStatus}
        </div>
      </div>

      <style>{`
        @keyframes cursorBlink {
          0%, 50% { opacity: 1; }
          51%, 100% { opacity: 0; }
        }
        textarea::placeholder {
          color: rgba(255,255,255,0.25);
        }
        div::-webkit-scrollbar {
          width: 6px;
        }
        div::-webkit-scrollbar-track {
          background: transparent;
        }
        div::-webkit-scrollbar-thumb {
          background: rgba(255,255,255,0.1);
          border-radius: 3px;
        }
      `}</style>
    </div>
  )
}
