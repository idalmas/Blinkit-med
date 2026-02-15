/**
 * AppGrid Component
 *
 * A horizontally-scrollable grid of AppCard tiles. On smaller screens the
 * cards scroll horizontally with snap points; on wider screens they wrap
 * into a centered grid.
 *
 * This component owns the list of available apps (name, route, icon, color).
 * To add a new app, simply append an entry to the `apps` array below.
 *
 * Child component: AppCard (app/components/AppCard.tsx)
 * Parent component: Home page (app/page.tsx)
 *
 * CSS:
 *   - Uses CSS snap scrolling (`snap-x snap-mandatory`) for mobile.
 *   - On md+ screens, switches to a wrapping flex layout.
 *   - Hides the scrollbar with `scrollbar-hide` (custom utility in globals.css).
 *   - Each card has `snap-center` for centered scroll stops.
 */

import AppCard from "./AppCard";

/** Descriptor for a single app shown on the home screen. */
interface AppDescriptor {
  name: string;
  href: string;
  icon: string;
  gradient: string;
  subtitle?: string;
}

/**
 * Master list of apps displayed on the home screen.
 * Add new apps here — the grid re-renders automatically.
 */
const apps: AppDescriptor[] = [
  {
    name: "Zoom",
    href: "/zoom",
    icon: "📹",
    gradient: "from-blue-500 to-blue-700",
    subtitle: "Video calls",
  },
  {
    name: "Record",
    href: "/record",
    icon: "🎙️",
    gradient: "from-red-500 to-red-700",
    subtitle: "Voice memos",
  },
  {
    name: "Notes",
    href: "/notes",
    icon: "📝",
    gradient: "from-yellow-400 to-orange-500",
    subtitle: "Quick notes",
  },
  {
    name: "Calendar",
    href: "/calendar",
    icon: "📅",
    gradient: "from-emerald-400 to-emerald-600",
    subtitle: "Schedule",
  },
  {
    name: "Photos",
    href: "/photos",
    icon: "🖼️",
    gradient: "from-pink-400 to-rose-600",
    subtitle: "Gallery",
  },
  {
    name: "Music",
    href: "/music",
    icon: "🎵",
    gradient: "from-purple-500 to-violet-700",
    subtitle: "Player",
  },
  {
    name: "Chat",
    href: "/chat",
    icon: "💬",
    gradient: "from-teal-400 to-cyan-600",
    subtitle: "Messages",
  },
  {
    name: "Settings",
    href: "/settings",
    icon: "⚙️",
    gradient: "from-gray-500 to-gray-700",
    subtitle: "Preferences",
  },
];

/**
 * AppGrid — renders the scrollable / wrapping grid of app tiles.
 * @returns A scrollable container of AppCard components.
 */
export default function AppGrid() {
  return (
    <div
      className={`
        flex w-full gap-6 overflow-x-auto px-8 py-4
        snap-x snap-mandatory scroll-px-8
        md:flex-wrap md:justify-center md:overflow-visible
        scrollbar-hide
      `}
    >
      {apps.map((app) => (
        <div key={app.name} className="snap-center shrink-0">
          <AppCard
            name={app.name}
            href={app.href}
            icon={app.icon}
            gradient={app.gradient}
            subtitle={app.subtitle}
          />
        </div>
      ))}
    </div>
  );
}
