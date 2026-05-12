import { useCallback, useEffect, useRef, useState } from 'react'
import './App.css'

type GameStatus = 'ready' | 'playing' | 'won' | 'lost' | 'timeup'
type BlockKind = 'breakable' | 'cage'
type PowerUpType = 'auto-shooter' | 'penetrating' | 'paddle-extender'

type Ball = {
  id: number
  x: number
  y: number
  vx: number
  vy: number
  radius: number
  penetrating: boolean
}

type Block = {
  id: number
  kind: BlockKind
  x: number
  y: number
  width: number
  height: number
  color: string
  spawnsBall: boolean
  powerUpType: PowerUpType | null
}

type FallingPowerUp = {
  id: number
  type: PowerUpType
  x: number
  y: number
  vy: number
  size: number
}

type HighScore = {
  name: string
  score: number
}

const WORLD_WIDTH = 900
const WORLD_HEIGHT = 560
const PADDLE_HEIGHT = 16
const PADDLE_Y = WORLD_HEIGHT - 44
const BALL_RADIUS = 8
const MAX_BALLS = 450
const ROUND_TIME_LIMIT = 90
const MAX_HIGH_SCORES = 5
const HIGH_SCORE_KEY = 'string-breaker-high-scores-v2'

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function randomUpwardVelocity(speed: number) {
  const angle = -Math.PI / 2 + (Math.random() * 0.9 - 0.45)
  return {
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
  }
}

function isTextEntryTarget(target: EventTarget | null) {
  const element = target as HTMLElement | null
  if (!element) {
    return false
  }
  const tag = element.tagName.toLowerCase()
  return tag === 'input' || tag === 'textarea' || element.isContentEditable
}

function shuffle<T>(items: T[]) {
  const copy = [...items]
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    const tmp = copy[i]
    copy[i] = copy[j]
    copy[j] = tmp
  }
  return copy
}

function randomChoice<T>(items: T[]) {
  return items[Math.floor(Math.random() * items.length)]
}

function wrapTextToLines(text: string, measure: (value: string) => number, maxWidth: number) {
  const lines: string[] = []
  let current = ''

  for (const char of text) {
    if (char === '\n') {
      const trimmed = current.trimEnd()
      if (trimmed.length > 0) {
        lines.push(trimmed)
      }
      current = ''
      continue
    }

    const candidate = current + char
    if (current.length === 0 || measure(candidate) <= maxWidth) {
      current = candidate
      continue
    }

    const trimmed = current.trimEnd()
    if (trimmed.length > 0) {
      lines.push(trimmed)
    }
    current = char === ' ' ? '' : char
  }

  const finalLine = current.trimEnd()
  if (finalLine.length > 0) {
    lines.push(finalLine)
  }

  return lines.length > 0 ? lines : ['REACT']
}

type BuildBoardResult = {
  blocks: Block[]
  breakableCount: number
}

function createTextBlocks(
  text: string,
  density: number,
  spawnDistribution: number,
  cageMode: boolean,
  powerUpBlockCount: number,
  blackoutMode: boolean,
): BuildBoardResult {
  const normalized = text.trim() || 'REACT'
  const canvasWidth = 860
  const canvasHeight = 220
  const canvas = document.createElement('canvas')
  canvas.width = canvasWidth
  canvas.height = canvasHeight
  const ctx = canvas.getContext('2d')

  if (!ctx) {
    return { blocks: [], breakableCount: 0 }
  }

  let fontSize = 180
  let lines: string[] = []
  let lineHeight = 0
  const maxTextWidth = canvasWidth - 50
  const maxTextHeight = canvasHeight - 24

  ctx.textBaseline = 'middle'

  while (fontSize > 58) {
    ctx.font = `900 ${fontSize}px Impact, Haettenschweiler, Arial Narrow Bold, sans-serif`
    lines = wrapTextToLines(normalized, (value) => ctx.measureText(value).width, maxTextWidth)
    lineHeight = Math.round(fontSize * 1.08)

    if (lines.length * lineHeight <= maxTextHeight) {
      break
    }
    fontSize -= 6
  }

  if (lines.length === 0) {
    lines = [normalized]
    lineHeight = Math.round(fontSize * 1.08)
  }

  const textMaskCanvas = document.createElement('canvas')
  textMaskCanvas.width = canvasWidth
  textMaskCanvas.height = canvasHeight
  const textMaskCtx = textMaskCanvas.getContext('2d')
  if (!textMaskCtx) {
    return { blocks: [], breakableCount: 0 }
  }

  textMaskCtx.clearRect(0, 0, canvasWidth, canvasHeight)
  textMaskCtx.fillStyle = '#fff'
  textMaskCtx.font = `900 ${fontSize}px Impact, Haettenschweiler, Arial Narrow Bold, sans-serif`
  textMaskCtx.textBaseline = 'middle'

  const letterBounds: Array<{ x: number; y: number; width: number; height: number }> = []
  const firstBaselineY = canvasHeight / 2 - ((lines.length - 1) * lineHeight) / 2

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex]
    const baselineY = firstBaselineY + lineIndex * lineHeight
    let cursorX = (canvasWidth - textMaskCtx.measureText(line).width) / 2

    for (const char of [...line]) {
      const charWidth = char === ' ' ? fontSize * 0.35 : textMaskCtx.measureText(char).width
      if (char !== ' ') {
        textMaskCtx.fillText(char, cursorX, baselineY)

        const letterCanvas = document.createElement('canvas')
        letterCanvas.width = canvasWidth
        letterCanvas.height = canvasHeight
        const letterCtx = letterCanvas.getContext('2d')
        if (letterCtx) {
          letterCtx.fillStyle = '#fff'
          letterCtx.font = `900 ${fontSize}px Impact, Haettenschweiler, Arial Narrow Bold, sans-serif`
          letterCtx.textBaseline = 'middle'
          letterCtx.fillText(char, cursorX, baselineY)

          const id = letterCtx.getImageData(0, 0, canvasWidth, canvasHeight).data
          let minX = canvasWidth
          let minY = canvasHeight
          let maxX = 0
          let maxY = 0

          for (let y = 0; y < canvasHeight; y += 1) {
            for (let x = 0; x < canvasWidth; x += 1) {
              const alpha = id[(y * canvasWidth + x) * 4 + 3]
              if (alpha > 30) {
                minX = Math.min(minX, x)
                minY = Math.min(minY, y)
                maxX = Math.max(maxX, x)
                maxY = Math.max(maxY, y)
              }
            }
          }

          if (maxX > minX && maxY > minY) {
            letterBounds.push({
              x: minX,
              y: minY,
              width: maxX - minX + 1,
              height: maxY - minY + 1,
            })
          }
        }
      }
      cursorX += charWidth
    }
  }

  const maskData = textMaskCtx.getImageData(0, 0, canvasWidth, canvasHeight).data
  const cell = Math.round(clamp(22 - density * 0.14, 8, 22))
  const blocks: Block[] = []
  let id = 0

  const toWorldX = (x: number) => 20 + x
  const toWorldY = (y: number) => 56 + y

  const makeBreakableBlock = (x: number, y: number, color: string): Block => ({
    id: id++,
    kind: 'breakable',
    x,
    y,
    width: cell - 2,
    height: cell - 2,
    color,
    spawnsBall: Math.random() * 100 < spawnDistribution,
    powerUpType: null,
  })

  if (blackoutMode) {
    const cols = Math.floor(canvasWidth / cell)
    const rows = Math.floor(canvasHeight / cell)
    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        const x = col * cell
        const y = row * cell
        const sampleX = Math.min(canvasWidth - 1, x + Math.floor(cell / 2))
        const sampleY = Math.min(canvasHeight - 1, y + Math.floor(cell / 2))
        const alpha = maskData[(sampleY * canvasWidth + sampleX) * 4 + 3]
        const isTextPixel = alpha > 30
        const color = isTextPixel
          ? `hsl(${(col * 11 + row * 7) % 40 + 20} 90% 62%)`
          : `hsl(${190 + ((col * 5 + row * 3) % 30)} 35% 28%)`
        blocks.push(makeBreakableBlock(toWorldX(x), toWorldY(y), color))
      }
    }
  } else {
    for (let y = 0; y < canvasHeight; y += cell) {
      for (let x = 0; x < canvasWidth; x += cell) {
        const sampleX = Math.min(canvasWidth - 1, x + Math.floor(cell / 2))
        const sampleY = Math.min(canvasHeight - 1, y + Math.floor(cell / 2))
        const alpha = maskData[(sampleY * canvasWidth + sampleX) * 4 + 3]
        if (alpha > 30) {
          const hue = ((x / canvasWidth) * 210 + (y / canvasHeight) * 90 + 18) % 360
          blocks.push(makeBreakableBlock(toWorldX(x), toWorldY(y), `hsl(${hue} 86% 62%)`))
        }
      }
    }

    if (blocks.length === 0) {
      for (let row = 0; row < 5; row += 1) {
        for (let col = 0; col < 14; col += 1) {
          blocks.push(
            makeBreakableBlock(
              58 + col * 56,
              72 + row * 30,
              `hsl(${(col * 18 + row * 24) % 360} 82% 60%)`,
            ),
          )
        }
      }
    }
  }

  if (cageMode && letterBounds.length > 0) {
    const occupied = new Set<string>()
    for (const block of blocks) {
      occupied.add(`${block.x},${block.y}`)
    }

    for (const bounds of letterBounds) {
      const left = clamp(toWorldX(Math.floor(bounds.x / cell) * cell - cell), 0, WORLD_WIDTH - cell)
      const right = clamp(
        toWorldX(Math.ceil((bounds.x + bounds.width) / cell) * cell),
        cell,
        WORLD_WIDTH - cell,
      )
      const top = clamp(toWorldY(Math.floor(bounds.y / cell) * cell - cell), 0, PADDLE_Y - 130)
      const bottom = clamp(
        toWorldY(Math.ceil((bounds.y + bounds.height) / cell) * cell),
        top + cell,
        PADDLE_Y - 50,
      )

      const ringCells: Array<{ x: number; y: number }> = []
      for (let x = left; x <= right; x += cell) {
        ringCells.push({ x, y: top })
        ringCells.push({ x, y: bottom })
      }
      for (let y = top + cell; y < bottom; y += cell) {
        ringCells.push({ x: left, y })
        ringCells.push({ x: right, y })
      }

      const uniqueRing = ringCells.filter((cellPos, index) => {
        return ringCells.findIndex((candidate) => candidate.x === cellPos.x && candidate.y === cellPos.y) === index
      })
      const openings = shuffle(uniqueRing).slice(0, Math.min(2, uniqueRing.length))
      const openingKeys = new Set(openings.map((open) => `${open.x},${open.y}`))

      for (const cellPos of uniqueRing) {
        const key = `${cellPos.x},${cellPos.y}`
        if (openingKeys.has(key) || occupied.has(key)) {
          continue
        }

        occupied.add(key)
        blocks.push({
          id: id++,
          kind: 'cage',
          x: cellPos.x,
          y: cellPos.y,
          width: cell - 2,
          height: cell - 2,
          color: '#8c98ab',
          spawnsBall: false,
          powerUpType: null,
        })
      }
    }
  }

  const breakableIndices = blocks
    .map((block, index) => ({ block, index }))
    .filter((entry) => entry.block.kind === 'breakable')
    .map((entry) => entry.index)

  const powerUpSlots = shuffle(breakableIndices).slice(0, Math.min(powerUpBlockCount, breakableIndices.length))
  for (const index of powerUpSlots) {
    blocks[index].powerUpType = randomChoice<PowerUpType>(['auto-shooter', 'penetrating', 'paddle-extender'])
  }

  return {
    blocks,
    breakableCount: breakableIndices.length,
  }
}

function App() {
  const [status, setStatus] = useState<GameStatus>('ready')
  const [textShape, setTextShape] = useState('CAREER DAY')
  const [ballSpeed, setBallSpeed] = useState(320)
  const [paddleSize, setPaddleSize] = useState(140)
  const [blockDensity, setBlockDensity] = useState(58)
  const [spawnDistribution, setSpawnDistribution] = useState(18)
  const [powerUpBlocks, setPowerUpBlocks] = useState(16)
  const [crazyMode, setCrazyMode] = useState(false)
  const [cageMode, setCageMode] = useState(false)
  const [blackoutMode, setBlackoutMode] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [tiltEnabled, setTiltEnabled] = useState(false)
  const [tiltSupport, setTiltSupport] = useState<'unknown' | 'available' | 'denied' | 'unsupported'>('unknown')
  const [ballCount, setBallCount] = useState(1)
  const [blockCount, setBlockCount] = useState(0)
  const [score, setScore] = useState(0)
  const [timeLeft, setTimeLeft] = useState(ROUND_TIME_LIMIT)
  const [highScores, setHighScores] = useState<HighScore[]>(() => {
    const stored = localStorage.getItem(HIGH_SCORE_KEY)
    if (!stored) {
      return []
    }
    try {
      const parsed = JSON.parse(stored) as HighScore[]
      if (!Array.isArray(parsed)) {
        return []
      }
      return parsed
        .filter((entry) => typeof entry.name === 'string' && typeof entry.score === 'number')
        .slice(0, MAX_HIGH_SCORES)
    } catch {
      return []
    }
  })

  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const animationRef = useRef<number | null>(null)
  const lastFrameRef = useRef(0)
  const nextBallIdRef = useRef(2)
  const nextPowerUpIdRef = useRef(1)
  const scoreRef = useRef(0)
  const timeLeftRef = useRef(ROUND_TIME_LIMIT)
  const paddleDirectionRef = useRef(0)
  const autoShooterShotsRef = useRef(0)
  const autoShooterCooldownRef = useRef(0)
  const paddleExtendTimerRef = useRef(0)
  const pointerActiveRef = useRef(false)
  const pointerTargetXRef = useRef(WORLD_WIDTH / 2)
  const tiltDirectionRef = useRef(0)

  const paddleXRef = useRef((WORLD_WIDTH - paddleSize) / 2)
  const keysRef = useRef({ left: false, right: false })
  const launchedRef = useRef(false)
  const ballsRef = useRef<Ball[]>([])
  const blocksRef = useRef<Block[]>([])
  const fallingPowerUpsRef = useRef<FallingPowerUp[]>([])

  const currentPaddleWidth = useCallback(() => {
    const extended = paddleExtendTimerRef.current > 0
    return clamp(extended ? paddleSize * 2 : paddleSize, 70, 360)
  }, [paddleSize])

  const updatePaddleFromClientX = useCallback(
    (clientX: number) => {
      const canvas = canvasRef.current
      if (!canvas) {
        return
      }

      const rect = canvas.getBoundingClientRect()
      const relative = clamp((clientX - rect.left) / rect.width, 0, 1)
      pointerTargetXRef.current = relative * WORLD_WIDTH
    },
    [],
  )

  const createBallFromPaddle = useCallback(
    (speed: number, vxBias: number, penetrating: boolean): Ball => {
      const paddleWidth = currentPaddleWidth()
      const centerX = paddleXRef.current + paddleWidth / 2
      return {
        id: nextBallIdRef.current++,
        x: centerX,
        y: PADDLE_Y - BALL_RADIUS - 2,
        vx: clamp(vxBias, -speed * 0.8, speed * 0.8),
        vy: -Math.abs(Math.sqrt(Math.max(0, speed * speed - vxBias * vxBias))),
        radius: BALL_RADIUS,
        penetrating,
      }
    },
    [currentPaddleWidth],
  )

  const launchBall = useCallback(() => {
    if (launchedRef.current || ballsRef.current.length === 0) {
      return
    }
    launchedRef.current = true
    setStatus('playing')
    const initial = randomUpwardVelocity(ballSpeed)
    ballsRef.current[0] = {
      ...ballsRef.current[0],
      vx: initial.vx,
      vy: initial.vy,
      penetrating: false,
    }
  }, [ballSpeed])

  const finishRound = useCallback(
    (result: 'won' | 'lost' | 'timeup') => {
      setStatus(result)
      launchedRef.current = false

      let finalScore = scoreRef.current
      if (result === 'won') {
        const speedBonus = Math.round(timeLeftRef.current * 25)
        finalScore += speedBonus
        scoreRef.current = finalScore
        setScore(finalScore)
      }

      const playerName = textShape.trim() || 'PLAYER'
      if (finalScore <= 0) {
        return
      }

      const next = [...highScores, { name: playerName, score: finalScore }]
        .sort((a, b) => b.score - a.score)
        .slice(0, MAX_HIGH_SCORES)

      const signature = `${playerName}-${finalScore}`
      const exists = highScores.some((entry) => `${entry.name}-${entry.score}` === signature)
      if (!exists || next.length !== highScores.length) {
        setHighScores(next)
      }
    },
    [highScores, textShape],
  )

  const activatePowerUp = useCallback(
    (type: PowerUpType) => {
      if (type === 'auto-shooter') {
        autoShooterShotsRef.current += 10
      }

      if (type === 'penetrating') {
        if (ballsRef.current.length < MAX_BALLS) {
          const speed = ballSpeed + 120
          const ball = createBallFromPaddle(speed, paddleDirectionRef.current * speed * 0.45, true)
          ballsRef.current.push(ball)
          launchedRef.current = true
          setStatus('playing')
        }
      }

      if (type === 'paddle-extender') {
        paddleExtendTimerRef.current = 30
      }
    },
    [ballSpeed, createBallFromPaddle],
  )

  const resetGame = useCallback(
    (shape: string) => {
      const board = createTextBlocks(
        shape,
        blockDensity,
        spawnDistribution,
        cageMode,
        powerUpBlocks,
        blackoutMode,
      )

      blocksRef.current = board.blocks
      setBlockCount(board.breakableCount)
      setBallCount(1)
      setScore(0)
      setTimeLeft(ROUND_TIME_LIMIT)
      scoreRef.current = 0
      timeLeftRef.current = ROUND_TIME_LIMIT
      setStatus('ready')
      launchedRef.current = false
      nextBallIdRef.current = 2
      nextPowerUpIdRef.current = 1
      autoShooterShotsRef.current = 0
      autoShooterCooldownRef.current = 0
      paddleExtendTimerRef.current = 0

      const paddleWidth = currentPaddleWidth()
      paddleXRef.current = (WORLD_WIDTH - paddleWidth) / 2

      ballsRef.current = [
        {
          id: 1,
          x: paddleXRef.current + paddleWidth / 2,
          y: PADDLE_Y - BALL_RADIUS - 2,
          vx: 0,
          vy: 0,
          radius: BALL_RADIUS,
          penetrating: false,
        },
      ]

      fallingPowerUpsRef.current = []
    },
    [blackoutMode, blockDensity, cageMode, currentPaddleWidth, powerUpBlocks, spawnDistribution],
  )

  useEffect(() => {
    resetGame(textShape)
  }, [blackoutMode, blockDensity, cageMode, powerUpBlocks, resetGame, spawnDistribution, textShape])

  useEffect(() => {
    localStorage.setItem(HIGH_SCORE_KEY, JSON.stringify(highScores.slice(0, MAX_HIGH_SCORES)))
  }, [highScores])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }
    if (!('DeviceOrientationEvent' in window)) {
      setTiltSupport('unsupported')
      return
    }
    setTiltSupport('available')
  }, [])

  useEffect(() => {
    if (!tiltEnabled) {
      tiltDirectionRef.current = 0
      return
    }

    const handleOrientation = (event: DeviceOrientationEvent) => {
      const gamma = event.gamma ?? 0
      tiltDirectionRef.current = clamp(gamma / 30, -1, 1)
    }

    window.addEventListener('deviceorientation', handleOrientation)
    return () => {
      window.removeEventListener('deviceorientation', handleOrientation)
    }
  }, [tiltEnabled])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTextEntryTarget(event.target)) {
        return
      }

      if (event.key === 'ArrowLeft') {
        keysRef.current.left = true
        event.preventDefault()
      }
      if (event.key === 'ArrowRight') {
        keysRef.current.right = true
        event.preventDefault()
      }
      if (event.key === ' ') {
        launchBall()
        event.preventDefault()
      }
      if (event.key === 'Enter' && (status === 'won' || status === 'lost' || status === 'timeup')) {
        resetGame(textShape)
      }
    }

    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === 'ArrowLeft') {
        keysRef.current.left = false
      }
      if (event.key === 'ArrowRight') {
        keysRef.current.right = false
      }
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [launchBall, resetGame, status, textShape])

  useEffect(() => {
    const step = (timestamp: number) => {
      const ctx = canvasRef.current?.getContext('2d')
      if (!ctx) {
        return
      }

      const dtRaw = (timestamp - lastFrameRef.current) / 1000
      const dt = clamp(Number.isFinite(dtRaw) ? dtRaw : 0, 0, 0.03)
      lastFrameRef.current = timestamp

      const paddleSpeed = 540
      const paddleWidth = currentPaddleWidth()

      if (pointerActiveRef.current) {
        paddleXRef.current = clamp(pointerTargetXRef.current - paddleWidth / 2, 0, WORLD_WIDTH - paddleWidth)
        paddleDirectionRef.current = 0
      } else {
        const keyboardDirection = (keysRef.current.right ? 1 : 0) - (keysRef.current.left ? 1 : 0)
        const direction = keyboardDirection !== 0 ? keyboardDirection : tiltDirectionRef.current
        paddleDirectionRef.current = direction
        paddleXRef.current = clamp(
          paddleXRef.current + direction * paddleSpeed * dt,
          0,
          WORLD_WIDTH - paddleWidth,
        )
      }

      if (!launchedRef.current && ballsRef.current.length > 0) {
        ballsRef.current[0].x = paddleXRef.current + paddleWidth / 2
        ballsRef.current[0].y = PADDLE_Y - BALL_RADIUS - 2
      }

      if (launchedRef.current && status === 'playing') {
        timeLeftRef.current = Math.max(0, timeLeftRef.current - dt)
        setTimeLeft(timeLeftRef.current)
        if (timeLeftRef.current <= 0) {
          finishRound('timeup')
        }

        if (paddleExtendTimerRef.current > 0) {
          paddleExtendTimerRef.current = Math.max(0, paddleExtendTimerRef.current - dt)
        }

        if (autoShooterShotsRef.current > 0) {
          autoShooterCooldownRef.current -= dt
          if (autoShooterCooldownRef.current <= 0) {
            autoShooterCooldownRef.current = 0.5
            if (ballsRef.current.length < MAX_BALLS) {
              const speed = ballSpeed + 50
              const vxBias = paddleDirectionRef.current === 0 ? 0 : paddleDirectionRef.current * speed * 0.48
              const firedBall = createBallFromPaddle(speed, vxBias, false)
              ballsRef.current.push(firedBall)
            }
            autoShooterShotsRef.current = Math.max(0, autoShooterShotsRef.current - 1)
          }
        }

        const updatedBalls: Ball[] = []
        const powerupSpawnedBalls: Ball[] = []
        const pendingBlocks = [...blocksRef.current]
        const pendingPowerUps = [...fallingPowerUpsRef.current]
        let breakableRemaining = pendingBlocks.filter((block) => block.kind === 'breakable').length
        let scoreChanged = false

        for (const ball of ballsRef.current) {
          let x = ball.x + ball.vx * dt
          let y = ball.y + ball.vy * dt
          let vx = ball.vx
          let vy = ball.vy

          if (ball.penetrating) {
            if (
              x + ball.radius < 0 ||
              x - ball.radius > WORLD_WIDTH ||
              y + ball.radius < 0 ||
              y - ball.radius > WORLD_HEIGHT
            ) {
              continue
            }
          }

          if (x - ball.radius < 0) {
            if (ball.penetrating) {
              continue
            }
            x = ball.radius
            vx = Math.abs(vx)
          }
          if (x + ball.radius > WORLD_WIDTH) {
            if (ball.penetrating) {
              continue
            }
            x = WORLD_WIDTH - ball.radius
            vx = -Math.abs(vx)
          }
          if (y - ball.radius < 0) {
            if (ball.penetrating) {
              continue
            }
            y = ball.radius
            vy = Math.abs(vy)
          }

          const intersectsPaddle =
            x + ball.radius >= paddleXRef.current &&
            x - ball.radius <= paddleXRef.current + paddleWidth &&
            y + ball.radius >= PADDLE_Y &&
            y - ball.radius <= PADDLE_Y + PADDLE_HEIGHT

          if (intersectsPaddle && vy > 0 && !ball.penetrating) {
            y = PADDLE_Y - ball.radius
            const relative = clamp(
              (x - (paddleXRef.current + paddleWidth / 2)) / (paddleWidth / 2),
              -1,
              1,
            )
            const speed = Math.max(ballSpeed, Math.hypot(vx, vy))
            const angle = relative * 1.15
            vx = Math.sin(angle) * speed
            vy = -Math.abs(Math.cos(angle) * speed)
          }

          let removedByBottom = false
          if (y - ball.radius > WORLD_HEIGHT) {
            removedByBottom = true
          }

          if (!removedByBottom) {
            for (let i = 0; i < pendingBlocks.length; i += 1) {
              const block = pendingBlocks[i]

              const closestX = clamp(x, block.x, block.x + block.width)
              const closestY = clamp(y, block.y, block.y + block.height)
              const dx = x - closestX
              const dy = y - closestY

              if (dx * dx + dy * dy <= ball.radius * ball.radius) {
                if (!ball.penetrating) {
                  const blockCenterX = block.x + block.width / 2
                  const blockCenterY = block.y + block.height / 2
                  const diffX = x - blockCenterX
                  const diffY = y - blockCenterY
                  const overlapX = block.width / 2 + ball.radius - Math.abs(diffX)
                  const overlapY = block.height / 2 + ball.radius - Math.abs(diffY)

                  if (overlapX < overlapY) {
                    vx = diffX > 0 ? Math.abs(vx) : -Math.abs(vx)
                  } else {
                    vy = diffY > 0 ? Math.abs(vy) : -Math.abs(vy)
                  }
                }

                const shouldSpawnBall = block.kind === 'breakable' && (crazyMode || block.spawnsBall)

                if (block.kind === 'breakable') {
                  pendingBlocks.splice(i, 1)
                  breakableRemaining -= 1
                  scoreRef.current += 10
                  scoreChanged = true

                  if (block.powerUpType) {
                    pendingPowerUps.push({
                      id: nextPowerUpIdRef.current++,
                      type: block.powerUpType,
                      x: block.x + block.width / 2,
                      y: block.y + block.height / 2,
                      vy: 155,
                      size: 16,
                    })
                  }
                }

                if (shouldSpawnBall && ballsRef.current.length + updatedBalls.length < MAX_BALLS) {
                  const spawnVelocity = randomUpwardVelocity(ballSpeed + Math.random() * 120)
                  updatedBalls.push({
                    id: nextBallIdRef.current,
                    x,
                    y,
                    vx: spawnVelocity.vx,
                    vy: spawnVelocity.vy,
                    radius: BALL_RADIUS,
                    penetrating: false,
                  })
                  nextBallIdRef.current += 1
                }

                if (!ball.penetrating || block.kind === 'cage') {
                  break
                }
              }
            }
          }

          if (!removedByBottom) {
            updatedBalls.push({ ...ball, x, y, vx, vy })
          }
        }

        const keptPowerUps: FallingPowerUp[] = []
        for (const drop of pendingPowerUps) {
          const nextY = drop.y + drop.vy * dt
          const caught =
            drop.x + drop.size >= paddleXRef.current &&
            drop.x - drop.size <= paddleXRef.current + paddleWidth &&
            nextY + drop.size >= PADDLE_Y &&
            nextY - drop.size <= PADDLE_Y + PADDLE_HEIGHT

          if (caught) {
            if (drop.type === 'penetrating') {
              if (updatedBalls.length + powerupSpawnedBalls.length < MAX_BALLS) {
                const speed = ballSpeed + 120
                const ball = createBallFromPaddle(speed, paddleDirectionRef.current * speed * 0.45, true)
                powerupSpawnedBalls.push(ball)
                launchedRef.current = true
                setStatus('playing')
              }
            } else {
              activatePowerUp(drop.type)
            }
            continue
          }

          if (nextY - drop.size > WORLD_HEIGHT) {
            continue
          }

          keptPowerUps.push({ ...drop, y: nextY })
        }

        const mergedBalls = [...updatedBalls, ...powerupSpawnedBalls]
        ballsRef.current = mergedBalls
        blocksRef.current = pendingBlocks
        fallingPowerUpsRef.current = keptPowerUps
        setBallCount(mergedBalls.length)
        setBlockCount(breakableRemaining)

        if (scoreChanged) {
          setScore(scoreRef.current)
        }

        if (mergedBalls.length === 0 && status === 'playing') {
          finishRound('lost')
        }

        if (breakableRemaining === 0 && status === 'playing') {
          finishRound('won')
        }
      }

      ctx.clearRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT)

      const bg = ctx.createLinearGradient(0, 0, 0, WORLD_HEIGHT)
      bg.addColorStop(0, '#101820')
      bg.addColorStop(1, '#254f64')
      ctx.fillStyle = bg
      ctx.fillRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT)

      for (let i = 0; i < 100; i += 1) {
        const x = (i * 73) % WORLD_WIDTH
        const y = (i * 157 + 20) % (WORLD_HEIGHT - 180)
        ctx.fillStyle = i % 2 === 0 ? 'rgba(255,255,255,0.10)' : 'rgba(255,220,180,0.08)'
        ctx.fillRect(x, y, 2, 2)
      }

      for (const block of blocksRef.current) {
        ctx.fillStyle = block.color
        ctx.fillRect(block.x, block.y, block.width, block.height)

        if (block.kind === 'cage') {
          ctx.strokeStyle = '#d9e4ed'
          ctx.lineWidth = 1.5
          ctx.strokeRect(block.x + 1, block.y + 1, block.width - 2, block.height - 2)
        }

        if (block.kind === 'breakable' && block.spawnsBall) {
          ctx.fillStyle = '#171f2f'
          ctx.beginPath()
          ctx.arc(
            block.x + block.width / 2,
            block.y + block.height / 2,
            Math.max(2, block.width * 0.14),
            0,
            Math.PI * 2,
          )
          ctx.fill()
          ctx.closePath()
        }

        if (block.kind === 'breakable' && block.powerUpType) {
          ctx.fillStyle = '#fefae0'
          ctx.fillRect(
            block.x + block.width * 0.22,
            block.y + block.height * 0.22,
            block.width * 0.56,
            block.height * 0.56,
          )
        }
      }

      for (const drop of fallingPowerUpsRef.current) {
        ctx.beginPath()
        const hue = drop.type === 'auto-shooter' ? 28 : drop.type === 'penetrating' ? 12 : 205
        ctx.fillStyle = `hsl(${hue} 90% 62%)`
        ctx.arc(drop.x, drop.y, drop.size, 0, Math.PI * 2)
        ctx.fill()
        ctx.closePath()
      }

      const paddleGradient = ctx.createLinearGradient(
        paddleXRef.current,
        PADDLE_Y,
        paddleXRef.current,
        PADDLE_Y + PADDLE_HEIGHT,
      )
      paddleGradient.addColorStop(0, '#fff7c2')
      paddleGradient.addColorStop(1, '#ffc347')
      ctx.fillStyle = paddleGradient
      ctx.fillRect(paddleXRef.current, PADDLE_Y, paddleWidth, PADDLE_HEIGHT)

      for (const ball of ballsRef.current) {
        ctx.beginPath()
        ctx.arc(ball.x, ball.y, ball.radius, 0, Math.PI * 2)
        ctx.fillStyle = ball.penetrating ? '#ff8f2d' : '#fff5f5'
        ctx.shadowColor = ball.penetrating ? '#ff5a00' : '#ff9e6d'
        ctx.shadowBlur = 12
        ctx.fill()
        ctx.closePath()
      }
      ctx.shadowBlur = 0

      ctx.fillStyle = 'rgba(0, 0, 0, 0.34)'
      ctx.fillRect(18, 14, 280, 68)
      ctx.fillStyle = '#fff'
      ctx.font = '900 34px Impact, Haettenschweiler, Arial Narrow Bold, sans-serif'
      ctx.textAlign = 'left'
      ctx.fillText(`SCORE ${scoreRef.current}`, 30, 44)
      ctx.font = '700 18px "Trebuchet MS", sans-serif'
      ctx.fillText(`TIME ${Math.ceil(timeLeftRef.current)}s`, 30, 70)

      if (status === 'ready') {
        ctx.fillStyle = 'rgba(255,255,255,0.95)'
        ctx.font = '700 24px "Trebuchet MS", sans-serif'
        ctx.textAlign = 'center'
        ctx.fillText('Press Space to Launch', WORLD_WIDTH / 2, WORLD_HEIGHT - 110)
      }

      if (status === 'won' || status === 'lost' || status === 'timeup') {
        ctx.fillStyle = 'rgba(5, 7, 16, 0.6)'
        ctx.fillRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT)
        ctx.fillStyle = '#ffffff'
        ctx.textAlign = 'center'
        ctx.font = '900 56px Impact, Haettenschweiler, Arial Narrow Bold, sans-serif'
        const title = status === 'won' ? 'YOU WIN' : status === 'timeup' ? 'TIME UP' : 'GAME OVER'
        ctx.fillText(title, WORLD_WIDTH / 2, WORLD_HEIGHT / 2 - 10)
        ctx.font = '700 24px "Trebuchet MS", sans-serif'
        ctx.fillText('Press Enter to Restart', WORLD_WIDTH / 2, WORLD_HEIGHT / 2 + 42)
      }

      animationRef.current = requestAnimationFrame(step)
    }

    animationRef.current = requestAnimationFrame(step)
    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current)
      }
    }
  }, [activatePowerUp, ballSpeed, crazyMode, createBallFromPaddle, currentPaddleWidth, finishRound, status])

  const enableTiltControl = async () => {
    if (typeof window === 'undefined' || !('DeviceOrientationEvent' in window)) {
      setTiltSupport('unsupported')
      return
    }

    try {
      const maybeRequest = (DeviceOrientationEvent as typeof DeviceOrientationEvent & {
        requestPermission?: () => Promise<'granted' | 'denied'>
      }).requestPermission

      if (typeof maybeRequest === 'function') {
        const result = await maybeRequest()
        if (result !== 'granted') {
          setTiltSupport('denied')
          setTiltEnabled(false)
          return
        }
      }

      setTiltSupport('available')
      setTiltEnabled(true)
    } catch {
      setTiltSupport('denied')
      setTiltEnabled(false)
    }
  }

  return (
    <main className="app-shell">
      <header className="title-zone">
        <h1>Fowler Career Day Game</h1>
        <p>Arrow keys move, Space launches, powerups fall when special blocks break.</p>
        <button type="button" className="settings-toggle" onClick={() => setSettingsOpen(true)}>
          Open Settings
        </button>
      </header>

      {settingsOpen && (
        <div className="settings-popover-backdrop" onClick={() => setSettingsOpen(false)}>
          <section className="settings-popover" aria-label="Game settings" onClick={(event) => event.stopPropagation()}>
            <div className="settings-header">
              <h2>Settings</h2>
              <button type="button" onClick={() => setSettingsOpen(false)}>
                Close
              </button>
            </div>

            <section className="controls" aria-label="Game controls">
          <div className="control-grid">
            <label>
              Block text (also used as high-score name)
              <input
                value={textShape}
                onChange={(event) => setTextShape(event.target.value.toUpperCase())}
                maxLength={24}
                aria-label="Text shape"
              />
            </label>

            <label>
              Ball speed: {ballSpeed}
              <input
                type="range"
                min={180}
                max={620}
                step={10}
                value={ballSpeed}
                onChange={(event) => setBallSpeed(Number(event.target.value))}
              />
            </label>

            <label>
              Paddle size: {paddleSize}
              <input
                type="range"
                min={80}
                max={240}
                step={4}
                value={paddleSize}
                onChange={(event) => setPaddleSize(Number(event.target.value))}
              />
            </label>

            <label>
              Block density: {blockDensity}
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={blockDensity}
                onChange={(event) => setBlockDensity(Number(event.target.value))}
              />
            </label>

            <label>
              Spawn-ball block distribution: {spawnDistribution}%
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={spawnDistribution}
                onChange={(event) => setSpawnDistribution(Number(event.target.value))}
              />
            </label>

            <label>
              Powerup blocks: {powerUpBlocks}
              <input
                type="range"
                min={0}
                max={60}
                step={1}
                value={powerUpBlocks}
                onChange={(event) => setPowerUpBlocks(Number(event.target.value))}
              />
            </label>

            <label>
              Tilt control
              <div className="tilt-row">
                <button
                  type="button"
                  onClick={() => {
                    if (tiltEnabled) {
                      setTiltEnabled(false)
                      return
                    }
                    void enableTiltControl()
                  }}
                  disabled={tiltSupport === 'unsupported'}
                >
                  {tiltEnabled ? 'Disable Tilt' : 'Enable Tilt'}
                </button>
                <span className="tilt-status">{tiltSupport}</span>
              </div>
            </label>
          </div>

          <label className="crazy">
            <input
              type="checkbox"
              checked={crazyMode}
              onChange={(event) => setCrazyMode(event.target.checked)}
            />
            Crazy mode (every broken block spawns a ball)
          </label>

          <label className="cage">
            <input
              type="checkbox"
              checked={cageMode}
              onChange={(event) => setCageMode(event.target.checked)}
            />
            Cage mode (each letter caged with two random openings)
          </label>

          <label className="blackout">
            <input
              type="checkbox"
              checked={blackoutMode}
              onChange={(event) => setBlackoutMode(event.target.checked)}
            />
            Blackout mode (same block count, name visible by colors)
          </label>

          <div className="buttons">
            <button type="button" onClick={() => resetGame(textShape)}>
              Rebuild Board
            </button>
            <button type="button" onClick={launchBall} disabled={launchedRef.current || status !== 'ready'}>
              Launch
            </button>
          </div>

          <div className="stats" role="status" aria-live="polite">
            <span>Blocks: {blockCount}</span>
            <span>Balls: {ballCount}</span>
            <span>Score: {score}</span>
            <span>Time: {Math.ceil(timeLeft)}s</span>
            <span>Status: {status.toUpperCase()}</span>
          </div>

          <div className="high-scores">
            <strong>High Scores</strong>
            <ol>
              {highScores.map((entry, index) => (
                <li key={`${entry.name}-${entry.score}-${index}`}>
                  <span>{entry.name}</span>
                  <span>{entry.score}</span>
                </li>
              ))}
              {highScores.length === 0 && <li className="empty">No scores yet</li>}
            </ol>
          </div>
            </section>
          </section>
        </div>
      )}

      <section className="game-wrap">
        <canvas
          ref={canvasRef}
          width={WORLD_WIDTH}
          height={WORLD_HEIGHT}
          aria-label="Breakout game board"
          onPointerDown={(event) => {
            pointerActiveRef.current = true
            updatePaddleFromClientX(event.clientX)
            if (status === 'ready') {
              launchBall()
            }
          }}
          onPointerMove={(event) => {
            if (pointerActiveRef.current) {
              updatePaddleFromClientX(event.clientX)
            }
          }}
          onPointerUp={() => {
            pointerActiveRef.current = false
          }}
          onPointerCancel={() => {
            pointerActiveRef.current = false
          }}
          onPointerLeave={() => {
            pointerActiveRef.current = false
          }}
        />
      </section>
    </main>
  )
}

export default App
