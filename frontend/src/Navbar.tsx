import { NavLink } from 'react-router-dom'

export default function Navbar() {
  return (
    <nav
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        height: 56,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 24px',
        background: 'rgba(10, 10, 10, 0.85)',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
        zIndex: 1000,
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}
    >
      <span
        style={{
          fontSize: 18,
          fontWeight: 700,
          color: '#fff',
          letterSpacing: '-0.5px',
        }}
      >
        Revive
      </span>

      <div style={{ display: 'flex', gap: 8 }}>
        {[
          { to: '/', label: 'Home' },
          { to: '/apps', label: 'Apps' },
        ].map(({ to, label }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            style={({ isActive }) => ({
              padding: '6px 16px',
              borderRadius: 8,
              fontSize: 14,
              fontWeight: 500,
              textDecoration: 'none',
              transition: 'all 0.2s ease',
              color: isActive ? '#fff' : 'rgba(255,255,255,0.55)',
              background: isActive
                ? 'rgba(255, 255, 255, 0.12)'
                : 'transparent',
            })}
          >
            {label}
          </NavLink>
        ))}
      </div>
    </nav>
  )
}
