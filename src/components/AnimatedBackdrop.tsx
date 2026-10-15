import { useEffect, useRef } from 'react'
import type { ActiveSceneId, SceneValues } from '../lib/animatedBackground'
import { backdropBudget } from '../lib/appearance'
import { createRenderer, type Renderer, type RGB } from '../lib/backdrop/renderers'
import { useTheme } from '../lib/theme'

/** A single transparent canvas; scenes never obscure the palette or the custom gradient. */
export function AnimatedBackdrop({ scene, values }: { scene: ActiveSceneId; values: SceneValues }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rendererRef = useRef<Renderer | null>(null)
  const redrawRef = useRef<(() => void) | null>(null)
  const valuesRef = useRef(values)
  valuesRef.current = values
  const valuesKey = JSON.stringify(values)
  const { theme, palette, effects } = useTheme()

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const style = getComputedStyle(document.documentElement)
    const readRGB = (name: string, fallback: RGB): RGB => {
      const channels = style.getPropertyValue(name).trim().split(/\s+/).map(Number)
      return channels.length === 3 && channels.every(Number.isFinite) ? channels as RGB : fallback
    }
    const colors = {
      primary: readRGB(theme === 'dark' ? '--brand-300' : '--brand-600', [90, 139, 255]),
      secondary: readRGB('--theme-secondary', [129, 140, 248]),
      dark: theme === 'dark',
    }
    let frame = 0, resizeFrame = 0, last = 0
    let budget = backdropBudget(effects, window.innerWidth)
    const redraw = () => rendererRef.current?.draw(ctx)
    redrawRef.current = redraw

    const sizeTo = () => {
      const width = window.innerWidth, height = window.innerHeight
      budget = backdropBudget(effects, width)
      const dpr = Math.min(window.devicePixelRatio || 1, budget.dpr)
      canvas.width = Math.round(width * dpr)
      canvas.height = Math.round(height * dpr)
      canvas.style.width = `${width}px`
      canvas.style.height = `${height}px`
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      const renderer = createRenderer(scene, colors, budget.particles)
      renderer.setup(width, height)
      renderer.configure(valuesRef.current)
      rendererRef.current = renderer
      redraw()
    }
    const tick = (now: number) => {
      frame = requestAnimationFrame(tick)
      const renderer = rendererRef.current
      if (!renderer) return
      const fps = Math.min(budget.fps, renderer.fps)
      if (last && now - last < 1000 / fps - 1) return
      const dt = last ? Math.min(0.1, (now - last) / 1000) : 1 / fps
      last = now
      renderer.step(dt)
      redraw()
    }
    const start = () => {
      if (frame || !budget.animate || document.hidden) return
      last = 0
      canvas.dataset.running = 'true'
      frame = requestAnimationFrame(tick)
    }
    const stop = () => {
      cancelAnimationFrame(frame)
      frame = 0
      canvas.dataset.running = 'false'
    }
    const onResize = () => {
      if (resizeFrame) return
      resizeFrame = requestAnimationFrame(() => { resizeFrame = 0; sizeTo() })
    }
    const onVisibility = () => { if (document.hidden) stop(); else { redraw(); start() } }

    canvas.dataset.running = 'false'
    sizeTo()
    start()
    window.addEventListener('resize', onResize)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      stop()
      cancelAnimationFrame(resizeFrame)
      window.removeEventListener('resize', onResize)
      document.removeEventListener('visibilitychange', onVisibility)
      rendererRef.current = null
      redrawRef.current = null
    }
  }, [scene, theme, palette.id, effects])

  useEffect(() => {
    rendererRef.current?.configure(valuesRef.current)
    // Static / reduced-motion views must also respond immediately to sliders.
    redrawRef.current?.()
  }, [valuesKey])

  return <canvas ref={canvasRef} aria-hidden="true" data-scene={scene} className="scene-canvas absolute inset-0 h-full w-full" />
}
