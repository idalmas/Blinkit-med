/**
 * AppsPage.tsx — App launcher with bento grid layout.
 *
 * Displays all available Revive apps in an asymmetric "bento box" grid layout,
 * inspired by modern dashboard UIs (Apple, Linear, Vercel).
 *
 * Features:
 *   - Bento grid with featured/tall/wide card variants
 *   - Category labels (Productivity, Content, Games)
 *   - Animated gradient borders on hover (CSS mask technique)
 *   - Staggered entrance animations
 *   - Mesh gradient background with ambient orbs
 *   - Micro-interactions (scale, glow, translate on hover)
 *   - Responsive: collapses to 2-column on mobile
 *
 * Parent: main.tsx (rendered as "/apps" route)
 * Children: None (leaf component)
 *
 * Each app card navigates to its respective route on click:
 *   /apps/chat, /apps/web-search, /apps/books, etc.
 */

import { useNavigate } from 'react-router-dom'
import {
  FaAmazon,
  FaMapMarkerAlt,
  FaComments,
  FaSearch,
  FaDove,
  FaBook,
  FaMicrophone,
} from 'react-icons/fa'

/** App card configuration with layout variant and visual properties */
interface AppCard {
  name: string
  icon: React.ReactNode
  gradient: string
  glowColor: string
  description: string
  path: string
  category: 'Productivity' | 'Content' | 'Games'
  /** Bento grid variant: 'featured' spans 2x2, 'tall' spans 1x2, 'wide' spans 2x1, 'normal' is 1x1 */
  variant: 'featured' | 'tall' | 'wide' | 'normal'
}

const apps: AppCard[] = [
  {
    name: 'ChatGPT',
    icon: <FaComments size={32} />,
    gradient: 'linear-gradient(135deg, #10b981 0%, #059669 50%, #10b981 100%)',
    glowColor: 'rgba(16, 185, 129, 0.3)',
    description: 'Converse with GPT using blinks and voice. Full streaming chat with RAG-powered context.',
    path: '/apps/chat',
    category: 'Productivity',
    variant: 'featured',
  },
  {
    name: 'Web Search',
    icon: <FaSearch size={28} />,
    gradient: 'linear-gradient(135deg, #4285F4 0%, #EA4335 33%, #FBBC05 66%, #34A853 100%)',
    glowColor: 'rgba(66, 133, 244, 0.3)',
    description: 'Search Google with blink-navigable carousel results',
    path: '/apps/web-search',
    category: 'Productivity',
    variant: 'tall',
  },
  {
    name: 'Talk',
    icon: <FaMicrophone size={28} />,
    gradient: 'linear-gradient(135deg, #8B5CF6 0%, #A78BFA 50%, #8B5CF6 100%)',
    glowColor: 'rgba(139, 92, 246, 0.3)',
    description: 'Clone your voice and generate speech',
    path: '/apps/talk',
    category: 'Productivity',
    variant: 'normal',
  },
  {
    name: 'Books',
    icon: <FaBook size={28} />,
    gradient: 'linear-gradient(135deg, #D4A574 0%, #8B6914 50%, #D4A574 100%)',
    glowColor: 'rgba(212, 165, 116, 0.3)',
    description: 'Read classic literature with blink-powered page turning and chapter navigation',
    path: '/apps/books',
    category: 'Content',
    variant: 'wide',
  },
  {
    name: 'Flappy Bird',
    icon: <FaDove size={28} />,
    gradient: 'linear-gradient(135deg, #FFD600 0%, #FF6D00 50%, #FFD600 100%)',
    glowColor: 'rgba(255, 214, 0, 0.3)',
    description: 'Blink to flap and fly through pipes',
    path: '/apps/flappy-bird',
    category: 'Games',
    variant: 'normal',
  },
  {
    name: 'Amazon',
    icon: <FaAmazon size={28} />,
    gradient: 'linear-gradient(135deg, #FF9900 0%, #FFB84D 50%, #FF9900 100%)',
    glowColor: 'rgba(255, 153, 0, 0.3)',
    description: 'Search and browse product data',
    path: '/apps/amazon',
    category: 'Productivity',
    variant: 'normal',
  },
  {
    name: 'Google Maps',
    icon: <FaMapMarkerAlt size={28} />,
    gradient: 'linear-gradient(135deg, #4285F4 0%, #34A853 50%, #4285F4 100%)',
    glowColor: 'rgba(66, 133, 244, 0.3)',
    description: 'Search places and businesses hands-free',
    path: '/apps/maps',
    category: 'Productivity',
    variant: 'normal',
  },
]

/**
 * getCategoryColor — Returns a subtle color for category labels.
 * @param category The app's category
 * @returns CSS color string
 */
function getCategoryColor(category: string): string {
  switch (category) {
    case 'Productivity': return 'var(--accent-blue)'
    case 'Content': return '#D4A574'
    case 'Games': return 'var(--accent-amber)'
    default: return 'var(--text-tertiary)'
  }
}

export default function AppsPage() {
  const navigate = useNavigate()

  return (
    <div
      className="page bg-mesh"
      style={{
        alignItems: 'center',
        overflowY: 'auto',
        paddingTop: 'calc(var(--navbar-height) + 40px)',
        paddingBottom: 60,
      }}
    >
      {/* ── Ambient orbs ── */}
      <div
        style={{
          position: 'fixed',
          width: 600,
          height: 600,
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(99, 102, 241, 0.07) 0%, transparent 70%)',
          top: '0%',
          left: '15%',
          pointerEvents: 'none',
          animation: 'orbDrift1 22s ease-in-out infinite',
        }}
      />
      <div
        style={{
          position: 'fixed',
          width: 500,
          height: 500,
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(139, 92, 246, 0.05) 0%, transparent 70%)',
          bottom: '0%',
          right: '10%',
          pointerEvents: 'none',
          animation: 'orbDrift2 28s ease-in-out infinite',
        }}
      />

      {/* ── Page header ── */}
      <div
        style={{
          textAlign: 'center',
          marginBottom: 48,
          animation: 'slideInUp 0.5s var(--ease-out-expo)',
          position: 'relative',
          zIndex: 1,
        }}
      >
        <h1
          style={{
            color: 'var(--text-primary)',
            fontSize: 42,
            fontWeight: 800,
            letterSpacing: '-2px',
            marginBottom: 12,
            lineHeight: 1.1,
          }}
        >
          Apps
        </h1>
        <p
          style={{
            color: 'var(--text-tertiary)',
            fontSize: 16,
            fontWeight: 400,
            maxWidth: 400,
            margin: '0 auto',
            lineHeight: 1.5,
          }}
        >
          Hands-free access to your favorite tools and experiences
        </p>
      </div>

      {/* ── Bento Grid ── */}
      <div className="bento-grid" style={{ position: 'relative', zIndex: 1 }}>
        {apps.map((app, i) => {
          const variantClass =
            app.variant === 'featured'
              ? 'bento-item--featured'
              : app.variant === 'tall'
                ? 'bento-item--tall'
                : app.variant === 'wide'
                  ? 'bento-item--wide'
                  : ''

          return (
            <div
              key={app.name}
              className={`bento-item ${variantClass}`}
              onClick={() => navigate(app.path)}
              style={{
                animation: `bentoFadeIn 0.5s var(--ease-out-expo) ${i * 0.08}s both`,
                position: 'relative',
                overflow: 'hidden',
              }}
              onMouseEnter={(e) => {
                const el = e.currentTarget
                el.style.transform = 'translateY(-6px) scale(1.02)'
                el.style.boxShadow = `0 24px 48px -12px ${app.glowColor}, 0 0 0 1px var(--border-default)`
                el.style.borderColor = 'var(--border-strong)'
              }}
              onMouseLeave={(e) => {
                const el = e.currentTarget
                el.style.transform = ''
                el.style.boxShadow = ''
                el.style.borderColor = ''
              }}
            >
              {/* Background glow effect on hover */}
              <div
                style={{
                  position: 'absolute',
                  top: -40,
                  right: -40,
                  width: app.variant === 'featured' ? 260 : 180,
                  height: app.variant === 'featured' ? 260 : 180,
                  borderRadius: '50%',
                  background: `radial-gradient(circle, ${app.glowColor} 0%, transparent 70%)`,
                  opacity: 0.4,
                  pointerEvents: 'none',
                  transition: 'opacity 0.4s ease',
                }}
              />

              {/* Category label */}
              <div
                style={{
                  position: 'absolute',
                  top: 20,
                  left: 24,
                  fontSize: 10,
                  fontWeight: 600,
                  letterSpacing: '0.1em',
                  textTransform: 'uppercase',
                  color: getCategoryColor(app.category),
                  opacity: 0.7,
                }}
              >
                {app.category}
              </div>

              {/* Icon */}
              <div
                style={{
                  width: app.variant === 'featured' ? 72 : 56,
                  height: app.variant === 'featured' ? 72 : 56,
                  borderRadius: app.variant === 'featured' ? 20 : 16,
                  background: app.gradient,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#fff',
                  boxShadow: `0 8px 24px -4px ${app.glowColor}`,
                  marginBottom: 16,
                  transition: 'transform 0.3s var(--ease-spring), box-shadow 0.3s ease',
                  flexShrink: 0,
                }}
              >
                {app.icon}
              </div>

              {/* Text content */}
              <div>
                <div
                  style={{
                    color: 'var(--text-primary)',
                    fontSize: app.variant === 'featured' ? 20 : 16,
                    fontWeight: 700,
                    marginBottom: 6,
                    letterSpacing: '-0.3px',
                  }}
                >
                  {app.name}
                </div>
                <div
                  style={{
                    color: 'var(--text-tertiary)',
                    fontSize: app.variant === 'featured' ? 14 : 13,
                    lineHeight: 1.5,
                    display: '-webkit-box',
                    WebkitLineClamp: app.variant === 'featured' ? 3 : 2,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden',
                  }}
                >
                  {app.description}
                </div>
              </div>

              {/* Arrow indicator (bottom-right) */}
              <div
                style={{
                  position: 'absolute',
                  bottom: 20,
                  right: 24,
                  width: 28,
                  height: 28,
                  borderRadius: 8,
                  background: 'var(--bg-elevated)',
                  border: '1px solid var(--border-subtle)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--text-tertiary)',
                  fontSize: 12,
                  transition: 'all 0.2s ease',
                }}
              >
                &rarr;
              </div>
            </div>
          )
        })}
      </div>

      {/* ── Footer hint ── */}
      <div
        style={{
          marginTop: 48,
          textAlign: 'center',
          color: 'var(--text-muted)',
          fontSize: 13,
          position: 'relative',
          zIndex: 1,
        }}
      >
        Navigate with blinks · Double-blink to select · Long-close to go back
      </div>
    </div>
  )
}
