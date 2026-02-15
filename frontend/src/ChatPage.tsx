/**
 * ChatPage.tsx — ChatGPT interface for the Revive application.
 *
 * Features:
 *   - Streaming chat with server-sent events (SSE)
 *   - User/assistant message bubbles with avatars
 *   - Auto-scrolling message area
 *   - Auto-resizing textarea input
 *   - Animated cursor for streaming responses
 *   - Mesh gradient background with glass card styling
 *
 * Inputs: None (standalone page, manages its own state)
 * Outputs: Sends messages to API_BASE/apps/chat, receives streamed responses
 *
 * Parent: main.tsx (rendered as "/apps/chat" route)
 * Children: None
 *
 * API: POST /apps/chat with { messages: Message[] }
 *   - Response is SSE stream with data: { content: string } chunks
 *   - Final event: data: [DONE]
 */

import { useState, useRef, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { FaArrowLeft, FaPaperPlane } from 'react-icons/fa'

const API_BASE = 'http://localhost:3003'

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
  const inputRef = useRef<HTMLTextAreaElement>(null)

  /**
   * scrollToBottom — Smoothly scrolls the message area to the latest message.
   */
  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [])

  useEffect(() => {
    scrollToBottom()
  }, [messages, scrollToBottom])

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  /**
   * handleSend — Sends the current input as a user message and streams the response.
   * Uses SSE to incrementally update the assistant message content.
   */
  const handleSend = async () => {
    const text = input.trim()
    if (!text || isStreaming) return

    const userMsg: Message = { role: 'user', content: text }
    const newMessages = [...messages, userMsg]
    setMessages(newMessages)
    setInput('')
    setIsStreaming(true)

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
  }

  /**
   * handleKeyDown — Handles Enter to send (Shift+Enter for newline).
   */
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div
      className="page bg-mesh"
      style={{
        paddingTop: 'var(--navbar-height)',
      }}
    >
      {/* ── Header ── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          padding: '16px 28px',
          borderBottom: '1px solid var(--border-subtle)',
          background: 'rgba(5, 5, 7, 0.5)',
          backdropFilter: 'blur(12px)',
          animation: 'slideInDown 0.3s var(--ease-out-expo)',
        }}
      >
        <button
          onClick={() => navigate('/apps')}
          style={{
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border-default)',
            borderRadius: 'var(--radius-sm)',
            color: 'var(--text-secondary)',
            cursor: 'pointer',
            padding: '8px 14px',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 13,
            fontWeight: 500,
            transition: 'all 0.2s',
            fontFamily: 'var(--font-sans)',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'var(--bg-elevated-hover)'
            e.currentTarget.style.color = 'var(--text-primary)'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'var(--bg-elevated)'
            e.currentTarget.style.color = 'var(--text-secondary)'
          }}
        >
          <FaArrowLeft size={11} /> Apps
        </button>

        {/* App icon + title */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: 10,
              background: 'linear-gradient(135deg, #10b981, #059669)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 4px 12px rgba(16, 185, 129, 0.3)',
            }}
          >
            <span style={{ color: '#fff', fontSize: 14, fontWeight: 700 }}>G</span>
          </div>
          <h1 style={{ color: 'var(--text-primary)', fontSize: 18, fontWeight: 700, margin: 0, letterSpacing: '-0.3px' }}>
            ChatGPT
          </h1>
        </div>
      </div>

      {/* ── Messages area ── */}
      <div
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
              gap: 16,
              color: 'var(--text-tertiary)',
              animation: 'fadeIn 0.5s ease',
            }}
          >
            <div
              style={{
                width: 64,
                height: 64,
                borderRadius: 'var(--radius-xl)',
                background: 'var(--bg-card)',
                border: '1px solid var(--border-subtle)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: 8,
              }}
            >
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z" />
                <path d="M12 6v6l4 2" />
              </svg>
            </div>
            <div style={{ fontSize: 18, fontWeight: 600, color: 'var(--text-secondary)' }}>Start a conversation</div>
            <div style={{ fontSize: 14 }}>Type a message below to chat with GPT</div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div
            key={i}
            style={{
              padding: '16px 28px',
              maxWidth: 720,
              width: '100%',
              margin: '0 auto',
              display: 'flex',
              gap: 16,
              animation: `slideInUp 0.3s var(--ease-out-expo)`,
            }}
          >
            {/* Avatar */}
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: 10,
                background: msg.role === 'user'
                  ? 'linear-gradient(135deg, var(--accent-blue), var(--accent-purple))'
                  : 'linear-gradient(135deg, #10b981, #34d399)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#fff',
                fontSize: 12,
                fontWeight: 700,
                flexShrink: 0,
                boxShadow: msg.role === 'user'
                  ? '0 2px 8px rgba(99, 102, 241, 0.3)'
                  : '0 2px 8px rgba(16, 185, 129, 0.3)',
              }}
            >
              {msg.role === 'user' ? 'U' : 'G'}
            </div>

            {/* Message content */}
            <div
              style={{
                color: 'rgba(240, 240, 245, 0.85)',
                fontSize: 15,
                lineHeight: 1.75,
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
                    background: 'var(--accent-green)',
                    marginLeft: 2,
                    animation: 'cursorBlink 1s infinite',
                    verticalAlign: 'text-bottom',
                    borderRadius: 1,
                  }}
                />
              )}
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* ── Input area ── */}
      <div
        style={{
          padding: '16px 28px 28px',
          borderTop: '1px solid var(--border-subtle)',
          background: 'rgba(5, 5, 7, 0.5)',
          backdropFilter: 'blur(12px)',
        }}
      >
        <div
          style={{
            maxWidth: 720,
            margin: '0 auto',
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
              background: 'var(--bg-card)',
              border: '1px solid var(--border-default)',
              borderRadius: 14,
              color: 'var(--text-primary)',
              fontSize: 15,
              padding: '14px 18px',
              outline: 'none',
              resize: 'none',
              fontFamily: 'var(--font-sans)',
              lineHeight: 1.5,
              maxHeight: 160,
              overflow: 'auto',
              transition: 'border-color 0.2s, box-shadow 0.2s',
            }}
            onFocus={(e) => {
              e.currentTarget.style.borderColor = 'rgba(99, 102, 241, 0.4)'
              e.currentTarget.style.boxShadow = '0 0 0 3px rgba(99, 102, 241, 0.1)'
            }}
            onBlur={(e) => {
              e.currentTarget.style.borderColor = 'var(--border-default)'
              e.currentTarget.style.boxShadow = 'none'
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
                ? 'var(--bg-elevated)'
                : 'linear-gradient(135deg, var(--accent-blue), var(--accent-purple))',
              color: isStreaming || !input.trim() ? 'var(--text-muted)' : '#fff',
              cursor: isStreaming || !input.trim() ? 'default' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'all 0.2s',
              flexShrink: 0,
              boxShadow: isStreaming || !input.trim()
                ? 'none'
                : '0 4px 12px rgba(99, 102, 241, 0.3)',
            }}
          >
            <FaPaperPlane size={15} />
          </button>
        </div>
      </div>
    </div>
  )
}
