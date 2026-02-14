/**
 * Record Page — /record
 *
 * Orchestrates the recording UI by composing three child components:
 *   - Timer        — displays elapsed time in MM:SS format.
 *   - RecordButton — the main record/stop toggle with a pulsing ring.
 *   - StatusLabel  — contextual hint ("Tap to record" / "Recording…").
 *
 * All recording state (isRecording, elapsed, timer interval) lives here
 * and is passed down via props.
 *
 * Child components: Timer, RecordButton, StatusLabel
 *   (all in app/components/)
 */
"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import Timer from "../components/Timer";
import RecordButton from "../components/RecordButton";
import StatusLabel from "../components/StatusLabel";

export default function RecordPage() {
  /* ── state ─────────────────────────────────────────────── */
  const [isRecording, setIsRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /* ── timer logic ───────────────────────────────────────── */

  /** startTimer — begins a 1-second interval that increments `elapsed`. */
  const startTimer = useCallback(() => {
    setElapsed(0);
    timerRef.current = setInterval(() => {
      setElapsed((prev) => prev + 1);
    }, 1000);
  }, []);

  /** stopTimer — clears the running interval. */
  const stopTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  /* Clean up on unmount */
  useEffect(() => {
    return () => stopTimer();
  }, [stopTimer]);

  /* ── handlers ──────────────────────────────────────────── */

  /**
   * toggleRecording — flips the recording state and starts/stops the timer.
   * This is where you'd hook up the MediaRecorder API in a future iteration.
   */
  const toggleRecording = () => {
    if (isRecording) {
      stopTimer();
      setIsRecording(false);
    } else {
      startTimer();
      setIsRecording(true);
    }
  };

  /* ── render ────────────────────────────────────────────── */
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-10 bg-background">
      <Timer elapsed={elapsed} />
      <RecordButton isRecording={isRecording} onToggle={toggleRecording} />
      <StatusLabel isRecording={isRecording} />
    </div>
  );
}
