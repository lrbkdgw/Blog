import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { Move, ZoomIn, ZoomOut, RotateCcw, Maximize2 } from 'lucide-react'
import { parseCcsContent, compileCcsExpression } from '../lib/coordinateSystem'
import { useTheme } from '../lib/theme'

interface CoordinateSystemProps {
  content: string
  sourceLine?: number
}

interface View {
  cx: number
  cy: number
  scale: number // pixels per unit
}

function niceStep(scale: number): number {
  const targetPx = 60
  const raw = targetPx / scale
  if (raw <= 0) return 1
  const mag = Math.pow(10, Math.floor(Math.log10(raw)))
  const candidates = [1, 2, 5, 10]
  for (const c of candidates) {
    const step = c * mag
    if (step >= raw - 1e-9) return step
  }
  return 10 * mag
}

function formatTick(v: number): string {
  if (Math.abs(v) < 1e-9) return '0'
  if (Number.isInteger(v)) return String(v)
  return Number(v.toFixed(4)).toString()
}

/**
 * 初始 / 重置视图：有点或折线时按它们的包围盒适配画布（函数图像是无限的，
 * 不参与适配）；只有一个点时以它为中心；什么都没有时回到原点附近。
 */
function defaultView(
  items: ReturnType<typeof parseCcsContent>['items'],
  w: number,
  h: number,
): View {
  const coords: [number, number][] = []
  for (const item of items) {
    if (item.kind === 'point') coords.push([item.x, item.y])
    else if (item.kind === 'polyline') coords.push(...item.points)
  }
  if (coords.length === 0) return { cx: 0, cy: 0, scale: 40 }
  if (coords.length === 1) return { cx: coords[0][0], cy: coords[0][1], scale: 40 }
  const xs = coords.map(([x]) => x)
  const ys = coords.map(([, y]) => y)
  const minX = Math.min(...xs, 0)
  const maxX = Math.max(...xs, 0)
  const minY = Math.min(...ys, 0)
  const maxY = Math.max(...ys, 0)
  const spanX = Math.max(maxX - minX, 1)
  const spanY = Math.max(maxY - minY, 1)
  const scale = Math.max(4, Math.min(200, Math.min((w * 0.8) / spanX, (h * 0.8) / spanY)))
  return { cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, scale }
}

export function CoordinateSystem({ content, sourceLine }: CoordinateSystemProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  // 解析结果直接走 useMemo：编辑器预览里内容一变，图例与画布在同一次渲染里同步，
  // 不能像之前那样只在 effect 里更新 ref（图例会慢一拍显示旧内容）。
  const parsed = useMemo(() => parseCcsContent(content), [content])
  const parsedRef = useRef(parsed)
  parsedRef.current = parsed
  const viewRef = useRef<View>(defaultView(parsed.items, 600, 420))
  const sizeRef = useRef({ w: 600, h: 400 })
  const draggingRef = useRef(false)
  const lastPosRef = useRef({ x: 0, y: 0 })
  const pointersRef = useRef(new Map<number, { x: number; y: number }>())
  const pinchRef = useRef<{ dist: number } | null>(null)

  const [viewDisplay, setViewDisplay] = useState<View>(viewRef.current)
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const { theme } = useTheme()
  const dark = theme === 'dark'

  const redraw = useCallback(() => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const { w, h } = sizeRef.current
    const view = viewRef.current
    const items = parsedRef.current.items
    const isDark = document.documentElement.classList.contains('dark')
    // Clear
    ctx.clearRect(0, 0, w, h)
    // Background fill
    ctx.fillStyle = isDark ? '#0b1220' : '#ffffff'
    ctx.fillRect(0, 0, w, h)

    // Grid
    const step = niceStep(view.scale)
    const left = view.cx - w / (2 * view.scale)
    const right = view.cx + w / (2 * view.scale)
    const bottom = view.cy - h / (2 * view.scale)
    const top = view.cy + h / (2 * view.scale)

    // minor grid if dense
    const minorStep = step / 5
    const showMinor = view.scale * step > 90
    if (showMinor) {
      ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)'
      ctx.lineWidth = 0.5
      ctx.beginPath()
      const startXMinor = Math.floor(left / minorStep) * minorStep
      const endXMinor = Math.ceil(right / minorStep) * minorStep
      for (let x = startXMinor; x <= endXMinor; x += minorStep) {
        if (Math.abs(x / step - Math.round(x / step)) < 1e-6) continue
        const sx = w / 2 + (x - view.cx) * view.scale
        if (sx < -1 || sx > w + 1) continue
        ctx.moveTo(sx, 0)
        ctx.lineTo(sx, h)
      }
      const startYMinor = Math.floor(bottom / minorStep) * minorStep
      const endYMinor = Math.ceil(top / minorStep) * minorStep
      for (let y = startYMinor; y <= endYMinor; y += minorStep) {
        if (Math.abs(y / step - Math.round(y / step)) < 1e-6) continue
        const sy = h / 2 - (y - view.cy) * view.scale
        if (sy < -1 || sy > h + 1) continue
        ctx.moveTo(0, sy)
        ctx.lineTo(w, sy)
      }
      ctx.stroke()
    }

    // major grid
    ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.09)' : 'rgba(0,0,0,0.08)'
    ctx.lineWidth = 1
    ctx.beginPath()
    {
      const startX = Math.floor(left / step) * step
      const endX = Math.ceil(right / step) * step
      for (let x = startX; x <= endX; x += step) {
        if (Math.abs(x) < 1e-9) continue
        const sx = w / 2 + (x - view.cx) * view.scale
        ctx.moveTo(Math.round(sx) + 0.5, 0)
        ctx.lineTo(Math.round(sx) + 0.5, h)
      }
      const startY = Math.floor(bottom / step) * step
      const endY = Math.ceil(top / step) * step
      for (let y = startY; y <= endY; y += step) {
        if (Math.abs(y) < 1e-9) continue
        const sy = h / 2 - (y - view.cy) * view.scale
        ctx.moveTo(0, Math.round(sy) + 0.5)
        ctx.lineTo(w, Math.round(sy) + 0.5)
      }
    }
    ctx.stroke()

    // axes
    const zeroX = w / 2 + (0 - view.cx) * view.scale
    const zeroY = h / 2 - (0 - view.cy) * view.scale

    // axis lines
    ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.45)' : 'rgba(0,0,0,0.6)'
    ctx.lineWidth = 1.6
    ctx.beginPath()
    if (zeroX >= 0 && zeroX <= w) {
      ctx.moveTo(Math.round(zeroX) + 0.5, 0)
      ctx.lineTo(Math.round(zeroX) + 0.5, h)
    }
    if (zeroY >= 0 && zeroY <= h) {
      ctx.moveTo(0, Math.round(zeroY) + 0.5)
      ctx.lineTo(w, Math.round(zeroY) + 0.5)
    }
    ctx.stroke()

    // axis arrows
    ctx.fillStyle = isDark ? 'rgba(255,255,255,0.85)' : 'rgba(0,0,0,0.85)'
    const arrowSize = 8
    if (zeroY >= 0 && zeroY <= h) {
      // x axis arrow to right
      ctx.beginPath()
      ctx.moveTo(w - 2, zeroY)
      ctx.lineTo(w - 2 - arrowSize, zeroY - 4)
      ctx.lineTo(w - 2 - arrowSize, zeroY + 4)
      ctx.closePath()
      ctx.fill()
      // label X
      ctx.font = '12px ui-sans-serif, system-ui'
      ctx.textBaseline = 'middle'
      ctx.textAlign = 'left'
      ctx.fillText('x', w - 14, zeroY - 12)
    }
    if (zeroX >= 0 && zeroX <= w) {
      ctx.beginPath()
      ctx.moveTo(zeroX, 2)
      ctx.lineTo(zeroX - 4, 2 + arrowSize)
      ctx.lineTo(zeroX + 4, 2 + arrowSize)
      ctx.closePath()
      ctx.fill()
      ctx.textAlign = 'center'
      ctx.textBaseline = 'top'
      ctx.fillText('y', zeroX + 12, 6)
    }

    // ticks and labels
    ctx.font = '11px ui-monospace, SFMono-Regular, monospace'
    ctx.fillStyle = isDark ? 'rgba(255,255,255,0.65)' : 'rgba(0,0,0,0.68)'
    ctx.textBaseline = 'middle'
    // x-axis labels (along x axis)
    if (zeroY >= -20 && zeroY <= h + 20) {
      ctx.textAlign = 'center'
      const startX = Math.floor(left / step) * step
      const endX = Math.ceil(right / step) * step
      for (let x = startX; x <= endX; x += step) {
        if (Math.abs(x) < 1e-9) continue
        const sx = w / 2 + (x - view.cx) * view.scale
        if (sx < 8 || sx > w - 8) continue
        // avoid label overlap near origin
        if (Math.abs(sx - zeroX) < 14) continue
        const labelY = Math.max(12, Math.min(h - 6, zeroY + 14))
        ctx.fillText(formatTick(x), sx, labelY)
      }
    }
    if (zeroX >= -20 && zeroX <= w + 20) {
      ctx.textAlign = 'left'
      const startY = Math.floor(bottom / step) * step
      const endY = Math.ceil(top / step) * step
      for (let y = startY; y <= endY; y += step) {
        if (Math.abs(y) < 1e-9) continue
        const sy = h / 2 - (y - view.cy) * view.scale
        if (sy < 8 || sy > h - 8) continue
        if (Math.abs(sy - zeroY) < 14) continue
        const tx = zeroX > w - 50 ? zeroX - 6 : zeroX + 6
        ctx.textAlign = zeroX > w - 50 ? 'right' : 'left'
        ctx.fillText(formatTick(y), tx, sy)
      }
    }

    // origin label O
    if (zeroX >= 0 && zeroX <= w && zeroY >= 0 && zeroY <= h) {
      ctx.textAlign = 'right'
      ctx.textBaseline = 'top'
      ctx.font = '11px ui-monospace, monospace'
      ctx.fillText('O', zeroX - 6, zeroY + 6)
    }

    // Draw user items
    for (const item of items) {
      if (item.kind === 'point') {
        const sx = w / 2 + (item.x - view.cx) * view.scale
        const sy = h / 2 - (item.y - view.cy) * view.scale
        // Draw point
        ctx.beginPath()
        ctx.arc(sx, sy, 5, 0, Math.PI * 2)
        ctx.fillStyle = item.color
        ctx.fill()
        ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.95)'
        ctx.lineWidth = 1.5
        ctx.stroke()
        // inner white dot
        ctx.beginPath()
        ctx.arc(sx, sy, 1.8, 0, Math.PI * 2)
        ctx.fillStyle = '#ffffff'
        ctx.fill()
        // label
        ctx.font = '12px ui-sans-serif, system-ui'
        ctx.textAlign = 'left'
        ctx.textBaseline = 'bottom'
        ctx.fillStyle = isDark ? 'rgba(255,255,255,0.9)' : 'rgba(0,0,0,0.8)'
        const label = `(${item.x}, ${item.y})`
        // avoid clipping
        const lx = sx + 9
        const ly = sy - 7
        ctx.fillText(label, lx, ly)
      } else if (item.kind === 'polyline') {
        if (item.points.length === 0) continue
        ctx.strokeStyle = item.color
        ctx.lineWidth = 2.2
        ctx.lineCap = 'round'
        ctx.lineJoin = 'round'
        ctx.beginPath()
        for (let i = 0; i < item.points.length; i++) {
          const [x, y] = item.points[i]
          const sx = w / 2 + (x - view.cx) * view.scale
          const sy = h / 2 - (y - view.cy) * view.scale
          if (i === 0) ctx.moveTo(sx, sy)
          else ctx.lineTo(sx, sy)
        }
        ctx.stroke()
        // vertices
        for (const [x, y] of item.points) {
          const sx = w / 2 + (x - view.cx) * view.scale
          const sy = h / 2 - (y - view.cy) * view.scale
          ctx.beginPath()
          ctx.arc(sx, sy, 3.5, 0, Math.PI * 2)
          ctx.fillStyle = item.color
          ctx.fill()
          ctx.strokeStyle = isDark ? '#0b1220' : '#ffffff'
          ctx.lineWidth = 1
          ctx.stroke()
        }
      } else if (item.kind === 'function') {
        // 每条函数每帧只解析一次，再逐像素列采样（拖动 / 缩放时不会重复解析字符串）
        const fn = compileCcsExpression(item.expr)
        if (!fn) continue
        ctx.strokeStyle = item.color
        ctx.lineWidth = 2
        ctx.lineCap = 'round'
        ctx.lineJoin = 'round'
        let started = false
        let prevSy: number | null = null
        let prevSx: number | null = null
        for (let sx = 0; sx < w; sx++) {
          const wx = view.cx + (sx - w / 2) / view.scale
          const wy = fn(wx)
          if (wy === null || !Number.isFinite(wy)) {
            if (started) {
              ctx.stroke()
              started = false
            }
            prevSy = null
            continue
          }
          const sy = h / 2 - (wy - view.cy) * view.scale
          // Handle asymptote: if jump too large (screen delta > 40% of height), break
          if (started && prevSy !== null && prevSx !== null) {
            const dy = Math.abs(sy - prevSy)
            // also check world dy?
            if (dy > h * 0.5 && Math.abs(sx - prevSx!) <= 2) {
              // discontinuity, break
              ctx.stroke()
              ctx.beginPath()
              ctx.moveTo(sx, sy)
              // started remains true but we have new subpath
              prevSy = sy
              prevSx = sx
              continue
            }
          }
          if (!started) {
            ctx.beginPath()
            ctx.moveTo(sx, sy)
            started = true
          } else {
            ctx.lineTo(sx, sy)
          }
          prevSy = sy
          prevSx = sx
        }
        if (started) ctx.stroke()
      }
    }

  }, [])

  // 内容变化（编辑器预览实时编辑）时重绘；视图保持不动，避免打字时画面跳动。
  useEffect(() => {
    redraw()
  }, [content, redraw])

  const updateSize = useCallback(() => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container) return
    const rect = container.getBoundingClientRect()
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const w = Math.round(rect.width)
    const h = Math.round(rect.height)
    if (w === 0 || h === 0) return
    sizeRef.current = { w, h }
    canvas.width = Math.round(w * dpr)
    canvas.height = Math.round(h * dpr)
    canvas.style.width = `${w}px`
    canvas.style.height = `${h}px`
    const ctx = canvas.getContext('2d')
    if (ctx) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    redraw()
  }, [redraw])

  useEffect(() => {
    updateSize()
    // 个别宿主（如 jsdom）没有 ResizeObserver，退回 window resize 即可
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updateSize)
    if (ro && containerRef.current) ro.observe(containerRef.current)
    window.addEventListener('resize', updateSize)
    return () => {
      ro?.disconnect()
      window.removeEventListener('resize', updateSize)
    }
  }, [updateSize])

  // 明暗切换时重绘：博客里靠主题上下文；VS Code 插件预览没有 ThemeProvider，
  // 只切换 <html> 的 dark 类，所以再观察一次类变化，两处都能跟上换色。
  useEffect(() => {
    redraw()
  }, [dark, redraw])
  useEffect(() => {
    const observer = new MutationObserver(() => redraw())
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [redraw])

  /** 以某个屏幕点为锚缩放：缩放前后锚点下的世界坐标不变（滚轮 / 双指共用）。 */
  const zoomAt = useCallback((sx: number, sy: number, factor: number) => {
    const { w, h } = sizeRef.current
    const view = viewRef.current
    const newScale = Math.max(4, Math.min(500, view.scale * factor))
    if (newScale === view.scale) return
    const wx0 = view.cx + (sx - w / 2) / view.scale
    const wy0 = view.cy + (h / 2 - sy) / view.scale
    view.scale = newScale
    view.cx = wx0 - (sx - w / 2) / newScale
    view.cy = wy0 - (h / 2 - sy) / newScale
    redraw()
    setViewDisplay({ ...view })
  }, [redraw])

  // 滚轮必须用非 passive 原生监听：React 的 onWheel 在根节点是 passive 的，
  // preventDefault 不生效，缩放坐标系时页面会跟着滚动。
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const rect = canvas.getBoundingClientRect()
      zoomAt(e.clientX - rect.left, e.clientY - rect.top, e.deltaY < 0 ? 1.12 : 0.89)
    }
    canvas.addEventListener('wheel', onWheel, { passive: false })
    return () => canvas.removeEventListener('wheel', onWheel)
  }, [zoomAt])

  const handlePointerDown = (e: React.PointerEvent) => {
    const canvas = canvasRef.current
    if (!canvas) return
    try {
      canvas.setPointerCapture(e.pointerId)
    } catch { /* 个别宿主不支持捕获时仍可单指拖动 */ }
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pointersRef.current.size === 2) {
      const [a, b] = [...pointersRef.current.values()]
      pinchRef.current = { dist: Math.hypot(a.x - b.x, a.y - b.y) }
      draggingRef.current = false
    } else {
      draggingRef.current = true
      lastPosRef.current = { x: e.clientX, y: e.clientY }
    }
    setIsDragging(true)
  }

  const handlePointerMove = (e: React.PointerEvent) => {
    const { w, h } = sizeRef.current
    const view = viewRef.current
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const sx = e.clientX - rect.left
    const sy = e.clientY - rect.top
    setHover({ x: view.cx + (sx - w / 2) / view.scale, y: view.cy + (h / 2 - sy) / view.scale })

    if (pointersRef.current.has(e.pointerId)) {
      pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    }
    // 双指捏合：以两指中点为锚缩放
    if (pinchRef.current && pointersRef.current.size === 2) {
      const [a, b] = [...pointersRef.current.values()]
      const dist = Math.hypot(a.x - b.x, a.y - b.y)
      if (dist > 0 && pinchRef.current.dist > 0) {
        zoomAt((a.x + b.x) / 2 - rect.left, (a.y + b.y) / 2 - rect.top, dist / pinchRef.current.dist)
      }
      pinchRef.current.dist = dist
      return
    }
    if (!draggingRef.current) return
    const dx = e.clientX - lastPosRef.current.x
    const dy = e.clientY - lastPosRef.current.y
    lastPosRef.current = { x: e.clientX, y: e.clientY }
    view.cx -= dx / view.scale
    view.cy += dy / view.scale
    redraw()
    setViewDisplay({ ...view })
  }

  const handlePointerUp = (e: React.PointerEvent) => {
    pointersRef.current.delete(e.pointerId)
    if (pointersRef.current.size < 2) pinchRef.current = null
    if (pointersRef.current.size === 1) {
      // 从双指切回单指时以剩余手指为新的拖动起点，避免视图跳一下
      const [rest] = [...pointersRef.current.values()]
      lastPosRef.current = { ...rest }
      draggingRef.current = true
    } else if (pointersRef.current.size === 0) {
      draggingRef.current = false
      setIsDragging(false)
    }
    try {
      ;(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId)
    } catch { /* 已释放时忽略 */ }
  }

  const zoom = (factor: number) => {
    const view = viewRef.current
    const newScale = Math.max(4, Math.min(500, view.scale * factor))
    if (newScale === view.scale) return
    view.scale = newScale
    redraw()
    setViewDisplay({ ...view })
  }

  const resetView = () => {
    const { w, h } = sizeRef.current
    viewRef.current = defaultView(parsedRef.current.items, w, h)
    redraw()
    setViewDisplay({ ...viewRef.current })
  }

  const hasErrors = parsed.errors.length > 0

  return (
    <div
      className="my-6 overflow-hidden rounded-xl border border-ink-200 bg-white shadow-sm dark:border-white/10 dark:bg-ink-900"
      data-source-line={sourceLine}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-ink-200 bg-ink-50/70 px-3 py-2 dark:border-white/10 dark:bg-white/[0.04]">
        <div className="flex items-center gap-2 text-sm font-medium text-ink-700 dark:text-ink-200">
          <Maximize2 size={14} className="text-ink-400" />
          平面直角坐标系
          <span className="hidden text-xs font-normal text-ink-400 sm:inline">· 拖动平移 · 滚轮缩放</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={resetView}
            className="inline-flex items-center gap-1 rounded-md border border-ink-200 bg-white px-2 py-1 text-xs text-ink-600 hover:bg-ink-50 dark:border-white/10 dark:bg-white/10 dark:text-ink-300 dark:hover:bg-white/15"
            title="重置视图"
          >
            <RotateCcw size={12} />
            重置
          </button>
          <button
            type="button"
            onClick={() => zoom(0.85)}
            className="rounded-md border border-ink-200 bg-white p-1.5 text-ink-600 hover:bg-ink-50 dark:border-white/10 dark:bg-white/10 dark:text-ink-300"
            title="缩小"
          >
            <ZoomOut size={14} />
          </button>
          <button
            type="button"
            onClick={() => zoom(1.18)}
            className="rounded-md border border-ink-200 bg-white p-1.5 text-ink-600 hover:bg-ink-50 dark:border-white/10 dark:bg-white/10 dark:text-ink-300"
            title="放大"
          >
            <ZoomIn size={14} />
          </button>
        </div>
      </div>

      {/* Canvas area */}
      <div ref={containerRef} className="relative h-[420px] w-full select-none bg-white dark:bg-[#0b1220] sm:h-[480px]">
        <canvas
          ref={canvasRef}
          role="img"
          aria-label="可拖动平移、滚轮或双指缩放的平面直角坐标系画布"
          className={`absolute inset-0 h-full w-full touch-none ${isDragging ? 'cursor-grabbing' : 'cursor-grab'}`}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onPointerLeave={() => {
            if (!draggingRef.current) setHover(null)
          }}
        />
        {/* Hover coordinate tooltip */}
        {hover && (
          <div className="pointer-events-none absolute bottom-2 left-2 rounded bg-white/90 px-2 py-1 font-mono text-[11px] text-ink-600 shadow-sm backdrop-blur-sm dark:bg-ink-800/90 dark:text-ink-300">
            ({hover.x.toFixed(2)}, {hover.y.toFixed(2)})
          </div>
        )}
        {/* Center/scale indicator */}
        <div className="pointer-events-none absolute right-2 top-2 rounded bg-white/90 px-2 py-1 font-mono text-[11px] text-ink-500 shadow-sm dark:bg-ink-800/80 dark:text-ink-400">
          中心 ({viewDisplay.cx.toFixed(1)}, {viewDisplay.cy.toFixed(1)}) · {viewDisplay.scale.toFixed(0)} px/单位
        </div>
        {/* Hint */}
        <div className="pointer-events-none absolute bottom-2 right-2 hidden items-center gap-1 rounded-full bg-ink-900/70 px-2.5 py-1 text-[11px] text-white backdrop-blur-sm dark:bg-white/10 sm:flex">
          <Move size={11} />
          拖动
          <span className="mx-1 opacity-50">·</span>
          滚轮缩放
        </div>
      </div>

      {/* Legend / info */}
      {parsed.items.length > 0 && (
        <div className="border-t border-ink-100 bg-ink-50/50 px-3 py-2.5 dark:border-white/5 dark:bg-white/[0.02]">
          <div className="flex flex-wrap gap-2">
            {parsed.items.map((it, idx) => (
              <span
                key={idx}
                className="inline-flex items-center gap-1.5 rounded-full border border-ink-200 bg-white px-2.5 py-1 text-xs text-ink-700 dark:border-white/10 dark:bg-white/5 dark:text-ink-300"
              >
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: it.color }} />
                {it.kind === 'point' && `点 (${it.x}, ${it.y})`}
                {it.kind === 'polyline' && `折线 ${it.points.length} 点`}
                {it.kind === 'function' && `y = ${it.expr}`}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Errors */}
      {hasErrors && (
        <div className="border-t border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/30 dark:bg-amber-950/20 dark:text-amber-200">
          <div className="font-medium">解析提示：</div>
          <ul className="mt-1 list-disc space-y-0.5 pl-4">
            {parsed.errors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
