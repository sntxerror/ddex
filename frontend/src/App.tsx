import { useEffect, useRef, useState } from 'react'
import wasmInit, { init as wasmInitMsg, version, Universe } from './wasm/wallet_core.js'

const CELL_SIZE = 8
const GAP = 1
const STEP = CELL_SIZE + GAP
const ALIVE_BASE = [192, 132, 252] // #c084fc
const REVEAL_RADIUS = 300
const LERP_SPEED = 0.08

function App() {
  const [wasmStatus, setWasmStatus] = useState<'loading' | 'ok' | 'error' | 'killed'>('loading')
  const [wasmVersion, setWasmVersion] = useState('')
  const [wasmError, setWasmError] = useState('')
  const [generation, setGeneration] = useState(0)
  const [running, setRunning] = useState(true)
  const [panelOpen, setPanelOpen] = useState(() => window.innerWidth > 600)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const blurRef = useRef<HTMLDivElement>(null)
  const wasmMemoryRef = useRef<WebAssembly.Memory | null>(null)
  const universeRef = useRef<Universe | null>(null)
  const runningRef = useRef(true)
  const genRef = useRef(0)
  const frameRef = useRef(0)
  const mouseTarget = useRef({ x: -9999, y: -9999 })
  const mouseCurrent = useRef({ x: -9999, y: -9999 })
  const mouseActive = useRef(false)

  useEffect(() => {
    runningRef.current = running
  }, [running])

  // Smooth trailing cursor reveal
  useEffect(() => {
    let raf = 0
    const tick = () => {
      const cur = mouseCurrent.current
      const tgt = mouseTarget.current
      cur.x += (tgt.x - cur.x) * LERP_SPEED
      cur.y += (tgt.y - cur.y) * LERP_SPEED
      if (blurRef.current && mouseActive.current) {
        const r = REVEAL_RADIUS
        const grad = `radial-gradient(circle ${r}px at ${cur.x}px ${cur.y}px, transparent 0%, transparent 40%, rgba(0,0,0,0.4) 60%, rgba(0,0,0,0.85) 100%)`
        blurRef.current.style.maskImage = grad
        blurRef.current.style.webkitMaskImage = grad
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  const paintingRef = useRef(false)
  const SPAWN_RADIUS = 3

  const spawnAtScreen = (screenX: number, screenY: number) => {
    const universe = universeRef.current
    if (!universe) return
    const col = Math.floor(screenX / STEP)
    const row = Math.floor(screenY / STEP)
    universe.spawn(col, row, SPAWN_RADIUS)
  }

  const handleMouseMove = (e: React.MouseEvent) => {
    mouseTarget.current = { x: e.clientX, y: e.clientY }
    mouseActive.current = true
    if (paintingRef.current) spawnAtScreen(e.clientX, e.clientY)
  }

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return
    paintingRef.current = true
    spawnAtScreen(e.clientX, e.clientY)
  }

  const handleMouseUp = () => { paintingRef.current = false }

  const handleMouseLeave = () => {
    mouseActive.current = false
    paintingRef.current = false
    if (blurRef.current) {
      blurRef.current.style.maskImage = 'none'
      blurRef.current.style.webkitMaskImage = 'none'
    }
  }

  const handleTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0]
    mouseTarget.current = { x: t.clientX, y: t.clientY }
    mouseCurrent.current = { x: t.clientX, y: t.clientY }
    mouseActive.current = true
    paintingRef.current = true
    spawnAtScreen(t.clientX, t.clientY)
  }

  const handleTouchMove = (e: React.TouchEvent) => {
    const t = e.touches[0]
    mouseTarget.current = { x: t.clientX, y: t.clientY }
    mouseActive.current = true
    if (paintingRef.current) spawnAtScreen(t.clientX, t.clientY)
  }

  const handleTouchEnd = () => {
    paintingRef.current = false
    mouseActive.current = false
    if (blurRef.current) {
      blurRef.current.style.maskImage = 'none'
      blurRef.current.style.webkitMaskImage = 'none'
    }
  }

  useEffect(() => {
    let cancelled = false

    async function loadWasm() {
      try {
        const exports = await wasmInit('/wasm/wallet_core_bg.wasm')
        if (cancelled) return
        wasmMemoryRef.current = exports.memory

        const msg = wasmInitMsg()
        const ver = version()
        console.log('[wallet-core]', msg)
        console.log('[wallet-core] version:', ver)
        setWasmStatus('ok')
        setWasmVersion(ver)

        const cols = Math.floor(window.innerWidth / STEP)
        const rows = Math.floor(window.innerHeight / STEP)
        const universe = Universe.new(cols, rows)
        universeRef.current = universe

        const canvas = canvasRef.current
        if (!canvas) return
        canvas.width = window.innerWidth
        canvas.height = window.innerHeight

        genRef.current = 0
        const renderLoop = () => {
          if (cancelled) return
          const u = universeRef.current
          if (!u) {
            // WASM killed — clear canvas
            const ctx = canvas.getContext('2d')
            if (ctx) { ctx.fillStyle = '#07070d'; ctx.fillRect(0, 0, canvas.width, canvas.height) }
            frameRef.current = requestAnimationFrame(renderLoop)
            return
          }
          if (runningRef.current) {
            u.tick()
            genRef.current++
            if (genRef.current % 2 === 0) setGeneration(genRef.current)
          }
          drawCells(canvas, u)
          frameRef.current = requestAnimationFrame(renderLoop)
        }

        drawCells(canvas, universe)
        frameRef.current = requestAnimationFrame(renderLoop)
      } catch (err) {
        if (cancelled) return
        const message = err instanceof Error ? err.message : String(err)
        setWasmStatus('error')
        setWasmError(message)
        console.error('[wallet-core] load error:', err)
      }
    }
    loadWasm()
    return () => { cancelled = true; cancelAnimationFrame(frameRef.current) }
  }, [])

  function drawCells(canvas: HTMLCanvasElement, universe: Universe) {
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const w = universe.width()
    const h = universe.height()
    const memory = wasmMemoryRef.current
    if (!memory) return

    const cells = new Uint8Array(memory.buffer, universe.cells_ptr(), w * h)

    ctx.fillStyle = '#07070d'
    ctx.fillRect(0, 0, canvas.width, canvas.height)

    for (let row = 0; row < h; row++) {
      for (let col = 0; col < w; col++) {
        if (cells[row * w + col] === 0) continue
        const a = 0.35 + Math.random() * 0.35
        ctx.fillStyle = `rgba(${ALIVE_BASE[0]},${ALIVE_BASE[1]},${ALIVE_BASE[2]},${a})`
        ctx.fillRect(col * STEP, row * STEP, CELL_SIZE, CELL_SIZE)
      }
    }
  }

  const handleRerun = () => {
    const universe = universeRef.current
    const canvas = canvasRef.current
    if (universe && canvas) {
      universe.reset()
      genRef.current = 0
      setGeneration(0)
      if (!runningRef.current) drawCells(canvas, universe)
    }
  }

  const handleToggleWasm = () => {
    if (wasmStatus === 'ok') {
      // Kill: free the Universe, null it out
      const universe = universeRef.current
      if (universe) {
        universe.free()
        universeRef.current = null
      }
      setWasmStatus('killed')
      setRunning(false)
      console.log('[wallet-core] WASM instance killed')
    } else if (wasmStatus === 'killed') {
      // Revive: re-create Universe from existing WASM memory
      const canvas = canvasRef.current
      if (!canvas) return
      const cols = Math.floor(window.innerWidth / STEP)
      const rows = Math.floor(window.innerHeight / STEP)
      const universe = Universe.new(cols, rows)
      universeRef.current = universe
      genRef.current = 0
      setGeneration(0)
      setRunning(true)
      setWasmStatus('ok')
      console.log('[wallet-core] WASM instance revived')
    }
  }

  const statusDot = wasmStatus === 'ok'
    ? { color: '#4ade80', label: 'wasm dreaming the game of life' }
    : wasmStatus === 'killed'
    ? { color: '#f85149', label: 'wasm killed — tap to revive' }
    : wasmStatus === 'error'
    ? { color: '#f85149', label: `Failed: ${wasmError}` }
    : { color: '#666', label: 'Loading WASM...' }

  const heroBtnStyle: React.CSSProperties = {
    padding: 'clamp(8px, 1.5vw, 10px) clamp(20px, 4vw, 28px)', borderRadius: '12px',
    border: '1px solid rgba(192,132,252,0.2)',
    background: 'rgba(192,132,252,0.08)',
    color: '#e5e5e5', cursor: 'pointer',
    fontSize: 'clamp(0.8rem, 2.5vw, 0.95rem)',
    fontWeight: 600, letterSpacing: '0.03em',
    transition: 'background 0.2s, border-color 0.2s, transform 0.15s',
    backdropFilter: 'blur(12px)',
    WebkitBackdropFilter: 'blur(12px)',
    minHeight: '44px',
  }

  return (
    <div
      onMouseMove={handleMouseMove}
      onMouseDown={handleMouseDown}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseLeave}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      style={{
        position: 'fixed', inset: 0, overflow: 'hidden',
        fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
        color: '#e5e5e5', background: '#07070d', cursor: 'crosshair',
      }}
    >
      <canvas
        ref={canvasRef}
        style={{ position: 'absolute', top: 0, left: 0, display: 'block' }}
      />

      <div
        ref={blurRef}
        style={{
          position: 'absolute', inset: 0,
          backdropFilter: 'blur(8px) brightness(0.6)',
          WebkitBackdropFilter: 'blur(8px) brightness(0.6)',
        }}
      />

      {/* Content layer */}
      <div style={{
        position: 'relative', zIndex: 10,
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        minHeight: '100vh',
        paddingTop: 'clamp(15vh, 20vh, 28vh)',
        paddingLeft: 'clamp(0.75rem, 3vw, 2rem)',
        paddingRight: 'clamp(0.75rem, 3vw, 2rem)',
        paddingBottom: 'clamp(0.5rem, 2vw, 1.5rem)',
        pointerEvents: 'none',
      }}>
        {/* Title */}
        <h1 style={{
          fontSize: 'clamp(1.8rem, 8vw, 5rem)', fontWeight: 800,
          margin: 0, lineHeight: 1.1, letterSpacing: '-0.02em',
          background: 'linear-gradient(135deg, #f0f0f0 0%, #c084fc 50%, #a855f7 100%)',
          WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
          backgroundClip: 'text',
          padding: '0.1em 0',
        }}>
          Demo Dream
        </h1>
        <div style={{
          display: 'flex', alignItems: 'center', gap: '0.5rem',
          marginTop: 'clamp(0.3rem, 0.8vw, 0.5rem)', marginBottom: 'clamp(0.3rem, 0.5vw, 0.5rem)',
          pointerEvents: 'auto', cursor: (wasmStatus === 'ok' || wasmStatus === 'killed') ? 'pointer' : 'default',
        }}
          onClick={handleToggleWasm}
          title={wasmStatus === 'ok' ? 'Click to kill WASM instance' : wasmStatus === 'killed' ? 'Click to revive' : undefined}
        >
          <span style={{
            width: 8, height: 8, borderRadius: '50%',
            background: statusDot.color, flexShrink: 0,
            boxShadow: `0 0 6px ${statusDot.color}`,
          }} />
          <span style={{
            color: 'rgba(200,200,200,0.4)', fontSize: 'clamp(0.6rem, 2.5vw, 1.1rem)',
            letterSpacing: '0.12em',
            textTransform: 'uppercase', fontWeight: 300,
          }}>
            wasm dreaming the game of life for js
          </span>
        </div>

        {/* Gen counter */}
        <span style={{
          fontSize: 'clamp(0.68rem, 2vw, 0.85rem)',
          color: 'rgba(192,132,252,0.5)',
          fontVariantNumeric: 'tabular-nums',
          marginBottom: 'clamp(0.6rem, 1.5vw, 1.2rem)',
        }}>
          Gen {generation}
        </span>

        {/* Hero buttons */}
        <div style={{
          display: 'flex', gap: 'clamp(0.5rem, 1.5vw, 0.75rem)', flexWrap: 'wrap',
          justifyContent: 'center',
          pointerEvents: 'auto',
          marginBottom: 'clamp(0.8rem, 2vw, 1.5rem)',
        }}>
          <button
            onClick={() => setRunning(r => !r)}
            style={heroBtnStyle}
            onMouseEnter={e => {
              e.currentTarget.style.background = 'rgba(192,132,252,0.2)'
              e.currentTarget.style.borderColor = 'rgba(192,132,252,0.4)'
              e.currentTarget.style.transform = 'scale(1.04)'
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = 'rgba(192,132,252,0.08)'
              e.currentTarget.style.borderColor = 'rgba(192,132,252,0.2)'
              e.currentTarget.style.transform = 'scale(1)'
            }}
          >
            {running ? 'Pause' : 'Play'}
          </button>
          <button
            onClick={handleRerun}
            style={heroBtnStyle}
            onMouseEnter={e => {
              e.currentTarget.style.background = 'rgba(192,132,252,0.2)'
              e.currentTarget.style.borderColor = 'rgba(192,132,252,0.4)'
              e.currentTarget.style.transform = 'scale(1.04)'
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = 'rgba(192,132,252,0.08)'
              e.currentTarget.style.borderColor = 'rgba(192,132,252,0.2)'
              e.currentTarget.style.transform = 'scale(1)'
            }}
          >
            Rerun
          </button>
        </div>

        {/* Foldable glass panel */}
        <div style={{
          pointerEvents: 'auto',
          maxWidth: 'min(420px, 92vw)', width: '100%',
        }}>
          {/* Toggle button */}
          <button
            onClick={() => setPanelOpen(o => !o)}
            style={{
              display: 'flex', alignItems: 'center', gap: '0.5rem',
              width: '100%', padding: '10px 16px',
              borderRadius: panelOpen ? '16px 16px 0 0' : '16px',
              border: '1px solid rgba(255,255,255,0.07)',
              borderBottom: panelOpen ? '1px solid rgba(255,255,255,0.04)' : undefined,
              background: 'rgba(255,255,255,0.035)',
              backdropFilter: 'blur(24px) saturate(1.3)',
              WebkitBackdropFilter: 'blur(24px) saturate(1.3)',
              color: '#e5e5e5', cursor: 'pointer', fontSize: '0.82rem',
              fontWeight: 500, transition: 'border-radius 0.25s',
              textAlign: 'left',
            }}
          >
            <span style={{ flex: 1 }}>Details</span>
            <span style={{
              transition: 'transform 0.25s',
              transform: panelOpen ? 'rotate(180deg)' : 'rotate(0deg)',
              fontSize: '0.7rem', color: 'rgba(200,200,200,0.4)',
            }}>
              ▼
            </span>
          </button>

          {/* Collapsible body */}
          <div style={{
            overflow: 'hidden',
            maxHeight: panelOpen ? '400px' : '0px',
            opacity: panelOpen ? 1 : 0,
            transition: 'max-height 0.35s ease, opacity 0.25s ease',
          }}>
            <div style={{
              background: 'rgba(255,255,255,0.035)',
              backdropFilter: 'blur(24px) saturate(1.3)',
              WebkitBackdropFilter: 'blur(24px) saturate(1.3)',
              border: '1px solid rgba(255,255,255,0.07)',
              borderTop: 'none',
              borderRadius: '0 0 16px 16px',
              padding: 'clamp(1rem, 2vw, 1.5rem) clamp(1rem, 2.5vw, 2rem)',
              boxShadow: '0 8px 40px rgba(0,0,0,0.4)',
            }}>

              {wasmVersion && (
                <div style={{
                  fontSize: '0.72rem', color: 'rgba(200,200,200,0.3)',
                  marginBottom: '1rem',
                }}>
                  wallet-core v{wasmVersion} · wasm-bindgen · Rust → wasm32
                </div>
              )}

              <p style={{
                fontSize: '0.78rem', color: 'rgba(200,200,200,0.3)',
                margin: 0, lineHeight: 1.6,
              }}>
                Each cell computed in Rust/WASM. Canvas reads linear memory directly.
                Click or touch to spawn cells. Move cursor to reveal the simulation.
              </p>
              <a href="https://github.com/sntxerror/ddex" target="_blank" rel="noopener"
                style={{
                  display: 'inline-block', marginTop: '0.75rem',
                  fontSize: '0.72rem', color: 'rgba(192,132,252,0.5)',
                  textDecoration: 'none',
                }}>
                github.com/sntxerror/ddex
              </a>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div style={{
          marginTop: 'auto', paddingTop: 'clamp(1rem, 3vw, 2rem)',
          paddingBottom: 'clamp(0.5rem, 2vw, 1rem)',
          fontSize: '0.68rem',
          color: 'rgba(200,200,200,0.18)', pointerEvents: 'auto',
          textAlign: 'center',
        }}>
          Based on the{' '}
          <a href="https://rustwasm.github.io/docs/book/" target="_blank" rel="noopener"
            style={{ color: 'rgba(192,132,252,0.35)', textDecoration: 'none' }}>
            Rust and WebAssembly Book
          </a>
          {' '}·{' '}
          <a href="https://github.com/nicholasray/wasm-game-of-life" target="_blank" rel="noopener"
            style={{ color: 'rgba(192,132,252,0.35)', textDecoration: 'none' }}>
            wasm-game-of-life
          </a>
        </div>
      </div>
    </div>
  )
}

export default App
