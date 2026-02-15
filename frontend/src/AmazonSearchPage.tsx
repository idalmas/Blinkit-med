import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import Webcam from 'react-webcam'
import { FaAmazon, FaStar, FaStarHalfAlt, FaRegStar, FaArrowLeft, FaSearch } from 'react-icons/fa'
import { useBlinkDetection, type BlinkType } from './useBlinkDetection'

const API_BASE = 'http://localhost:3002'
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

const CARD_WIDTH = 320
const CARD_GAP = 24
const CARD_STEP = CARD_WIDTH + CARD_GAP

export default function AmazonSearchPage() {
  const navigate = useNavigate()
  const scrollRef = useRef<HTMLDivElement>(null)
  const [keyword, setKeyword] = useState('')
  const [limit, setLimit] = useState(20)
  const [status, setStatus] = useState<SearchStatus>('idle')
  const [snapshotId, setSnapshotId] = useState<string | null>(null)
  const [products, setProducts] = useState<AmazonProduct[]>([])
  const [errorMsg, setErrorMsg] = useState('')
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const failCountRef = useRef(0)
  const MAX_POLL_FAILURES = 5

  // Center card tracking & blink selection
  const [centerOrigIdx, setCenterOrigIdx] = useState(0)
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

  const scrollByCards = useCallback((delta: number) => {
    const el = scrollRef.current
    if (!el) return
    el.style.scrollBehavior = 'smooth'
    el.scrollLeft += delta * CARD_STEP
  }, [])

  const handleBlink = useCallback(
    (type: BlinkType) => {
      if (products.length === 0) return
      if (type === 'double') {
        setSelectedOrigIdx((prev) => (prev === centerOrigIdx ? null : centerOrigIdx))
      } else if (type === 'triple' && selectedOrigIdx !== null) {
        sendProductEmail(products[selectedOrigIdx])
      } else if (type === 'wink-left') {
        scrollByCards(-1)
      } else if (type === 'wink-right') {
        scrollByCards(1)
      }
    },
    [centerOrigIdx, products, selectedOrigIdx, sendProductEmail, scrollByCards]
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
    [stopPolling]
  )

  const handleSearch = async () => {
    if (!keyword.trim()) return

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

  // Infinite scroll: triple the list and reset position when near edges
  const loopProducts = products.length > 0
    ? [...products, ...products, ...products]
    : []

  const updateCenterCard = useCallback(() => {
    const el = scrollRef.current
    if (!el || products.length === 0) return
    const containerCenter = el.scrollLeft + el.clientWidth / 2
    const loopIdx = Math.round((containerCenter - 60) / CARD_STEP)
    const origIdx = ((loopIdx % products.length) + products.length) % products.length
    setCenterOrigIdx(origIdx)
  }, [products])

  useEffect(() => {
    const el = scrollRef.current
    if (!el || products.length === 0) return

    // Start at the middle copy
    el.scrollLeft = products.length * CARD_STEP

    const handleScroll = () => {
      const singleSetWidth = products.length * CARD_STEP
      if (el.scrollLeft < singleSetWidth * 0.25) {
        el.style.scrollBehavior = 'auto'
        el.scrollLeft += singleSetWidth
        el.style.scrollBehavior = 'smooth'
      } else if (el.scrollLeft > singleSetWidth * 1.75) {
        el.style.scrollBehavior = 'auto'
        el.scrollLeft -= singleSetWidth
        el.style.scrollBehavior = 'smooth'
      }
      updateCenterCard()
    }

    updateCenterCard()
    el.addEventListener('scroll', handleScroll)
    return () => el.removeEventListener('scroll', handleScroll)
  }, [products, updateCenterCard])

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
            {products.length} products found — scroll to browse
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

        {products.length > 0 && (
          <>
            {/* Left fade */}
            <div
              style={{
                position: 'absolute',
                left: 0,
                top: 0,
                bottom: 0,
                width: 60,
                background: 'linear-gradient(to right, #0a0a0a, transparent)',
                zIndex: 2,
                pointerEvents: 'none',
              }}
            />
            {/* Right fade */}
            <div
              style={{
                position: 'absolute',
                right: 0,
                top: 0,
                bottom: 0,
                width: 60,
                background: 'linear-gradient(to left, #0a0a0a, transparent)',
                zIndex: 2,
                pointerEvents: 'none',
              }}
            />

            <div
              ref={scrollRef}
              style={{
                display: 'flex',
                alignItems: 'flex-end',
                gap: 24,
                overflowX: 'auto',
                padding: '20px 60px 80px',
                width: '100%',
                msOverflowStyle: 'none',
                scrollbarWidth: 'none',
              }}
            >
              {loopProducts.map((product, i) => {
                const origIdx = i % products.length
                const isCenter = origIdx === centerOrigIdx
                const isSelected = origIdx === selectedOrigIdx

                return (
                <a
                  key={`${product.asin || 'p'}-${i}`}
                  href={product.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    flex: isSelected
                      ? `0 0 380px`
                      : isCenter
                        ? `0 0 350px`
                        : `0 0 ${CARD_WIDTH}px`,
                    height: isSelected ? 480 : isCenter ? 450 : 420,
                    borderRadius: isSelected ? 24 : 20,
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
                      ? '0 0 50px rgba(255, 50, 50, 0.5), 0 0 100px rgba(255, 50, 50, 0.2), inset 0 0 30px rgba(255, 50, 50, 0.05)'
                      : isCenter
                        ? '0 16px 48px -8px rgba(255,153,0,0.2), 0 0 0 1px rgba(255,153,0,0.1)'
                        : 'none',
                    transform: 'none',
                    opacity: isSelected || isCenter ? 1 : 0.7,
                    display: 'flex',
                    flexDirection: 'column',
                    textDecoration: 'none',
                    transition: 'all 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275)',
                    cursor: 'pointer',
                    overflow: 'hidden',
                    zIndex: isSelected ? 3 : isCenter ? 1 : 0,
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.transform = 'translateY(-10px)'
                    e.currentTarget.style.opacity = '1'
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.transform = 'none'
                    e.currentTarget.style.opacity = isSelected || isCenter ? '1' : '0.7'
                  }}
                >
                  {/* Product image */}
                  {(product.image_url || product.image) && (
                    <div
                      style={{
                        height: 200,
                        background: '#fff',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        padding: 16,
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
                            top: 12,
                            left: 12,
                            background: 'linear-gradient(135deg, #232F3E, #37475A)',
                            color: '#FF9900',
                            fontSize: 11,
                            fontWeight: 600,
                            padding: '4px 10px',
                            borderRadius: 6,
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
                    {/* Title */}
                    <div
                      style={{
                        color: '#fff',
                        fontSize: 14,
                        fontWeight: 500,
                        lineHeight: 1.4,
                        display: '-webkit-box',
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical',
                        overflow: 'hidden',
                      }}
                    >
                      {product.title}
                    </div>

                    {/* Brand */}
                    {product.brand && (
                      <div style={{ color: 'rgba(255,255,255,0.35)', fontSize: 12 }}>
                        {product.brand}
                      </div>
                    )}

                    {/* Rating */}
                    {product.rating != null && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
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

                    {/* Price */}
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 'auto' }}>
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
          </>
        )}
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
        div::-webkit-scrollbar {
          display: none;
        }
      `}</style>
    </div>
  )
}
