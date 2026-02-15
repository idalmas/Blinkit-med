/**
 * AmazonSearchPage — Personalized Amazon product discovery page.
 *
 * On mount, calls POST /getContext to get 20 personalized Amazon search queries
 * generated from the user's stored context (Elasticsearch kNN + Cerebras LLM).
 * The top suggestion auto-searches immediately via BrightData, and all 20
 * suggestions are displayed as clickable chips so the user can explore others.
 *
 * Users can also type their own keyword into the search bar. Products are
 * displayed in a 3D card carousel navigable by wink-based blink detection.
 *
 * Data flow:
 *   1. Page load → POST /getContext { app: "Amazon" } → 20 search queries
 *   2. Auto-search suggestions[0] → POST /apps/amazon-search → BrightData scrape
 *   3. Poll GET /apps/amazon-status/:id until products are ready
 *   4. Display product cards in carousel; blink to browse, double-blink to select
 *
 * Key state:
 *   - suggestions / suggestionsLoading / activeSuggestion — getContext results
 *   - keyword / status / products — BrightData search state
 *   - centerIdx / selectedOrigIdx — carousel navigation
 *
 * Parent: mounted by src/main.tsx at /apps/amazon
 * Dependencies: useBlinkDetection, backend at localhost:3001
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import Webcam from 'react-webcam'
import { FaAmazon, FaStar, FaStarHalfAlt, FaRegStar, FaArrowLeft, FaSearch } from 'react-icons/fa'
import { useBlinkDetection, type BlinkType } from './useBlinkDetection'

/** Base URL for the Hono backend (Elasticsearch + BrightData + Cerebras). */
const API_BASE = 'http://localhost:3003'

/**
 * PERSON — the persona whose Elasticsearch context is used for personalisation.
 *
 * Set via the VITE_PERSON env var in frontend/.env (e.g. VITE_PERSON=hagrid).
 * Defaults to "ian" when unset.
 */
const PERSON = (import.meta.env.VITE_PERSON ?? 'ian').trim().toLowerCase()

/** How often (ms) to poll BrightData for scrape completion. */
const POLL_INTERVAL = 3000

interface AmazonProduct {
  title?: string
  image_url?: string
  image?: string
  final_price?: number
  initial_price?: number
  currency?: string
  rating?: number
  reviews_count?: number
  brand?: string
  availability?: string
  url?: string
  badge?: string
  bought_past_month?: number
  asin?: string
  error?: string
}

type SearchStatus = 'idle' | 'submitting' | 'polling' | 'ready' | 'error'

function StarRating({ rating }: { rating: number }) {
  const stars = []
  for (let i = 1; i <= 5; i++) {
    if (rating >= i) {
      stars.push(<FaStar key={i} size={14} color="#FFA41C" />)
    } else if (rating >= i - 0.5) {
      stars.push(<FaStarHalfAlt key={i} size={14} color="#FFA41C" />)
    } else {
      stars.push(<FaRegStar key={i} size={14} color="#FFA41C" />)
    }
  }
  return <span style={{ display: 'flex', gap: 2, alignItems: 'center' }}>{stars}</span>
}

/** Safely coerce BrightData response into an array of products */
function normalizeProducts(raw: unknown): AmazonProduct[] {
  if (Array.isArray(raw)) return raw
  if (raw && typeof raw === 'object') {
    // Handle possible nested structures like { results: [...] } or { data: [...] }
    const obj = raw as Record<string, unknown>
    for (const key of ['results', 'data', 'items', 'products']) {
      if (Array.isArray(obj[key])) return obj[key] as AmazonProduct[]
    }
    return [raw as AmazonProduct]
  }
  return []
}

export default function AmazonSearchPage() {
  const navigate = useNavigate()
  const [keyword, setKeyword] = useState('')
  const [limit, setLimit] = useState(20)
  const [status, setStatus] = useState<SearchStatus>('idle')
  const [snapshotId, setSnapshotId] = useState<string | null>(null)
  const [products, setProducts] = useState<AmazonProduct[]>([])
  const [errorMsg, setErrorMsg] = useState('')
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const failCountRef = useRef(0)
  const MAX_POLL_FAILURES = 5

  // Personalized suggestions from getContext (Elasticsearch + Cerebras)
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [suggestionsLoading, setSuggestionsLoading] = useState(true)
  const [activeSuggestion, setActiveSuggestion] = useState<string | null>(null)

  // Index of the suggestion currently highlighted via blink navigation
  const [highlightedSuggestionIdx, setHighlightedSuggestionIdx] = useState(0)
  /** Ref mirror of highlightedSuggestionIdx so event handlers can read the
   *  latest value without closure staleness or side-effects inside setState. */
  const highlightedIdxRef = useRef(0)
  useEffect(() => { highlightedIdxRef.current = highlightedSuggestionIdx }, [highlightedSuggestionIdx])

  // Search result cache (persisted in localStorage)
  const cacheRef = useRef<Map<string, AmazonProduct[]>>(new Map())
  const lastSearchKeyRef = useRef('')

  useEffect(() => {
    try {
      const stored = localStorage.getItem('revive-amazon-cache')
      if (stored) {
        const entries = JSON.parse(stored) as [string, AmazonProduct[]][]
        cacheRef.current = new Map(entries)
        console.log(`[cache] Loaded ${entries.length} cached searches`)
      }
    } catch { /* ignore corrupt data */ }
  }, [])

  const saveToCache = useCallback((key: string, data: AmazonProduct[]) => {
    cacheRef.current.set(key, data)
    // Keep only the last 50 searches
    if (cacheRef.current.size > 50) {
      const first = cacheRef.current.keys().next().value
      if (first !== undefined) cacheRef.current.delete(first)
    }
    try {
      localStorage.setItem('revive-amazon-cache', JSON.stringify([...cacheRef.current.entries()]))
    } catch { /* storage full — non-critical */ }
  }, [])

  // State-based carousel: centerIdx is the product index shown in the center
  const [centerIdx, setCenterIdx] = useState(0)
  const [selectedOrigIdx, setSelectedOrigIdx] = useState<number | null>(null)
  const [emailStatus, setEmailStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')

  const sendProductEmail = useCallback(async (product: AmazonProduct) => {
    if (!product.url) return
    setEmailStatus('sending')
    try {
      console.log('[email] Sending product link:', product.title)
      const res = await fetch(`${API_BASE}/apps/send-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productUrl: product.url, productTitle: product.title }),
      })
      if (res.ok) {
        console.log('[email] Sent successfully')
        setEmailStatus('sent')
        setTimeout(() => setEmailStatus('idle'), 3000)
      } else {
        console.error('[email] Failed:', await res.text())
        setEmailStatus('error')
        setTimeout(() => setEmailStatus('idle'), 3000)
      }
    } catch (err) {
      console.error('[email] Error:', err)
      setEmailStatus('error')
      setTimeout(() => setEmailStatus('idle'), 3000)
    }
  }, [])

  /**
   * Ref to hold the latest handleSuggestionClick so handleBlink can call it
   * without a circular dependency.
   */
  const suggestionClickRef = useRef<(s: string) => void>(() => {})

  /**
   * handleBlink — dispatches blink/wink events to either the suggestion list
   * (when suggestions are visible and no products are loaded) or the product
   * carousel (once products are on screen).
   *
   * Suggestion mode:
   *   - wink-left / wink-right → move highlight left / right
   *   - double blink → select highlighted suggestion (triggers search)
   *
   * Product carousel mode:
   *   - wink-left / wink-right → scroll cards
   *   - double blink → email current product
   *   - triple blink → go back (clear products, return to search)
   */
  const handleBlink = useCallback(
    (type: BlinkType) => {
      if (type === 'long-close') {
        navigate('/apps')
        return
      }
      const suggestionsVisible = suggestions.length > 0 && !(status === 'ready' && products.length > 0)

      // ── Suggestion navigation mode ──
      if (suggestionsVisible && products.length === 0) {
        if (type === 'wink-right') {
          setHighlightedSuggestionIdx((prev) => Math.min(prev + 1, suggestions.length - 1))
        } else if (type === 'wink-left') {
          setHighlightedSuggestionIdx((prev) => Math.max(prev - 1, 0))
        } else if (type === 'double') {
          const idx = highlightedIdxRef.current
          if (idx >= 0 && idx < suggestions.length) {
            suggestionClickRef.current(suggestions[idx])
          }
        }
        return
      }

      // ── Product carousel mode ──
      if (products.length === 0) return
      if (type === 'double') {
        sendProductEmail(products[centerIdx])
      } else if (type === 'triple') {
        setProducts([])
        setSelectedOrigIdx(null)
        setCenterIdx(0)
        setStatus('idle')
      } else if (type === 'wink-left') {
        setCenterIdx((prev) => ((prev - 1) + products.length) % products.length)
      } else if (type === 'wink-right') {
        setCenterIdx((prev) => (prev + 1) % products.length)
      }
    },
    [centerIdx, products, sendProductEmail, suggestions, status]
  )

  const { webcamRef, status: blinkStatus } = useBlinkDetection({ onBlink: handleBlink })

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
    failCountRef.current = 0
  }, [])

  useEffect(() => () => stopPolling(), [stopPolling])

  const pollForResults = useCallback(
    (sid: string) => {
      setStatus('polling')
      failCountRef.current = 0
      pollRef.current = setInterval(async () => {
        try {
          console.log(`[poll] Checking status for ${sid} (failures: ${failCountRef.current})`)
          const res = await fetch(`${API_BASE}/apps/amazon-status/${sid}`)

          if (!res.ok) {
            const errorText = await res.text()
            console.warn(`[poll] Non-OK response: ${res.status}`, errorText)
            failCountRef.current++
            if (failCountRef.current >= MAX_POLL_FAILURES) {
              console.error(`[poll] Giving up after ${MAX_POLL_FAILURES} failures`)
              stopPolling()
              setErrorMsg(`Status check failed after ${MAX_POLL_FAILURES} attempts.`)
              setStatus('error')
            }
            return
          }

          failCountRef.current = 0
          const data = await res.json()
          console.log(`[poll] Response:`, data.status, data)

          if (data.status === 'ready') {
            console.log(`[poll] Raw data.data type: ${typeof data.data}, isArray: ${Array.isArray(data.data)}, keys:`, Array.isArray(data.data) ? `length=${data.data.length}` : Object.keys(data.data ?? {}))
            const allProducts = normalizeProducts(data.data)
            const validProducts = allProducts.filter((p) => p.title && !p.error)
            console.log(`[poll] Ready! ${validProducts.length} valid products (${allProducts.length} total)`)
            if (allProducts.length > 0 && validProducts.length === 0) {
              console.log(`[poll] First product keys:`, Object.keys(allProducts[0]))
              console.log(`[poll] First product sample:`, JSON.stringify(allProducts[0]).slice(0, 300))
            }
            stopPolling()
            setProducts(validProducts)
            if (validProducts.length > 0) {
              saveToCache(lastSearchKeyRef.current, validProducts)
            }
            setStatus('ready')
          } else if (data.status === 'failed') {
            console.error(`[poll] Scrape failed:`, data)
            stopPolling()
            setErrorMsg(data.error || 'Scrape job failed.')
            setStatus('error')
          }
        } catch (err) {
          console.error(`[poll] Fetch error:`, err)
          failCountRef.current++
          if (failCountRef.current >= MAX_POLL_FAILURES) {
            console.error(`[poll] Giving up after ${MAX_POLL_FAILURES} failures`)
            stopPolling()
            setErrorMsg(`Status check failed after ${MAX_POLL_FAILURES} attempts.`)
            setStatus('error')
          }
        }
      }, POLL_INTERVAL)
    },
    [stopPolling, saveToCache]
  )

  const handleSearch = async () => {
    if (!keyword.trim()) return

    // Check cache first
    const cacheKey = keyword.trim().toLowerCase()
    const cached = cacheRef.current.get(cacheKey)
    if (cached && cached.length > 0) {
      console.log(`[cache] Hit for "${cacheKey}" — ${cached.length} products`)
      setProducts(cached)
      setStatus('ready')
      setErrorMsg('')
      return
    }

    lastSearchKeyRef.current = cacheKey
    stopPolling()
    setProducts([])
    setErrorMsg('')
    setStatus('submitting')

    try {
      console.log(`[search] Starting search: keyword="${keyword.trim()}", limit=${limit}`)
      const res = await fetch(`${API_BASE}/apps/amazon-search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keyword: keyword.trim(), limit }),
      })

      const data = await res.json()
      console.log(`[search] Response (${res.status}):`, data)

      if (!res.ok && res.status !== 202) {
        console.error(`[search] Request failed:`, data)
        setErrorMsg(data.error || 'Request failed.')
        setStatus('error')
        return
      }

      if (data.snapshot_id) {
        console.log(`[search] Got snapshot_id: ${data.snapshot_id}, starting polling...`)
        setSnapshotId(data.snapshot_id)
        pollForResults(data.snapshot_id)
      } else {
        setErrorMsg('No snapshot_id returned.')
        setStatus('error')
      }
    } catch {
      setErrorMsg('Failed to start search.')
      setStatus('error')
    }
  }

  // ── Fetch personalized suggestions from getContext on mount ──
  useEffect(() => {
    let cancelled = false
    async function fetchSuggestions() {
      setSuggestionsLoading(true)
      try {
        console.log('[getContext] Fetching personalized suggestions...')
        const res = await fetch(`${API_BASE}/getContext`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ app: 'Amazon', person: PERSON, k: 10 }),
        })
        if (!res.ok) {
          console.warn('[getContext] Non-OK response:', res.status)
          return
        }
        const data = await res.json()
        const items: string[] = Array.isArray(data.result)
          ? data.result.filter((s: unknown) => typeof s === 'string' && (s as string).trim().length > 0)
          : []
        if (!cancelled && items.length > 0) {
          console.log(`[getContext] Got ${items.length} suggestions:`, items)
          setSuggestions(items)
        }
      } catch (err) {
        console.error('[getContext] Error:', err)
      } finally {
        if (!cancelled) setSuggestionsLoading(false)
      }
    }
    fetchSuggestions()
    return () => { cancelled = true }
  }, [])

  // No auto-search — user must navigate suggestions with winks and
  // double-blink to confirm before any search is triggered.

  /**
   * handleSuggestionClick — triggered when the user clicks a suggestion chip.
   * Sets the keyword, marks the chip as active, and kicks off a BrightData search.
   */
  const handleSuggestionClick = useCallback((suggestion: string) => {
    setKeyword(suggestion)
    setActiveSuggestion(suggestion)
    // Inline the search logic so we use the clicked suggestion directly
    ;(async () => {
      const cacheKey = suggestion.trim().toLowerCase()
      const cached = cacheRef.current.get(cacheKey)
      if (cached && cached.length > 0) {
        setProducts(cached)
        setStatus('ready')
        setErrorMsg('')
        return
      }
      lastSearchKeyRef.current = cacheKey
      stopPolling()
      setProducts([])
      setErrorMsg('')
      setStatus('submitting')
      try {
        const res = await fetch(`${API_BASE}/apps/amazon-search`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ keyword: suggestion.trim(), limit }),
        })
        const data = await res.json()
        if (!res.ok && res.status !== 202) {
          setErrorMsg(data.error || 'Request failed.')
          setStatus('error')
          return
        }
        if (data.snapshot_id) {
          setSnapshotId(data.snapshot_id)
          pollForResults(data.snapshot_id)
        } else {
          setErrorMsg('No snapshot_id returned.')
          setStatus('error')
        }
      } catch {
        setErrorMsg('Failed to start search.')
        setStatus('error')
      }
    })()
  }, [limit, stopPolling, pollForResults])

  // Keep the ref in sync so handleBlink can call the latest version
  useEffect(() => {
    suggestionClickRef.current = handleSuggestionClick
  }, [handleSuggestionClick])

  // Reset centerIdx when products change (new search)
  useEffect(() => {
    setCenterIdx(0)
    setSelectedOrigIdx(null)
  }, [products])

  const isLoading = status === 'submitting' || status === 'polling'

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'linear-gradient(160deg, #0a0a0a 0%, #111827 50%, #0a0a0a 100%)',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '72px 32px 20px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 20,
          overflowY: 'auto',
          scrollbarWidth: 'none',
        }}
      >
        <button
          onClick={() => navigate('/apps')}
          style={{
            position: 'absolute',
            top: 72,
            left: 24,
            background: 'rgba(255,255,255,0.06)',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 10,
            color: 'rgba(255,255,255,0.6)',
            padding: '8px 14px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            fontSize: 14,
            transition: 'all 0.2s',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'rgba(255,255,255,0.1)'
            e.currentTarget.style.color = '#fff'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'rgba(255,255,255,0.06)'
            e.currentTarget.style.color = 'rgba(255,255,255,0.6)'
          }}
        >
          <FaArrowLeft size={12} /> Back
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div
            style={{
              width: 48,
              height: 48,
              borderRadius: 14,
              background: 'linear-gradient(135deg, #FF9900, #FFB84D)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 8px 24px rgba(255,153,0,0.3)',
            }}
          >
            <FaAmazon size={26} color="#fff" />
          </div>
          <h1 style={{ color: '#fff', fontSize: 28, fontWeight: 700, margin: 0 }}>
            Amazon Search
          </h1>
        </div>

        {/* Search bar */}
        <div
          style={{
            display: 'flex',
            gap: 10,
            width: '100%',
            maxWidth: 640,
            alignItems: 'center',
          }}
        >
          <div
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              background: 'rgba(255,255,255,0.06)',
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: 12,
              padding: '0 16px',
            }}
          >
            <FaSearch size={14} color="rgba(255,255,255,0.3)" />
            <input
              type="text"
              placeholder="Search Amazon products..."
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !isLoading && handleSearch()}
              style={{
                flex: 1,
                background: 'none',
                border: 'none',
                outline: 'none',
                color: '#fff',
                fontSize: 15,
                padding: '14px 12px',
                fontFamily: 'inherit',
              }}
            />
          </div>
          <select
            value={limit}
            onChange={(e) => setLimit(Number(e.target.value))}
            style={{
              background: 'rgba(255,255,255,0.06)',
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: 12,
              color: '#fff',
              fontSize: 14,
              padding: '14px 12px',
              cursor: 'pointer',
              outline: 'none',
              fontFamily: 'inherit',
            }}
          >
            {[10, 20, 50, 100].map((n) => (
              <option key={n} value={n} style={{ background: '#1a1a2e' }}>
                {n} results
              </option>
            ))}
          </select>
          <button
            onClick={handleSearch}
            disabled={isLoading || !keyword.trim()}
            style={{
              background: isLoading
                ? 'rgba(255,153,0,0.3)'
                : 'linear-gradient(135deg, #FF9900, #e68a00)',
              border: 'none',
              borderRadius: 12,
              color: '#fff',
              fontSize: 15,
              fontWeight: 600,
              padding: '14px 28px',
              cursor: isLoading || !keyword.trim() ? 'not-allowed' : 'pointer',
              opacity: !keyword.trim() ? 0.4 : 1,
              transition: 'all 0.2s',
              fontFamily: 'inherit',
              whiteSpace: 'nowrap',
            }}
          >
            {isLoading ? 'Searching...' : 'Search'}
          </button>
        </div>

        {/* Personalized suggestion chips */}
        {suggestionsLoading && suggestions.length === 0 && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              color: 'rgba(255,255,255,0.35)',
              fontSize: 13,
            }}
          >
            <div
              style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: '#FF9900',
                animation: 'pulse 1.5s ease-in-out infinite',
              }}
            />
            Finding personalized suggestions...
          </div>
        )}
        {/* Horizontal suggestion list — hidden once results are showing */}
        {suggestions.length > 0 && !(status === 'ready' && products.length > 0) && (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(2, 1fr)',
              gap: 12,
              width: '100%',
              maxWidth: 720,
            }}
          >
            {suggestions.map((s, idx) => {
              const isActive = activeSuggestion === s
              const isHighlighted = highlightedSuggestionIdx === idx
              const isSearching = isActive && isLoading
              return (
                <button
                  key={s}
                  onClick={() => {
                    if (!isLoading) {
                      setHighlightedSuggestionIdx(idx)
                      handleSuggestionClick(s)
                    }
                  }}
                  onMouseEnter={() => setHighlightedSuggestionIdx(idx)}
                  style={{
                    padding: '14px 20px',
                    borderRadius: 0,
                    border: isActive
                      ? '2px solid #FF9900'
                      : isHighlighted
                        ? '2px solid rgba(255,255,255,0.4)'
                        : '1px solid rgba(255,255,255,0.15)',
                    background: isActive
                      ? 'rgba(255,153,0,0.2)'
                      : isHighlighted
                        ? 'rgba(255,255,255,0.12)'
                        : 'rgba(255,255,255,0.05)',
                    color: isActive
                      ? '#FF9900'
                      : isHighlighted
                        ? '#fff'
                        : 'rgba(255,255,255,0.75)',
                    fontSize: 16,
                    fontWeight: isActive || isHighlighted ? 700 : 500,
                    cursor: isLoading ? 'not-allowed' : 'pointer',
                    transition: 'all 0.15s',
                    fontFamily: 'inherit',
                    textAlign: 'left',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    boxShadow: isActive
                      ? '0 0 20px rgba(255,153,0,0.25)'
                      : isHighlighted
                        ? '0 0 12px rgba(255,255,255,0.08)'
                        : 'none',
                  }}
                >
                  {isSearching ? (
                    <>
                      <div
                        style={{
                          display: 'inline-block',
                          width: 13,
                          height: 13,
                          marginRight: 12,
                          verticalAlign: -2,
                          border: '2px solid rgba(255,153,0,0.3)',
                          borderTop: '2px solid #FF9900',
                          borderRadius: '50%',
                          animation: 'spin 0.8s linear infinite',
                        }}
                      />
                      Searching...
                    </>
                  ) : (
                    <>
                      <FaSearch size={13} style={{ marginRight: 12, opacity: isHighlighted ? 0.8 : 0.5, verticalAlign: -1 }} />
                      {s}
                    </>
                  )}
                </button>
              )
            })}
          </div>
        )}

        {/* Status indicator */}
        {isLoading && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              color: 'rgba(255,255,255,0.5)',
              fontSize: 14,
            }}
          >
            <div
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: '#FF9900',
                animation: 'pulse 1.5s ease-in-out infinite',
              }}
            />
            {status === 'submitting' ? 'Starting scrape...' : 'Scraping in progress...'}
            {snapshotId && (
              <span style={{ color: 'rgba(255,255,255,0.25)', fontSize: 12 }}>
                {snapshotId}
              </span>
            )}
          </div>
        )}

        {status === 'error' && (
          <div
            style={{
              color: '#ff6b6b',
              fontSize: 14,
              background: 'rgba(255,107,107,0.1)',
              padding: '8px 16px',
              borderRadius: 8,
            }}
          >
            {errorMsg}
          </div>
        )}

        {status === 'ready' && products.length > 0 && (
          <p style={{ color: 'rgba(255,255,255,0.3)', fontSize: 13, margin: 0 }}>
            {products.length} products found — wink to browse, double-blink to email
          </p>
        )}
      </div>

      {/* Horizontal scrollable cards */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          overflow: 'hidden',
          position: 'relative',
        }}
      >
        {status === 'ready' && products.length === 0 && (
          <p style={{ color: 'rgba(255,255,255,0.4)', textAlign: 'center', width: '100%' }}>
            No products found.
          </p>
        )}

        {products.length > 0 && (() => {
          // Build visible card set (7 positions: ±3 are invisible staging areas).
          // Iterate center-outward so each product gets its closest-to-center slot.
          const seen = new Set<number>()
          const cards = [0, -1, 1, -2, 2, -3, 3]
            .map((offset) => {
              const idx = ((centerIdx + offset) % products.length + products.length) % products.length
              if (seen.has(idx)) return null
              seen.add(idx)
              return { offset, idx, product: products[idx] }
            })
            .filter(Boolean) as { offset: number; idx: number; product: AmazonProduct }[]

          // Sort by product index so React never reorders DOM nodes mid-transition
          cards.sort((a, b) => a.idx - b.idx)

          // All cards share one base size — sizing is done purely via transform: scale()
          // which is GPU-composited and avoids layout reflows.
          const scaleFor = (o: number) => ({ 0: 1, 1: 0.68, 2: 0.52, 3: 0.4 }[Math.abs(o)] ?? 0.4)
          const xFor = (o: number) => {
            const sign = o < 0 ? -1 : 1
            return ({ 0: 0, 1: 340, 2: 570, 3: 750 }[Math.abs(o)] ?? 750) * sign
          }

          return (
            <div style={{ position: 'relative', width: '100%', height: '100%' }}>
              {cards.map(({ offset, idx, product }) => {
                const absOffset = Math.abs(offset)
                const isCenter = offset === 0
                const isStaging = absOffset === 3
                const isSelected = idx === selectedOrigIdx
                const cardOpacity = isStaging ? 0 : isSelected || isCenter ? 1 : absOffset === 1 ? 0.7 : 0.4

                return (
                  <a
                    key={idx}
                    href={product.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      position: 'absolute',
                      left: '50%',
                      top: '50%',
                      width: 400,
                      height: 520,
                      transform: `translate(calc(-50% + ${xFor(offset)}px), -50%) scale(${scaleFor(offset)})`,
                      willChange: 'transform, opacity',
                      borderRadius: 24,
                      background: isSelected
                        ? 'rgba(255, 50, 50, 0.15)'
                        : isCenter
                          ? 'rgba(255,255,255,0.1)'
                          : 'rgba(255,255,255,0.05)',
                      border: isSelected
                        ? '2px solid rgba(255, 60, 60, 0.8)'
                        : isCenter
                          ? '1px solid rgba(255,255,255,0.25)'
                          : '1px solid rgba(255,255,255,0.08)',
                      boxShadow: isSelected
                        ? '0 0 50px rgba(255, 50, 50, 0.5), 0 0 100px rgba(255, 50, 50, 0.2)'
                        : isCenter
                          ? '0 16px 48px -8px rgba(255,153,0,0.3), 0 0 0 1px rgba(255,153,0,0.15)'
                          : 'none',
                      opacity: cardOpacity,
                      display: 'flex',
                      flexDirection: 'column',
                      textDecoration: 'none',
                      transition: 'transform 0.5s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.5s cubic-bezier(0.4, 0, 0.2, 1), box-shadow 0.4s ease, border-color 0.4s ease, background 0.4s ease',
                      cursor: isStaging ? 'default' : 'pointer',
                      overflow: 'hidden',
                      pointerEvents: isStaging ? 'none' : 'auto',
                      zIndex: isSelected ? 4 : isCenter ? 3 : absOffset === 1 ? 2 : 1,
                    }}
                  >
                    {/* Product image */}
                    {(product.image_url || product.image) && (
                      <div
                        style={{
                          height: 260,
                          background: '#fff',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          padding: 20,
                          position: 'relative',
                        }}
                      >
                        <img
                          src={product.image_url || product.image}
                          alt={product.title}
                          style={{ maxHeight: '100%', maxWidth: '100%', objectFit: 'contain' }}
                        />
                        {product.badge && (
                          <span
                            style={{
                              position: 'absolute',
                              top: 10,
                              left: 10,
                              background: 'linear-gradient(135deg, #232F3E, #37475A)',
                              color: '#FF9900',
                              fontSize: 10,
                              fontWeight: 600,
                              padding: '3px 8px',
                              borderRadius: 5,
                            }}
                          >
                            {product.badge}
                          </span>
                        )}
                      </div>
                    )}

                    {/* Product info */}
                    <div
                      style={{
                        flex: 1,
                        padding: '16px 20px 20px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 8,
                      }}
                    >
                      <div
                        style={{
                          color: '#fff',
                          fontSize: 15,
                          fontWeight: 500,
                          lineHeight: 1.4,
                          display: '-webkit-box',
                          WebkitLineClamp: 3,
                          WebkitBoxOrient: 'vertical',
                          overflow: 'hidden',
                        }}
                      >
                        {product.title}
                      </div>

                      {product.brand && (
                        <div style={{ color: 'rgba(255,255,255,0.35)', fontSize: 12 }}>
                          {product.brand}
                        </div>
                      )}

                      {product.rating != null && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          <StarRating rating={product.rating} />
                          <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: 13 }}>
                            {product.rating}
                          </span>
                          {product.reviews_count != null && (
                            <span style={{ color: 'rgba(255,255,255,0.25)', fontSize: 12 }}>
                              ({product.reviews_count.toLocaleString()})
                            </span>
                          )}
                        </div>
                      )}

                      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginTop: 'auto' }}>
                        {product.final_price != null && (
                          <span style={{ color: '#fff', fontSize: 24, fontWeight: 700 }}>
                            ${product.final_price.toFixed(2)}
                          </span>
                        )}
                        {product.initial_price != null &&
                          product.final_price != null &&
                          product.initial_price > product.final_price && (
                            <span
                              style={{
                                color: 'rgba(255,255,255,0.3)',
                                fontSize: 14,
                                textDecoration: 'line-through',
                              }}
                            >
                              ${product.initial_price.toFixed(2)}
                            </span>
                          )}
                      </div>

                      {product.bought_past_month != null && product.bought_past_month > 0 && (
                        <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: 11 }}>
                          {product.bought_past_month.toLocaleString()}+ bought last month
                        </div>
                      )}
                    </div>
                  </a>
                )
              })}
            </div>
          )
        })()}
      </div>

      {/* Webcam preview */}
      <div
        style={{
          position: 'fixed',
          bottom: 20,
          right: 20,
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

      {/* Selected indicator + email status */}
      {(selectedOrigIdx !== null || emailStatus !== 'idle') && (
        <div
          style={{
            position: 'fixed',
            bottom: 20,
            left: 20,
            background: 'rgba(255, 50, 50, 0.15)',
            border: '1px solid rgba(255, 60, 60, 0.4)',
            borderRadius: 10,
            padding: '8px 16px',
            color: '#ff6b6b',
            fontSize: 13,
            fontWeight: 500,
            zIndex: 10,
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
            maxWidth: 360,
          }}
        >
          {selectedOrigIdx !== null && (
            <div>Selected: {products[selectedOrigIdx]?.title?.slice(0, 40)}...</div>
          )}
          {emailStatus === 'sending' && (
            <div style={{ color: '#fbbf24', fontSize: 12 }}>Sending email...</div>
          )}
          {emailStatus === 'sent' && (
            <div style={{ color: '#4ade80', fontSize: 12 }}>Email sent!</div>
          )}
          {emailStatus === 'error' && (
            <div style={{ color: '#ff6b6b', fontSize: 12 }}>Email failed to send</div>
          )}
        </div>
      )}

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
        div::-webkit-scrollbar {
          display: none;
        }
      `}</style>
    </div>
  )
}
