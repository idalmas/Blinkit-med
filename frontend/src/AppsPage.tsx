import { useNavigate } from 'react-router-dom'
import { FaAmazon, FaAirbnb } from 'react-icons/fa'
import { SiOpenai } from 'react-icons/si'

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
    name: 'ChatGPT',
    icon: <SiOpenai size={48} />,
    gradient: 'linear-gradient(135deg, #10A37F 0%, #1ED9A4 50%, #10A37F 100%)',
    shadow: 'rgba(16, 163, 127, 0.4)',
    description: 'AI-powered conversations',
  },
  {
    name: 'Airbnb',
    icon: <FaAirbnb size={48} />,
    gradient: 'linear-gradient(135deg, #FF5A5F 0%, #FF8C8F 50%, #FF5A5F 100%)',
    shadow: 'rgba(255, 90, 95, 0.4)',
    description: 'Listings & travel data',
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
          50% { transform: translateY(-14px); }
        }

        @keyframes float2 {
          0%, 100% { transform: translateY(0px); }
          50% { transform: translateY(-8px); }
        }

        .app-card:hover {
          animation-play-state: paused !important;
        }
      `}</style>
    </div>
  )
}
