/**
 * Timer Component
 *
 * Displays elapsed time in MM:SS format. Generic enough to be used by any
 * feature that needs a seconds counter (recording, workouts, etc.).
 *
 * Props:
 *   - elapsed: number of seconds elapsed.
 *
 * Used by: RecordPage (app/record/page.tsx)
 *
 * CSS: Uses Tailwind utility classes — monospaced font, large size,
 *      reduced-opacity foreground for a subtle look.
 */

/** Pad a number to two digits (e.g. 5 → "05"). */
function pad(n: number): string {
  return n.toString().padStart(2, "0");
}

/**
 * formatTime — converts total seconds into an "MM:SS" string.
 * @param totalSeconds  The number of seconds to format.
 * @returns             A string in "MM:SS" format.
 */
function formatTime(totalSeconds: number): string {
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${pad(mins)}:${pad(secs)}`;
}

interface TimerProps {
  /** Number of seconds elapsed. */
  elapsed: number;
}

/**
 * Timer — renders the elapsed time as a large MM:SS display.
 * @param props.elapsed  Seconds elapsed.
 * @returns              A <span> element with the formatted time.
 */
export default function Timer({ elapsed }: TimerProps) {
  return (
    <span className="font-mono text-5xl font-light tracking-widest text-foreground/80">
      {formatTime(elapsed)}
    </span>
  );
}
