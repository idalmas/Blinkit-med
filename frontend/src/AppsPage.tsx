/**
 * AppsPage — App launcher grid with blink-based navigation.
 *
 * Displays all available apps (Amazon, Maps, ChatGPT, Web Search, Flappy Bird,
 * Books) as a card grid. Users can navigate entirely hands-free:
 *
 *   - wink-left  → move highlight to the previous app card
 *   - wink-right → move highlight to the next app card
 *   - double blink → open the highlighted app
 *
 * The currently highlighted card is visually distinguished with a lifted
 * transform, a glowing border matching the app's brand colour, and a pulsing
 * ring animation so it's unmistakable even from a distance.
 *
 * A small webcam preview + blink-status badge sits in the bottom-right corner
 * (same placement as every other blink-enabled page for consistency).
 *
 * Parent: mounted by src/main.tsx at /apps
 * Children: none (navigates to individual app pages)
 * Dependencies: useBlinkDetection (blink/wink hook), react-webcam, react-icons
 */

import { useState, useCallback, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import Webcam from 'react-webcam'
import { FaAmazon, FaMapMarkerAlt, FaComments, FaSearch, FaDove, FaBook, FaMicrophone, FaVideo } from 'react-icons/fa'
import { useBlinkDetection, type BlinkType } from './useBlinkDetection'

/** Describes a single app card in the launcher grid. */
interface AppCard {
  name: string
  icon: React.ReactNode
  gradient: string
  shadow: string
  description: string
  path?: string
}

/** All available apps rendered in the grid. */
const apps: AppCard[] = [
  {
    name: 'Amazon',
    icon: <FaAmazon size={48} />,
    gradient: 'linear-gradient(135deg, #FF9900 0%, #FFB84D 50%, #FF9900 100%)',
    shadow: 'rgba(255, 153, 0, 0.4)',
    description: 'Search & scrape product data',
    path: '/apps/amazon',
  },
  {
    name: 'Google Maps',
    icon: <FaMapMarkerAlt size={48} />,
    gradient: 'linear-gradient(135deg, #4285F4 0%, #34A853 50%, #4285F4 100%)',
    shadow: 'rgba(66, 133, 244, 0.4)',
    description: 'Search places & businesses',
    path: '/apps/maps',
  },
  {
    name: 'ChatGPT',
    icon: <FaComments size={48} />,
    gradient: 'linear-gradient(135deg, #10b981 0%, #34d399 50%, #10b981 100%)',
    shadow: 'rgba(16, 185, 129, 0.4)',
    description: 'Chat with GPT',
    path: '/apps/chat',
  },
  {
    name: 'Web Search',
    icon: <FaSearch size={48} />,
    gradient: 'linear-gradient(135deg, #4285F4 0%, #EA4335 33%, #FBBC05 66%, #34A853 100%)',
    shadow: 'rgba(66, 133, 244, 0.4)',
    description: 'Search Google SERP',
    path: '/apps/web-search',
  },
  {
    name: 'Flappy Bird',
    icon: <FaDove size={48} />,
    gradient: 'linear-gradient(135deg, #FFD600 0%, #FF6D00 50%, #FFD600 100%)',
    shadow: 'rgba(255, 214, 0, 0.4)',
    description: 'Blink to flap & fly',
    path: '/apps/flappy-bird',
  },
  {
    name: 'Books',
    icon: <FaBook size={48} />,
    gradient: 'linear-gradient(135deg, #D4A574 0%, #8B6914 50%, #D4A574 100%)',
    shadow: 'rgba(212, 165, 116, 0.4)',
    description: 'Read classic literature',
    path: '/apps/books',
  },
  {
    name: 'Talk',
    icon: <FaMicrophone size={48} />,
    gradient: 'linear-gradient(135deg, #8B5CF6 0%, #A78BFA 50%, #8B5CF6 100%)',
    shadow: 'rgba(139, 92, 246, 0.4)',
    description: 'Voice conversations',
    path: '/apps/talk',
  },
  {
    name: 'Zoom',
    icon: <FaVideo size={48} />,
    gradient: 'linear-gradient(135deg, #0E71EB 0%, #38BDF8 50%, #0E71EB 100%)',
    shadow: 'rgba(14, 113, 235, 0.45)',
    description: 'Meetings + RTMS logs',
    path: '/apps/zoom',
  },
]

/**
 * AppsPage component.
 *
 * Renders the app launcher grid and wires up blink detection so the user can
 * navigate and open apps without touching the keyboard/mouse.
 *
 * @returns The full-screen apps launcher.
 */
export default function AppsPage() {
  const navigate = useNavigate()

  /** Index of the app card currently highlighted via blink navigation. */
  const [highlightIdx, setHighlightIdx] = useState(0)

  /**
   * Once the initial floatIn entrance animations finish, this flips to true so
   * cards that lose their highlight only resume the gentle bob — they never
   * replay the floatIn (which starts at opacity 0 and causes a flash).
   */
  const [hasAnimatedIn, setHasAnimatedIn] = useState(false)
  useEffect(() => {
    // Longest entrance delay: (apps.length - 1) * 0.12s + 0.6s duration = ~1.2s
    const timer = setTimeout(() => setHasAnimatedIn(true), 1400)
    return () => clearTimeout(timer)
  }, [])

  /**
   * handleBlink — routes blink/wink events to navigation actions.
   *
   * @param type - The detected blink type from useBlinkDetection.
   *
   * Mapping:
   *   wink-right → next app
   *   wink-left  → previous app
   *   double     → open highlighted app
   */
  const handleBlink = useCallback(
    (type: BlinkType) => {
      if (type === 'wink-right') {
        setHighlightIdx((prev) => (prev + 1) % apps.length)
      } else if (type === 'wink-left') {
        setHighlightIdx((prev) => (prev - 1 + apps.length) % apps.length)
      } else if (type === 'double') {
        const app = apps[highlightIdx]
        if (app?.path) navigate(app.path)
      }
    },
    [highlightIdx, navigate],
  )

  const { webcamRef, status: blinkStatus } = useBlinkDetection({ onBlink: handleBlink })

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'linear-gradient(160deg, #0a0a0a 0%, #111827 50%, #0a0a0a 100%)',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
      }}
    >
      {/* Ambient background glow */}
      <div
        style={{
          position: 'absolute',
          width: 600,
          height: 600,
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(99, 102, 241, 0.08) 0%, transparent 70%)',
          top: '10%',
          left: '50%',
          transform: 'translateX(-50%)',
          pointerEvents: 'none',
        }}
      />

      <h1
        style={{
          color: '#fff',
          fontSize: 36,
          fontWeight: 700,
          marginBottom: 8,
          letterSpacing: '-1px',
        }}
      >
        Apps
      </h1>
      <p
        style={{
          color: 'rgba(255,255,255,0.4)',
          fontSize: 16,
          marginBottom: 16,
          marginTop: 0,
        }}
      >
        Connect with your favorite platforms
      </p>

      {/* Blink navigation hint */}
      <p
        style={{
          color: 'rgba(255,255,255,0.25)',
          fontSize: 13,
          marginBottom: 48,
          marginTop: 0,
          textAlign: 'center',
          lineHeight: 1.6,
        }}
      >
        Wink left/right to browse &middot; Double-blink to open
      </p>

      <div
        style={{
          display: 'flex',
          gap: 40,
          flexWrap: 'wrap',
          justifyContent: 'center',
          padding: '0 24px',
          marginTop: '20px'
        }}
      >
        {apps.map((app, i) => {
          const isHighlighted = highlightIdx === i

          return (
            <div
              key={app.name}
              className="app-card"
              onClick={() => app.path && navigate(app.path)}
              onMouseEnter={() => setHighlightIdx(i)}
              style={{
                width: 200,
                height: 240,
                borderRadius: 24,
                background: isHighlighted
                  ? 'rgba(255, 255, 255, 0.10)'
                  : 'rgba(255, 255, 255, 0.04)',
                border: isHighlighted
                  ? `2px solid ${app.shadow}`
                  : '1px solid rgba(255, 255, 255, 0.08)',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 20,
                cursor: 'pointer',
                // Highlighted cards ease-in smoothly; un-highlighted snap back instantly
                transition: isHighlighted
                  ? 'transform 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275), box-shadow 0.3s ease, background 0.3s ease, border-color 0.3s ease'
                  : 'none',
                animation: isHighlighted
                  ? undefined
                  : hasAnimatedIn
                    ? `float${i} 6s ease-in-out ${i * 0.8}s infinite`
                    : `floatIn 0.6s cubic-bezier(0.16, 1, 0.3, 1) ${i * 0.12}s both, float${i} 6s ease-in-out ${i * 0.8}s infinite`,
                transform: isHighlighted ? 'translateY(-16px) scale(1.08)' : undefined,
                boxShadow: isHighlighted
                  ? `0 32px 64px -16px ${app.shadow}, 0 0 40px ${app.shadow}, 0 0 0 1px rgba(255,255,255,0.15)`
                  : undefined,
                position: 'relative',
                zIndex: isHighlighted ? 10 : 1,
              }}
            >
              {/* Pulsing ring around highlighted card */}
              {isHighlighted && (
                <div
                  style={{
                    position: 'absolute',
                    inset: -6,
                    borderRadius: 28,
                    border: `2px solid ${app.shadow}`,
                    opacity: 0.5,
                    animation: 'highlightPulse 2s ease-in-out infinite',
                    pointerEvents: 'none',
                  }}
                />
              )}

              {/* Icon container with gradient background */}
              <div
                style={{
                  width: 88,
                  height: 88,
                  borderRadius: 22,
                  background: app.gradient,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#fff',
                  boxShadow: isHighlighted
                    ? `0 12px 40px -4px ${app.shadow}`
                    : `0 8px 32px -4px ${app.shadow}`,
                  transition: 'transform 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275), box-shadow 0.4s ease',
                  transform: isHighlighted ? 'scale(1.08)' : undefined,
                }}
              >
                {app.icon}
              </div>

              <div style={{ textAlign: 'center' }}>
                <div
                  style={{
                    color: '#fff',
                    fontSize: 17,
                    fontWeight: 600,
                    marginBottom: 4,
                  }}
                >
                  {app.name}
                </div>
                <div
                  style={{
                    color: isHighlighted ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.35)',
                    fontSize: 13,
                    transition: 'color 0.3s ease',
                  }}
                >
                  {app.description}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Webcam preview — matches placement on all other blink-enabled pages */}
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
          {blinkStatus === 'loading'
            ? 'Loading...'
            : blinkStatus === 'detecting'
              ? 'Blink active'
              : blinkStatus}
        </div>
      </div>

      {/* Keyframe animations injected via <style> */}
      <style>{`
        @keyframes floatIn {
          from {
            opacity: 0;
            transform: translateY(40px) scale(0.9);
          }
          to {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }

        @keyframes highlightPulse {
          0%, 100% { opacity: 0.5; transform: scale(1); }
          50% { opacity: 0.2; transform: scale(1.03); }
        }

        @keyframes float0 {
          0%, 100% { transform: translateY(0px); }
          50% { transform: translateY(-10px); }
        }

        @keyframes float1 {
          0%, 100% { transform: translateY(0px); }
          50% { transform: translateY(-8px); }
        }

        @keyframes float2 {
          0%, 100% { transform: translateY(0px); }
          50% { transform: translateY(-12px); }
        }

        @keyframes float3 {
          0%, 100% { transform: translateY(0px); }
          50% { transform: translateY(-9px); }
        }

        @keyframes float4 {
          0%, 100% { transform: translateY(0px); }
          50% { transform: translateY(-11px); }
        }

        @keyframes float5 {
          0%, 100% { transform: translateY(0px); }
          50% { transform: translateY(-10px); }
        }

        @keyframes float6 {
          0%, 100% { transform: translateY(0px); }
          50% { transform: translateY(-9px); }
        }

        .app-card:hover {
          animation-play-state: paused !important;
        }
      `}</style>
    </div>
  )
}
