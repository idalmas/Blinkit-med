import { useRef, useEffect, useState, useCallback } from 'react'
import Webcam from 'react-webcam'
import {
  FaceLandmarker,
  FilesetResolver,
  type NormalizedLandmark,
} from '@mediapipe/tasks-vision'
import { useRealtimeTranscription } from './useRealtimeTranscription'
import { DiarizationPanel } from './DiarizationPanel'

// Blink detection tuning
const BLINK_THRESHOLD = 0.4
const MIN_BLINK_FRAMES = 1
const MAX_BLINK_FRAMES = 20

// How long to wait after a blink before committing the count.
const MULTI_BLINK_WINDOW_MS = 600

// Primary face selection tuning
const MAX_FACES = 4
const AREA_WEIGHT = 0.7
const CENTER_WEIGHT = 0.3
// Hysteresis: require alternative face to beat current by this margin
// for this many consecutive frames before switching
const HYSTERESIS_MARGIN = 1.3
const HYSTERESIS_FRAMES = 10

type BlinkType = 'single' | 'double' | 'triple'

interface ColorState {
  bg: string
  label: string
  textColor: string
  subColor: string
}

const COLORS: Record<BlinkType, ColorState> = {
  single: { bg: '#000000', label: 'BLACK', textColor: '#ffffff', subColor: '#888' },
  double: { bg: '#cc0000', label: 'RED', textColor: '#ffffff', subColor: '#ff9999' },
  triple: { bg: '#7b2d8e', label: 'PURPLE', textColor: '#ffffff', subColor: '#d4a0e0' },
}

const WHITE: ColorState = { bg: '#ffffff', label: 'WHITE', textColor: '#000000', subColor: '#999' }

// Compute bounding box area from face landmarks (normalized 0-1)
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

// Compute distance from face center (nose tip) to frame center
function distanceToCenter(landmarks: NormalizedLandmark[]): number {
  const nose = landmarks[1] // nose tip landmark
  const dx = nose.x - 0.5
  const dy = nose.y - 0.5
  return Math.sqrt(dx * dx + dy * dy)
}

// Score each face: higher = more likely to be the primary user
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

  const {
    isRecording,
    utterances,
    speakers,
    error: transcriptionError,
    startRecording,
    stopRecording,
    clearTranscript,
  } = useRealtimeTranscription()

  // Select primary face with combined scoring + hysteresis
  const selectPrimaryFace = useCallback(
    (faceLandmarks: NormalizedLandmark[][]): number => {
      if (faceLandmarks.length <= 1) {
        currentPrimaryRef.current = 0
        switchCounterRef.current = 0
        return 0
      }

      // Score all faces
      const scores = faceLandmarks.map(scoreFace)

      // Find the highest-scoring face
      let bestIdx = 0
      let bestScore = -Infinity
      for (let i = 0; i < scores.length; i++) {
        if (scores[i] > bestScore) {
          bestScore = scores[i]
          bestIdx = i
        }
      }

      const currentIdx = currentPrimaryRef.current

      // If current primary is no longer detected, switch immediately
      if (currentIdx >= faceLandmarks.length) {
        currentPrimaryRef.current = bestIdx
        switchCounterRef.current = 0
        return bestIdx
      }

      // If best face is different from current primary, apply hysteresis
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
        // Stick with current primary until hysteresis threshold is met
        return currentIdx
      }

      // Best face is the current primary — reset counter
      switchCounterRef.current = 0
      return currentIdx
    },
    [],
  )

  // Commit the accumulated blinks as a single/double/triple action
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
  }, [])

  // Called each time a single blink is registered
  const registerBlink = useCallback(() => {
    setTotalBlinks(prev => prev + 1)
    blinkAccumulatorRef.current++

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
    return () => {
      cancelled = true
    }
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
        // Select primary face using combined score + hysteresis
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

  const statusText = {
    loading: 'Loading face detection model...',
    ready: 'Model loaded. Waiting for camera...',
    detecting: '1x blink = black | 2x blink = red | 3x blink = purple',
    error: 'Failed to load model. Check your connection.',
  }

  const isDark = colorState.bg !== '#ffffff'

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: colorState.bg,
        transition: 'background-color 0.2s ease',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}
    >
      {/* Status bar */}
      <div
        style={{
          position: 'fixed',
          top: 56,
          left: 0,
          right: 0,
          padding: '12px 20px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          backgroundColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)',
          backdropFilter: 'blur(10px)',
          zIndex: 10,
        }}
      >
        <span style={{ color: isDark ? '#fff' : '#000', fontSize: '14px' }}>
          {statusText[status]}
        </span>
        {status === 'detecting' && (
          <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
            {faceCount > 1 && (
              <span
                style={{
                  color: isDark ? '#ffcc00' : '#996600',
                  fontSize: '13px',
                  padding: '2px 10px',
                  borderRadius: '10px',
                  backgroundColor: isDark ? 'rgba(255,204,0,0.15)' : 'rgba(153,102,0,0.1)',
                }}
              >
                {faceCount} faces — tracking primary
              </span>
            )}
            <span style={{ color: isDark ? '#aaa' : '#666', fontSize: '14px' }}>
              Blinks: {totalBlinks}
            </span>
          </div>
        )}
      </div>

      {/* Center content */}
      <h1
        style={{
          color: colorState.textColor,
          fontSize: '64px',
          fontWeight: 300,
          margin: 0,
          transition: 'color 0.2s ease',
        }}
      >
        {colorState.label}
      </h1>

      {lastDetected && (
        <div
          style={{
            marginTop: '16px',
            padding: '8px 24px',
            borderRadius: '20px',
            backgroundColor: isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.08)',
            color: colorState.textColor,
            fontSize: '16px',
            fontWeight: 500,
            letterSpacing: '2px',
            transition: 'all 0.2s ease',
          }}
        >
          {lastDetected}
        </div>
      )}

      <p
        style={{
          color: colorState.subColor,
          fontSize: '16px',
          marginTop: '20px',
          transition: 'color 0.2s ease',
        }}
      >
        blink again to return to white
      </p>

      {/* Diarization panel */}
      <DiarizationPanel
        utterances={utterances}
        speakers={speakers}
        isRecording={isRecording}
        error={transcriptionError}
      />

      {/* Audio recording controls */}
      <div
        style={{
          position: 'fixed',
          bottom: 20,
          left: 20,
          display: 'flex',
          gap: 8,
          zIndex: 30,
        }}
      >
        <button
          onClick={isRecording ? stopRecording : startRecording}
          style={{
            padding: '10px 20px',
            borderRadius: 8,
            border: 'none',
            backgroundColor: isRecording ? '#ef4444' : '#3b82f6',
            color: '#fff',
            fontSize: 14,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          {isRecording ? 'Stop Recording' : 'Start Recording'}
        </button>
        {utterances.length > 0 && !isRecording && (
          <button
            onClick={clearTranscript}
            style={{
              padding: '10px 16px',
              borderRadius: 8,
              border: '1px solid rgba(255,255,255,0.2)',
              backgroundColor: 'rgba(255,255,255,0.1)',
              color: '#fff',
              fontSize: 14,
              cursor: 'pointer',
            }}
          >
            Clear
          </button>
        )}
      </div>

      {/* Webcam preview */}
      <div
        style={{
          position: 'fixed',
          bottom: 20,
          right: 20,
          width: 200,
          height: 150,
          borderRadius: 12,
          overflow: 'hidden',
          border: `2px solid ${isDark ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.1)'}`,
          zIndex: 10,
        }}
      >
        <Webcam
          ref={webcamRef}
          audio={false}
          videoConstraints={{ facingMode: 'user', width: 640, height: 480 }}
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          mirrored
        />
      </div>
    </div>
  )
}
