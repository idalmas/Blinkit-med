/**
 * Header — Top navigation bar for the app launcher.
 *
 * Renders a fixed-position header with the "Renaissance" brand name on the
 * left and an optional hint string on the right. The brand name uses Playfair
 * Display (medium italic) for a classic serif feel; the hint uses Geist.
 *
 * @param hint - Optional right-side text (e.g. blink navigation instructions).
 *
 * Parent: AppsPage (and potentially other top-level pages)
 * Children: none
 *
 * CSS: Positioned absolutely at top-0, full width, with a subtle bottom
 * border and z-index 20 so it sits above card content.
 */

interface HeaderProps {
  /** Optional helper text shown on the right side of the header. */
  hint?: string
}

/**
 * Header component.
 *
 * @param props.hint - Small instructional text displayed on the right.
 * @returns A top-bar header element.
 */
export default function Header({ hint }: HeaderProps)  {
  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '20px 32px',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        zIndex: 20,
      }}
    >
      <h1
        style={{
          color: '#111',
          fontSize: 22,
          fontWeight: 500,
          fontStyle: 'italic',
          margin: 0,
          letterSpacing: '0.5px',
          fontFamily: '"Playfair Display", Georgia, serif',
        }}
      >
        Renaissance
      </h1>

      {hint && (
        <p
          style={{
            color: 'rgba(0,0,0,0.35)',
            fontSize: 13,
            margin: 0,
            fontFamily: '"Geist", system-ui, -apple-system, sans-serif',
          }}
        >
          {hint}
        </p>
      )}
    </div>
  )
}
