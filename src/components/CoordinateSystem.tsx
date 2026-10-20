import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Crosshair, Download, Maximize2, Move, RotateCcw, ZoomIn, ZoomOut } from 'lucide-react'
import { compileCcsExpression, parseCcsContent, type CcsItem } from '../lib/coordinateSystem'
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

type CompiledFunction = (x: number) => number | null
type RenderItem = CcsItem & { fn?: CompiledFunction | null }

interface FunctionSample {
  sx: number
  sy: number | null
}

const MIN_SCALE = 0.005
const MAX_SCALE = 5000

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function niceStep(scale: number): number {
  const targetPx = 60
  const raw = targetPx / scale
  if (!Number.isFinite(raw) || raw <= 0) return 1
  const mag = Math.pow(10, Math.floor(Math.log10(raw)))
  for (const c of [1, 2, 5, 10]) {
    const step = c * mag
    if (step >= raw - 1e-12) return step
  }
  return 10 * mag
}

function tickDecimals(step: number): number {
  if (step >= 1) return 0
  return clamp(Math.ceil(-Math.log10(step)), 0, 10)
}

function formatTick(value: number, step: number): string {
  if (value === 0) return '0'
  const abs = Math.abs(value)
  if (abs >= 1e12 || (abs > 0 && abs < 1e-7)) return value.toExponential(2).replace('e+', 'e')
  const text = value.toFixed(tickDecimals(step))
  return text.includes('.') ? text.replace(/\.?0+$/, '') : text
}

/** 悬停 / 中心坐标：小数位随缩放走，放大看细节时不会只剩两位，缩小时也不拖一串零。 */
function formatCoordinate(value: number, scale: number): string {
  if (!Number.isFinite(value)) return '—'
  if (value === 0) return '0'
  const abs = Math.abs(value)
  if (abs >= 1e12 || abs < 1e-7) return value.toExponential(3).replace('e+', 'e')
  const worldPerPixel = 1 / Math.max(scale, MIN_SCALE)
  const decimals = clamp(Math.ceil(-Math.log10(worldPerPixel)) + 1, 2, 8)
  return Number(value.toFixed(decimals)).toString()
}

function formatScale(scale: number): string {
  if (scale >= 100) return scale.toFixed(0)
  if (scale >= 10) return Number(scale.toFixed(1)).toString()
  if (scale >= 1) return Number(scale.toFixed(2)).toString()
  return Number(scale.toFixed(3)).toString()
}

function formatPointValue(value: number): string {
  if (Number.isInteger(value)) return String(value)
  return Number(value.toPrecision(8)).toString()
}

interface Bounds {
  minX: number
  maxX: number
  minY: number
  maxY: number
  count: number
}

function boundsForItems(items: readonly CcsItem[]): Bounds | null {
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  let count = 0
  const include = (x: number, y: number) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return
    minX = Math.min(minX, x)
    maxX = Math.max(maxX, x)
    minY = Math.min(minY, y)
    maxY = Math.max(maxY, y)
    count += 1
  }
  for (const item of items) {
    if (item.kind === 'point') include(item.x, item.y)
    else if (item.kind === 'polyline') {
      for (const [x, y] of item.points) include(x, y)
    }
  }
  return count > 0 ? { minX, maxX, minY, maxY, count } : null
}

/**
 * 初始 / 适配视图：按点与折线的包围盒适配画布（函数图像是无限的，不参与适配）。
 * 不硬把原点塞进包围盒——数据在 (1000,1000) 附近时，强行带上原点只会把图形缩成一团；
 * 需要看原点时有单独的「回到原点」按钮。
 */
function fitView(items: readonly CcsItem[], w: number, h: number): View {
  const bounds = boundsForItems(items)
  if (!bounds) return { cx: 0, cy: 0, scale: 40 }
  const cx = (bounds.minX + bounds.maxX) / 2
  const cy = (bounds.minY + bounds.maxY) / 2
  const rawSpanX = bounds.maxX - bounds.minX
  const rawSpanY = bounds.maxY - bounds.minY
  if (rawSpanX === 0 && rawSpanY === 0) return { cx, cy, scale: 40 }
  const spanX = Math.max(rawSpanX, rawSpanY * 0.2, 1)
  const spanY = Math.max(rawSpanY, rawSpanX * 0.2, 1)
  const scale = clamp(Math.min((w * 0.82) / spanX, (h * 0.82) / spanY), MIN_SCALE, MAX_SCALE)
  return { cx, cy, scale }
}

export function CoordinateSystem({ content, sourceLine }: CoordinateSystemProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const hoverLabelRef = useRef<HTMLDivElement>(null)
  const viewLabelRef = useRef<HTMLDivElement>(null)

  // 解析与函数编译只随内容变化做一次；拖动 / 缩放的每一帧只采样，不重复解析字符串。
  const parsed = useMemo(() => parseCcsContent(content), [content])
  const renderItems = useMemo<RenderItem[]>(
    () =>
      parsed.items.map((item) =>
        item.kind === 'function' ? { ...item, fn: compileCcsExpression(item.expr) } : item,
      ),
    [parsed],
  )
  const renderItemsRef = useRef(renderItems)
  renderItemsRef.current = renderItems

  const viewRef = useRef<View>(fitView(parsed.items, 600, 420))
  const sizeRef = useRef({ w: 600, h: 400 })
  const canvasPixelRef = useRef({ w: 0, h: 0, dpr: 1 })
  const drawFrameRef = useRef(0)
  const draggingRef = useRef(false)
  const lastPosRef = useRef({ x: 0, y: 0 })
  const pointersRef = useRef(new Map<number, { x: number; y: number }>())
  const pinchRef = useRef<{ dist: number; midX: number; midY: number } | null>(null)
  const hoverScreenRef = useRef<{ x: number; y: number } | null>(null)
  const activeIndexRef = useRef<number | null>(null)

  const [isDragging, setIsDragging] = useState(false)
  const [activeIndex, setActiveIndexState] = useState<number | null>(null)
  const { theme } = useTheme()
  const dark = theme === 'dark'

  const setActiveIndex = useCallback((index: number | null) => {
    activeIndexRef.current = index
    setActiveIndexState(index)
  }, [])

  /**
   * 右上角的中心 / 比例与左下角的悬停坐标直接写 DOM：
   * 指针移动一秒可触发上百次，走 React state 会让整个坐标系组件跟着重渲染上百次。
   */
  const syncOverlay = useCallback(() => {
    const view = viewRef.current
    if (viewLabelRef.current) {
      viewLabelRef.current.textContent =
        `中心 (${formatCoordinate(view.cx, view.scale)}, ${formatCoordinate(view.cy, view.scale)}) · ` +
        `${formatScale(view.scale)} px/单位`
    }
    const label = hoverLabelRef.current
    if (!label) return
    const hover = hoverScreenRef.current
    if (!hover) {
      label.style.opacity = '0'
      return
    }
    const { w, h } = sizeRef.current
    const wx = view.cx + (hover.x - w / 2) / view.scale
    const wy = view.cy + (h / 2 - hover.y) / view.scale
    label.textContent = `(${formatCoordinate(wx, view.scale)}, ${formatCoordinate(wy, view.scale)})`
    label.style.opacity = '1'
  }, [])

  const redraw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const { w, h } = sizeRef.current
    if (w <= 0 || h <= 0) return
    const view = viewRef.current
    const items = renderItemsRef.current
    const isDark = document.documentElement.classList.contains('dark')
    const selected = activeIndexRef.current

    const toScreenX = (x: number) => w / 2 + (x - view.cx) * view.scale
    const toScreenY = (y: number) => h / 2 - (y - view.cy) * view.scale

    ctx.clearRect(0, 0, w, h)
    ctx.fillStyle = isDark ? '#0b1220' : '#ffffff'
    ctx.fillRect(0, 0, w, h)

    const step = niceStep(view.scale)
    const left = view.cx - w / (2 * view.scale)
    const right = view.cx + w / (2 * view.scale)
    const bottom = view.cy - h / (2 * view.scale)
    const top = view.cy + h / (2 * view.scale)

    // 次级网格：主刻度够宽时五等分。用整数刻度序号遍历，避免浮点累加漂移。
    const minorStep = step / 5
    if (view.scale * step > 90) {
      ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)'
      ctx.lineWidth = 0.5
      ctx.beginPath()
      const firstMinorX = Math.ceil(left / minorStep)
      const lastMinorX = Math.floor(right / minorStep)
      for (let i = firstMinorX; i <= lastMinorX; i += 1) {
        if (i % 5 === 0) continue
        const sx = toScreenX(i * minorStep)
        ctx.moveTo(sx, 0)
        ctx.lineTo(sx, h)
      }
      const firstMinorY = Math.ceil(bottom / minorStep)
      const lastMinorY = Math.floor(top / minorStep)
      for (let i = firstMinorY; i <= lastMinorY; i += 1) {
        if (i % 5 === 0) continue
        const sy = toScreenY(i * minorStep)
        ctx.moveTo(0, sy)
        ctx.lineTo(w, sy)
      }
      ctx.stroke()
    }

    // 主网格
    const firstX = Math.ceil(left / step)
    const lastX = Math.floor(right / step)
    const firstY = Math.ceil(bottom / step)
    const lastY = Math.floor(top / step)
    ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.09)' : 'rgba(0,0,0,0.08)'
    ctx.lineWidth = 1
    ctx.beginPath()
    for (let i = firstX; i <= lastX; i += 1) {
      if (i === 0) continue
      const sx = toScreenX(i * step)
      ctx.moveTo(Math.round(sx) + 0.5, 0)
      ctx.lineTo(Math.round(sx) + 0.5, h)
    }
    for (let i = firstY; i <= lastY; i += 1) {
      if (i === 0) continue
      const sy = toScreenY(i * step)
      ctx.moveTo(0, Math.round(sy) + 0.5)
      ctx.lineTo(w, Math.round(sy) + 0.5)
    }
    ctx.stroke()

    // 坐标轴
    const zeroX = toScreenX(0)
    const zeroY = toScreenY(0)
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

    ctx.fillStyle = isDark ? 'rgba(255,255,255,0.85)' : 'rgba(0,0,0,0.85)'
    const arrowSize = 8
    if (zeroY >= 0 && zeroY <= h) {
      ctx.beginPath()
      ctx.moveTo(w - 2, zeroY)
      ctx.lineTo(w - 2 - arrowSize, zeroY - 4)
      ctx.lineTo(w - 2 - arrowSize, zeroY + 4)
      ctx.closePath()
      ctx.fill()
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
      ctx.font = '12px ui-sans-serif, system-ui'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'top'
      ctx.fillText('y', zeroX + 12, 6)
    }

    // 刻度标签
    ctx.font = '11px ui-monospace, SFMono-Regular, monospace'
    ctx.fillStyle = isDark ? 'rgba(255,255,255,0.65)' : 'rgba(0,0,0,0.68)'
    ctx.textBaseline = 'middle'
    if (zeroY >= -20 && zeroY <= h + 20) {
      ctx.textAlign = 'center'
      const labelY = clamp(zeroY + 14, 12, h - 6)
      for (let i = firstX; i <= lastX; i += 1) {
        if (i === 0) continue
        const sx = toScreenX(i * step)
        if (sx < 8 || sx > w - 8 || Math.abs(sx - zeroX) < 14) continue
        ctx.fillText(formatTick(i * step, step), sx, labelY)
      }
    }
    if (zeroX >= -20 && zeroX <= w + 20) {
      const alignRight = zeroX > w - 56
      ctx.textAlign = alignRight ? 'right' : 'left'
      const tx = alignRight ? zeroX - 6 : zeroX + 6
      for (let i = firstY; i <= lastY; i += 1) {
        if (i === 0) continue
        const sy = toScreenY(i * step)
        if (sy < 8 || sy > h - 8 || Math.abs(sy - zeroY) < 14) continue
        ctx.fillText(formatTick(i * step, step), tx, sy)
      }
    }
    if (zeroX >= 0 && zeroX <= w && zeroY >= 0 && zeroY <= h) {
      ctx.textAlign = 'right'
      ctx.textBaseline = 'top'
      ctx.fillText('O', zeroX - 6, zeroY + 6)
    }

    const functionCount = items.reduce((n, item) => n + (item.kind === 'function' ? 1 : 0), 0)
    const baseStepPx = functionCount <= 6 ? 1 : functionCount <= 20 ? 2 : 4
    const maxDepth = functionCount <= 6 ? 5 : 3
    const maxEvals = functionCount <= 6 ? 6000 : 2500

    /**
     * 函数采样：先按像素列取样，相邻样本在屏幕上跳得太远时递归补中点。
     * 陡峭的连续曲线（如 x^3）会因此跟得更贴，渐近线两侧则靠定义域断裂或
     * 「一端在画布上方很远、另一端在下方很远」判定断线，不再连出竖线。
     */
    const buildSamples = (fn: CompiledFunction): FunctionSample[] => {
      const samples: FunctionSample[] = []
      let evals = 0
      const sampleAt = (sx: number): FunctionSample => {
        evals += 1
        const wy = fn(view.cx + (sx - w / 2) / view.scale)
        return { sx, sy: wy === null ? null : toScreenY(wy) }
      }
      const visit = (a: FunctionSample, b: FunctionSample, depth: number) => {
        if (
          a.sy !== null &&
          b.sy !== null &&
          depth < maxDepth &&
          evals < maxEvals &&
          Math.abs(b.sy - a.sy) > 10
        ) {
          const mid = sampleAt((a.sx + b.sx) / 2)
          if (mid.sy !== null) {
            visit(a, mid, depth + 1)
            visit(mid, b, depth + 1)
            return
          }
          samples.push(mid)
        }
        samples.push(b)
      }
      let previous = sampleAt(0)
      samples.push(previous)
      for (let sx = baseStepPx; sx < w; sx += baseStepPx) {
        const next = sampleAt(sx)
        visit(previous, next, 0)
        previous = next
      }
      if (previous.sx < w) {
        const last = sampleAt(w)
        visit(previous, last, 0)
      }
      return samples
    }

    const strokeSamples = (samples: FunctionSample[]) => {
      ctx.beginPath()
      let pen = false
      let previous: FunctionSample | null = null
      for (const sample of samples) {
        if (sample.sy === null) {
          pen = false
          previous = null
          continue
        }
        if (!pen || !previous || previous.sy === null) {
          ctx.moveTo(sample.sx, sample.sy)
          pen = true
        } else {
          const oppositeOutside =
            (previous.sy < -h * 0.1 && sample.sy > h * 1.1) ||
            (previous.sy > h * 1.1 && sample.sy < -h * 0.1)
          const intersectsView =
            Math.max(previous.sy, sample.sy) >= -32 && Math.min(previous.sy, sample.sy) <= h + 32
          if ((oppositeOutside && Math.abs(sample.sy - previous.sy) > h) || !intersectsView) {
            ctx.moveTo(sample.sx, sample.sy)
          } else {
            ctx.lineTo(sample.sx, sample.sy)
          }
        }
        previous = sample
      }
      ctx.stroke()
    }

    items.forEach((item, index) => {
      const isSelected = selected === index
      if (item.kind === 'point') {
        const sx = toScreenX(item.x)
        const sy = toScreenY(item.y)
        if (sx < -40 || sx > w + 40 || sy < -40 || sy > h + 40) return
        if (isSelected) {
          ctx.beginPath()
          ctx.arc(sx, sy, 10, 0, Math.PI * 2)
          ctx.strokeStyle = item.color
          ctx.globalAlpha = 0.45
          ctx.lineWidth = 2
          ctx.stroke()
          ctx.globalAlpha = 1
        }
        ctx.beginPath()
        ctx.arc(sx, sy, 5, 0, Math.PI * 2)
        ctx.fillStyle = item.color
        ctx.fill()
        ctx.strokeStyle = 'rgba(255,255,255,0.95)'
        ctx.lineWidth = 1.5
        ctx.stroke()
        ctx.beginPath()
        ctx.arc(sx, sy, 1.8, 0, Math.PI * 2)
        ctx.fillStyle = '#ffffff'
        ctx.fill()

        // 标签带半透明底，靠边时自动翻到点的另一侧，避免被画布裁掉。
        const label = `(${formatPointValue(item.x)}, ${formatPointValue(item.y)})`
        ctx.font = '12px ui-sans-serif, system-ui'
        const labelWidth = ctx.measureText(label).width
        let lx = sx + 9
        if (lx + labelWidth + 8 > w) lx = sx - labelWidth - 17
        lx = clamp(lx, 4, Math.max(4, w - labelWidth - 8))
        let ly = sy - 20
        if (ly < 4) ly = sy + 9
        ly = clamp(ly, 4, Math.max(4, h - 20))
        ctx.fillStyle = isDark ? 'rgba(11,18,32,0.78)' : 'rgba(255,255,255,0.82)'
        ctx.beginPath()
        if (typeof ctx.roundRect === 'function') ctx.roundRect(lx - 4, ly - 2, labelWidth + 8, 17, 4)
        else ctx.rect(lx - 4, ly - 2, labelWidth + 8, 17)
        ctx.fill()
        ctx.textAlign = 'left'
        ctx.textBaseline = 'top'
        ctx.fillStyle = isDark ? 'rgba(255,255,255,0.9)' : 'rgba(0,0,0,0.8)'
        ctx.fillText(label, lx, ly)
      } else if (item.kind === 'polyline') {
        if (item.points.length === 0) return
        const tracePath = () => {
          ctx.beginPath()
          item.points.forEach(([x, y], i) => {
            const sx = toScreenX(x)
            const sy = toScreenY(y)
            if (i === 0) ctx.moveTo(sx, sy)
            else ctx.lineTo(sx, sy)
          })
        }
        ctx.lineCap = 'round'
        ctx.lineJoin = 'round'
        if (isSelected) {
          tracePath()
          ctx.strokeStyle = item.color
          ctx.globalAlpha = 0.22
          ctx.lineWidth = 6
          ctx.stroke()
          ctx.globalAlpha = 1
        }
        tracePath()
        ctx.strokeStyle = item.color
        ctx.lineWidth = 2.2
        ctx.stroke()
        for (const [x, y] of item.points) {
          const sx = toScreenX(x)
          const sy = toScreenY(y)
          if (sx < -12 || sx > w + 12 || sy < -12 || sy > h + 12) continue
          ctx.beginPath()
          ctx.arc(sx, sy, 3.5, 0, Math.PI * 2)
          ctx.fillStyle = item.color
          ctx.fill()
          ctx.strokeStyle = isDark ? '#0b1220' : '#ffffff'
          ctx.lineWidth = 1
          ctx.stroke()
        }
      } else if (item.kind === 'function') {
        if (!item.fn) return
        const samples = buildSamples(item.fn)
        ctx.lineCap = 'round'
        ctx.lineJoin = 'round'
        if (isSelected) {
          ctx.strokeStyle = item.color
          ctx.globalAlpha = 0.2
          ctx.lineWidth = 6
          strokeSamples(samples)
          ctx.globalAlpha = 1
        }
        ctx.strokeStyle = item.color
        ctx.lineWidth = 2
        strokeSamples(samples)
      }
    })

    if (items.length === 0) {
      ctx.font = '14px ui-sans-serif, system-ui'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillStyle = isDark ? 'rgba(255,255,255,0.45)' : 'rgba(0,0,0,0.42)'
      ctx.fillText('暂无可绘制元素', w / 2, h / 2)
    }

    syncOverlay()
  }, [syncOverlay])

  /** 所有重绘都合进下一帧：快速拖动时一帧只画一次。 */
  const scheduleRedraw = useCallback(() => {
    if (drawFrameRef.current) return
    drawFrameRef.current = requestAnimationFrame(() => {
      drawFrameRef.current = 0
      redraw()
    })
  }, [redraw])

  useEffect(
    () => () => {
      if (drawFrameRef.current) cancelAnimationFrame(drawFrameRef.current)
    },
    [],
  )

  // 内容变化（编辑器预览实时编辑）时重绘；视图保持不动，避免打字时画面跳动。
  useEffect(() => {
    if (activeIndexRef.current !== null && activeIndexRef.current >= renderItems.length) {
      setActiveIndex(null)
    }
    scheduleRedraw()
  }, [renderItems, scheduleRedraw, setActiveIndex])

  const updateSize = useCallback(() => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container) return
    const rect = container.getBoundingClientRect()
    const w = Math.round(rect.width)
    const h = Math.round(rect.height)
    if (w === 0 || h === 0) return
    sizeRef.current = { w, h }
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const previous = canvasPixelRef.current
    if (previous.w !== w || previous.h !== h || previous.dpr !== dpr) {
      canvasPixelRef.current = { w, h, dpr }
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)
      canvas.style.width = `${w}px`
      canvas.style.height = `${h}px`
      canvas.getContext('2d')?.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    scheduleRedraw()
  }, [scheduleRedraw])

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
    scheduleRedraw()
  }, [dark, scheduleRedraw])
  useEffect(() => {
    if (typeof MutationObserver === 'undefined') return
    const observer = new MutationObserver(scheduleRedraw)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [scheduleRedraw])

  const applyView = useCallback(
    (view: View) => {
      viewRef.current = view
      syncOverlay()
      scheduleRedraw()
    },
    [scheduleRedraw, syncOverlay],
  )

  /** 以某个屏幕点为锚缩放：缩放前后锚点下的世界坐标不变（滚轮 / 双指共用）。 */
  const zoomAt = useCallback(
    (sx: number, sy: number, factor: number) => {
      const { w, h } = sizeRef.current
      const view = viewRef.current
      const newScale = clamp(view.scale * factor, MIN_SCALE, MAX_SCALE)
      if (newScale === view.scale) return
      const wx0 = view.cx + (sx - w / 2) / view.scale
      const wy0 = view.cy + (h / 2 - sy) / view.scale
      applyView({
        scale: newScale,
        cx: wx0 - (sx - w / 2) / newScale,
        cy: wy0 - (h / 2 - sy) / newScale,
      })
    },
    [applyView],
  )

  // 滚轮必须用非 passive 原生监听：React 的 onWheel 在根节点是 passive 的，
  // preventDefault 不生效，缩放坐标系时页面会跟着滚动。缩放量按 delta 连续换算，
  // 触控板的小步滚动不会再一格跳 12%。
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const rect = canvas.getBoundingClientRect()
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? rect.height : 1
      const exponent = clamp(-e.deltaY * unit * (e.ctrlKey ? 0.01 : 0.0016), -0.7, 0.7)
      zoomAt(e.clientX - rect.left, e.clientY - rect.top, Math.exp(exponent))
    }
    canvas.addEventListener('wheel', onWheel, { passive: false })
    return () => canvas.removeEventListener('wheel', onWheel)
  }, [zoomAt])

  const handlePointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    const canvas = canvasRef.current
    if (!canvas) return
    try {
      canvas.setPointerCapture(e.pointerId)
    } catch { /* 个别宿主不支持捕获时仍可单指拖动 */ }
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pointersRef.current.size === 2) {
      const [a, b] = [...pointersRef.current.values()]
      pinchRef.current = {
        dist: Math.hypot(a.x - b.x, a.y - b.y),
        midX: (a.x + b.x) / 2,
        midY: (a.y + b.y) / 2,
      }
      draggingRef.current = false
    } else {
      draggingRef.current = true
      lastPosRef.current = { x: e.clientX, y: e.clientY }
    }
    setIsDragging(true)
  }

  const handlePointerMove = (e: React.PointerEvent) => {
    const view = viewRef.current
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    hoverScreenRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top }
    syncOverlay()

    if (pointersRef.current.has(e.pointerId)) {
      pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    }
    // 双指：中点移动是平移、指距变化是缩放，两者同时生效。
    if (pinchRef.current && pointersRef.current.size === 2) {
      const [a, b] = [...pointersRef.current.values()]
      const dist = Math.hypot(a.x - b.x, a.y - b.y)
      const midX = (a.x + b.x) / 2
      const midY = (a.y + b.y) / 2
      view.cx -= (midX - pinchRef.current.midX) / view.scale
      view.cy += (midY - pinchRef.current.midY) / view.scale
      if (dist > 0 && pinchRef.current.dist > 0) {
        zoomAt(midX - rect.left, midY - rect.top, dist / pinchRef.current.dist)
      }
      // 缩放已到上下限时 zoomAt 会直接返回，但上面这步平移仍要落到画面上。
      syncOverlay()
      scheduleRedraw()
      pinchRef.current = { dist, midX, midY }
      return
    }
    if (!draggingRef.current) return
    const dx = e.clientX - lastPosRef.current.x
    const dy = e.clientY - lastPosRef.current.y
    lastPosRef.current = { x: e.clientX, y: e.clientY }
    if (dx === 0 && dy === 0) return
    view.cx -= dx / view.scale
    view.cy += dy / view.scale
    syncOverlay()
    scheduleRedraw()
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
    const { w, h } = sizeRef.current
    zoomAt(w / 2, h / 2, factor)
  }

  const resetView = () => {
    const { w, h } = sizeRef.current
    applyView(fitView(renderItemsRef.current, w, h))
  }

  const goToOrigin = () => {
    applyView({ cx: 0, cy: 0, scale: viewRef.current.scale })
  }

  /** 点图例：定位到该元素并高亮；再点一次取消高亮。 */
  const focusItem = (index: number) => {
    if (activeIndexRef.current === index) {
      setActiveIndex(null)
      scheduleRedraw()
      return
    }
    const item = renderItemsRef.current[index]
    if (!item) return
    setActiveIndex(index)
    const { w, h } = sizeRef.current
    const { scale } = viewRef.current
    if (item.kind === 'point') applyView({ cx: item.x, cy: item.y, scale })
    else if (item.kind === 'polyline') applyView(fitView([item], w, h))
    else {
      const y0 = item.fn ? item.fn(0) : null
      applyView(y0 === null ? { cx: 0, cy: 0, scale } : { cx: 0, cy: y0, scale })
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    const { w, h } = sizeRef.current
    const view = viewRef.current
    const amount = e.shiftKey ? 0.35 : 0.12
    switch (e.key) {
      case 'ArrowLeft':
        applyView({ ...view, cx: view.cx - (w * amount) / view.scale })
        break
      case 'ArrowRight':
        applyView({ ...view, cx: view.cx + (w * amount) / view.scale })
        break
      case 'ArrowUp':
        applyView({ ...view, cy: view.cy + (h * amount) / view.scale })
        break
      case 'ArrowDown':
        applyView({ ...view, cy: view.cy - (h * amount) / view.scale })
        break
      case '+':
      case '=':
        zoom(1.2)
        break
      case '-':
      case '_':
        zoom(1 / 1.2)
        break
      case '0':
      case 'Home':
        resetView()
        break
      case 'o':
      case 'O':
        goToOrigin()
        break
      default:
        return
    }
    e.preventDefault()
  }

  const exportPng = () => {
    const canvas = canvasRef.current
    if (!canvas) return
    redraw() // 导出前先同步画一帧，避免拿到合帧队列里上一帧的画面
    const save = (url: string, revoke: boolean) => {
      const link = document.createElement('a')
      link.href = url
      link.download = 'coordinate-system.png'
      document.body.append(link)
      link.click()
      link.remove()
      if (revoke) window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    }
    if (typeof canvas.toBlob === 'function') {
      canvas.toBlob((blob) => {
        if (blob) save(URL.createObjectURL(blob), true)
        else save(canvas.toDataURL('image/png'), false)
      }, 'image/png')
    } else {
      save(canvas.toDataURL('image/png'), false)
    }
  }

  const hasErrors = parsed.errors.length > 0
  const initialView = viewRef.current
  const buttonClass =
    'rounded-md border border-ink-200 bg-white p-1.5 text-ink-600 transition hover:bg-ink-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 dark:border-white/10 dark:bg-white/10 dark:text-ink-300 dark:hover:bg-white/15'

  return (
    <div
      className="my-6 overflow-hidden rounded-xl border border-ink-200 bg-white shadow-sm dark:border-white/10 dark:bg-ink-900"
      data-source-line={sourceLine}
    >
      <div className="flex items-center justify-between gap-2 border-b border-ink-200 bg-ink-50/70 px-3 py-2 dark:border-white/10 dark:bg-white/[0.04]">
        <div className="flex min-w-0 items-center gap-2 text-sm font-medium text-ink-700 dark:text-ink-200">
          <Maximize2 size={14} className="shrink-0 text-ink-400" />
          <span className="truncate">平面直角坐标系</span>
          <span className="hidden text-xs font-normal text-ink-400 lg:inline">· 拖动平移 · 滚轮缩放 · 方向键移动</span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={resetView}
            className="inline-flex items-center gap-1 rounded-md border border-ink-200 bg-white px-2 py-1 text-xs text-ink-600 transition hover:bg-ink-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 dark:border-white/10 dark:bg-white/10 dark:text-ink-300 dark:hover:bg-white/15"
            title="重置视图"
            aria-label="重置视图，适配全部点与折线"
          >
            <RotateCcw size={12} />
            适配
          </button>
          <button type="button" onClick={goToOrigin} className={buttonClass} title="回到原点" aria-label="回到原点">
            <Crosshair size={14} />
          </button>
          <button type="button" onClick={() => zoom(1 / 1.18)} className={buttonClass} title="缩小" aria-label="缩小">
            <ZoomOut size={14} />
          </button>
          <button type="button" onClick={() => zoom(1.18)} className={buttonClass} title="放大" aria-label="放大">
            <ZoomIn size={14} />
          </button>
          <button type="button" onClick={exportPng} className={buttonClass} title="导出 PNG" aria-label="导出当前视图为 PNG 图片">
            <Download size={14} />
          </button>
        </div>
      </div>

      <div ref={containerRef} className="relative h-[420px] w-full select-none bg-white dark:bg-[#0b1220] sm:h-[480px]">
        <canvas
          ref={canvasRef}
          role="application"
          aria-roledescription="可平移和缩放的坐标系"
          aria-label="平面直角坐标系画布：可拖动平移，滚轮或双指缩放；聚焦后可用方向键平移、加减号缩放、数字 0 适配全部、字母 O 回到原点"
          tabIndex={0}
          className={`absolute inset-0 h-full w-full touch-none focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500 ${isDragging ? 'cursor-grabbing' : 'cursor-grab'}`}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onPointerLeave={() => {
            if (pointersRef.current.size === 0) {
              hoverScreenRef.current = null
              syncOverlay()
            }
          }}
          onKeyDown={handleKeyDown}
        >
          平面直角坐标系画布
        </canvas>
        <div
          ref={hoverLabelRef}
          className="pointer-events-none absolute bottom-2 left-2 rounded bg-white/90 px-2 py-1 font-mono text-[11px] text-ink-600 opacity-0 shadow-sm backdrop-blur-sm transition-opacity duration-100 dark:bg-ink-800/90 dark:text-ink-300"
        >
          (0, 0)
        </div>
        <div
          ref={viewLabelRef}
          className="pointer-events-none absolute right-2 top-2 rounded bg-white/90 px-2 py-1 font-mono text-[11px] text-ink-500 shadow-sm dark:bg-ink-800/80 dark:text-ink-400"
        >
          {`中心 (${formatCoordinate(initialView.cx, initialView.scale)}, ${formatCoordinate(initialView.cy, initialView.scale)}) · ${formatScale(initialView.scale)} px/单位`}
        </div>
        <div className="pointer-events-none absolute bottom-2 right-2 hidden items-center gap-1 rounded-full bg-ink-900/70 px-2.5 py-1 text-[11px] text-white backdrop-blur-sm dark:bg-white/10 sm:flex">
          <Move size={11} />
          拖动
          <span className="mx-1 opacity-50">·</span>
          滚轮缩放
          <span className="mx-1 opacity-50">·</span>
          点击图例定位
        </div>
      </div>

      {parsed.items.length > 0 && (
        <div className="border-t border-ink-100 bg-ink-50/50 px-3 py-2.5 dark:border-white/5 dark:bg-white/[0.02]">
          <div className="flex flex-wrap gap-2">
            {parsed.items.map((it, idx) => (
              <button
                type="button"
                key={idx}
                onClick={() => focusItem(idx)}
                aria-pressed={activeIndex === idx}
                title={activeIndex === idx ? '取消高亮' : '定位并高亮此元素'}
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${
                  activeIndex === idx
                    ? 'border-brand-400 bg-brand-500/10 font-medium text-ink-900 ring-1 ring-brand-400/60 dark:border-brand-400/50 dark:text-white'
                    : 'border-ink-200 bg-white text-ink-700 hover:border-ink-300 dark:border-white/10 dark:bg-white/5 dark:text-ink-300 dark:hover:border-white/20'
                }`}
              >
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: it.color }} />
                {it.kind === 'point' && `点 (${formatPointValue(it.x)}, ${formatPointValue(it.y)})`}
                {it.kind === 'polyline' && `折线 ${it.points.length} 点`}
                {it.kind === 'function' && `y = ${it.expr}`}
              </button>
            ))}
          </div>
        </div>
      )}

      {hasErrors && (
        <div className="border-t border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/30 dark:bg-amber-950/20 dark:text-amber-200">
          <div className="font-medium">解析提示：</div>
          <ul className="mt-1 list-disc space-y-0.5 pl-4">
            {parsed.errors.map((error, i) => (
              <li key={i}>{error}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
