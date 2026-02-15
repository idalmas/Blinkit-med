/**
 * SubwaySurfersPage — A Subway-Surfers-style 3-lane endless runner.
 *
 * The player runs along an infinite track split into three lanes (left, center,
 * right). Obstacles scroll toward the player and must be dodged by switching
 * lanes. Coins can be collected for bonus points.
 *
 * Controls — only two inputs:
 *   - wink-left  → move one lane to the left
 *   - wink-right → move one lane to the right
 *   - blink (both eyes) → start / restart the game
 *   - long-close (eyes shut ~2 s) → return to /apps
 *
 * Keyboard fallback:
 *   - ArrowLeft / A → move left
 *   - ArrowRight / D → move right
 *   - Space / Enter → start / restart
 *
 * The game progressively speeds up and obstacle density increases over time.
 * High score is persisted to localStorage.
 *
 * Parent : mounted by src/main.tsx at /apps/subway-surfers
 * Children: none
 * Dependencies: react, react-router-dom, react-webcam, @mediapipe/tasks-vision,
 *               react-icons
 *
 * CSS: All styles are inline. The canvas fills the centre of the page; a small
 * webcam preview + blink badge sits fixed in the bottom-right corner.
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import Webcam from 'react-webcam'
import { FaArrowLeft, FaRunning } from 'react-icons/fa'
import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision'

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

/** Canvas dimensions (portrait orientation like a phone screen). */
const CANVAS_W = 400
const CANVAS_H = 700

/** Number of lanes and geometry. */
const NUM_LANES = 3
const LANE_W = CANVAS_W / NUM_LANES

/** Player dimensions & position. */
const PLAYER_W = 40
const PLAYER_H = 60
const PLAYER_Y = CANVAS_H - 120

/** Starting speed and acceleration. */
const BASE_SPEED = 4
const SPEED_INCREMENT = 0.0008

/** Obstacle spawning. */
const MIN_SPAWN_INTERVAL = 50
const MAX_SPAWN_INTERVAL = 90
const OBSTACLE_W = 50
const OBSTACLE_H = 70

/** Coins. */
const COIN_R = 10
const COIN_SPAWN_CHANCE = 0.35

/** Blink detection — both-eyes blink to start/restart only. */
const BLINK_SCORE_THRESHOLD = 0.45
const BLINK_COOLDOWN_MS = 300

/** Wink detection thresholds (tuned to match useBlinkDetection.ts). */
const WINK_CLOSED_MIN = 0.25
const WINK_DIFF_MIN = 0.12
const WINK_RATIO_MIN = 1.8
const EMA_ALPHA = 0.5
const MIN_WINK_FRAMES = 2
const WINK_COOLDOWN_MS = 400

/** Long close — eyes shut ~2 s to navigate back. */
const LONG_CLOSE_MS = 2000

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

/** An obstacle the player must dodge by switching lanes. */
interface Obstacle {
  /** Lane index (0 = left, 1 = center, 2 = right). */
  lane: number
  /** Current Y position on canvas (scrolls downward). */
  y: number
  /** Width of this obstacle. */
  w: number
  /** Height of this obstacle. */
  h: number
  /** Visual variant — purely cosmetic, both are solid collisions. */
  kind: 'train' | 'barrier'
}

/** A collectible coin. */
interface Coin {
  lane: number
  y: number
  collected: boolean
}

/**
 * Full mutable game state held in a ref for the animation loop.
 * No jump fields — only lane switching.
 */
interface GameState {
  /** Current lane the player occupies (0–2). */
  lane: number
  /** Target lane for smooth interpolation. */
  targetLane: number
  /** Visual X position of the player (smoothly lerps). */
  playerX: number
  /** Active obstacles on screen. */
  obstacles: Obstacle[]
  /** Active coins on screen. */
  coins: Coin[]
  /** Distance-based score. */
  score: number
  /** Bonus score from coins. */
  coinScore: number
  /** Frame counter since game started. */
  frame: number
  /** Current scroll speed (increases over time). */
  speed: number
  /** Frames until next obstacle spawn. */
  spawnTimer: number
  /** Current spawn interval (shrinks over time). */
  spawnInterval: number
  /** Game phase. */
  phase: 'waiting' | 'playing' | 'dead'
  /** Track stripe offset for scrolling ground effect. */
  stripeOffset: number
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

/**
 * Creates a fresh GameState with defaults.
 *
 * @returns A new GameState ready for the 'waiting' screen.
 */
function initState(): GameState {
  return {
    lane: 1,
    targetLane: 1,
    playerX: laneCenter(1),
    obstacles: [],
    coins: [],
    score: 0,
    coinScore: 0,
    frame: 0,
    speed: BASE_SPEED,
    spawnTimer: MAX_SPAWN_INTERVAL,
    spawnInterval: MAX_SPAWN_INTERVAL,
    phase: 'waiting',
    stripeOffset: 0,
  }
}

/**
 * Returns the X centre of a lane.
 *
 * @param lane - Lane index (0–2).
 * @returns Pixel X of the lane's centre.
 */
function laneCenter(lane: number): number {
  return lane * LANE_W + LANE_W / 2
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

/**
 * SubwaySurfersPage — the full-screen game page.
 *
 * Renders a canvas-based 3-lane runner with only left/right controls.
 * Blink starts/restarts, wink-left/right switches lanes, long-close
 * navigates back to /apps.
 *
 * @returns JSX for the Subway Surfers game page.
 */
export default function SubwaySurfersPage() {
  const navigate = useNavigate()

  /* ---- React state (UI display only) ---- */
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const gameRef = useRef<GameState>(initState())
  const animRef = useRef<number>(0)
  const [score, setScore] = useState(0)
  const [highScore, setHighScore] = useState(() => {
    const stored = localStorage.getItem('revive-subway-highscore')
    return stored ? parseInt(stored, 10) : 0
  })
  const [phase, setPhase] = useState<'waiting' | 'playing' | 'dead'>('waiting')
  const [blinkStatus, setBlinkStatus] = useState<
    'loading' | 'ready' | 'detecting' | 'error'
  >('loading')

  /* ---- Refs for blink / wink detection ---- */
  const webcamRef = useRef<Webcam>(null)
  const landmarkerRef = useRef<FaceLandmarker | null>(null)
  const lastVideoTimeRef = useRef(-1)
  const detectAnimRef = useRef<number>(0)

  // Blink (both-eyes) leading-edge detection
  const eyesWereClosedRef = useRef(false)
  const lastBlinkTimeRef = useRef(0)

  // Wink EMA smoothing
  const smoothLeftRef = useRef(0)
  const smoothRightRef = useRef(0)
  const wasWinkingRef = useRef(false)
  const winkSideRef = useRef<'left' | 'right' | null>(null)
  const winkFrameCountRef = useRef(0)
  const lastWinkTimeRef = useRef(0)

  // Long-close
  const eyesClosedSinceRef = useRef<number | null>(null)
  const longCloseFiredRef = useRef(false)

  /* ---- Action refs (stable across renders) ---- */
  const moveLeftRef = useRef<() => void>(() => {})
  const moveRightRef = useRef<() => void>(() => {})
  const startOrRestartRef = useRef<() => void>(() => {})

  /* ---- Actions ---- */

  /**
   * moveLeft — shift the player one lane to the left (clamped at lane 0).
   */
  const moveLeft = useCallback(() => {
    const g = gameRef.current
    if (g.phase !== 'playing') return
    if (g.targetLane > 0) {
      g.targetLane--
      g.lane = g.targetLane
    }
  }, [])

  /**
   * moveRight — shift the player one lane to the right (clamped at lane 2).
   */
  const moveRight = useCallback(() => {
    const g = gameRef.current
    if (g.phase !== 'playing') return
    if (g.targetLane < NUM_LANES - 1) {
      g.targetLane++
      g.lane = g.targetLane
    }
  }, [])

  /**
   * startOrRestart — begin a new game from waiting or dead state.
   */
  const startOrRestart = useCallback(() => {
    const g = gameRef.current
    if (g.phase === 'waiting') {
      g.phase = 'playing'
      setPhase('playing')
    } else if (g.phase === 'dead') {
      const fresh = initState()
      fresh.phase = 'playing'
      gameRef.current = fresh
      setPhase('playing')
      setScore(0)
    }
  }, [])

  // Keep refs current
  moveLeftRef.current = moveLeft
  moveRightRef.current = moveRight
  startOrRestartRef.current = startOrRestart

  /* ---- MediaPipe FaceLandmarker init ---- */
  useEffect(() => {
    let cancelled = false
    async function init() {
      try {
        const vision = await FilesetResolver.forVisionTasks(
          'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.32/wasm',
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
          setBlinkStatus('ready')
        }
      } catch {
        if (!cancelled) setBlinkStatus('error')
      }
    }
    init()
    return () => {
      cancelled = true
    }
  }, [])

  /* ---- Blink / wink / long-close detection loop ---- */
  useEffect(() => {
    if (blinkStatus !== 'ready' && blinkStatus !== 'detecting') return

    const detectLoop = () => {
      const video = webcamRef.current?.video
      const landmarker = landmarkerRef.current

      if (!video || !landmarker || video.readyState < 2) {
        detectAnimRef.current = requestAnimationFrame(detectLoop)
        return
      }

      if (blinkStatus === 'ready') setBlinkStatus('detecting')

      const now = performance.now()
      if (video.currentTime !== lastVideoTimeRef.current) {
        lastVideoTimeRef.current = video.currentTime
        const results = landmarker.detectForVideo(video, now)

        if (results.faceBlendshapes?.length) {
          const shapes = results.faceBlendshapes[0]?.categories
          if (shapes) {
            const leftScore =
              shapes.find((s) => s.categoryName === 'eyeBlinkLeft')?.score ?? 0
            const rightScore =
              shapes.find((s) => s.categoryName === 'eyeBlinkRight')?.score ?? 0
            const avgScore = (leftScore + rightScore) / 2

            /* ---------- Both-eyes blink → start / restart only ---------- */
            const eyesClosed = avgScore > BLINK_SCORE_THRESHOLD

            if (eyesClosed && !eyesWereClosedRef.current) {
              const elapsed = now - lastBlinkTimeRef.current
              if (elapsed > BLINK_COOLDOWN_MS) {
                lastBlinkTimeRef.current = now
                const g = gameRef.current
                if (g.phase !== 'playing') {
                  startOrRestartRef.current()
                }
              }
            }
            eyesWereClosedRef.current = eyesClosed

            /* ---------- EMA smoothing for wink detection ---------- */
            smoothLeftRef.current =
              EMA_ALPHA * leftScore + (1 - EMA_ALPHA) * smoothLeftRef.current
            smoothRightRef.current =
              EMA_ALPHA * rightScore + (1 - EMA_ALPHA) * smoothRightRef.current

            const sL = smoothLeftRef.current
            const sR = smoothRightRef.current
            const diff = Math.abs(sL - sR)
            const higher = Math.max(sL, sR)
            const lower = Math.min(sL, sR)
            const ratio = lower < 0.01 ? 999 : higher / lower

            const isWinking =
              higher >= WINK_CLOSED_MIN &&
              diff >= WINK_DIFF_MIN &&
              ratio >= WINK_RATIO_MIN
            const currentWinkSide: 'left' | 'right' | null = isWinking
              ? sL > sR
                ? 'left'
                : 'right'
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
                winkFrameCountRef.current >= MIN_WINK_FRAMES
              ) {
                const timeSinceLast = now - lastWinkTimeRef.current
                if (timeSinceLast > WINK_COOLDOWN_MS) {
                  lastWinkTimeRef.current = now
                  if (winkSideRef.current === 'left') {
                    moveLeftRef.current()
                  } else {
                    moveRightRef.current()
                  }
                }
              }
              winkFrameCountRef.current = 0
              winkSideRef.current = null
            }
            wasWinkingRef.current = isWinking

            /* ---------- Long-close → navigate back ---------- */
            const smoothAvg = (sL + sR) / 2
            const bothClosed = sL > 0.34 && sR > 0.34
            const symmetric = Math.abs(sL - sR) <= 0.1
            const isLongClosed = smoothAvg > 0.28 && bothClosed && symmetric

            if (isLongClosed) {
              if (eyesClosedSinceRef.current === null) {
                eyesClosedSinceRef.current = now
                longCloseFiredRef.current = false
              } else if (
                !longCloseFiredRef.current &&
                now - eyesClosedSinceRef.current >= LONG_CLOSE_MS
              ) {
                longCloseFiredRef.current = true
                navigate('/apps')
              }
            } else {
              eyesClosedSinceRef.current = null
              longCloseFiredRef.current = false
            }
          }
        }
      }

      detectAnimRef.current = requestAnimationFrame(detectLoop)
    }

    detectAnimRef.current = requestAnimationFrame(detectLoop)
    return () => cancelAnimationFrame(detectAnimRef.current)
  }, [blinkStatus, navigate])

  /* ---- Keyboard controls (left / right only) ---- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'ArrowLeft' || e.key === 'a' || e.key === 'A') {
        e.preventDefault()
        const g = gameRef.current
        if (g.phase !== 'playing') {
          startOrRestart()
        } else {
          moveLeft()
        }
      } else if (e.code === 'ArrowRight' || e.key === 'd' || e.key === 'D') {
        e.preventDefault()
        const g = gameRef.current
        if (g.phase !== 'playing') {
          startOrRestart()
        } else {
          moveRight()
        }
      } else if (e.code === 'Space' || e.code === 'Enter') {
        e.preventDefault()
        startOrRestart()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [moveLeft, moveRight, startOrRestart])

  /* ---- Canvas click to start / restart ---- */
  const handleCanvasClick = useCallback(() => {
    startOrRestart()
  }, [startOrRestart])

  /* ---- Main game loop ---- */
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const loop = () => {
      const g = gameRef.current

      /* ============== UPDATE ============== */
      if (g.phase === 'playing') {
        g.frame++

        // Speed ramp
        g.speed = BASE_SPEED + g.frame * SPEED_INCREMENT
        g.spawnInterval = Math.max(
          MIN_SPAWN_INTERVAL,
          MAX_SPAWN_INTERVAL - g.frame * 0.05,
        )

        // Scroll ground stripes
        g.stripeOffset = (g.stripeOffset + g.speed) % 40

        // Smooth lane interpolation
        const target = laneCenter(g.targetLane)
        g.playerX += (target - g.playerX) * 0.2

        // Spawn obstacles
        g.spawnTimer--
        if (g.spawnTimer <= 0) {
          g.spawnTimer = Math.floor(g.spawnInterval)

          // Pick 1-2 lanes to block (never all 3 so player always has a way)
          const blockedCount = Math.random() < 0.25 ? 2 : 1
          const lanes = [0, 1, 2].sort(() => Math.random() - 0.5)
          for (let i = 0; i < blockedCount; i++) {
            const kind: 'train' | 'barrier' =
              Math.random() < 0.5 ? 'train' : 'barrier'
            g.obstacles.push({
              lane: lanes[i],
              y: -OBSTACLE_H,
              w: OBSTACLE_W,
              h: OBSTACLE_H,
              kind,
            })
          }

          // Possibly spawn a coin in a free lane
          if (Math.random() < COIN_SPAWN_CHANCE) {
            const freeLanes = [0, 1, 2].filter(
              (l) => !lanes.slice(0, blockedCount).includes(l),
            )
            if (freeLanes.length > 0) {
              const cl = freeLanes[Math.floor(Math.random() * freeLanes.length)]
              g.coins.push({ lane: cl, y: -COIN_R * 2, collected: false })
            }
          }
        }

        // Move obstacles & coins
        for (const obs of g.obstacles) obs.y += g.speed
        for (const coin of g.coins) coin.y += g.speed

        // Remove off-screen
        g.obstacles = g.obstacles.filter((o) => o.y < CANVAS_H + 20)
        g.coins = g.coins.filter((c) => c.y < CANVAS_H + 20)

        // Collision — obstacles (no jumping, just lane dodging)
        const px = g.playerX - PLAYER_W / 2
        const py = PLAYER_Y
        for (const obs of g.obstacles) {
          const ox = laneCenter(obs.lane) - obs.w / 2
          const oy = obs.y

          const overlapX = px + PLAYER_W > ox && px < ox + obs.w
          const overlapY = py + PLAYER_H > oy && py < oy + obs.h

          if (overlapX && overlapY) {
            g.phase = 'dead'
            setPhase('dead')
            const total = g.score + g.coinScore
            if (total > highScore) {
              setHighScore(total)
              localStorage.setItem('revive-subway-highscore', String(total))
            }
            break
          }
        }

        // Collision — coins
        for (const coin of g.coins) {
          if (coin.collected) continue
          const cx = laneCenter(coin.lane)
          const cy = coin.y
          const pcx = g.playerX
          const pcy = PLAYER_Y + PLAYER_H / 2
          const dist = Math.sqrt((pcx - cx) ** 2 + (pcy - cy) ** 2)
          if (dist < COIN_R + PLAYER_W / 2) {
            coin.collected = true
            g.coinScore += 50
          }
        }

        // Distance score
        g.score = Math.floor(g.frame / 5)
        setScore(g.score + g.coinScore)
      }

      /* ============== DRAW ============== */

      // Sky gradient
      const skyGrad = ctx.createLinearGradient(0, 0, 0, CANVAS_H)
      skyGrad.addColorStop(0, '#1a1a2e')
      skyGrad.addColorStop(0.4, '#16213e')
      skyGrad.addColorStop(1, '#0f3460')
      ctx.fillStyle = skyGrad
      ctx.fillRect(0, 0, CANVAS_W, CANVAS_H)

      // Track / road
      ctx.fillStyle = '#2d2d3f'
      ctx.fillRect(20, 0, CANVAS_W - 40, CANVAS_H)

      // Lane dividers (dashed, scrolling)
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)'
      ctx.lineWidth = 2
      ctx.setLineDash([20, 20])
      for (let i = 1; i < NUM_LANES; i++) {
        const x = 20 + (i * (CANVAS_W - 40)) / NUM_LANES
        ctx.lineDashOffset = -g.stripeOffset
        ctx.beginPath()
        ctx.moveTo(x, 0)
        ctx.lineTo(x, CANVAS_H)
        ctx.stroke()
      }
      ctx.setLineDash([])

      // Road edges (bright lines)
      ctx.strokeStyle = 'rgba(255, 200, 0, 0.3)'
      ctx.lineWidth = 3
      ctx.beginPath()
      ctx.moveTo(20, 0)
      ctx.lineTo(20, CANVAS_H)
      ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(CANVAS_W - 20, 0)
      ctx.lineTo(CANVAS_W - 20, CANVAS_H)
      ctx.stroke()

      // Scrolling ground stripes (for speed feeling)
      ctx.fillStyle = 'rgba(255,255,255,0.03)'
      for (let y = -40 + g.stripeOffset; y < CANVAS_H; y += 40) {
        ctx.fillRect(20, y, CANVAS_W - 40, 10)
      }

      // Obstacles
      for (const obs of g.obstacles) {
        const ox = laneCenter(obs.lane) - obs.w / 2
        if (obs.kind === 'train') {
          // Train body
          const trainGrad = ctx.createLinearGradient(ox, obs.y, ox + obs.w, obs.y)
          trainGrad.addColorStop(0, '#e74c3c')
          trainGrad.addColorStop(0.5, '#c0392b')
          trainGrad.addColorStop(1, '#e74c3c')
          ctx.fillStyle = trainGrad
          ctx.beginPath()
          ctx.roundRect(ox, obs.y, obs.w, obs.h, 6)
          ctx.fill()
          // Windows
          ctx.fillStyle = 'rgba(255, 255, 150, 0.7)'
          const winY = obs.y + 12
          for (let wi = 0; wi < 3; wi++) {
            ctx.fillRect(ox + 6 + wi * 16, winY, 10, 10)
          }
          // Roof stripe
          ctx.fillStyle = 'rgba(0,0,0,0.2)'
          ctx.fillRect(ox, obs.y, obs.w, 6)
        } else {
          // Barrier
          ctx.fillStyle = '#f39c12'
          ctx.beginPath()
          ctx.roundRect(ox, obs.y, obs.w, obs.h, 4)
          ctx.fill()
          // Hazard stripes
          ctx.fillStyle = '#2c3e50'
          for (let si = 0; si < obs.w; si += 16) {
            ctx.fillRect(ox + si, obs.y, 8, obs.h)
          }
          ctx.strokeStyle = '#e67e22'
          ctx.lineWidth = 2
          ctx.beginPath()
          ctx.roundRect(ox, obs.y, obs.w, obs.h, 4)
          ctx.stroke()
        }
      }

      // Coins
      for (const coin of g.coins) {
        if (coin.collected) continue
        const cx = laneCenter(coin.lane)
        const cy = coin.y

        // Outer glow
        ctx.fillStyle = 'rgba(255, 215, 0, 0.2)'
        ctx.beginPath()
        ctx.arc(cx, cy, COIN_R + 4, 0, Math.PI * 2)
        ctx.fill()

        // Coin body
        const coinGrad = ctx.createRadialGradient(cx - 2, cy - 2, 2, cx, cy, COIN_R)
        coinGrad.addColorStop(0, '#FFD700')
        coinGrad.addColorStop(1, '#DAA520')
        ctx.fillStyle = coinGrad
        ctx.beginPath()
        ctx.arc(cx, cy, COIN_R, 0, Math.PI * 2)
        ctx.fill()

        // $ symbol
        ctx.fillStyle = '#8B6914'
        ctx.font = 'bold 12px system-ui'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText('$', cx, cy + 1)
      }

      // Player (no jump offset — always on the ground)
      const plX = g.playerX
      const plY = PLAYER_Y
      ctx.save()
      ctx.translate(plX, plY)

      // Body
      const bodyGrad = ctx.createLinearGradient(-PLAYER_W / 2, 0, PLAYER_W / 2, 0)
      bodyGrad.addColorStop(0, '#3b82f6')
      bodyGrad.addColorStop(0.5, '#60a5fa')
      bodyGrad.addColorStop(1, '#3b82f6')
      ctx.fillStyle = bodyGrad
      ctx.beginPath()
      ctx.roundRect(-PLAYER_W / 2, 10, PLAYER_W, PLAYER_H - 10, 8)
      ctx.fill()

      // Head
      ctx.fillStyle = '#fbbf24'
      ctx.beginPath()
      ctx.arc(0, 6, 14, 0, Math.PI * 2)
      ctx.fill()

      // Eyes
      ctx.fillStyle = '#1e293b'
      ctx.beginPath()
      ctx.arc(-4, 4, 2, 0, Math.PI * 2)
      ctx.fill()
      ctx.beginPath()
      ctx.arc(4, 4, 2, 0, Math.PI * 2)
      ctx.fill()

      // Running legs animation
      const legSwing = g.phase === 'playing' ? Math.sin(g.frame * 0.3) * 8 : 0
      ctx.strokeStyle = '#1e40af'
      ctx.lineWidth = 5
      ctx.lineCap = 'round'
      ctx.beginPath()
      ctx.moveTo(-6, PLAYER_H - 4)
      ctx.lineTo(-6 + legSwing, PLAYER_H + 10)
      ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(6, PLAYER_H - 4)
      ctx.lineTo(6 - legSwing, PLAYER_H + 10)
      ctx.stroke()

      ctx.restore()

      // HUD — Score
      ctx.fillStyle = '#fff'
      ctx.font = 'bold 28px system-ui, sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'top'
      ctx.strokeStyle = 'rgba(0,0,0,0.5)'
      ctx.lineWidth = 3
      const displayScore = g.score + g.coinScore
      ctx.strokeText(String(displayScore), CANVAS_W / 2, 20)
      ctx.fillText(String(displayScore), CANVAS_W / 2, 20)

      // Speed indicator
      ctx.font = '12px system-ui'
      ctx.fillStyle = 'rgba(255,255,255,0.4)'
      ctx.fillText(`${g.speed.toFixed(1)}x`, CANVAS_W / 2, 52)

      /* ---- Overlays ---- */
      if (g.phase === 'waiting') {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.45)'
        ctx.fillRect(0, 0, CANVAS_W, CANVAS_H)

        ctx.fillStyle = '#fff'
        ctx.font = 'bold 32px system-ui'
        ctx.textAlign = 'center'
        ctx.fillText('Subway Surfers', CANVAS_W / 2, CANVAS_H / 2 - 50)

        ctx.font = '16px system-ui'
        ctx.fillStyle = 'rgba(255,255,255,0.7)'
        ctx.fillText('Wink left/right to dodge', CANVAS_W / 2, CANVAS_H / 2)
        ctx.fillText('Blink or tap to start', CANVAS_W / 2, CANVAS_H / 2 + 30)

        ctx.font = '28px system-ui'
        ctx.fillStyle = 'rgba(255,255,255,0.5)'
        ctx.fillText('← 👁 →', CANVAS_W / 2, CANVAS_H / 2 + 80)
      }

      if (g.phase === 'dead') {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.55)'
        ctx.fillRect(0, 0, CANVAS_W, CANVAS_H)

        ctx.fillStyle = '#ff6b6b'
        ctx.font = 'bold 36px system-ui'
        ctx.textAlign = 'center'
        ctx.fillText('Game Over', CANVAS_W / 2, CANVAS_H / 2 - 50)

        ctx.fillStyle = '#fff'
        ctx.font = '22px system-ui'
        ctx.fillText(`Score: ${g.score + g.coinScore}`, CANVAS_W / 2, CANVAS_H / 2)

        ctx.font = '16px system-ui'
        ctx.fillStyle = 'rgba(255,255,255,0.6)'
        ctx.fillText('Blink or tap to restart', CANVAS_W / 2, CANVAS_H / 2 + 40)
      }

      animRef.current = requestAnimationFrame(loop)
    }

    animRef.current = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(animRef.current)
  }, [highScore])

  /* ============== RENDER ============== */
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background:
          'linear-gradient(160deg, #0a0a0a 0%, #0f172a 50%, #0a0a0a 100%)',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        overflow: 'hidden',
      }}
    >
      {/* ---- Header ---- */}
      <div
        style={{
          padding: '72px 32px 0',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 16,
          flexShrink: 0,
          width: '100%',
        }}
      >
        <button
          onClick={() => navigate('/apps')}
          style={{
            position: 'absolute',
            top: 72,
            left: 24,
            background: 'rgba(255,255,255,0.06)',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 10,
            color: 'rgba(255,255,255,0.6)',
            padding: '8px 14px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            fontSize: 14,
            transition: 'all 0.2s',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'rgba(255,255,255,0.1)'
            e.currentTarget.style.color = '#fff'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'rgba(255,255,255,0.06)'
            e.currentTarget.style.color = 'rgba(255,255,255,0.6)'
          }}
        >
          <FaArrowLeft size={12} /> Back
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div
            style={{
              width: 48,
              height: 48,
              borderRadius: 14,
              background: 'linear-gradient(135deg, #e74c3c, #3498db)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 8px 24px rgba(231, 76, 60, 0.3)',
            }}
          >
            <FaRunning size={22} color="#fff" />
          </div>
          <h1
            style={{ color: '#fff', fontSize: 28, fontWeight: 700, margin: 0 }}
          >
            Subway Surfers
          </h1>
        </div>

        <div style={{ display: 'flex', gap: 24, alignItems: 'center' }}>
          <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 14 }}>
            Score:{' '}
            <span style={{ color: '#60a5fa', fontWeight: 700, fontSize: 18 }}>
              {score}
            </span>
          </div>
          <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 14 }}>
            Best:{' '}
            <span style={{ color: '#4ade80', fontWeight: 700, fontSize: 18 }}>
              {highScore}
            </span>
          </div>
          <div
            style={{
              color:
                phase === 'playing'
                  ? '#4ade80'
                  : phase === 'dead'
                    ? '#ff6b6b'
                    : 'rgba(255,255,255,0.4)',
              fontSize: 13,
              padding: '4px 12px',
              borderRadius: 8,
              background:
                phase === 'playing'
                  ? 'rgba(74,222,128,0.1)'
                  : phase === 'dead'
                    ? 'rgba(255,107,107,0.1)'
                    : 'rgba(255,255,255,0.05)',
            }}
          >
            {phase === 'waiting'
              ? 'Ready'
              : phase === 'playing'
                ? 'Running'
                : 'Game Over'}
          </div>
        </div>
      </div>

      {/* ---- Game canvas ---- */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 20,
        }}
      >
        <canvas
          ref={canvasRef}
          width={CANVAS_W}
          height={CANVAS_H}
          onClick={handleCanvasClick}
          style={{
            borderRadius: 20,
            border: '2px solid rgba(255,255,255,0.1)',
            boxShadow:
              '0 20px 60px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.05)',
            cursor: 'pointer',
            maxHeight: 'calc(100vh - 220px)',
            objectFit: 'contain',
          }}
        />
      </div>

      {/* ---- Webcam preview (bottom-right) ---- */}
      <div
        style={{
          position: 'fixed',
          bottom: 20,
          right: 20,
          width: 160,
          height: 120,
          borderRadius: 12,
          overflow: 'hidden',
          border: '2px solid rgba(255,255,255,0.15)',
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
        <div
          style={{
            position: 'absolute',
            bottom: 4,
            left: 4,
            fontSize: 10,
            color:
              blinkStatus === 'detecting'
                ? '#4ade80'
                : 'rgba(255,255,255,0.5)',
            background: 'rgba(0,0,0,0.6)',
            padding: '2px 6px',
            borderRadius: 4,
          }}
        >
          {blinkStatus === 'loading'
            ? 'Loading...'
            : blinkStatus === 'detecting'
              ? 'Blink active'
              : blinkStatus}
        </div>
      </div>
    </div>
  )
}
