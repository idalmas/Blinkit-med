import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import Webcam from 'react-webcam'
import { FaArrowLeft, FaDove } from 'react-icons/fa'
import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision'

const CANVAS_W = 480
const CANVAS_H = 640

// Physics — very floaty so blink timing is forgiving
const GRAVITY = 0.12
const JUMP_VEL = -4
const BIRD_X = 80
const BIRD_R = 18

// Pipes
const PIPE_W = 60
const PIPE_GAP = 340
const PIPE_SPEED = 1.5
const PIPE_SPAWN_INTERVAL = 150 // frames

// Instant blink detection
const BLINK_SCORE_THRESHOLD = 0.45
const BLINK_COOLDOWN_MS = 300 // minimum ms between jumps from blinks

interface Pipe {
  x: number
  topH: number
  scored: boolean
}

interface GameState {
  birdY: number
  birdVel: number
  pipes: Pipe[]
  score: number
  frame: number
  phase: 'waiting' | 'playing' | 'dead'
}

function initState(): GameState {
  return {
    birdY: CANVAS_H / 2,
    birdVel: 0,
    pipes: [],
    score: 0,
    frame: 0,
    phase: 'waiting',
  }
}

export default function FlappyBirdPage() {
  const navigate = useNavigate()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const gameRef = useRef<GameState>(initState())
  const animRef = useRef<number>(0)
  const [score, setScore] = useState(0)
  const [highScore, setHighScore] = useState(() => {
    const stored = localStorage.getItem('revive-flappy-highscore')
    return stored ? parseInt(stored, 10) : 0
  })
  const [phase, setPhase] = useState<'waiting' | 'playing' | 'dead'>('waiting')
  const [blinkStatus, setBlinkStatus] = useState<'loading' | 'ready' | 'detecting' | 'error'>('loading')

  const webcamRef = useRef<Webcam>(null)
  const landmarkerRef = useRef<FaceLandmarker | null>(null)
  const lastVideoTimeRef = useRef(-1)
  const eyesWereClosedRef = useRef(false)
  const lastBlinkJumpRef = useRef(0)
  const detectAnimRef = useRef<number>(0)
  const eyesClosedSinceRef = useRef<number | null>(null)
  const longCloseFiredRef = useRef(false)

  const jumpRef = useRef<() => void>(() => {})

  const jump = useCallback(() => {
    const g = gameRef.current
    if (g.phase === 'waiting') {
      g.phase = 'playing'
      g.birdVel = JUMP_VEL
      setPhase('playing')
    } else if (g.phase === 'playing') {
      g.birdVel = JUMP_VEL
    } else if (g.phase === 'dead') {
      gameRef.current = initState()
      gameRef.current.phase = 'playing'
      gameRef.current.birdVel = JUMP_VEL
      setPhase('playing')
      setScore(0)
    }
  }, [])

  jumpRef.current = jump

  // Init MediaPipe FaceLandmarker
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
          setBlinkStatus('ready')
        }
      } catch {
        if (!cancelled) setBlinkStatus('error')
      }
    }
    init()
    return () => { cancelled = true }
  }, [])

  // Instant blink detection loop — fires jump the FRAME eyes close
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
            const leftScore = shapes.find((s) => s.categoryName === 'eyeBlinkLeft')?.score ?? 0
            const rightScore = shapes.find((s) => s.categoryName === 'eyeBlinkRight')?.score ?? 0
            const avgScore = (leftScore + rightScore) / 2

            const eyesClosed = avgScore > BLINK_SCORE_THRESHOLD

            // Fire jump INSTANTLY when eyes cross the threshold (leading edge)
            if (eyesClosed && !eyesWereClosedRef.current) {
              const timeSinceLast = now - lastBlinkJumpRef.current
              if (timeSinceLast > BLINK_COOLDOWN_MS) {
                lastBlinkJumpRef.current = now
                jumpRef.current()
              }
            }

            eyesWereClosedRef.current = eyesClosed

            // Long-close: eyes shut for 3+ seconds → go back to apps
            if (eyesClosed) {
              if (eyesClosedSinceRef.current === null) {
                eyesClosedSinceRef.current = now
                longCloseFiredRef.current = false
              } else if (!longCloseFiredRef.current && (now - eyesClosedSinceRef.current) >= 3000) {
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
  }, [blinkStatus])

  // Keyboard support
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Space' || e.key === ' ') {
        e.preventDefault()
        jump()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [jump])

  const handleCanvasClick = useCallback(() => {
    jump()
  }, [jump])

  // Game loop
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const loop = () => {
      const g = gameRef.current

      // --- Update ---
      if (g.phase === 'playing') {
        g.frame++
        g.birdVel += GRAVITY
        g.birdY += g.birdVel

        // Spawn pipes
        if (g.frame % PIPE_SPAWN_INTERVAL === 0) {
          const minTop = 80
          const maxTop = CANVAS_H - PIPE_GAP - 80
          const topH = minTop + Math.random() * (maxTop - minTop)
          g.pipes.push({ x: CANVAS_W + PIPE_W, topH, scored: false })
        }

        // Move pipes
        for (const pipe of g.pipes) {
          pipe.x -= PIPE_SPEED

          if (!pipe.scored && pipe.x + PIPE_W < BIRD_X) {
            pipe.scored = true
            g.score++
            setScore(g.score)
          }
        }

        // Remove offscreen pipes
        g.pipes = g.pipes.filter((p) => p.x + PIPE_W > -10)

        // Collision: ground/ceiling
        if (g.birdY + BIRD_R > CANVAS_H || g.birdY - BIRD_R < 0) {
          g.phase = 'dead'
          setPhase('dead')
          if (g.score > highScore) {
            setHighScore(g.score)
            localStorage.setItem('revive-flappy-highscore', String(g.score))
          }
        }

        // Collision: pipes
        for (const pipe of g.pipes) {
          if (BIRD_X + BIRD_R > pipe.x && BIRD_X - BIRD_R < pipe.x + PIPE_W) {
            if (g.birdY - BIRD_R < pipe.topH || g.birdY + BIRD_R > pipe.topH + PIPE_GAP) {
              g.phase = 'dead'
              setPhase('dead')
              if (g.score > highScore) {
                setHighScore(g.score)
                localStorage.setItem('revive-flappy-highscore', String(g.score))
              }
            }
          }
        }
      }

      // --- Draw ---
      const bgGrad = ctx.createLinearGradient(0, 0, 0, CANVAS_H)
      bgGrad.addColorStop(0, '#0c1445')
      bgGrad.addColorStop(0.5, '#1a237e')
      bgGrad.addColorStop(1, '#0d47a1')
      ctx.fillStyle = bgGrad
      ctx.fillRect(0, 0, CANVAS_W, CANVAS_H)

      // Stars
      ctx.fillStyle = 'rgba(255, 255, 255, 0.3)'
      for (let i = 0; i < 30; i++) {
        const sx = (i * 137 + g.frame * 0.1) % CANVAS_W
        const sy = (i * 97) % (CANVAS_H * 0.6)
        ctx.beginPath()
        ctx.arc(sx, sy, 1, 0, Math.PI * 2)
        ctx.fill()
      }

      // Ground
      ctx.fillStyle = '#1b5e20'
      ctx.fillRect(0, CANVAS_H - 4, CANVAS_W, 4)

      // Pipes
      for (const pipe of g.pipes) {
        const pipeGrad = ctx.createLinearGradient(pipe.x, 0, pipe.x + PIPE_W, 0)
        pipeGrad.addColorStop(0, '#2e7d32')
        pipeGrad.addColorStop(0.5, '#43a047')
        pipeGrad.addColorStop(1, '#2e7d32')
        ctx.fillStyle = pipeGrad
        ctx.fillRect(pipe.x, 0, PIPE_W, pipe.topH)
        ctx.fillStyle = '#388e3c'
        ctx.fillRect(pipe.x - 4, pipe.topH - 20, PIPE_W + 8, 20)

        ctx.fillStyle = pipeGrad
        const bottomY = pipe.topH + PIPE_GAP
        ctx.fillRect(pipe.x, bottomY, PIPE_W, CANVAS_H - bottomY)
        ctx.fillStyle = '#388e3c'
        ctx.fillRect(pipe.x - 4, bottomY, PIPE_W + 8, 20)
      }

      // Bird
      const birdAngle = Math.min(Math.max(g.birdVel * 3, -30), 70) * (Math.PI / 180)
      ctx.save()
      ctx.translate(BIRD_X, g.birdY)
      ctx.rotate(birdAngle)

      ctx.fillStyle = '#FFD600'
      ctx.beginPath()
      ctx.ellipse(0, 0, BIRD_R, BIRD_R * 0.85, 0, 0, Math.PI * 2)
      ctx.fill()
      ctx.strokeStyle = '#F9A825'
      ctx.lineWidth = 2
      ctx.stroke()

      const wingFlap = g.phase === 'playing' ? Math.sin(g.frame * 0.3) * 5 : 0
      ctx.fillStyle = '#FFC107'
      ctx.beginPath()
      ctx.ellipse(-6, 2 + wingFlap, 10, 6, -0.3, 0, Math.PI * 2)
      ctx.fill()

      ctx.fillStyle = '#fff'
      ctx.beginPath()
      ctx.arc(8, -5, 6, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = '#000'
      ctx.beginPath()
      ctx.arc(10, -5, 3, 0, Math.PI * 2)
      ctx.fill()

      ctx.fillStyle = '#FF6D00'
      ctx.beginPath()
      ctx.moveTo(BIRD_R - 2, -2)
      ctx.lineTo(BIRD_R + 10, 2)
      ctx.lineTo(BIRD_R - 2, 6)
      ctx.closePath()
      ctx.fill()

      ctx.restore()

      // Score
      ctx.fillStyle = '#fff'
      ctx.font = 'bold 48px system-ui, sans-serif'
      ctx.textAlign = 'center'
      ctx.strokeStyle = 'rgba(0,0,0,0.5)'
      ctx.lineWidth = 4
      ctx.strokeText(String(g.score), CANVAS_W / 2, 70)
      ctx.fillText(String(g.score), CANVAS_W / 2, 70)

      if (g.phase === 'waiting') {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.3)'
        ctx.fillRect(0, 0, CANVAS_W, CANVAS_H)
        ctx.fillStyle = '#fff'
        ctx.font = 'bold 32px system-ui'
        ctx.fillText('Flappy Bird', CANVAS_W / 2, CANVAS_H / 2 - 40)
        ctx.font = '18px system-ui'
        ctx.fillStyle = 'rgba(255,255,255,0.7)'
        ctx.fillText('Blink, tap, or press Space to start', CANVAS_W / 2, CANVAS_H / 2 + 10)
      }

      if (g.phase === 'dead') {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.5)'
        ctx.fillRect(0, 0, CANVAS_W, CANVAS_H)
        ctx.fillStyle = '#ff6b6b'
        ctx.font = 'bold 36px system-ui'
        ctx.fillText('Game Over', CANVAS_W / 2, CANVAS_H / 2 - 40)
        ctx.fillStyle = '#fff'
        ctx.font = '22px system-ui'
        ctx.fillText(`Score: ${g.score}`, CANVAS_W / 2, CANVAS_H / 2 + 10)
        ctx.font = '16px system-ui'
        ctx.fillStyle = 'rgba(255,255,255,0.6)'
        ctx.fillText('Blink or tap to restart', CANVAS_W / 2, CANVAS_H / 2 + 50)
      }

      animRef.current = requestAnimationFrame(loop)
    }

    animRef.current = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(animRef.current)
  }, [highScore])

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'linear-gradient(160deg, #0a0a0a 0%, #0f172a 50%, #0a0a0a 100%)',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        overflow: 'hidden',
      }}
    >
      {/* Header */}
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
              background: 'linear-gradient(135deg, #FFD600, #FF6D00)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 8px 24px rgba(255,214,0,0.3)',
            }}
          >
            <FaDove size={22} color="#fff" />
          </div>
          <h1 style={{ color: '#fff', fontSize: 28, fontWeight: 700, margin: 0 }}>
            Flappy Bird
          </h1>
        </div>

        <div style={{ display: 'flex', gap: 24, alignItems: 'center' }}>
          <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 14 }}>
            Score: <span style={{ color: '#FFD600', fontWeight: 700, fontSize: 18 }}>{score}</span>
          </div>
          <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 14 }}>
            Best: <span style={{ color: '#4ade80', fontWeight: 700, fontSize: 18 }}>{highScore}</span>
          </div>
          <div
            style={{
              color: phase === 'playing' ? '#4ade80' : phase === 'dead' ? '#ff6b6b' : 'rgba(255,255,255,0.4)',
              fontSize: 13,
              padding: '4px 12px',
              borderRadius: 8,
              background: phase === 'playing'
                ? 'rgba(74,222,128,0.1)'
                : phase === 'dead'
                  ? 'rgba(255,107,107,0.1)'
                  : 'rgba(255,255,255,0.05)',
            }}
          >
            {phase === 'waiting' ? 'Ready' : phase === 'playing' ? 'Playing' : 'Game Over'}
          </div>
        </div>
      </div>

      {/* Game canvas */}
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
            boxShadow: '0 20px 60px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.05)',
            cursor: 'pointer',
            maxHeight: 'calc(100vh - 220px)',
            objectFit: 'contain',
          }}
        />
      </div>

      {/* Webcam preview */}
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
            color: blinkStatus === 'detecting' ? '#4ade80' : 'rgba(255,255,255,0.5)',
            background: 'rgba(0,0,0,0.6)',
            padding: '2px 6px',
            borderRadius: 4,
          }}
        >
          {blinkStatus === 'loading' ? 'Loading...' : blinkStatus === 'detecting' ? 'Blink active' : blinkStatus}
        </div>
      </div>
    </div>
  )
}
