/**
 * RecordButton Component
 *
 * A large circular button that toggles between "record" and "stop" states.
 * While recording, a pulsing red ring provides visual feedback.
 *
 * Props:
 *   - isRecording: whether a recording session is currently active.
 *   - onToggle:    callback invoked when the button is clicked.
 *
 * Used by: RecordPage (app/record/page.tsx)
 *
 * CSS: The button is a 96px (h-24 / w-24) red circle. When recording it
 *      scales up to 110% and shows an animated ping ring behind it.
 *      The inner icon transitions between a circle (idle) and a rounded
 *      square (recording / stop).
 */

interface RecordButtonProps {
  /** Whether a recording is currently in progress. */
  isRecording: boolean;
  /** Called when the user clicks the button to start or stop recording. */
  onToggle: () => void;
}

/**
 * RecordButton — renders the main record/stop button with a pulsing ring.
 * @param props.isRecording  Current recording state.
 * @param props.onToggle     Toggle callback.
 * @returns                  A <div> containing the button and optional pulse ring.
 */
export default function RecordButton({ isRecording, onToggle }: RecordButtonProps) {
  return (
    <div className="relative flex items-center justify-center">
      {/* Pulse ring — only visible while recording */}
      {isRecording && (
        <span className="absolute h-32 w-32 animate-ping rounded-full bg-red-500/30" />
      )}

      <button
        onClick={onToggle}
        aria-label={isRecording ? "Stop recording" : "Start recording"}
        className={`
          relative z-10 flex h-24 w-24 items-center justify-center
          rounded-full shadow-lg transition-all duration-300
          focus:outline-none focus-visible:ring-4 focus-visible:ring-red-400/50
          ${
            isRecording
              ? "bg-red-600 hover:bg-red-700 scale-110"
              : "bg-red-500 hover:bg-red-600"
          }
        `}
      >
        {/* Icon: circle when idle, square (stop) when recording */}
        <span
          className={`
            block bg-white transition-all duration-300
            ${
              isRecording
                ? "h-7 w-7 rounded-sm"
                : "h-10 w-10 rounded-full"
            }
          `}
        />
      </button>
    </div>
  );
}
