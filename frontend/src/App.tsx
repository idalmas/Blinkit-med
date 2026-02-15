/**
 * App.tsx — Home page / Blink Detection demo for Revive.
 *
 * This is the main landing page that demonstrates blink detection capabilities.
 * Features:
 *   - Mesh gradient animated background with floating ambient orbs
 *   - Real-time blink detection using MediaPipe FaceLandmarker
 *   - Visual feedback: background color changes on single/double/triple blinks
 *   - Webcam preview with animated pulse ring on blink detection
 *   - Live transcript panel via Deepgram (DiarizationPanel)
 *   - Status bar showing detection state and blink count
 *   - Multi-face tracking with hysteresis-based primary face selection
 *
 * Inputs: None (standalone page, mounts webcam internally)
 * Outputs: Visual feedback based on detected blinks
 *
 * Parent: main.tsx (rendered as "/" route)
 * Children: DiarizationPanel (live transcript sidebar)
 *
 * Blink Detection Logic:
 *   - Uses MediaPipe eyeBlinkLeft/eyeBlinkRight blendshape scores
 *   - BLINK_THRESHOLD > 0.4 for closed eyes
 *   - Multi-blink window (600ms) accumulates blinks into single/double/triple
 *   - Multi-face: selects primary face via area + center scoring with hysteresis
 */

import { useRef, useEffect, useState, useCallback } from 'react'
import Webcam from 'react-webcam'
import {
  FaceLandmarker,
  FilesetResolver,
  type NormalizedLandmark,
} from '@mediapipe/tasks-vision'
import { useRealtimeTranscription } from './useRealtimeTranscription'
import { DiarizationPanel } from './DiarizationPanel'

// ── Blink detection tuning ──
const BLINK_THRESHOLD = 0.4
const MIN_BLINK_FRAMES = 1
const MAX_BLINK_FRAMES = 20
const MULTI_BLINK_WINDOW_MS = 600

// ── Primary face selection tuning ──
const MAX_FACES = 4
const AREA_WEIGHT = 0.7
const CENTER_WEIGHT = 0.3
const HYSTERESIS_MARGIN = 1.3
const HYSTERESIS_FRAMES = 10

type BlinkType = 'single' | 'double' | 'triple'

interface ColorState {
  bg: string
  label: string
  textColor: string
  subColor: string
  accentGlow: string
}

/**
 * Color states for each blink type.
 * Each includes a background, label, text colors, and a glow color for ambient effects.
 */
const COLORS: Record<BlinkType, ColorState> = {
  single: {
    bg: '#050507',
    label: 'ONYX',
    textColor: '#f0f0f5',
    subColor: 'rgba(240,240,245,0.4)',
    accentGlow: 'rgba(99, 102, 241, 0.15)',
  },
  double: {
    bg: '#1a0505',
    label: 'CRIMSON',
    textColor: '#fca5a5',
    subColor: 'rgba(252,165,165,0.4)',
    accentGlow: 'rgba(239, 68, 68, 0.2)',
  },
  triple: {
    bg: '#0f0520',
    label: 'VIOLET',
    textColor: '#c4b5fd',
    subColor: 'rgba(196,181,253,0.4)',
    accentGlow: 'rgba(139, 92, 246, 0.2)',
  },
}

const WHITE: ColorState = {
  bg: '#050507',
  label: 'READY',
  textColor: '#f0f0f5',
  subColor: 'rgba(240,240,245,0.35)',
  accentGlow: 'rgba(99, 102, 241, 0.1)',
}

/**
 * computeFaceArea — Compute bounding box area from face landmarks (normalized 0-1).
 * @param landmarks Array of normalized face landmarks
 * @returns Area as a fraction of the frame
 */
function computeFaceArea(landmarks: NormalizedLandmark[]): number {
  let minX = Infinity, maxX = -Infinity
  let minY = Infinity, maxY = -Infinity
  for (const lm of landmarks) {
    if (lm.x < minX) minX = lm.x
    if (lm.x > maxX) maxX = lm.x
    if (lm.y < minY) minY = lm.y
    if (lm.y > maxY) maxY = lm.y
  }
  return (maxX - minX) * (maxY - minY)
}

/**
 * distanceToCenter — Compute distance from face center (nose tip) to frame center.
 * @param landmarks Array of normalized face landmarks
 * @returns Euclidean distance from nose tip to (0.5, 0.5)
 */
function distanceToCenter(landmarks: NormalizedLandmark[]): number {
  const nose = landmarks[1]
  const dx = nose.x - 0.5
  const dy = nose.y - 0.5
  return Math.sqrt(dx * dx + dy * dy)
}

/**
 * scoreFace — Score each face: higher = more likely to be the primary user.
 * Combines bounding-box area (larger = closer) with proximity to center.
 * @param landmarks Array of normalized face landmarks
 * @returns Combined score (higher is better)
 */
function scoreFace(landmarks: NormalizedLandmark[]): number {
  const area = computeFaceArea(landmarks)
  const centerDist = distanceToCenter(landmarks)
  return area * AREA_WEIGHT + (1 - centerDist) * CENTER_WEIGHT
}

export default function App() {
  const webcamRef = useRef<Webcam>(null)
  const landmarkerRef = useRef<FaceLandmarker | null>(null)
  const animFrameRef = useRef<number>(0)
  const lastVideoTimeRef = useRef<number>(-1)

  // Per-blink frame tracking
  const closedFrameCountRef = useRef<number>(0)
  const wasBlinkingRef = useRef<boolean>(false)

  // Multi-blink accumulator
  const blinkAccumulatorRef = useRef<number>(0)
  const multiBlinkTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Hysteresis state for primary face selection
  const currentPrimaryRef = useRef<number>(0)
  const switchCounterRef = useRef<number>(0)

  const [colorState, setColorState] = useState<ColorState>(WHITE)
  const [status, setStatus] = useState<'loading' | 'ready' | 'detecting' | 'error'>('loading')
  const [lastDetected, setLastDetected] = useState<string>('')
  const [totalBlinks, setTotalBlinks] = useState(0)
  const [faceCount, setFaceCount] = useState(0)
  const [justBlinked, setJustBlinked] = useState(false)

  const {
    isRecording,
    utterances,
    speakers,
    error: transcriptionError,
    startRecording,
    stopRecording,
    clearTranscript,
  } = useRealtimeTranscription()

  /**
   * selectPrimaryFace — Select primary face with combined scoring + hysteresis.
   * @param faceLandmarks Array of face landmark arrays (one per detected face)
   * @returns Index of the primary face
   */
  const selectPrimaryFace = useCallback(
    (faceLandmarks: NormalizedLandmark[][]): number => {
      if (faceLandmarks.length <= 1) {
        currentPrimaryRef.current = 0
        switchCounterRef.current = 0
        return 0
      }

      const scores = faceLandmarks.map(scoreFace)
      let bestIdx = 0
      let bestScore = -Infinity
      for (let i = 0; i < scores.length; i++) {
        if (scores[i] > bestScore) {
          bestScore = scores[i]
          bestIdx = i
        }
      }

      const currentIdx = currentPrimaryRef.current
      if (currentIdx >= faceLandmarks.length) {
        currentPrimaryRef.current = bestIdx
        switchCounterRef.current = 0
        return bestIdx
      }

      if (bestIdx !== currentIdx) {
        if (scores[bestIdx] > scores[currentIdx] * HYSTERESIS_MARGIN) {
          switchCounterRef.current++
          if (switchCounterRef.current >= HYSTERESIS_FRAMES) {
            currentPrimaryRef.current = bestIdx
            switchCounterRef.current = 0
            return bestIdx
          }
        } else {
          switchCounterRef.current = 0
        }
        return currentIdx
      }

      switchCounterRef.current = 0
      return currentIdx
    },
    [],
  )

  /**
   * commitBlinks — Commit the accumulated blinks as a single/double/triple action.
   * Toggles color state or returns to default.
   * @param count Number of accumulated blinks
   */
  const commitBlinks = useCallback((count: number) => {
    let type: BlinkType
    if (count >= 3) {
      type = 'triple'
    } else if (count === 2) {
      type = 'double'
    } else {
      type = 'single'
    }

    setColorState(prev => {
      if (prev.bg === COLORS[type].bg) return WHITE
      return COLORS[type]
    })

    const label = count >= 3 ? 'TRIPLE BLINK' : count === 2 ? 'DOUBLE BLINK' : 'SINGLE BLINK'
    setLastDetected(label)

    // Trigger visual feedback flash
    setJustBlinked(true)
    setTimeout(() => setJustBlinked(false), 600)
  }, [])

  /**
   * registerBlink — Called each time a single blink is registered.
   * Accumulates within MULTI_BLINK_WINDOW_MS before committing.
   */
  const registerBlink = useCallback(() => {
    setTotalBlinks(prev => prev + 1)
    blinkAccumulatorRef.current++

    // Flash feedback on every individual blink
    setJustBlinked(true)
    setTimeout(() => setJustBlinked(false), 400)

    if (multiBlinkTimerRef.current) {
      clearTimeout(multiBlinkTimerRef.current)
    }

    const currentCount = blinkAccumulatorRef.current
    if (currentCount >= 3) {
      blinkAccumulatorRef.current = 0
      commitBlinks(currentCount)
      return
    }

    multiBlinkTimerRef.current = setTimeout(() => {
      const finalCount = blinkAccumulatorRef.current
      blinkAccumulatorRef.current = 0
      if (finalCount > 0) {
        commitBlinks(finalCount)
      }
    }, MULTI_BLINK_WINDOW_MS)
  }, [commitBlinks])

  // Initialize MediaPipe Face Landmarker
  useEffect(() => {
    let cancelled = false
    async function init() {
      try {
        const vision = await FilesetResolver.forVisionTasks(
          'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.32/wasm'
        )
        const landmarker = await FaceLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath:
              'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
            delegate: 'GPU',
          },
          runningMode: 'VIDEO',
          numFaces: MAX_FACES,
          outputFaceBlendshapes: true,
          outputFacialTransformationMatrixes: false,
        })
        if (!cancelled) {
          landmarkerRef.current = landmarker
          setStatus('ready')
        }
      } catch {
        if (!cancelled) setStatus('error')
      }
    }
    init()
    return () => { cancelled = true }
  }, [])

  // Blink detection loop
  const detect = useCallback(() => {
    const video = webcamRef.current?.video
    const landmarker = landmarkerRef.current

    if (!video || !landmarker || video.readyState < 2) {
      animFrameRef.current = requestAnimationFrame(detect)
      return
    }

    if (status === 'ready') setStatus('detecting')
    const now = performance.now()

    if (video.currentTime !== lastVideoTimeRef.current) {
      lastVideoTimeRef.current = video.currentTime
      const results = landmarker.detectForVideo(video, now)
      const detectedFaces = results.faceLandmarks?.length ?? 0
      setFaceCount(detectedFaces)

      if (detectedFaces > 0 && results.faceBlendshapes?.length) {
        const primaryIdx = selectPrimaryFace(results.faceLandmarks)
        const shapes = results.faceBlendshapes[primaryIdx]?.categories
        if (shapes) {
          const leftScore = shapes.find(s => s.categoryName === 'eyeBlinkLeft')?.score ?? 0
          const rightScore = shapes.find(s => s.categoryName === 'eyeBlinkRight')?.score ?? 0
          const avgScore = (leftScore + rightScore) / 2
          const isClosed = avgScore > BLINK_THRESHOLD

          if (isClosed) {
            closedFrameCountRef.current++
          } else {
            if (
              wasBlinkingRef.current &&
              closedFrameCountRef.current >= MIN_BLINK_FRAMES &&
              closedFrameCountRef.current <= MAX_BLINK_FRAMES
            ) {
              registerBlink()
            }
            closedFrameCountRef.current = 0
          }
          wasBlinkingRef.current = isClosed
        }
      }
    }

    animFrameRef.current = requestAnimationFrame(detect)
  }, [status, registerBlink, selectPrimaryFace])

  // Start detection loop when model is ready
  useEffect(() => {
    if (status === 'ready' || status === 'detecting') {
      animFrameRef.current = requestAnimationFrame(detect)
    }
    return () => cancelAnimationFrame(animFrameRef.current)
  }, [status, detect])

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (multiBlinkTimerRef.current) clearTimeout(multiBlinkTimerRef.current)
    }
  }, [])

  const statusText: Record<string, string> = {
    loading: 'Initializing face detection model...',
    ready: 'Model loaded — waiting for camera...',
    detecting: 'Detecting blinks',
    error: 'Failed to load model',
  }

  const statusColor: Record<string, string> = {
    loading: 'var(--accent-amber)',
    ready: 'var(--accent-blue)',
    detecting: 'var(--accent-green)',
    error: 'var(--accent-red)',
  }

  return (
    <div
      className="page bg-mesh"
      style={{
        alignItems: 'center',
        justifyContent: 'center',
        transition: 'background-color 0.4s ease',
        backgroundColor: colorState.bg,
      }}
    >
      {/* ── Ambient floating orbs ── */}
      <div
        style={{
          position: 'absolute',
          width: 500,
          height: 500,
          borderRadius: '50%',
          background: `radial-gradient(circle, ${colorState.accentGlow} 0%, transparent 70%)`,
          top: '5%',
          left: '20%',
          pointerEvents: 'none',
          animation: 'orbDrift1 20s ease-in-out infinite',
          transition: 'background 0.6s ease',
        }}
      />
      <div
        style={{
          position: 'absolute',
          width: 400,
          height: 400,
          borderRadius: '50%',
          background: `radial-gradient(circle, ${colorState.accentGlow} 0%, transparent 70%)`,
          bottom: '10%',
          right: '15%',
          pointerEvents: 'none',
          animation: 'orbDrift2 25s ease-in-out infinite',
          transition: 'background 0.6s ease',
        }}
      />
      <div
        style={{
          position: 'absolute',
          width: 300,
          height: 300,
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(6, 182, 212, 0.06) 0%, transparent 70%)',
          top: '40%',
          right: '40%',
          pointerEvents: 'none',
          animation: 'orbDrift3 18s ease-in-out infinite',
        }}
      />

      {/* ── Status bar (below navbar) ── */}
      <div
        style={{
          position: 'fixed',
          top: 'calc(var(--navbar-height) + 1px)',
          left: 0,
          right: 0,
          padding: '10px 28px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          background: 'rgba(5, 5, 7, 0.6)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          borderBottom: '1px solid var(--border-subtle)',
          zIndex: 10,
          animation: 'slideInDown 0.3s var(--ease-out-expo)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: '50%',
              background: statusColor[status],
              animation: status === 'detecting' ? 'statusPulse 2s ease-in-out infinite' : 'none',
              flexShrink: 0,
            }}
          />
          <span style={{ color: 'var(--text-secondary)', fontSize: 13, fontWeight: 500 }}>
            {statusText[status]}
          </span>
        </div>

        {status === 'detecting' && (
          <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
            {faceCount > 1 && (
              <span
                className="status-pill status-pill--loading"
                style={{ fontSize: 12 }}
              >
                {faceCount} faces — tracking primary
              </span>
            )}
            <span style={{ color: 'var(--text-tertiary)', fontSize: 13, fontWeight: 500 }}>
              Blinks: <span style={{ color: 'var(--accent-blue)', fontWeight: 700 }}>{totalBlinks}</span>
            </span>
          </div>
        )}
      </div>

      {/* ── Center content ── */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 0,
          animation: 'slideInUp 0.5s var(--ease-out-expo)',
          zIndex: 2,
        }}
      >
        {/* Large label */}
        <h1
          style={{
            color: colorState.textColor,
            fontSize: 72,
            fontWeight: 800,
            margin: 0,
            letterSpacing: '-3px',
            transition: 'color 0.3s ease',
            lineHeight: 1,
          }}
        >
          {colorState.label}
        </h1>

        {/* Blink type indicator pill */}
        {lastDetected && (
          <div
            style={{
              marginTop: 20,
              padding: '8px 28px',
              borderRadius: 'var(--radius-full)',
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border-default)',
              color: colorState.textColor,
              fontSize: 13,
              fontWeight: 600,
              letterSpacing: '2px',
              transition: 'all 0.3s ease',
              animation: 'scaleIn 0.3s var(--ease-spring)',
            }}
          >
            {lastDetected}
          </div>
        )}

        {/* Instructions */}
        <p
          style={{
            color: colorState.subColor,
            fontSize: 15,
            marginTop: 24,
            transition: 'color 0.3s ease',
            fontWeight: 400,
          }}
        >
          {status === 'detecting'
            ? '1x blink = onyx · 2x = crimson · 3x = violet'
            : status === 'loading'
              ? 'Loading face detection model...'
              : status === 'error'
                ? 'Failed to load model. Check your connection.'
                : 'Waiting for camera...'}
        </p>

        {/* Quick stats row */}
        {status === 'detecting' && (
          <div
            style={{
              display: 'flex',
              gap: 12,
              marginTop: 40,
              animation: 'fadeIn 0.5s ease 0.3s both',
            }}
          >
            {[
              { label: 'Single', desc: '1x blink', color: '#6366f1' },
              { label: 'Double', desc: '2x rapid', color: '#ef4444' },
              { label: 'Triple', desc: '3x rapid', color: '#8b5cf6' },
            ].map(({ label, desc, color }) => (
              <div
                key={label}
                style={{
                  padding: '14px 20px',
                  borderRadius: 'var(--radius-lg)',
                  background: 'var(--bg-card)',
                  border: '1px solid var(--border-subtle)',
                  textAlign: 'center',
                  minWidth: 110,
                  transition: 'all 0.2s ease',
                }}
              >
                <div
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    background: color,
                    margin: '0 auto 8px',
                    boxShadow: `0 0 12px ${color}40`,
                  }}
                />
                <div style={{ color: 'var(--text-primary)', fontSize: 13, fontWeight: 600 }}>
                  {label}
                </div>
                <div style={{ color: 'var(--text-tertiary)', fontSize: 11, marginTop: 2 }}>
                  {desc}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Diarization panel ── */}
      <DiarizationPanel
        utterances={utterances}
        speakers={speakers}
        isRecording={isRecording}
        error={transcriptionError}
      />

      {/* ── Audio recording controls ── */}
      <div
        style={{
          position: 'fixed',
          bottom: 24,
          left: 24,
          display: 'flex',
          gap: 8,
          zIndex: 30,
        }}
      >
        <button
          onClick={isRecording ? stopRecording : startRecording}
          style={{
            padding: '10px 22px',
            borderRadius: 'var(--radius-md)',
            border: 'none',
            background: isRecording
              ? 'linear-gradient(135deg, #ef4444, #f87171)'
              : 'linear-gradient(135deg, var(--accent-blue), var(--accent-purple))',
            color: '#fff',
            fontSize: 13,
            fontWeight: 600,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            transition: 'all 0.2s ease',
            boxShadow: isRecording
              ? '0 4px 16px rgba(239, 68, 68, 0.3)'
              : '0 4px 16px rgba(99, 102, 241, 0.3)',
          }}
        >
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: isRecording ? 2 : '50%',
              background: '#fff',
              animation: isRecording ? 'statusPulse 1.5s ease-in-out infinite' : 'none',
            }}
          />
          {isRecording ? 'Stop Recording' : 'Start Recording'}
        </button>
        {utterances.length > 0 && !isRecording && (
          <button
            onClick={clearTranscript}
            style={{
              padding: '10px 18px',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--border-default)',
              background: 'var(--bg-elevated)',
              color: 'var(--text-secondary)',
              fontSize: 13,
              cursor: 'pointer',
              transition: 'all 0.2s ease',
            }}
          >
            Clear
          </button>
        )}
      </div>

      {/* ── Webcam preview with blink feedback ring ── */}
      <div
        className={`webcam-container ${
          status === 'detecting' ? 'webcam-container--detecting' : ''
        }`}
        style={{
          animation: justBlinked ? 'pulseRing 0.6s ease-out' : 'none',
          boxShadow: justBlinked
            ? '0 0 0 4px rgba(99, 102, 241, 0.4), 0 8px 32px rgba(0, 0, 0, 0.4)'
            : '0 8px 32px rgba(0, 0, 0, 0.4)',
          transition: 'border-color 0.2s, box-shadow 0.3s',
        }}
      >
        <Webcam
          ref={webcamRef}
          audio={false}
          videoConstraints={{ facingMode: 'user', width: 640, height: 480 }}
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          mirrored
        />
        {/* Status label on webcam */}
        <div
          style={{
            position: 'absolute',
            bottom: 6,
            left: 6,
            right: 6,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <span
            style={{
              fontSize: 10,
              fontWeight: 500,
              color: status === 'detecting' ? '#4ade80' : 'rgba(255,255,255,0.5)',
              background: 'rgba(0,0,0,0.65)',
              padding: '3px 8px',
              borderRadius: 6,
              backdropFilter: 'blur(4px)',
            }}
          >
            {status === 'loading'
              ? 'Loading...'
              : status === 'detecting'
                ? 'Tracking'
                : status}
          </span>
          {faceCount > 0 && (
            <span
              style={{
                fontSize: 10,
                fontWeight: 500,
                color: 'rgba(255,255,255,0.5)',
                background: 'rgba(0,0,0,0.65)',
                padding: '3px 8px',
                borderRadius: 6,
              }}
            >
              {faceCount} face{faceCount !== 1 ? 's' : ''}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
