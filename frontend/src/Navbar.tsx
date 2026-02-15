/**
 * Navbar.tsx — Top navigation bar for the Revive application.
 *
 * Features:
 *   - Revive brand logo with animated gradient icon
 *   - Navigation links (Home, Apps) with active-state underlines
 *   - Connection status pill showing hardware/system state
 *   - Glassmorphism background with blur
 *
 * This component is rendered at the top-level in main.tsx and appears on all pages.
 * It has a fixed height of var(--navbar-height) = 60px.
 *
 * Parent: main.tsx (rendered above <Routes>)
 * Children: None (leaf component)
 */

import { NavLink } from 'react-router-dom'
import { FaEye } from 'react-icons/fa'

export default function Navbar() {
  return (
    <nav
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        height: 'var(--navbar-height)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 28px',
        background: 'rgba(5, 5, 7, 0.75)',
        backdropFilter: 'blur(20px) saturate(180%)',
        WebkitBackdropFilter: 'blur(20px) saturate(180%)',
        borderBottom: '1px solid var(--border-subtle)',
        zIndex: 1000,
        fontFamily: 'var(--font-sans)',
      }}
    >
      {/* Left: Brand */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        {/* Brand icon with gradient background */}
        <div
          style={{
            width: 32,
            height: 32,
            borderRadius: 10,
            background: 'linear-gradient(135deg, var(--accent-blue), var(--accent-purple))',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 2px 12px rgba(99, 102, 241, 0.3)',
          }}
        >
          <FaEye size={15} color="#fff" />
        </div>
        <span
          style={{
            fontSize: 17,
            fontWeight: 700,
            color: 'var(--text-primary)',
            letterSpacing: '-0.5px',
          }}
        >
          Revive
        </span>
        {/* Version badge */}
        <span
          style={{
            fontSize: 10,
            fontWeight: 600,
            color: 'var(--text-tertiary)',
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-full)',
            padding: '2px 8px',
            letterSpacing: '0.05em',
            textTransform: 'uppercase',
          }}
        >
          beta
        </span>
      </div>

      {/* Center: Navigation links */}
      <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
        {[
          { to: '/', label: 'Home' },
          { to: '/apps', label: 'Apps' },
        ].map(({ to, label }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            style={({ isActive }) => ({
              position: 'relative',
              padding: '8px 18px',
              borderRadius: 10,
              fontSize: 14,
              fontWeight: 500,
              textDecoration: 'none',
              transition: 'all 0.2s ease',
              color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
              background: isActive
                ? 'rgba(255, 255, 255, 0.08)'
                : 'transparent',
            })}
          >
            {({ isActive }: { isActive: boolean }) => (
              <>
                {label}
                {/* Active indicator bar */}
                {isActive && (
                  <span
                    style={{
                      position: 'absolute',
                      bottom: -1,
                      left: '50%',
                      transform: 'translateX(-50%)',
                      width: 20,
                      height: 2,
                      borderRadius: 1,
                      background: 'linear-gradient(90deg, var(--accent-blue), var(--accent-purple))',
                      animation: 'fadeIn 0.2s ease',
                    }}
                  />
                )}
              </>
            )}
          </NavLink>
        ))}
      </div>

      {/* Right: Status indicator */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div
          className="status-pill status-pill--active"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '5px 12px',
            borderRadius: 'var(--radius-full)',
            fontSize: 12,
            fontWeight: 500,
          }}
        >
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: 'var(--accent-green)',
              animation: 'statusPulse 2s ease-in-out infinite',
            }}
          />
          System Active
        </div>
      </div>
    </nav>
  )
}
