import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import Webcam from 'react-webcam'
import { FaBook, FaArrowLeft, FaBookOpen, FaChevronLeft, FaChevronRight } from 'react-icons/fa'
import { useBlinkDetection, type BlinkType } from './useBlinkDetection'
import { API_BASE } from './config'
const CHARS_PER_PAGE = 1400

interface BookMeta {
  id: number
  title: string
  author: string
  coverUrl: string
}

/** Split chapter text into page-sized chunks at paragraph or word boundaries */
function splitIntoPages(text: string): string[] {
  if (!text) return []
  const pages: string[] = []
  let remaining = text

  while (remaining.length > 0) {
    if (remaining.length <= CHARS_PER_PAGE) {
      pages.push(remaining.trim())
      break
    }

    let splitAt = CHARS_PER_PAGE
    // Try to break at a paragraph boundary (double newline)
    const paraBreak = remaining.lastIndexOf('\n\n', splitAt)
    if (paraBreak > CHARS_PER_PAGE * 0.5) {
      splitAt = paraBreak + 2
    } else {
      // Fall back to single newline
      const lineBreak = remaining.lastIndexOf('\n', splitAt)
      if (lineBreak > CHARS_PER_PAGE * 0.6) {
        splitAt = lineBreak + 1
      } else {
        // Fall back to word boundary
        const wordBreak = remaining.lastIndexOf(' ', splitAt)
        if (wordBreak > CHARS_PER_PAGE * 0.7) {
          splitAt = wordBreak + 1
        }
      }
    }

    pages.push(remaining.slice(0, splitAt).trim())
    remaining = remaining.slice(splitAt)
  }

  return pages.filter((p) => p.length > 0)
}

export default function BooksPage() {
  const navigate = useNavigate()

  const [books, setBooks] = useState<BookMeta[]>([])
  const [loading, setLoading] = useState(true)
  const [centerIdx, setCenterIdx] = useState(0)

  // Reading state
  const [readingBook, setReadingBook] = useState<BookMeta | null>(null)
  const [chapterContent, setChapterContent] = useState('')
  const [chapterTitle, setChapterTitle] = useState('')
  const [currentChapter, setCurrentChapter] = useState(0)
  const [totalChapters, setTotalChapters] = useState(0)
  const [chapterLoading, setChapterLoading] = useState(false)
  const [subPage, setSubPage] = useState(0)
  const [flipDir, setFlipDir] = useState<'left' | 'right' | null>(null)
  const [flipKey, setFlipKey] = useState(0)
  const contentRef = useRef<HTMLDivElement>(null)

  // Split chapter into pages
  const pages = useMemo(() => splitIntoPages(chapterContent), [chapterContent])
  const totalSubPages = pages.length
  const currentPageText = pages[subPage] || ''

  // Fetch curated book list
  useEffect(() => {
    fetch(`${API_BASE}/apps/books`)
      .then((r) => r.json())
      .then((data) => {
        setBooks(data.books || [])
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  // Fetch chapter content when reading
  useEffect(() => {
    if (!readingBook) return
    setChapterLoading(true)
    fetch(`${API_BASE}/apps/book-content/${readingBook.id}?chapter=${currentChapter}`)
      .then((r) => r.json())
      .then((data) => {
        setChapterContent(data.content || '')
        setChapterTitle(data.chapterTitle || '')
        setTotalChapters(data.totalChapters || data.totalPages || 0)
        setChapterLoading(false)
        setSubPage(0)
      })
      .catch(() => {
        setChapterContent('Failed to load chapter.')
        setChapterLoading(false)
      })
  }, [readingBook, currentChapter])

  const closeBook = useCallback(() => {
    setReadingBook(null)
    setChapterContent('')
    setChapterTitle('')
    setCurrentChapter(0)
    setSubPage(0)
  }, [])

  const flipForward = useCallback(() => {
    if (subPage < totalSubPages - 1) {
      setFlipDir('right')
      setFlipKey((k) => k + 1)
      setSubPage((p) => p + 1)
    } else if (currentChapter < totalChapters - 1) {
      // End of chapter pages → next chapter
      setFlipDir('right')
      setFlipKey((k) => k + 1)
      setCurrentChapter((c) => c + 1)
    }
  }, [subPage, totalSubPages, currentChapter, totalChapters])

  const flipBack = useCallback(() => {
    if (subPage > 0) {
      setFlipDir('left')
      setFlipKey((k) => k + 1)
      setSubPage((p) => p - 1)
    } else if (currentChapter > 0) {
      // Beginning of chapter → prev chapter (will land on page 0, user can flip back through it)
      setFlipDir('left')
      setFlipKey((k) => k + 1)
      setCurrentChapter((c) => c - 1)
    }
  }, [subPage, currentChapter])

  const handleBlink = useCallback(
    (type: BlinkType) => {
      if (type === 'long-close') {
        navigate('/apps')
        return
      }
      if (readingBook) {
        if (type === 'wink-right') {
          flipForward()
        } else if (type === 'wink-left') {
          flipBack()
        } else if (type === 'triple') {
          closeBook()
        }
      } else {
        if (type === 'triple') {
          navigate('/apps')
          return
        }
        if (books.length === 0) return
        if (type === 'wink-left') {
          setCenterIdx((p) => ((p - 1) + books.length) % books.length)
        } else if (type === 'wink-right') {
          setCenterIdx((p) => (p + 1) % books.length)
        } else if (type === 'double') {
          setReadingBook(books[centerIdx])
          setCurrentChapter(0)
        }
      }
    },
    [readingBook, books, centerIdx, closeBook, flipForward, flipBack, navigate]
  )

  const { webcamRef, status: blinkStatus } = useBlinkDetection({ onBlink: handleBlink })

  // Keyboard: Escape closes, arrow keys flip pages
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!readingBook) return
      if (e.key === 'Escape') closeBook()
      if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); flipForward() }
      if (e.key === 'ArrowLeft') { e.preventDefault(); flipBack() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [readingBook, closeBook, flipForward, flipBack])

  // Carousel helpers
  const scaleFor = (o: number) => ({ 0: 1, 1: 0.68, 2: 0.52, 3: 0.4 }[Math.abs(o)] ?? 0.4)
  const xFor = (o: number) => {
    const sign = o < 0 ? -1 : 1
    return ({ 0: 0, 1: 340, 2: 570, 3: 750 }[Math.abs(o)] ?? 750) * sign
  }

  // Global page number across all chapters (approximate)
  const isFirstPage = currentChapter === 0 && subPage === 0
  const isLastPage = currentChapter >= totalChapters - 1 && subPage >= totalSubPages - 1

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'linear-gradient(160deg, #0a0a0a 0%, #1a1208 50%, #0a0a0a 100%)',
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
              background: 'linear-gradient(135deg, #D4A574, #8B6914)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 8px 24px rgba(212,165,116,0.3)',
            }}
          >
            <FaBook size={22} color="#fff" />
          </div>
          <h1 style={{ color: '#fff', fontSize: 28, fontWeight: 700, margin: 0 }}>
            Books
          </h1>
        </div>

        {!loading && books.length > 0 && !readingBook && (
          <p style={{ color: 'rgba(255,255,255,0.35)', fontSize: 13, margin: 0 }}>
            {books.length} classics — wink to browse, double-blink to read
          </p>
        )}

      </div>

      {/* Carousel */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          overflow: 'hidden',
          position: 'relative',
        }}
      >
        {loading && (
          <p style={{ color: 'rgba(255,255,255,0.4)', textAlign: 'center', width: '100%' }}>
            Loading books...
          </p>
        )}

        {!loading && books.length > 0 &&
          (() => {
            const seen = new Set<number>()
            const cards = [0, -1, 1, -2, 2, -3, 3]
              .map((offset) => {
                const idx = ((centerIdx + offset) % books.length + books.length) % books.length
                if (seen.has(idx)) return null
                seen.add(idx)
                return { offset, idx, book: books[idx] }
              })
              .filter(Boolean) as { offset: number; idx: number; book: BookMeta }[]

            cards.sort((a, b) => a.idx - b.idx)

            return (
              <div style={{ position: 'relative', width: '100%', height: '100%' }}>
                {cards.map(({ offset, idx, book }) => {
                  const absOffset = Math.abs(offset)
                  const isCenter = offset === 0
                  const isStaging = absOffset === 3
                  const cardOpacity = isStaging ? 0 : isCenter ? 1 : absOffset === 1 ? 0.7 : 0.4

                  return (
                    <div
                      key={idx}
                      onClick={() => {
                        if (isCenter) {
                          setReadingBook(book)
                          setCurrentChapter(0)
                        }
                      }}
                      style={{
                        position: 'absolute',
                        left: '50%',
                        top: '50%',
                        width: 280,
                        height: 420,
                        transform: `translate(calc(-50% + ${xFor(offset)}px), -50%) scale(${scaleFor(offset)})`,
                        willChange: 'transform, opacity',
                        borderRadius: 20,
                        background: isCenter
                          ? 'rgba(255,255,255,0.08)'
                          : 'rgba(255,255,255,0.04)',
                        border: isCenter
                          ? '1px solid rgba(212,165,116,0.3)'
                          : '1px solid rgba(255,255,255,0.06)',
                        boxShadow: isCenter
                          ? '0 16px 48px -8px rgba(212,165,116,0.25), 0 0 0 1px rgba(212,165,116,0.1)'
                          : 'none',
                        opacity: cardOpacity,
                        display: 'flex',
                        flexDirection: 'column',
                        overflow: 'hidden',
                        transition:
                          'transform 0.5s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.5s cubic-bezier(0.4, 0, 0.2, 1), box-shadow 0.4s ease',
                        cursor: isStaging ? 'default' : 'pointer',
                        pointerEvents: isStaging ? 'none' : 'auto',
                        zIndex: isCenter ? 3 : absOffset === 1 ? 2 : 1,
                      }}
                    >
                      {/* Cover image */}
                      <div
                        style={{
                          flex: 1,
                          background: 'linear-gradient(135deg, #2a1f14, #3d2b1a)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          overflow: 'hidden',
                          position: 'relative',
                        }}
                      >
                        <img
                          src={book.coverUrl}
                          alt={book.title}
                          style={{
                            width: '100%',
                            height: '100%',
                            objectFit: 'cover',
                          }}
                          onError={(e) => {
                            ;(e.target as HTMLImageElement).style.display = 'none'
                          }}
                        />
                        {/* Fallback text if no cover */}
                        <div
                          style={{
                            position: 'absolute',
                            inset: 0,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            padding: 20,
                          }}
                        >
                          <FaBookOpen
                            size={48}
                            color="rgba(212,165,116,0.2)"
                            style={{ position: 'absolute' }}
                          />
                        </div>
                      </div>

                      {/* Title + Author */}
                      <div style={{ padding: '16px 18px' }}>
                        <div
                          style={{
                            color: isCenter ? '#D4A574' : 'rgba(255,255,255,0.7)',
                            fontSize: 15,
                            fontWeight: 600,
                            lineHeight: 1.3,
                            display: '-webkit-box',
                            WebkitLineClamp: 2,
                            WebkitBoxOrient: 'vertical',
                            overflow: 'hidden',
                            marginBottom: 4,
                          }}
                        >
                          {book.title}
                        </div>
                        <div
                          style={{
                            color: 'rgba(255,255,255,0.35)',
                            fontSize: 13,
                          }}
                        >
                          {book.author}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )
          })()}
      </div>

      {/* Reading modal — page-flip view */}
      {readingBook && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 50,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(0, 0, 0, 0.95)',
            animation: 'modalIn 0.3s ease-out',
          }}
        >
          {/* Top bar */}
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '10px 20px',
              background: 'rgba(15, 23, 42, 0.9)',
              borderBottom: '1px solid rgba(255,255,255,0.08)',
              zIndex: 2,
            }}
          >
            <FaBookOpen size={13} color="#D4A574" />
            <span
              style={{
                color: '#D4A574',
                fontSize: 14,
                fontWeight: 600,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {readingBook.title}
            </span>
            <span style={{ color: 'rgba(255,255,255,0.35)', fontSize: 13 }}>
              {readingBook.author}
            </span>
            <div style={{ flex: 1 }} />
            {chapterTitle && (
              <span style={{ color: 'rgba(212,165,116,0.5)', fontSize: 12 }}>
                {chapterTitle}
              </span>
            )}
            <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: 12 }}>
              Ch. {currentChapter + 1}/{totalChapters}
            </span>
            <span style={{ color: 'rgba(255,255,255,0.2)', fontSize: 11 }}>
              Wink: flip | Triple: close
            </span>
            <button
              onClick={closeBook}
              style={{
                background: 'rgba(255,255,255,0.06)',
                border: '1px solid rgba(255,255,255,0.12)',
                borderRadius: 6,
                color: 'rgba(255,255,255,0.6)',
                padding: '5px 12px',
                cursor: 'pointer',
                fontSize: 12,
                fontFamily: 'inherit',
                transition: 'all 0.2s',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'rgba(255,255,255,0.12)'
                e.currentTarget.style.color = '#fff'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'rgba(255,255,255,0.06)'
                e.currentTarget.style.color = 'rgba(255,255,255,0.6)'
              }}
            >
              Close
            </button>
          </div>

          {/* Page container with perspective */}
          <div
            style={{
              perspective: 1600,
              width: '100%',
              maxWidth: 680,
              height: 'calc(100vh - 100px)',
              maxHeight: 820,
              position: 'relative',
              margin: '50px auto 0',
            }}
          >
            {/* Left arrow */}
            <button
              onClick={flipBack}
              disabled={isFirstPage}
              style={{
                position: 'absolute',
                left: -60,
                top: '50%',
                transform: 'translateY(-50%)',
                width: 44,
                height: 44,
                borderRadius: '50%',
                background: isFirstPage ? 'transparent' : 'rgba(212,165,116,0.1)',
                border: isFirstPage ? 'none' : '1px solid rgba(212,165,116,0.2)',
                color: isFirstPage ? 'transparent' : 'rgba(212,165,116,0.6)',
                cursor: isFirstPage ? 'default' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'all 0.2s',
                zIndex: 3,
              }}
            >
              <FaChevronLeft size={16} />
            </button>

            {/* Right arrow */}
            <button
              onClick={flipForward}
              disabled={isLastPage}
              style={{
                position: 'absolute',
                right: -60,
                top: '50%',
                transform: 'translateY(-50%)',
                width: 44,
                height: 44,
                borderRadius: '50%',
                background: isLastPage ? 'transparent' : 'rgba(212,165,116,0.1)',
                border: isLastPage ? 'none' : '1px solid rgba(212,165,116,0.2)',
                color: isLastPage ? 'transparent' : 'rgba(212,165,116,0.6)',
                cursor: isLastPage ? 'default' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'all 0.2s',
                zIndex: 3,
              }}
            >
              <FaChevronRight size={16} />
            </button>

            {/* The page */}
            <div
              key={flipKey}
              ref={contentRef}
              className={flipDir === 'right' ? 'page-flip-right' : flipDir === 'left' ? 'page-flip-left' : ''}
              style={{
                width: '100%',
                height: '100%',
                borderRadius: 4,
                background: 'linear-gradient(135deg, #faf6f0 0%, #f5efe6 50%, #faf6f0 100%)',
                boxShadow: '0 4px 40px rgba(0,0,0,0.5), -2px 0 8px rgba(0,0,0,0.15), 2px 0 8px rgba(0,0,0,0.15)',
                padding: '48px 56px',
                overflow: 'hidden',
                position: 'relative',
                transformOrigin: 'center center',
              }}
            >
              {/* Page spine shadow */}
              <div
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  bottom: 0,
                  width: 20,
                  background: 'linear-gradient(to right, rgba(0,0,0,0.06), transparent)',
                  pointerEvents: 'none',
                }}
              />

              {chapterLoading ? (
                <div
                  style={{
                    height: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#8a7a6a',
                    fontFamily: 'Georgia, serif',
                    fontSize: 16,
                  }}
                >
                  <div
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      background: '#D4A574',
                      margin: '0 auto 12px',
                      animation: 'pulse 1.5s ease-in-out infinite',
                    }}
                  />
                </div>
              ) : (
                <>
                  {/* Chapter title on first page */}
                  {subPage === 0 && chapterTitle && (
                    <div
                      style={{
                        fontFamily: 'Georgia, "Times New Roman", serif',
                        fontSize: 22,
                        fontWeight: 700,
                        color: '#3d2b1a',
                        marginBottom: 24,
                        paddingBottom: 16,
                        borderBottom: '1px solid rgba(139,105,20,0.15)',
                        letterSpacing: '0.02em',
                      }}
                    >
                      {chapterTitle}
                    </div>
                  )}

                  {/* Page text */}
                  <div
                    style={{
                      fontFamily: 'Georgia, "Times New Roman", serif',
                      fontSize: 16,
                      lineHeight: 1.8,
                      color: '#2a2018',
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                      letterSpacing: '0.01em',
                      overflow: 'hidden',
                      height: subPage === 0 && chapterTitle ? 'calc(100% - 70px)' : '100%',
                    }}
                  >
                    {currentPageText}
                  </div>
                </>
              )}

              {/* Page number */}
              <div
                style={{
                  position: 'absolute',
                  bottom: 20,
                  left: 0,
                  right: 0,
                  textAlign: 'center',
                  fontFamily: 'Georgia, serif',
                  fontSize: 12,
                  color: '#a09080',
                  letterSpacing: '0.1em',
                }}
              >
                {subPage + 1} / {totalSubPages}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Webcam */}
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
          zIndex: 60,
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
          {blinkStatus === 'loading'
            ? 'Loading...'
            : blinkStatus === 'detecting'
              ? 'Blink active'
              : blinkStatus}
        </div>
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
        @keyframes modalIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes flipRight {
          0% {
            transform: rotateY(0deg);
            opacity: 1;
          }
          100% {
            transform: rotateY(0deg);
            opacity: 1;
          }
        }
        @keyframes slideInRight {
          0% {
            transform: translateX(40px);
            opacity: 0;
          }
          100% {
            transform: translateX(0);
            opacity: 1;
          }
        }
        @keyframes slideInLeft {
          0% {
            transform: translateX(-40px);
            opacity: 0;
          }
          100% {
            transform: translateX(0);
            opacity: 1;
          }
        }
        .page-flip-right {
          animation: slideInRight 0.35s cubic-bezier(0.16, 1, 0.3, 1) both;
        }
        .page-flip-left {
          animation: slideInLeft 0.35s cubic-bezier(0.16, 1, 0.3, 1) both;
        }
        div::-webkit-scrollbar {
          display: none;
        }
      `}</style>
    </div>
  )
}
