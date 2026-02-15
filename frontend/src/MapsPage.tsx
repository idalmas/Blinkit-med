import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import Webcam from 'react-webcam'
import { FaMapMarkerAlt, FaStar, FaStarHalfAlt, FaRegStar, FaArrowLeft, FaSearch, FaPhone, FaGlobe } from 'react-icons/fa'

import { useBlinkDetection, type BlinkType } from './useBlinkDetection'
import { MorseKeyboard, type MorseKeyboardHandle } from './MorseKeyboard'
import { API_BASE, PERSON } from './config'
const POLL_INTERVAL = 3000

interface MapsPlace {
  name?: string
  title?: string
  address?: string
  full_address?: string
  street_address?: string
  city?: string
  state?: string
  country?: string
  rating?: number
  reviews?: number
  reviews_count?: number
  number_of_reviews?: number
  phone?: string
  phone_number?: string
  website?: string
  url?: string
  link?: string
  category?: string
  type?: string
  categories?: string[]
  image?: string
  photo?: string
  thumbnail?: string
  hours?: string
  opening_hours?: Record<string, string>
  price_level?: string
  latitude?: number
  longitude?: number
  description?: string
  error?: string
}

type SearchStatus = 'idle' | 'submitting' | 'polling' | 'ready' | 'error'

function StarRating({ rating }: { rating: number }) {
  const stars = []
  for (let i = 1; i <= 5; i++) {
    if (rating >= i) {
      stars.push(<FaStar key={i} size={14} color="#FBBC04" />)
    } else if (rating >= i - 0.5) {
      stars.push(<FaStarHalfAlt key={i} size={14} color="#FBBC04" />)
    } else {
      stars.push(<FaRegStar key={i} size={14} color="#FBBC04" />)
    }
  }
  return <span style={{ display: 'flex', gap: 2, alignItems: 'center' }}>{stars}</span>
}

function normalizePlaces(raw: unknown): MapsPlace[] {
  if (Array.isArray(raw)) return raw
  if (raw && typeof raw === 'object') {
    const obj = raw as Record<string, unknown>
    for (const key of ['results', 'data', 'items', 'places']) {
      if (Array.isArray(obj[key])) return obj[key] as MapsPlace[]
    }
    return [raw as MapsPlace]
  }
  return []
}

export default function MapsPage() {
  const navigate = useNavigate()

  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<SearchStatus>('idle')
  const [places, setPlaces] = useState<MapsPlace[]>([])
  const [errorMsg, setErrorMsg] = useState('')
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const failCountRef = useRef(0)
  const MAX_POLL_FAILURES = 5

  // Suggestion state
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [suggestionsLoading, setSuggestionsLoading] = useState(true)
  const [highlightedIdx, setHighlightedIdx] = useState(0)
  const highlightedIdxRef = useRef(0)
  const handleSearchRef = useRef<() => void>(() => {})
  const suggestionClickRef = useRef<(s: string) => void>(() => {})

  // Keep ref in sync
  useEffect(() => { highlightedIdxRef.current = highlightedIdx }, [highlightedIdx])
  const [morseOpen, setMorseOpen] = useState(false)
  const morseOpenRef = useRef(false)
  const morseRef = useRef<MorseKeyboardHandle>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  useEffect(() => { morseOpenRef.current = morseOpen }, [morseOpen])

  const handleBlink = useCallback(
    (type: BlinkType) => {
      // Quadruple blink toggles Morse keyboard
      if (type === 'quadruple') {
        if (morseOpenRef.current && morseRef.current) {
          const text = morseRef.current.getComposedText()
          if (text.trim()) {
            setQuery(prev => prev + text)
          }
          setTimeout(() => searchInputRef.current?.focus(), 50)
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
        if (places.length > 0) {
          // Go back to suggestions
          setPlaces([])
          setStatus('idle')
          setQuery('')
          return
        }
        navigate('/apps')
        return
      }

      // Suggestion navigation mode (when suggestions visible and no places shown)
      if (suggestions.length > 0 && places.length === 0 && status === 'idle') {
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

      // Carousel navigation (when places are shown)
      if (places.length > 0) {
        if (type === 'wink-left') {
          setCenterIdx((prev) => ((prev - 1) % places.length + places.length) % places.length)
        } else if (type === 'wink-right') {
          setCenterIdx((prev) => (prev + 1) % places.length)
        } else if (type === 'double') {
          handleSearchRef.current()
        }
        return
      }

      // Fallback: double-blink to search when typing
      if (type === 'double') {
        handleSearchRef.current()
      }
    },
    [navigate, suggestions, places, status]
  )

  const { webcamRef, status: blinkStatus } = useBlinkDetection({ onBlink: handleBlink })

  // Cache
  const cacheRef = useRef<Map<string, MapsPlace[]>>(new Map())
  const lastSearchKeyRef = useRef('')

  useEffect(() => {
    try {
      const stored = localStorage.getItem('blinket-maps-cache')
      if (stored) {
        const entries = JSON.parse(stored) as [string, MapsPlace[]][]
        cacheRef.current = new Map(entries)
      }
    } catch { /* ignore */ }
  }, [])

  const saveToCache = useCallback((key: string, data: MapsPlace[]) => {
    cacheRef.current.set(key, data)
    if (cacheRef.current.size > 50) {
      const first = cacheRef.current.keys().next().value
      if (first !== undefined) cacheRef.current.delete(first)
    }
    try {
      localStorage.setItem('blinket-maps-cache', JSON.stringify([...cacheRef.current.entries()]))
    } catch { /* storage full */ }
  }, [])

  // Fetch getContext suggestions on mount (with geolocation)
  useEffect(() => {
    let cancelled = false

    async function fetchSuggestions() {
      // Try to get user's current location
      let locationText: string | undefined
      try {
        const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 5000 })
        })
        locationText = `${pos.coords.latitude.toFixed(4)}, ${pos.coords.longitude.toFixed(4)}`
      } catch {
        // Location unavailable — proceed without it
      }

      try {
        const res = await fetch(`${API_BASE}/getContext`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ app: 'maps', person: PERSON, k: 5, ...(locationText ? { text: locationText } : {}) }),
        })
        if (!res.ok) throw new Error('Failed')
        const data = await res.json()
        if (!cancelled && Array.isArray(data.result)) {
          setSuggestions(data.result)
        }
      } catch {
        // Silently fail
      } finally {
        if (!cancelled) setSuggestionsLoading(false)
      }
    }

    fetchSuggestions()
    return () => { cancelled = true }
  }, [])

  const handleSuggestionClick = useCallback((suggestion: string) => {
    setQuery(suggestion)
    // Auto-search after state update
    setTimeout(() => {
      handleSearchRef.current()
    }, 0)
  }, [])

  // Keep ref in sync
  suggestionClickRef.current = handleSuggestionClick

  // Carousel state
  const [centerIdx, setCenterIdx] = useState(0)

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
          const res = await fetch(`${API_BASE}/apps/amazon-status/${sid}`)
          if (!res.ok) {
            failCountRef.current++
            if (failCountRef.current >= MAX_POLL_FAILURES) {
              stopPolling()
              setErrorMsg('Failed to get results.')
              setStatus('error')
            }
            return
          }

          failCountRef.current = 0
          const data = await res.json()

          if (data.status === 'ready') {
            const allPlaces = normalizePlaces(data.data)
            const validPlaces = allPlaces.filter((p) => (p.name || p.title) && !p.error)
            stopPolling()
            setPlaces(validPlaces.length > 0 ? validPlaces : allPlaces)
            if (validPlaces.length > 0) {
              saveToCache(lastSearchKeyRef.current, validPlaces)
            }
            setStatus('ready')
          } else if (data.status === 'failed') {
            stopPolling()
            setErrorMsg(data.error || 'Scrape job failed.')
            setStatus('error')
          }
        } catch {
          failCountRef.current++
          if (failCountRef.current >= MAX_POLL_FAILURES) {
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
    if (!query.trim()) return

    const cacheKey = query.trim().toLowerCase()
    const cached = cacheRef.current.get(cacheKey)
    if (cached && cached.length > 0) {
      setPlaces(cached)
      setStatus('ready')
      setErrorMsg('')
      return
    }

    lastSearchKeyRef.current = cacheKey
    stopPolling()
    setPlaces([])
    setErrorMsg('')
    setStatus('submitting')

    try {
      const res = await fetch(`${API_BASE}/apps/maps-search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: query.trim() }),
      })

      const data = await res.json()

      if (!res.ok && res.status !== 202) {
        setErrorMsg(data.error || 'Request failed.')
        setStatus('error')
        return
      }

      if (data.snapshot_id) {
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

  // Keep ref in sync so blink handler can call latest version
  handleSearchRef.current = handleSearch

  useEffect(() => {
    setCenterIdx(0)
  }, [places])

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
          padding: '72px 32px 0',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 16,
          flexShrink: 0,
          position: 'relative',
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
              background: 'linear-gradient(135deg, #4285F4, #34A853)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 8px 24px rgba(66, 133, 244, 0.3)',
            }}
          >
            <FaMapMarkerAlt size={24} color="#fff" />
          </div>
          <h1 style={{ color: '#fff', fontSize: 28, fontWeight: 700, margin: 0 }}>
            Google Maps
          </h1>
        </div>

        {/* Search input */}
        <div
          style={{
            display: 'flex',
            gap: 12,
            width: '100%',
            maxWidth: 600,
            marginTop: 8,
          }}
        >
          <div
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              background: 'rgba(255,255,255,0.06)',
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: 14,
              padding: '0 16px',
            }}
          >
            <FaSearch size={14} color="rgba(255,255,255,0.3)" />
            <input
              ref={searchInputRef}
              type="text"
              placeholder="Search a place or location..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              disabled={isLoading}
              style={{
                flex: 1,
                background: 'none',
                border: 'none',
                outline: 'none',
                color: '#fff',
                fontSize: 15,
                padding: '14px 12px',
                fontFamily: 'inherit',
                opacity: isLoading ? 0.5 : 1,
              }}
            />
          </div>
          <button
            onClick={handleSearch}
            disabled={isLoading || !query.trim()}
            style={{
              padding: '0 28px',
              borderRadius: 14,
              background:
                isLoading || !query.trim()
                  ? 'rgba(66, 133, 244, 0.3)'
                  : 'linear-gradient(135deg, #4285F4, #3367D6)',
              border: 'none',
              color: '#fff',
              fontSize: 15,
              fontWeight: 600,
              cursor: isLoading || !query.trim() ? 'not-allowed' : 'pointer',
              transition: 'all 0.2s',
              fontFamily: 'inherit',
              flexShrink: 0,
            }}
          >
            {isLoading ? 'Searching...' : 'Search'}
          </button>
        </div>

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
                background: '#4285F4',
                animation: 'pulse 1.5s ease-in-out infinite',
              }}
            />
            {status === 'submitting' ? 'Starting search...' : 'Fetching results...'}
          </div>
        )}

        {errorMsg && (
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
      </div>

      {/* Carousel area */}
      <div
        style={{
          flex: 1,
          position: 'relative',
          overflow: 'hidden',
          marginTop: 24,
        }}
      >
        {status === 'ready' && places.length === 0 && (
          <p style={{ color: 'rgba(255,255,255,0.4)', textAlign: 'center', width: '100%' }}>
            No places found.
          </p>
        )}

        {places.length > 0 && (() => {
          const seen = new Set<number>()
          const cards = [0, -1, 1, -2, 2, -3, 3]
            .map((offset) => {
              const idx = ((centerIdx + offset) % places.length + places.length) % places.length
              if (seen.has(idx)) return null
              seen.add(idx)
              return { offset, idx, place: places[idx] }
            })
            .filter(Boolean) as { offset: number; idx: number; place: MapsPlace }[]

          cards.sort((a, b) => a.idx - b.idx)

          const scaleFor = (o: number) => ({ 0: 1, 1: 0.68, 2: 0.52, 3: 0.4 }[Math.abs(o)] ?? 0.4)
          const xFor = (o: number) => {
            const sign = o < 0 ? -1 : 1
            return ({ 0: 0, 1: 340, 2: 570, 3: 750 }[Math.abs(o)] ?? 750) * sign
          }

          return (
            <div style={{ position: 'relative', width: '100%', height: '100%' }}>
              {cards.map(({ offset, idx, place }) => {
                const absOffset = Math.abs(offset)
                const isCenter = offset === 0
                const isStaging = absOffset === 3
                const cardOpacity = isStaging ? 0 : isCenter ? 1 : absOffset === 1 ? 0.7 : 0.4

                const placeName = place.name || place.title || ''
                const placeImage = place.image || place.photo || place.thumbnail || ''
                const placeAddress = place.full_address || place.address || [place.street_address, place.city, place.state].filter(Boolean).join(', ')
                const placeRating = place.rating
                const placeReviews = place.reviews ?? place.reviews_count ?? place.number_of_reviews
                const placeCategory = place.category || place.type || (place.categories && place.categories[0]) || ''
                const placePhone = place.phone || place.phone_number || ''
                const placeWebsite = place.website || ''
                const placeUrl = place.url || place.link || ''

                return (
                  <div
                    key={idx}
                    onClick={() => {
                      if (isCenter && placeUrl) window.open(placeUrl, '_blank')
                      else if (!isStaging) {
                        const diff = offset
                        setCenterIdx((prev) => ((prev + diff) % places.length + places.length) % places.length)
                      }
                    }}
                    style={{
                      position: 'absolute',
                      left: '50%',
                      top: '50%',
                      width: 400,
                      height: 520,
                      transform: `translate(calc(-50% + ${xFor(offset)}px), -50%) scale(${scaleFor(offset)})`,
                      willChange: 'transform, opacity',
                      borderRadius: 24,
                      background: isCenter
                        ? 'rgba(255,255,255,0.1)'
                        : 'rgba(255,255,255,0.05)',
                      border: isCenter
                        ? '1px solid rgba(255,255,255,0.25)'
                        : '1px solid rgba(255,255,255,0.08)',
                      boxShadow: isCenter
                        ? '0 16px 48px -8px rgba(66,133,244,0.3), 0 0 0 1px rgba(66,133,244,0.15)'
                        : 'none',
                      opacity: cardOpacity,
                      display: 'flex',
                      flexDirection: 'column',
                      transition: 'transform 0.5s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.5s cubic-bezier(0.4, 0, 0.2, 1), box-shadow 0.4s ease, border-color 0.4s ease, background 0.4s ease',
                      cursor: isStaging ? 'default' : 'pointer',
                      overflow: 'hidden',
                      pointerEvents: isStaging ? 'none' : 'auto',
                      zIndex: isCenter ? 3 : absOffset === 1 ? 2 : 1,
                    }}
                  >
                    {/* Place image */}
                    {placeImage ? (
                      <div
                        style={{
                          height: 220,
                          overflow: 'hidden',
                          position: 'relative',
                        }}
                      >
                        <img
                          src={placeImage}
                          alt={placeName}
                          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                        />
                        {placeCategory && (
                          <span
                            style={{
                              position: 'absolute',
                              top: 12,
                              left: 12,
                              background: 'rgba(0,0,0,0.7)',
                              color: '#fff',
                              fontSize: 11,
                              fontWeight: 600,
                              padding: '4px 10px',
                              borderRadius: 8,
                              backdropFilter: 'blur(4px)',
                            }}
                          >
                            {placeCategory}
                          </span>
                        )}
                      </div>
                    ) : (
                      <div
                        style={{
                          height: 220,
                          background: 'linear-gradient(135deg, #4285F4, #34A853)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          position: 'relative',
                        }}
                      >
                        <FaMapMarkerAlt size={48} color="rgba(255,255,255,0.3)" />
                        {placeCategory && (
                          <span
                            style={{
                              position: 'absolute',
                              top: 12,
                              left: 12,
                              background: 'rgba(0,0,0,0.4)',
                              color: '#fff',
                              fontSize: 11,
                              fontWeight: 600,
                              padding: '4px 10px',
                              borderRadius: 8,
                            }}
                          >
                            {placeCategory}
                          </span>
                        )}
                      </div>
                    )}

                    {/* Place info */}
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
                          fontSize: 17,
                          fontWeight: 600,
                          lineHeight: 1.3,
                          display: '-webkit-box',
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: 'vertical',
                          overflow: 'hidden',
                        }}
                      >
                        {placeName}
                      </div>

                      {placeRating != null && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <StarRating rating={placeRating} />
                          <span style={{ color: '#fff', fontSize: 14, fontWeight: 600 }}>
                            {placeRating}
                          </span>
                          {placeReviews != null && (
                            <span style={{ color: 'rgba(255,255,255,0.35)', fontSize: 12 }}>
                              ({placeReviews.toLocaleString()})
                            </span>
                          )}
                        </div>
                      )}

                      {placeAddress && (
                        <div
                          style={{
                            color: 'rgba(255,255,255,0.45)',
                            fontSize: 13,
                            lineHeight: 1.4,
                            display: 'flex',
                            alignItems: 'flex-start',
                            gap: 6,
                          }}
                        >
                          <FaMapMarkerAlt size={11} style={{ marginTop: 3, flexShrink: 0 }} />
                          <span
                            style={{
                              display: '-webkit-box',
                              WebkitLineClamp: 2,
                              WebkitBoxOrient: 'vertical',
                              overflow: 'hidden',
                            }}
                          >
                            {placeAddress}
                          </span>
                        </div>
                      )}

                      <div style={{ marginTop: 'auto', display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                        {placePhone && (
                          <div
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 6,
                              color: 'rgba(255,255,255,0.4)',
                              fontSize: 12,
                            }}
                          >
                            <FaPhone size={10} />
                            {placePhone}
                          </div>
                        )}
                        {placeWebsite && (
                          <div
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 6,
                              color: 'rgba(255,255,255,0.4)',
                              fontSize: 12,
                            }}
                          >
                            <FaGlobe size={10} />
                            Website
                          </div>
                        )}
                      </div>

                      {place.price_level && (
                        <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: 12 }}>
                          {place.price_level}
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )
        })()}

        {status === 'idle' && (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 16,
              color: 'rgba(255,255,255,0.3)',
              height: '100%',
            }}
          >
            <FaMapMarkerAlt size={48} />
            <p style={{ fontSize: 16, margin: 0 }}>
              {suggestionsLoading ? 'Loading personalized suggestions...' : 'Pick a suggestion or search for a place'}
            </p>

            {/* Suggestion chips */}
            {suggestions.length > 0 && (
              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: 10,
                  justifyContent: 'center',
                  maxWidth: 700,
                  marginTop: 8,
                }}
              >
                {suggestions.map((s, i) => {
                  const isHighlighted = i === highlightedIdx
                  return (
                    <button
                      key={i}
                      onClick={() => handleSuggestionClick(s)}
                      style={{
                        background: isHighlighted ? 'rgba(66, 133, 244, 0.2)' : 'rgba(255,255,255,0.06)',
                        border: isHighlighted
                          ? '1px solid rgba(66, 133, 244, 0.5)'
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
                        boxShadow: isHighlighted ? '0 0 12px rgba(66, 133, 244, 0.3)' : 'none',
                        transform: isHighlighted ? 'scale(1.05)' : 'scale(1)',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = 'rgba(66, 133, 244, 0.15)'
                        e.currentTarget.style.borderColor = 'rgba(66, 133, 244, 0.4)'
                        e.currentTarget.style.color = '#fff'
                      }}
                      onMouseLeave={(e) => {
                        if (!isHighlighted) {
                          e.currentTarget.style.background = 'rgba(255,255,255,0.06)'
                          e.currentTarget.style.borderColor = 'rgba(255,255,255,0.12)'
                          e.currentTarget.style.color = 'rgba(255,255,255,0.7)'
                        } else {
                          e.currentTarget.style.background = 'rgba(66, 133, 244, 0.2)'
                          e.currentTarget.style.borderColor = 'rgba(66, 133, 244, 0.5)'
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
      </div>

      {/* Navigation arrows */}
      {places.length > 1 && (
        <>
          <button
            onClick={() => setCenterIdx((prev) => ((prev - 1) % places.length + places.length) % places.length)}
            style={{
              position: 'fixed',
              left: 24,
              top: '50%',
              transform: 'translateY(-50%)',
              width: 48,
              height: 48,
              borderRadius: '50%',
              background: 'rgba(255,255,255,0.08)',
              border: '1px solid rgba(255,255,255,0.12)',
              color: '#fff',
              fontSize: 20,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'all 0.2s',
              zIndex: 10,
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.15)' }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.08)' }}
          >
            ‹
          </button>
          <button
            onClick={() => setCenterIdx((prev) => (prev + 1) % places.length)}
            style={{
              position: 'fixed',
              right: 24,
              top: '50%',
              transform: 'translateY(-50%)',
              width: 48,
              height: 48,
              borderRadius: '50%',
              background: 'rgba(255,255,255,0.08)',
              border: '1px solid rgba(255,255,255,0.12)',
              color: '#fff',
              fontSize: 20,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'all 0.2s',
              zIndex: 10,
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.15)' }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.08)' }}
          >
            ›
          </button>
        </>
      )}

      {/* Result count */}
      {places.length > 0 && (
        <div
          style={{
            position: 'fixed',
            bottom: 24,
            left: '50%',
            transform: 'translateX(-50%)',
            color: 'rgba(255,255,255,0.3)',
            fontSize: 13,
            zIndex: 10,
          }}
        >
          {centerIdx + 1} / {places.length}
        </div>
      )}

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
          if (text.trim()) setQuery(prev => prev + text)
          setMorseOpen(false)
        }}
      />

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

      {/* Help text */}
      <p style={{ position: 'fixed', bottom: 8, left: '50%', transform: 'translateX(-50%)', color: 'rgba(255,255,255,0.2)', fontSize: 11, zIndex: 10, margin: 0, whiteSpace: 'nowrap' }}>
        Wink to navigate &middot; Double-blink to select &middot; Triple-blink to go back
      </p>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
      `}</style>
    </div>
  )
}
