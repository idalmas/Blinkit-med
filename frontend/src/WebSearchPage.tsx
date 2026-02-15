/**
 * WebSearchPage — Personalized web search experience with blink navigation.
 *
 * On mount, calls POST /getContext with app "Web Search" to retrieve
 * 20 personalized search queries generated from stored user context.
 * Those suggestions are shown as clickable chips and can kick off SERP
 * searches immediately.
 *
 * Data flow:
 *   1) Page load -> POST /getContext { app: "Web Search", person } -> suggestions
 *   2) User chooses suggestion (or types manually) -> POST /apps/web-search
 *   3) Poll GET /apps/web-search-status/:id until ready
 *   4) Render results in carousel; blink controls navigate/open results
 *
 * Parent: mounted by src/main.tsx at /apps/web-search
 * Child/related systems:
 *   - useBlinkDetection: drives wink/double/triple/long-close behavior
 *   - Backend routes: /getContext, /apps/web-search, /apps/web-search-status/:id
 *
 * CSS/styling notes:
 *   - Results use layered depth (scale + translate + opacity) for carousel focus.
 *   - Suggestion chips use stronger border/contrast when active or highlighted.
 */
import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import Webcam from 'react-webcam'
import { FaSearch, FaArrowLeft, FaGlobe, FaExternalLinkAlt } from 'react-icons/fa'
import { useBlinkDetection, type BlinkType } from './useBlinkDetection'

const API_BASE = (import.meta.env.VITE_API_BASE ?? 'http://localhost:3001').trim()
const POLL_INTERVAL = 3000
const PERSON = (import.meta.env.VITE_PERSON ?? 'ian').trim().toLowerCase()

interface SearchResult {
  title?: string
  url?: string
  description?: string
  displayed_url?: string
  position?: number
  rawHtml?: string
  error?: string
  // BrightData SERP may also return these
  snippet?: string
  link?: string
  global_rank?: number
  domain?: string
}

type SearchStatus = 'idle' | 'submitting' | 'polling' | 'ready' | 'error'

/**
 * parseResponseBody — safely parses fetch response as JSON or plain text.
 *
 * @param res Fetch response object.
 * @returns Parsed payload (object if JSON, string otherwise, null on empty body).
 */
async function parseResponseBody(res: Response): Promise<unknown> {
  const text = await res.text()
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

/**
 * parseSuggestionArray — extracts a string[] from getContext response payload.
 *
 * Tries `result` first, then falls back to parsing `rawResult` if needed.
 *
 * @param payload Raw JSON payload from /getContext.
 * @returns A cleaned array of non-empty suggestion strings.
 */
function parseSuggestionArray(payload: unknown): string[] {
  if (!payload || typeof payload !== 'object') return []
  const obj = payload as Record<string, unknown>

  const fromResult = Array.isArray(obj.result)
    ? obj.result.filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
    : []
  if (fromResult.length > 0) return fromResult

  if (typeof obj.rawResult === 'string') {
    const raw = obj.rawResult.trim()
    const match = raw.match(/\[[\s\S]*\]/)
    if (match) {
      try {
        const parsed = JSON.parse(match[0])
        if (Array.isArray(parsed)) {
          return parsed.filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
        }
      } catch {
        // Ignore parse errors and return empty fallback.
      }
    }
  }

  return []
}

/**
 * normalizeResults — safely coerces BrightData SERP response into a results array.
 *
 * @param raw The raw API payload.
 * @returns A normalized array of search-result objects.
 */
function normalizeResults(raw: unknown): SearchResult[] {
  if (Array.isArray(raw)) return raw
  if (raw && typeof raw === 'object') {
    const obj = raw as Record<string, unknown>
    for (const key of ['organic', 'results', 'organic_results', 'data', 'items']) {
      if (Array.isArray(obj[key])) return obj[key] as SearchResult[]
    }
    return [raw as SearchResult]
  }
  return []
}

/**
 * getDomain — extracts a display-friendly hostname from a URL.
 *
 * @param url A raw URL string.
 * @returns Hostname without a leading www, or the original input on parse failure.
 */
function getDomain(url: string): string {
  try {
    const u = new URL(url)
    return u.hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

/**
 * getFaviconUrl — builds a favicon endpoint URL for a given page URL.
 *
 * @param url A raw URL string.
 * @returns Favicon URL string (or empty string if URL parsing fails).
 */
function getFaviconUrl(url: string): string {
  try {
    const u = new URL(url)
    return `https://www.google.com/s2/favicons?domain=${u.hostname}&sz=32`
  } catch {
    return ''
  }
}

export default function WebSearchPage() {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<SearchStatus>('idle')
  const [requestId, setRequestId] = useState<string | null>(null)
  const [results, setResults] = useState<SearchResult[]>([])
  const [errorMsg, setErrorMsg] = useState('')
  const [pollCount, setPollCount] = useState(0)
  const [elapsedSec, setElapsedSec] = useState(0)
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [suggestionsLoading, setSuggestionsLoading] = useState(true)
  const [activeSuggestion, setActiveSuggestion] = useState<string | null>(null)
  const [suggestionsError, setSuggestionsError] = useState<string | null>(null)
  const [highlightedSuggestionIdx, setHighlightedSuggestionIdx] = useState(0)
  const highlightedSuggestionIdxRef = useRef(0)
  const suggestionClickRef = useRef<(s: string) => void>(() => {})
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const failCountRef = useRef(0)
  const MAX_POLL_FAILURES = 5

  // Cache
  const cacheRef = useRef<Map<string, SearchResult[]>>(new Map())
  const lastSearchKeyRef = useRef('')

  useEffect(() => {
    try {
      const stored = localStorage.getItem('revive-websearch-cache')
      if (stored) {
        const entries = JSON.parse(stored) as [string, SearchResult[]][]
        cacheRef.current = new Map(entries)
        console.log(`[web-search-cache] Loaded ${entries.length} cached searches`)
      }
    } catch { /* ignore */ }
  }, [])

  const saveToCache = useCallback((key: string, data: SearchResult[]) => {
    cacheRef.current.set(key, data)
    if (cacheRef.current.size > 50) {
      const first = cacheRef.current.keys().next().value
      if (first !== undefined) cacheRef.current.delete(first)
    }
    try {
      localStorage.setItem('revive-websearch-cache', JSON.stringify([...cacheRef.current.entries()]))
    } catch { /* storage full */ }
  }, [])

  // Carousel state
  const [centerIdx, setCenterIdx] = useState(0)
  const [selectedOrigIdx, setSelectedOrigIdx] = useState<number | null>(null)

  // Modal state for in-page iframe preview
  const [modalUrl, setModalUrl] = useState<string | null>(null)
  const [modalTitle, setModalTitle] = useState('')
  const [modalLoading, setModalLoading] = useState(false)
  const [modalError, setModalError] = useState<string | null>(null)
  const iframeRef = useRef<HTMLIFrameElement>(null)

  /**
   * openModal — opens the selected result in the in-page iframe modal.
   *
   * @param result The selected search result.
   * @returns void
   */
  const openModal = useCallback((result: SearchResult) => {
    const resultUrl = result.url || result.link
    if (!resultUrl) return
    console.log('[web-search] Opening in modal:', resultUrl)
    setModalLoading(true)
    setModalError(null)
    setModalUrl(resultUrl)
    setModalTitle(result.title || 'Web Result')
  }, [])

  /**
   * closeModal — closes the in-page iframe modal and clears selection state.
   *
   * @returns void
   */
  const closeModal = useCallback(() => {
    console.log('[web-search] Closing modal')
    setModalUrl(null)
    setModalTitle('')
    setModalLoading(false)
    setModalError(null)
    setSelectedOrigIdx(null)
  }, [])

  /**
   * modalLoadTimeout — prevents indefinite white iframe by surfacing timeout state.
   *
   * @returns void
   */
  useEffect(() => {
    if (!modalUrl) return
    setModalLoading(true)
    setModalError(null)
    const timer = setTimeout(() => {
      setModalLoading(false)
      setModalError('Preview timed out. Open in a new tab for this site.')
    }, 12000)
    return () => clearTimeout(timer)
  }, [modalUrl])

  // Auto-scroll the iframe every 2 seconds while modal is open
  const scrollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (modalUrl) {
      scrollIntervalRef.current = setInterval(() => {
        iframeRef.current?.contentWindow?.postMessage({ type: 'scroll', amount: 400 }, '*')
      }, 2000)
    } else {
      if (scrollIntervalRef.current) {
        clearInterval(scrollIntervalRef.current)
        scrollIntervalRef.current = null
      }
    }
    return () => {
      if (scrollIntervalRef.current) {
        clearInterval(scrollIntervalRef.current)
        scrollIntervalRef.current = null
      }
    }
  }, [modalUrl])

  const handleBlink = useCallback(
    (type: BlinkType) => {
      if (type === 'long-close') {
        navigate('/apps')
        return
      }
      const suggestionsVisible = suggestions.length > 0 && !(status === 'ready' && results.length > 0)

      // Suggestion navigation mode (mirrors Amazon flow)
      if (suggestionsVisible && results.length === 0) {
        if (type === 'wink-right') {
          setHighlightedSuggestionIdx((prev) => Math.min(prev + 1, suggestions.length - 1))
        } else if (type === 'wink-left') {
          setHighlightedSuggestionIdx((prev) => Math.max(prev - 1, 0))
        } else if (type === 'triple') {
          const idx = highlightedSuggestionIdxRef.current
          if (idx >= 0 && idx < suggestions.length) {
            suggestionClickRef.current(suggestions[idx])
          }
        }
        return
      }

      if (type === 'triple') {
        if (modalUrl) {
          closeModal()
          return
        }
      }
      if (results.length === 0) return
      if (type === 'double') {
        if (modalUrl) return
        const result = results[centerIdx]
        setSelectedOrigIdx(centerIdx)
        openModal(result)
      } else if (type === 'wink-left') {
        if (modalUrl) {
          // Scroll up in the iframe
          iframeRef.current?.contentWindow?.postMessage({ type: 'scroll', amount: -400 }, '*')
        } else {
          setCenterIdx((prev) => ((prev - 1) + results.length) % results.length)
        }
      } else if (type === 'wink-right') {
        if (modalUrl) {
          // Scroll down in the iframe
          iframeRef.current?.contentWindow?.postMessage({ type: 'scroll', amount: 400 }, '*')
        } else {
          setCenterIdx((prev) => (prev + 1) % results.length)
        }
      }
    },
    [centerIdx, results, modalUrl, openModal, closeModal, navigate, suggestions, status]
  )

  const { webcamRef, status: blinkStatus } = useBlinkDetection({ onBlink: handleBlink })

  // Close modal on Escape key
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && modalUrl) closeModal()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [modalUrl, closeModal])

  /**
   * stopPolling — stops the status polling interval and resets poll failure tracking.
   *
   * @returns void
   */
  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
    failCountRef.current = 0
  }, [])

  useEffect(() => () => stopPolling(), [stopPolling])

  /**
   * pollForResults — polls backend status until web search results are ready or failed.
   *
   * @param rid Backend request id returned by /apps/web-search.
   * @returns void
   */
  const pollForResults = useCallback(
    (rid: string) => {
      setStatus('polling')
      failCountRef.current = 0
      setPollCount(0)
      pollRef.current = setInterval(async () => {
        try {
          setPollCount((prev) => prev + 1)
          console.log(`[web-search-poll] Checking status for ${rid} (failures: ${failCountRef.current})`)
          const res = await fetch(`${API_BASE}/apps/web-search-status/${rid}`)

          if (!res.ok) {
            const errorText = await res.text()
            console.warn(`[web-search-poll] Non-OK response: ${res.status}`, errorText)
            failCountRef.current++
            if (failCountRef.current >= MAX_POLL_FAILURES) {
              console.error(`[web-search-poll] Giving up after ${MAX_POLL_FAILURES} failures`)
              stopPolling()
              setErrorMsg(`Status check failed after ${MAX_POLL_FAILURES} attempts.`)
              setStatus('error')
            }
            return
          }

          failCountRef.current = 0
          const data = await res.json()
          console.log(`[web-search-poll] Response:`, data.status, data)

          if (data.elapsed) setElapsedSec(data.elapsed)

          if (data.status === 'ready') {
            const allResults = normalizeResults(data.data)
            const validResults = allResults.filter((r) => (r.title || r.rawHtml) && !r.error)
            console.log(`[web-search-poll] Ready! ${validResults.length} valid results (${allResults.length} total)`)
            stopPolling()
            setResults(validResults)
            if (validResults.length > 0) {
              saveToCache(lastSearchKeyRef.current, validResults)
            }
            setStatus('ready')
          } else if (data.status === 'failed') {
            console.error(`[web-search-poll] Search failed:`, data)
            stopPolling()
            setErrorMsg(data.error || 'SERP request failed.')
            setStatus('error')
          }
        } catch (err) {
          console.error(`[web-search-poll] Fetch error:`, err)
          failCountRef.current++
          if (failCountRef.current >= MAX_POLL_FAILURES) {
            console.error(`[web-search-poll] Giving up after ${MAX_POLL_FAILURES} failures`)
            stopPolling()
            setErrorMsg(`Status check failed after ${MAX_POLL_FAILURES} attempts.`)
            setStatus('error')
          }
        }
      }, POLL_INTERVAL)
    },
    [stopPolling, saveToCache]
  )

  /**
   * runSearch — runs a web search lifecycle for a given query string.
   *
   * Checks cache first, then starts a backend search request and begins polling.
   *
   * @param rawQuery Search query string to run.
   * @returns void
   */
  const runSearch = useCallback(async (rawQuery: string) => {
    const normalizedQuery = rawQuery.trim()
    if (!normalizedQuery) return

    const cacheKey = normalizedQuery.toLowerCase()
    const cached = cacheRef.current.get(cacheKey)
    if (cached && cached.length > 0) {
      console.log(`[web-search-cache] Hit for "${cacheKey}" — ${cached.length} results`)
      setResults(cached)
      setStatus('ready')
      setErrorMsg('')
      return
    }

    lastSearchKeyRef.current = cacheKey
    stopPolling()
    setResults([])
    setErrorMsg('')
    setElapsedSec(0)
    setPollCount(0)
    setStatus('submitting')

    try {
      console.log(`[web-search] Starting search: query="${normalizedQuery}"`)
      const res = await fetch(`${API_BASE}/apps/web-search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: normalizedQuery }),
      })

      const data = await parseResponseBody(res)
      console.log(`[web-search] Response (${res.status}):`, data)

      if (!res.ok && res.status !== 202) {
        console.error(`[web-search] Request failed:`, data)
        const errorText =
          data && typeof data === 'object' && 'error' in (data as Record<string, unknown>)
            ? String((data as Record<string, unknown>).error)
            : typeof data === 'string'
              ? data
              : 'Request failed.'

        if (res.status === 404) {
          setErrorMsg(
            `Web Search route not found on backend (${API_BASE}/apps/web-search). Restart backend with latest code.`
          )
        } else {
          setErrorMsg(errorText)
        }
        setStatus('error')
        return
      }

      const requestId =
        data && typeof data === 'object' && 'request_id' in (data as Record<string, unknown>)
          ? String((data as Record<string, unknown>).request_id)
          : null

      if (requestId) {
        console.log(`[web-search] Got request_id: ${requestId}, starting polling...`)
        setRequestId(requestId)
        pollForResults(requestId)
      } else {
        setErrorMsg('No request_id returned.')
        setStatus('error')
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to start search.'
      setErrorMsg(message)
      setStatus('error')
    }
  }, [pollForResults, stopPolling])

  /**
   * handleSearch — triggers a search from the text input value.
   *
   * @returns void
   */
  const handleSearch = useCallback(async () => {
    setActiveSuggestion(null)
    await runSearch(query)
  }, [query, runSearch])

  /**
   * handleSuggestionClick — triggers search from a personalized suggestion chip.
   *
   * @param suggestion Suggested query string from getContext.
   * @returns void
   */
  const handleSuggestionClick = useCallback(async (suggestion: string) => {
    setQuery(suggestion)
    setActiveSuggestion(suggestion)
    await runSearch(suggestion)
  }, [runSearch])

  /**
   * keepSuggestionRefsInSync — keeps refs synchronized for blink handlers.
   *
   * @returns void
   */
  useEffect(() => {
    suggestionClickRef.current = (s: string) => { void handleSuggestionClick(s) }
  }, [handleSuggestionClick])

  /**
   * keepHighlightedSuggestionRefInSync — mirrors highlighted index for callback reads.
   *
   * @returns void
   */
  useEffect(() => {
    highlightedSuggestionIdxRef.current = highlightedSuggestionIdx
  }, [highlightedSuggestionIdx])

  /**
   * fetchSuggestionsOnMount — loads personalized query suggestions from getContext.
   *
   * Uses the "Web Search" app config so prompt generation follows backend APP_CONFIGS.
   *
   * @returns void
   */
  useEffect(() => {
    let cancelled = false
    /**
     * fetchSuggestionsForApp — requests personalized suggestions for a specific app key.
     *
     * @param appName The app name sent to /getContext.
     * @returns Response status, parsed payload, and normalized suggestion items.
     */
    async function fetchSuggestionsForApp(appName: string): Promise<{
      status: number
      payload: unknown
      items: string[]
    }> {
      const res = await fetch(`${API_BASE}/getContext`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ app: appName, person: PERSON, k: 10 }),
      })
      let payload: unknown = null
      try {
        payload = await res.json()
      } catch {
        payload = null
      }
      return {
        status: res.status,
        payload,
        items: parseSuggestionArray(payload),
      }
    }

    async function fetchSuggestionsOnMount() {
      setSuggestionsLoading(true)
      setSuggestionsError(null)
      try {
        console.log('[getContext] Fetching personalized web search suggestions...')
        // Backward-compatible candidates:
        // - "Web Search": newest backend config
        // - "websearch": alternate key
        // - "Amazon": older backend that only supports Amazon
        const appCandidates = ['Web Search', 'websearch', 'Amazon']
        let lastStatus = 0

        for (const candidate of appCandidates) {
          const { status, payload, items } = await fetchSuggestionsForApp(candidate)
          lastStatus = status

          if (status >= 200 && status < 300 && items.length > 0) {
            if (!cancelled) {
              console.log(
                `[getContext] Got ${items.length} suggestions using app="${candidate}":`,
                items
              )
              setSuggestions(items.slice(0, 20))
            }
            return
          }

          console.warn(
            `[getContext] Suggestions request failed for app="${candidate}" (HTTP ${status})`,
            payload
          )
        }

        if (!cancelled) {
          setSuggestionsError(`Could not load suggestions (HTTP ${lastStatus || 400}).`)
        }
      } catch (err) {
        console.error('[getContext] Error:', err)
        if (!cancelled) {
          setSuggestionsError(
            `Could not reach ${API_BASE}. Check backend is running and VITE_API_BASE is correct.`
          )
        }
      } finally {
        if (!cancelled) setSuggestionsLoading(false)
      }
    }
    fetchSuggestionsOnMount()
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    setCenterIdx(0)
    setSelectedOrigIdx(null)
  }, [results])

  /**
   * resetSuggestionHighlightOnNewSuggestions — resets highlight to the first chip.
   *
   * @returns void
   */
  useEffect(() => {
    setHighlightedSuggestionIdx(0)
  }, [suggestions])

  const isLoading = status === 'submitting' || status === 'polling'

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'linear-gradient(160deg, #0a0a0a 0%, #0f172a 50%, #0a0a0a 100%)',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '72px 32px 0',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 20,
          flexShrink: 0,
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
              background: 'linear-gradient(135deg, #4285F4, #EA4335, #FBBC05, #34A853)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 8px 24px rgba(66,133,244,0.3)',
            }}
          >
            <FaSearch size={22} color="#fff" />
          </div>
          <h1 style={{ color: '#fff', fontSize: 28, fontWeight: 700, margin: 0 }}>
            Web Search
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
              placeholder="Search the web..."
              value={query}
              onChange={(e) => {
                setQuery(e.target.value)
                setActiveSuggestion(null)
              }}
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
          <button
            onClick={handleSearch}
            disabled={isLoading || !query.trim()}
            style={{
              background: isLoading
                ? 'rgba(66,133,244,0.3)'
                : 'linear-gradient(135deg, #4285F4, #3367D6)',
              border: 'none',
              borderRadius: 12,
              color: '#fff',
              fontSize: 15,
              fontWeight: 600,
              padding: '14px 28px',
              cursor: isLoading || !query.trim() ? 'not-allowed' : 'pointer',
              opacity: !query.trim() ? 0.4 : 1,
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
                background: '#4285F4',
                animation: 'pulse 1.5s ease-in-out infinite',
              }}
            />
            Finding personalized search ideas...
          </div>
        )}
        {!suggestionsLoading && suggestions.length === 0 && suggestionsError && (
          <div
            style={{
              color: 'rgba(255, 165, 165, 0.9)',
              fontSize: 13,
              background: 'rgba(255, 107, 107, 0.12)',
              border: '1px solid rgba(255, 107, 107, 0.25)',
              padding: '8px 12px',
              borderRadius: 8,
            }}
          >
            {suggestionsError}
          </div>
        )}
        {suggestions.length > 0 && !(status === 'ready' && results.length > 0) && (
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
              return (
                <button
                  key={s}
                  onClick={() => {
                    if (!isLoading) void handleSuggestionClick(s)
                  }}
                  onMouseEnter={() => setHighlightedSuggestionIdx(idx)}
                  style={{
                    padding: '14px 20px',
                    borderRadius: 0,
                    border: isActive
                      ? '2px solid #4285F4'
                      : isHighlighted
                        ? '2px solid rgba(255,255,255,0.45)'
                      : '1px solid rgba(255,255,255,0.15)',
                    background: isActive
                      ? 'rgba(66,133,244,0.2)'
                      : isHighlighted
                        ? 'rgba(255,255,255,0.12)'
                      : 'rgba(255,255,255,0.05)',
                    color: isActive
                      ? '#8AB4F8'
                      : isHighlighted
                        ? '#fff'
                      : 'rgba(255,255,255,0.78)',
                    fontSize: 15,
                    fontWeight: isActive || isHighlighted ? 700 : 500,
                    cursor: isLoading ? 'not-allowed' : 'pointer',
                    transition: 'all 0.15s',
                    fontFamily: 'inherit',
                    textAlign: 'left',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    boxShadow: isActive
                      ? '0 0 20px rgba(66,133,244,0.25)'
                      : isHighlighted
                        ? '0 0 12px rgba(255,255,255,0.08)'
                        : 'none',
                  }}
                >
                  {s}
                </button>
              )
            })}
          </div>
        )}
        {suggestions.length > 0 && !(status === 'ready' && results.length > 0) && (
          <p style={{ color: 'rgba(255,255,255,0.28)', fontSize: 12, margin: 0 }}>
            Wink left/right to pick a suggestion, then triple blink to search
          </p>
        )}

        {/* Status / polling indicator */}
        {isLoading && (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 6,
              color: 'rgba(255,255,255,0.5)',
              fontSize: 14,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: '#4285F4',
                  animation: 'pulse 1.5s ease-in-out infinite',
                }}
              />
              {status === 'submitting' ? 'Starting SERP request...' : `Polling for results... (poll #${pollCount})`}
            </div>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.25)' }}>
              {requestId && <span>ID: {requestId.slice(0, 8)}... </span>}
              {elapsedSec > 0 && <span>({elapsedSec}s elapsed)</span>}
            </div>
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

        {status === 'ready' && results.length > 0 && (
          <p style={{ color: 'rgba(255,255,255,0.3)', fontSize: 13, margin: 0 }}>
            {results.length} results found — wink to browse, double-blink to open
          </p>
        )}
      </div>

      {/* Carousel area */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          overflow: 'hidden',
          position: 'relative',
        }}
      >
        {status === 'ready' && results.length === 0 && (
          <p style={{ color: 'rgba(255,255,255,0.4)', textAlign: 'center', width: '100%' }}>
            No results found.
          </p>
        )}

        {results.length > 0 && (() => {
          const seen = new Set<number>()
          const cards = [0, -1, 1, -2, 2, -3, 3]
            .map((offset) => {
              const idx = ((centerIdx + offset) % results.length + results.length) % results.length
              if (seen.has(idx)) return null
              seen.add(idx)
              return { offset, idx, result: results[idx] }
            })
            .filter(Boolean) as { offset: number; idx: number; result: SearchResult }[]

          cards.sort((a, b) => a.idx - b.idx)

          const scaleFor = (o: number) => ({ 0: 1, 1: 0.62, 2: 0.46, 3: 0.35 }[Math.abs(o)] ?? 0.35)
          const xFor = (o: number) => {
            const sign = o < 0 ? -1 : 1
            return ({ 0: 0, 1: 420, 2: 660, 3: 840 }[Math.abs(o)] ?? 840) * sign
          }

          return (
            <div style={{ position: 'relative', width: '100%', height: '100%' }}>
              {cards.map(({ offset, idx, result }) => {
                const absOffset = Math.abs(offset)
                const isCenter = offset === 0
                const isStaging = absOffset === 3
                const isSelected = idx === selectedOrigIdx
                const cardOpacity = isStaging ? 0 : isSelected || isCenter ? 1 : absOffset === 1 ? 0.7 : 0.4
                const resultUrl = result.url || result.link || ''
                const snippet = result.description || result.snippet || ''

                return (
                  <a
                    key={idx}
                    href={resultUrl || undefined}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      position: 'absolute',
                      left: '50%',
                      top: '50%',
                      width: 400,
                      height: 340,
                      transform: `translate(calc(-50% + ${xFor(offset)}px), -50%) scale(${scaleFor(offset)})`,
                      willChange: 'transform, opacity',
                      borderRadius: 24,
                      background: isSelected
                        ? 'rgba(66, 133, 244, 0.2)'
                        : isCenter
                          ? 'rgba(255,255,255,0.08)'
                          : 'rgba(255,255,255,0.04)',
                      border: isSelected
                        ? '2px solid rgba(66, 133, 244, 0.8)'
                        : isCenter
                          ? '1px solid rgba(255,255,255,0.2)'
                          : '1px solid rgba(255,255,255,0.06)',
                      boxShadow: isSelected
                        ? '0 0 50px rgba(66, 133, 244, 0.5), 0 0 100px rgba(66, 133, 244, 0.2)'
                        : isCenter
                          ? '0 16px 48px -8px rgba(66,133,244,0.25), 0 0 0 1px rgba(66,133,244,0.1)'
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
                      padding: '28px 28px 24px',
                    }}
                  >
                    {/* Position badge */}
                    <div
                      style={{
                        position: 'absolute',
                        top: 16,
                        right: 16,
                        width: 32,
                        height: 32,
                        borderRadius: 10,
                        background: 'rgba(66,133,244,0.15)',
                        border: '1px solid rgba(66,133,244,0.3)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: '#4285F4',
                        fontSize: 13,
                        fontWeight: 700,
                      }}
                    >
                      {result.position ?? idx + 1}
                    </div>

                    {/* Domain + Favicon */}
                    {resultUrl && (
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          marginBottom: 12,
                        }}
                      >
                        <img
                          src={getFaviconUrl(resultUrl)}
                          alt=""
                          style={{ width: 16, height: 16, borderRadius: 3 }}
                          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                        />
                        <span
                          style={{
                            color: '#34A853',
                            fontSize: 13,
                            maxWidth: 300,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {getDomain(resultUrl)}
                        </span>
                        <FaExternalLinkAlt size={10} color="rgba(255,255,255,0.2)" />
                      </div>
                    )}

                    {/* Title */}
                    <div
                      style={{
                        color: isCenter ? '#8AB4F8' : '#7aa2db',
                        fontSize: 19,
                        fontWeight: 600,
                        lineHeight: 1.35,
                        display: '-webkit-box',
                        WebkitLineClamp: 3,
                        WebkitBoxOrient: 'vertical',
                        overflow: 'hidden',
                        marginBottom: 12,
                      }}
                    >
                      {result.title || 'Untitled'}
                    </div>

                    {/* Full URL */}
                    {resultUrl && (
                      <div
                        style={{
                          color: 'rgba(255,255,255,0.25)',
                          fontSize: 12,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          marginBottom: 12,
                          maxWidth: '100%',
                        }}
                      >
                        {resultUrl}
                      </div>
                    )}

                    {/* Snippet */}
                    {snippet && (
                      <div
                        style={{
                          color: 'rgba(255,255,255,0.55)',
                          fontSize: 14,
                          lineHeight: 1.6,
                          display: '-webkit-box',
                          WebkitLineClamp: 4,
                          WebkitBoxOrient: 'vertical',
                          overflow: 'hidden',
                          flex: 1,
                        }}
                      >
                        {snippet}
                      </div>
                    )}

                    {/* Bottom row: rank / domain info */}
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        marginTop: 'auto',
                        paddingTop: 12,
                        borderTop: '1px solid rgba(255,255,255,0.06)',
                      }}
                    >
                      <FaGlobe size={12} color="rgba(255,255,255,0.2)" />
                      <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: 12 }}>
                        Result #{result.position ?? idx + 1}
                        {result.global_rank ? ` • Rank: ${result.global_rank.toLocaleString()}` : ''}
                      </span>
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

      {/* Modal overlay with iframe */}
      {modalUrl && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 50,
            display: 'flex',
            flexDirection: 'column',
            background: 'rgba(0, 0, 0, 0.85)',
            animation: 'modalIn 0.3s ease-out',
          }}
        >
          {/* Modal header */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '12px 20px',
              background: 'rgba(15, 23, 42, 0.95)',
              borderBottom: '1px solid rgba(255,255,255,0.1)',
              flexShrink: 0,
            }}
          >
            <FaGlobe size={14} color="#4285F4" />
            <span
              style={{
                color: '#8AB4F8',
                fontSize: 14,
                fontWeight: 600,
                flex: 1,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {modalTitle}
            </span>
            <span
              style={{
                color: 'rgba(255,255,255,0.3)',
                fontSize: 12,
                maxWidth: 400,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {modalUrl}
            </span>
            <span
              style={{
                color: 'rgba(255,255,255,0.3)',
                fontSize: 11,
                marginLeft: 8,
              }}
            >
              Triple-blink or press Esc to close
            </span>
            <button
              onClick={closeModal}
              style={{
                background: 'rgba(255,255,255,0.08)',
                border: '1px solid rgba(255,255,255,0.15)',
                borderRadius: 8,
                color: 'rgba(255,255,255,0.7)',
                padding: '6px 14px',
                cursor: 'pointer',
                fontSize: 13,
                fontFamily: 'inherit',
                transition: 'all 0.2s',
                marginLeft: 8,
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'rgba(255,255,255,0.15)'
                e.currentTarget.style.color = '#fff'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'rgba(255,255,255,0.08)'
                e.currentTarget.style.color = 'rgba(255,255,255,0.7)'
              }}
            >
              Close
            </button>
          </div>

          {/* Iframe — loaded via backend proxy so it's same-origin (scrollBy works) */}
          <iframe
            ref={iframeRef}
            src={`${API_BASE}/apps/web-proxy?url=${encodeURIComponent(modalUrl)}`}
            title={modalTitle}
            onLoad={() => setModalLoading(false)}
            onError={() => {
              setModalLoading(false)
              setModalError('Could not load this preview.')
            }}
            style={{
              flex: 1,
              border: 'none',
              background: '#fff',
            }}
          />
          {(modalLoading || modalError) && (
            <div
              style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'rgba(0,0,0,0.28)',
                color: '#fff',
                fontSize: 14,
                pointerEvents: 'none',
                textAlign: 'center',
                padding: 24,
              }}
            >
              {modalError ?? 'Loading preview...'}
            </div>
          )}
        </div>
      )}

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
        @keyframes modalIn {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }
        div::-webkit-scrollbar {
          display: none;
        }
      `}</style>
    </div>
  )
}
