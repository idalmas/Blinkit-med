/**
 * StatusLabel Component
 *
 * A small text label that tells the user the current recording state.
 *
 * Props:
 *   - isRecording: whether a recording session is currently active.
 *
 * Used by: RecordPage (app/record/page.tsx)
 *
 * CSS: Uppercase, wide letter-spacing, small font at 50% foreground opacity
 *      to keep it subtle beneath the record button.
 */

interface StatusLabelProps {
  /** Whether a recording is currently in progress. */
  isRecording: boolean;
}

/**
 * StatusLabel — renders a contextual hint below the record button.
 * @param props.isRecording  Current recording state.
 * @returns                  A <p> element with the status text.
 */
export default function StatusLabel({ isRecording }: StatusLabelProps) {
  return (
    <p className="text-sm font-medium uppercase tracking-widest text-foreground/50">
      {isRecording ? "Recording…" : "Tap to record"}
    </p>
  );
}
