import { useNavigate } from 'react-router-dom'
import { FaAmazon, FaMapMarkerAlt, FaComments, FaSearch, FaDove, FaBook } from 'react-icons/fa'

interface AppCard {
  name: string
  icon: React.ReactNode
  gradient: string
  shadow: string
  description: string
  path?: string
}

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
]

export default function AppsPage() {
  const navigate = useNavigate()

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
          marginBottom: 56,
          marginTop: 0,
        }}
      >
        Connect with your favorite platforms
      </p>

      <div
        style={{
          display: 'flex',
          gap: 40,
          flexWrap: 'wrap',
          justifyContent: 'center',
          padding: '0 24px',
        }}
      >
        {apps.map((app, i) => (
          <div
            key={app.name}
            className="app-card"
            onClick={() => app.path && navigate(app.path)}
            style={{
              width: 200,
              height: 240,
              borderRadius: 24,
              background: 'rgba(255, 255, 255, 0.04)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 20,
              cursor: 'pointer',
              transition: 'all 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275)',
              animation: `floatIn 0.6s cubic-bezier(0.16, 1, 0.3, 1) ${i * 0.12}s both, float${i} 6s ease-in-out ${i * 0.8}s infinite`,
              position: 'relative',
            }}
            onMouseEnter={(e) => {
              const el = e.currentTarget
              el.style.transform = 'translateY(-16px) scale(1.05)'
              el.style.boxShadow = `0 32px 64px -16px ${app.shadow}, 0 0 0 1px rgba(255,255,255,0.12)`
              el.style.background = 'rgba(255, 255, 255, 0.08)'
            }}
            onMouseLeave={(e) => {
              const el = e.currentTarget
              el.style.transform = ''
              el.style.boxShadow = ''
              el.style.background = 'rgba(255, 255, 255, 0.04)'
            }}
          >
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
                boxShadow: `0 8px 32px -4px ${app.shadow}`,
                transition: 'transform 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275), box-shadow 0.4s ease',
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
                  color: 'rgba(255,255,255,0.35)',
                  fontSize: 13,
                }}
              >
                {app.description}
              </div>
            </div>
          </div>
        ))}
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

        .app-card:hover {
          animation-play-state: paused !important;
        }
      `}</style>
    </div>
  )
}
