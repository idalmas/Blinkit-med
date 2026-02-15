import { useRef, useEffect, useState, useCallback } from 'react'
import type Webcam from 'react-webcam'
import {
  FaceLandmarker,
  FilesetResolver,
} from '@mediapipe/tasks-vision'

const BLINK_THRESHOLD = 0.4
const MIN_BLINK_FRAMES = 1
const MAX_BLINK_FRAMES = 20
const MULTI_BLINK_WINDOW_MS = 600

// Wink detection — uses smoothed scores + relative difference between eyes
const WINK_CLOSED_MIN = 0.25     // closed eye must score at least this
const WINK_DIFF_MIN = 0.12       // minimum difference between eyes
const WINK_RATIO_MIN = 1.8       // closed/open score ratio threshold
const EMA_ALPHA = 0.5            // smoothing factor (higher = more responsive)
const MIN_WINK_FRAMES = 2        // require 2+ consecutive frames for stability
const WINK_COOLDOWN_MS = 500     // cooldown between wink events

// Long-close detection — both eyes closed for 3 seconds
const LONG_CLOSE_MS = 3000

export type BlinkType = 'single' | 'double' | 'triple' | 'wink-left' | 'wink-right' | 'long-close'

interface UseBlinkDetectionOptions {
  onBlink?: (type: BlinkType, count: number) => void
}

export function useBlinkDetection({ onBlink }: UseBlinkDetectionOptions = {}) {
  const webcamRef = useRef<Webcam>(null)
  const landmarkerRef = useRef<FaceLandmarker | null>(null)
  const animFrameRef = useRef<number>(0)
  const lastVideoTimeRef = useRef<number>(-1)

  const closedFrameCountRef = useRef(0)
  const wasBlinkingRef = useRef(false)
  const blinkAccumulatorRef = useRef(0)
  const multiBlinkTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const onBlinkRef = useRef(onBlink)
  onBlinkRef.current = onBlink

  // Wink tracking
  const winkFrameCountRef = useRef(0)
  const winkSideRef = useRef<'left' | 'right' | null>(null)
  const wasWinkingRef = useRef(false)
  const lastWinkTimeRef = useRef(0)

  // EMA-smoothed eye scores for wink detection
  const smoothLeftRef = useRef(0)
  const smoothRightRef = useRef(0)

  // Long-close tracking
  const eyesClosedSinceRef = useRef<number | null>(null)
  const longCloseFiredRef = useRef(false)

  const [status, setStatus] = useState<'loading' | 'ready' | 'detecting' | 'error'>('loading')

  const commitBlinks = useCallback((count: number) => {
    const type: BlinkType = count >= 3 ? 'triple' : count === 2 ? 'double' : 'single'
    onBlinkRef.current?.(type, count)
  }, [])

  const registerBlink = useCallback(() => {
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
      if (finalCount > 0) commitBlinks(finalCount)
    }, MULTI_BLINK_WINDOW_MS)
  }, [commitBlinks])

  // Init MediaPipe
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
          numFaces: 1,
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

  // Detection loop
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

      if (results.faceBlendshapes?.length) {
        const shapes = results.faceBlendshapes[0]?.categories
        if (shapes) {
          const leftScore = shapes.find(s => s.categoryName === 'eyeBlinkLeft')?.score ?? 0
          const rightScore = shapes.find(s => s.categoryName === 'eyeBlinkRight')?.score ?? 0
          const avgScore = (leftScore + rightScore) / 2

          // Both-eyes blink detection (existing logic)
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

          // Long-close detection (both eyes shut for 3+ seconds)
          if (isClosed) {
            if (eyesClosedSinceRef.current === null) {
              eyesClosedSinceRef.current = now
              longCloseFiredRef.current = false
            } else if (!longCloseFiredRef.current && (now - eyesClosedSinceRef.current) >= LONG_CLOSE_MS) {
              longCloseFiredRef.current = true
              onBlinkRef.current?.('long-close', 1)
            }
          } else {
            eyesClosedSinceRef.current = null
            longCloseFiredRef.current = false
          }

          // Wink detection with EMA smoothing + relative difference
          smoothLeftRef.current = EMA_ALPHA * leftScore + (1 - EMA_ALPHA) * smoothLeftRef.current
          smoothRightRef.current = EMA_ALPHA * rightScore + (1 - EMA_ALPHA) * smoothRightRef.current

          const sL = smoothLeftRef.current
          const sR = smoothRightRef.current
          const diff = Math.abs(sL - sR)
          const higher = Math.max(sL, sR)
          const lower = Math.min(sL, sR)
          const ratio = lower < 0.01 ? 999 : higher / lower

          const isWinking = higher >= WINK_CLOSED_MIN && diff >= WINK_DIFF_MIN && ratio >= WINK_RATIO_MIN
          const currentWinkSide: 'left' | 'right' | null = isWinking
            ? (sL > sR ? 'left' : 'right')
            : null

          if (isWinking && currentWinkSide) {
            if (!wasWinkingRef.current) {
              winkSideRef.current = currentWinkSide
              winkFrameCountRef.current = 1
            } else if (winkSideRef.current === currentWinkSide) {
              winkFrameCountRef.current++
            }
          } else {
            if (
              wasWinkingRef.current &&
              winkSideRef.current &&
              winkFrameCountRef.current >= MIN_WINK_FRAMES &&
              winkFrameCountRef.current <= MAX_BLINK_FRAMES
            ) {
              const timeSinceLastWink = now - lastWinkTimeRef.current
              if (timeSinceLastWink > WINK_COOLDOWN_MS) {
                lastWinkTimeRef.current = now
                const type: BlinkType = winkSideRef.current === 'left' ? 'wink-left' : 'wink-right'
                onBlinkRef.current?.(type, 1)
              }
            }
            winkFrameCountRef.current = 0
            winkSideRef.current = null
          }
          wasWinkingRef.current = isWinking
        }
      }
    }

    animFrameRef.current = requestAnimationFrame(detect)
  }, [status, registerBlink])

  useEffect(() => {
    if (status === 'ready' || status === 'detecting') {
      animFrameRef.current = requestAnimationFrame(detect)
    }
    return () => cancelAnimationFrame(animFrameRef.current)
  }, [status, detect])

  useEffect(() => {
    return () => {
      if (multiBlinkTimerRef.current) clearTimeout(multiBlinkTimerRef.current)
    }
  }, [])

  return { webcamRef, status }
}
