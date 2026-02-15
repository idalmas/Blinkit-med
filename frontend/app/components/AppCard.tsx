/**
 * AppCard Component
 *
 * A single app tile used inside the AppGrid. Renders an icon, label, and
 * optional subtitle inside a rounded card that links to the app's route.
 *
 * Props:
 *   - name:       Display name shown beneath the icon.
 *   - href:       The Next.js route the card links to.
 *   - icon:       An emoji or short string rendered as the card's icon.
 *   - gradient:   Tailwind gradient classes for the card background.
 *   - subtitle:   (optional) A secondary line of text below the name.
 *
 * Parent component: AppGrid (app/components/AppGrid.tsx)
 *
 * CSS: The card has a fixed size (160 × 160 px), rounded-3xl corners,
 *      a gradient background, drop shadow, and a scale-up hover/active
 *      transition for tactile feedback.
 */

import Link from "next/link";

interface AppCardProps {
  /** Display name shown beneath the icon. */
  name: string;
  /** Route the card links to. */
  href: string;
  /** Emoji or short text used as the icon. */
  icon: string;
  /** Tailwind gradient classes for the background (e.g. "from-blue-500 to-blue-700"). */
  gradient: string;
  /** Optional secondary text beneath the name. */
  subtitle?: string;
}

/**
 * AppCard — renders a single app tile with icon, name, and link.
 * @param props  See AppCardProps.
 * @returns      A Next.js <Link> wrapping the card UI.
 */
export default function AppCard({
  name,
  href,
  icon,
  gradient,
  subtitle,
}: AppCardProps) {
  return (
    <Link
      href={href}
      className={`
        group relative flex h-40 w-40 flex-col items-center justify-center
        rounded-3xl bg-gradient-to-br ${gradient}
        shadow-lg shadow-black/20 transition-all duration-200
        hover:scale-105 hover:shadow-xl active:scale-95
        focus:outline-none focus-visible:ring-4 focus-visible:ring-white/40
      `}
    >
      {/* Icon */}
      <span className="text-5xl drop-shadow-md transition-transform duration-200 group-hover:scale-110">
        {icon}
      </span>

      {/* Name */}
      <span className="mt-2 text-sm font-semibold text-white drop-shadow-sm">
        {name}
      </span>

      {/* Optional subtitle */}
      {subtitle && (
        <span className="text-[11px] text-white/70">{subtitle}</span>
      )}
    </Link>
  );
}
