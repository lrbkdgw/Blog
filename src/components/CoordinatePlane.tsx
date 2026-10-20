import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Minus, Plus, RotateCcw } from 'lucide-react'
import { useTheme } from '../lib/theme'
import {
  compilePlaneExpression,
  findPlaneIntersections,
  formatPlaneNumber,
  nicePlaneStep,
  parseCoordinatePlane,
  planeContentBounds,
  type PlanePoint,
  type PlaneSpec,
} from '../lib/coordinatePlane'

/**
 * 交互平面直角坐标系（issue #76）：
 * 文章里用 `::begin_ui-ccs` … `::end_ui-ccs` 声明点、折线与函数图像，
 * 读者可以拖动平移、滚轮 / 双指捏合缩放。
 *
 * 视觉上尽量接近教材插图：只有网格、箭头坐标轴、刻度与图形本身，
 * 操作控件是浮在右上角的一枚小工具条，不占用独立横栏；
 * 函数表达式以小标签浮在左上角，折线顶点（含端点）与声明点画出色点，
 * 元素之间的交点以描边圆环标出；所有点默认不带坐标文字，悬浮（触屏点按）时才弹出坐标气泡。
 * 几何内容统一裁在视口矩形内，函数在间断点（如 1/x 的 x=0）自动断线。
 */

interface View {
  /** 视口中心对应的世界坐标。 */
  cx: number
  cy: number
  /** 每世界单位对应的像素数。 */
  scale: number
}

const DEFAULT_WIDTH = 820
const DEFAULT_HEIGHT = 400
const MIN_SCALE = 1
const MAX_SCALE = 5000
const CENTER_LIMIT = 1e6

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

/** 根据点 / 折线范围计算初始取景；没有几何内容时退回常见教学取景 [-6,6]×[-4,4]。 */
function fitView(spec: PlaneSpec, width: number, height: number): View {
  const bounds = planeContentBounds(spec)
  let minX = -6
  let maxX = 6
  let minY = -4
  let maxY = 4
  if (bounds) {
    minX = bounds.minX - Math.max((bounds.maxX - bounds.minX) * 0.2, 1)
    maxX = bounds.maxX + Math.max((bounds.maxX - bounds.minX) * 0.2, 1)
    minY = bounds.minY - Math.max((bounds.maxY - bounds.minY) * 0.2, 1)
    maxY = bounds.maxY + Math.max((bounds.maxY - bounds.minY) * 0.2, 1)
  }
  if (maxX - minX < 6) {
    const mid = (minX + maxX) / 2
    minX = mid - 3
    maxX = mid + 3
  }
  if (maxY - minY < 5) {
    const mid = (minY + maxY) / 2
    minY = mid - 2.5
    maxY = mid + 2.5
  }
  const scale = clamp(Math.min(width / (maxX - minX), height / (maxY - minY)) * 0.94, MIN_SCALE, MAX_SCALE)
  return { cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, scale }
}

/** 沿当前可见 x 区间采样函数；null / 非有限值或跨度过大（渐近线）时断开路径。 */
function sampleFunctionPath(
  fn: (x: number) => number | null,
  view: View,
  width: number,
  height: number,
): string {
  const halfWidthWorld = width / 2 / view.scale
  const xMin = view.cx - halfWidthWorld
  const xMax = view.cx + halfWidthWorld
  const segments = Math.max(180, Math.ceil(width / 2.5))
  const step = (xMax - xMin) / segments
  const jumpLimit = (height / view.scale) * 4
  let d = ''
  let pen = false
  let previousY: number | null = null

  for (let i = 0; i <= segments; i += 1) {
    const wx = xMin + i * step
    const wy = fn(wx)
    if (wy === null || Math.abs(wy) > 1e9) {
      pen = false
      previousY = null
      continue
    }
    if (previousY !== null && Math.abs(wy - previousY) > jumpLimit) pen = false
    const sx = (wx - view.cx) * view.scale + width / 2
    const sy = height / 2 - (wy - view.cy) * view.scale
    d += `${pen ? 'L' : 'M'}${sx.toFixed(2)},${sy.toFixed(2)}`
    pen = true
    previousY = wy
  }
  return d
}

export function CoordinatePlane({ spec: rawSpec, sourceLine }: { spec: string; sourceLine?: number }) {
  const spec = useMemo(() => parseCoordinatePlane(rawSpec), [rawSpec])
  // 文章内容变化时 remount 内部画布，视角随之复位到新内容的初始取景。
  return <PlaneCanvas key={rawSpec.trim()} spec={spec} sourceLine={sourceLine} />
}

interface HoverTarget {
  id: string
  point: PlanePoint
  text: string
}

const coordinateLabel = (point: PlanePoint) =>
  `(${formatPlaneNumber(point.x)}, ${formatPlaneNumber(point.y)})`

/**
 * 可悬浮的点：可见色点之外再铺一个透明的大命中圆（r≈12），
 * 鼠标 / 触屏进入时由父级显示坐标气泡；未悬浮时不显示任何坐标文字。
 */
function InteractiveDot({
  id,
  sx,
  sy,
  r,
  fill,
  halo,
  point,
  ring = false,
  active,
  onHover,
  onLeave,
}: {
  id: string
  sx: number
  sy: number
  r: number
  fill: string
  halo: string
  point: PlanePoint
  /** ring=true 表示交点：描边圆环而不是实心点。 */
  ring?: boolean
  active: boolean
  onHover: (target: HoverTarget) => void
  onLeave: () => void
}) {
  const emit = () => onHover({ id, point, text: coordinateLabel(point) })
  return (
    <g>
      {ring ? (
        <circle cx={sx} cy={sy} r={r} fill={halo} stroke={fill} strokeWidth={1.6} pointerEvents="none" />
      ) : (
        <circle cx={sx} cy={sy} r={r} fill={fill} stroke={halo} strokeWidth={1.6} pointerEvents="none" />
      )}
      {active && (
        <circle
          cx={sx}
          cy={sy}
          r={r + 3.5}
          fill="none"
          stroke={fill}
          strokeWidth={1.4}
          strokeDasharray="3 3"
          pointerEvents="none"
        />
      )}
      <circle
        cx={sx}
        cy={sy}
        r={Math.max(12, r + 7)}
        fill="transparent"
        style={{ cursor: 'crosshair' }}
        onPointerEnter={emit}
        onPointerDown={emit}
        onPointerLeave={onLeave}
      />
    </g>
  )
}

function PlaneCanvas({ spec, sourceLine }: { spec: PlaneSpec; sourceLine?: number }) {
  const { theme } = useTheme()
  const dark = theme === 'dark'
  const clipId = useId().replace(/[^a-zA-Z0-9_-]/g, '')

  const wrapRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT })
  const [view, setView] = useState<View>(() => fitView(spec, DEFAULT_WIDTH, DEFAULT_HEIGHT))
  const viewRef = useRef(view)
  viewRef.current = view
  const fittedRef = useRef(false)

  /* 容器实测尺寸（jsdom / 静态渲染下没有 ResizeObserver，保持默认尺寸）。 */
  useEffect(() => {
    const element = wrapRef.current
    if (!element || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect
      if (!rect || rect.width < 8 || rect.height < 8) return
      setSize({ width: Math.round(rect.width), height: Math.round(rect.height) })
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  /* 第一次拿到真实尺寸时按实际宽高比取景一次，之后不再打断读者的拖动 / 缩放。 */
  useEffect(() => {
    if (fittedRef.current) return
    if (size.width !== DEFAULT_WIDTH || size.height !== DEFAULT_HEIGHT) {
      fittedRef.current = true
      setView(fitView(spec, size.width, size.height))
    }
  }, [size, spec])

  const colors = dark
    ? {
        grid: 'rgba(255,255,255,0.09)',
        axis: 'rgba(226,232,240,0.88)',
        label: 'rgba(203,213,225,0.9)',
        halo: 'rgba(15,23,42,0.85)',
        chip: 'border-white/10 bg-ink-900/80 text-ink-200',
      }
    : {
        grid: 'rgba(15,23,42,0.08)',
        axis: 'rgba(30,41,59,0.85)',
        label: 'rgba(71,85,105,0.95)',
        halo: 'rgba(255,255,255,0.88)',
        chip: 'border-ink-200/70 bg-white/85 text-ink-600',
      }

  const { width: w, height: h } = size
  const toScreenX = (wx: number) => (wx - view.cx) * view.scale + w / 2
  const toScreenY = (wy: number) => h / 2 - (wy - view.cy) * view.scale

  /* 当前悬浮的点（端点 / 顶点 / 声明点 / 交点），未悬浮时不显示任何坐标。 */
  const [hovered, setHovered] = useState<HoverTarget | null>(null)

  const zoomAt = (px: number, py: number, factor: number) => {
    setView((current) => {
      const scale = clamp(current.scale * factor, MIN_SCALE, MAX_SCALE)
      const worldX = current.cx + (px - w / 2) / current.scale
      const worldY = current.cy - (py - h / 2) / current.scale
      return {
        scale,
        cx: clamp(worldX - (px - w / 2) / scale, -CENTER_LIMIT, CENTER_LIMIT),
        cy: clamp(worldY + (py - h / 2) / scale, -CENTER_LIMIT, CENTER_LIMIT),
      }
    })
  }

  const zoomCenter = (factor: number) => zoomAt(w / 2, h / 2, factor)

  /* 非被动 wheel 监听：缩放时阻止页面滚动。 */
  useEffect(() => {
    const element = wrapRef.current
    if (!element) return
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      const rect = element.getBoundingClientRect()
      zoomAt(event.clientX - rect.left, event.clientY - rect.top, event.deltaY < 0 ? 1.18 : 1 / 1.18)
    }
    element.addEventListener('wheel', onWheel, { passive: false })
    return () => element.removeEventListener('wheel', onWheel)
    // zoomAt 内部用 setView 回调读取最新视角，绑定一次即可。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [w, h])

  /* 指针：单指拖动平移，双指捏合缩放并平移。 */
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const gesture = useRef<{ view: View; midX: number; midY: number; distance: number } | null>(null)

  const midpoint = () => {
    const points = [...pointers.current.values()]
    if (points.length < 2) return null
    return {
      x: (points[0].x + points[1].x) / 2,
      y: (points[0].y + points[1].y) / 2,
    }
  }

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    // 指针捕获让拖动移出元素后仍能收到 move / up；个别环境（如 jsdom）没有该 API，
    // 捕获失败时退化为普通指针事件，不影响元素范围内的拖动平移。
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      /* no pointer capture support */
    }
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    const mid = midpoint()
    gesture.current = mid
      ? { view: viewRef.current, midX: mid.x, midY: mid.y, distance: 0 }
      : { view: viewRef.current, midX: event.clientX, midY: event.clientY, distance: 0 }
  }

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(event.pointerId) || !gesture.current) return
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    const base = gesture.current
    if (pointers.current.size === 1) {
      const dx = event.clientX - base.midX
      const dy = event.clientY - base.midY
      setView({
        ...base.view,
        cx: clamp(base.view.cx - dx / base.view.scale, -CENTER_LIMIT, CENTER_LIMIT),
        cy: clamp(base.view.cy + dy / base.view.scale, -CENTER_LIMIT, CENTER_LIMIT),
      })
      return
    }
    const mid = midpoint()
    const points = [...pointers.current.values()]
    const distance = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y)
    if (!mid || distance < 1) return
    const rect = event.currentTarget.getBoundingClientRect()
    const px = mid.x - rect.left
    const py = mid.y - rect.top
    const factor = base.distance > 0 ? distance / base.distance : 1
    const nextScale = clamp(base.view.scale * factor, MIN_SCALE, MAX_SCALE)
    const worldX = base.view.cx + (px - w / 2) / base.view.scale
    const worldY = base.view.cy - (py - h / 2) / base.view.scale
    const nextView = {
      scale: nextScale,
      cx: clamp(worldX - (px - w / 2) / nextScale, -CENTER_LIMIT, CENTER_LIMIT),
      cy: clamp(worldY + (py - h / 2) / nextScale, -CENTER_LIMIT, CENTER_LIMIT),
    }
    setView(nextView)
    // 基准同步到最新视角与双指状态，下一个 move 事件按增量计算，捏合过程不会累计漂移。
    gesture.current = { view: nextView, midX: mid.x, midY: mid.y, distance }
  }

  const endPointer = (event: React.PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(event.pointerId)
    // 触屏没有 hover 态：抬手后收起坐标气泡，避免气泡一直挂在画布上。
    if (event.pointerType === 'touch') setHovered(null)
    if (pointers.current.size === 0) {
      gesture.current = null
    } else {
      const remaining = [...pointers.current.values()][0]
      gesture.current = { view: viewRef.current, midX: remaining.x, midY: remaining.y, distance: 0 }
    }
  }

  /* ------------------------------ 网格与坐标轴 ------------------------------ */
  const step = nicePlaneStep(72 / view.scale)
  const xMinWorld = view.cx - w / 2 / view.scale
  const xMaxWorld = view.cx + w / 2 / view.scale
  const yMinWorld = view.cy - h / 2 / view.scale
  const yMaxWorld = view.cy + h / 2 / view.scale
  const xTicks: number[] = []
  const yTicks: number[] = []
  for (let i = Math.ceil(xMinWorld / step); i <= Math.floor(xMaxWorld / step); i += 1) xTicks.push(i * step)
  for (let i = Math.ceil(yMinWorld / step); i <= Math.floor(yMaxWorld / step); i += 1) yTicks.push(i * step)

  const axisX = clamp(toScreenX(0), 24, w - 24)
  const axisY = clamp(toScreenY(0), 24, h - 24)

  const compiledFunctions = useMemo(
    () =>
      spec.functions
        .map((item) => ({ ...item, fn: compilePlaneExpression(item.expression) }))
        .filter((item) => item.fn !== null),
    [spec],
  )

  /* 交点只依赖当前可见区间；把区间按刻度取整，拖动过程中不会逐像素重算。 */
  const visibleRange = useMemo(() => {
    const gridStep = nicePlaneStep(72 / view.scale)
    return {
      xMin: Math.floor((view.cx - w / 2 / view.scale) / gridStep) * gridStep,
      xMax: Math.ceil((view.cx + w / 2 / view.scale) / gridStep) * gridStep,
      tolerance: 9 / view.scale,
      gridStep,
    }
  }, [view, w])

  const intersections = useMemo(() => {
    const found = findPlaneIntersections(
      {
        functions: compiledFunctions.map((item) => ({ fn: item.fn! })),
        polylines: spec.polylines.map((line) => line.points),
        xMin: visibleRange.xMin,
        xMax: visibleRange.xMax,
      },
      visibleRange.tolerance,
    )
    // 与已声明点 / 折线顶点重合的交点不重复画圆环（顶点本身已可悬浮）。
    const known: PlanePoint[] = [...spec.points, ...spec.polylines.flatMap((line) => line.points)]
    return found.filter(
      (point) => !known.some((other) => Math.hypot(other.x - point.x, other.y - point.y) <= visibleRange.tolerance),
    )
  }, [compiledFunctions, spec.points, spec.polylines, visibleRange])

  const isEmpty = spec.points.length === 0 && spec.polylines.length === 0 && spec.functions.length === 0
  const buttonClass =
    'flex h-7 w-7 items-center justify-center rounded-md text-ink-500 transition hover:text-brand-600 dark:text-ink-400 dark:hover:text-brand-300'

  return (
    <section
      className="not-prose my-6 overflow-hidden rounded-xl border border-ink-200 bg-ink-50/60 shadow-sm dark:border-white/10 dark:bg-white/[0.03]"
      data-source-line={sourceLine}
    >
      <div
        ref={wrapRef}
        className="relative h-[340px] w-full cursor-grab touch-none select-none sm:h-[400px] active:cursor-grabbing"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPointer}
        onPointerCancel={endPointer}
      >
        <svg
          viewBox={`0 0 ${w} ${h}`}
          className="h-full w-full"
          role="img"
          aria-label="可拖动、滚轮或双指缩放的平面直角坐标系，悬浮在点或交点上可查看坐标"
        >
          <defs>
            <clipPath id={`plane-clip-${clipId}`}>
              <rect x={0} y={0} width={w} height={h} />
            </clipPath>
            <marker
              id={`plane-arrow-${clipId}`}
              viewBox="0 0 10 10"
              refX={8.5}
              refY={5}
              markerWidth={7}
              markerHeight={7}
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill={colors.axis} />
            </marker>
          </defs>

          {/* 网格 */}
          <g stroke={colors.grid} strokeWidth={1}>
            {xTicks.map((value) => (
              <line key={`vx-${value}`} x1={toScreenX(value)} y1={0} x2={toScreenX(value)} y2={h} />
            ))}
            {yTicks.map((value) => (
              <line key={`hy-${value}`} x1={0} y1={toScreenY(value)} x2={w} y2={toScreenY(value)} />
            ))}
          </g>

          {/* 坐标轴：正方向带箭头，零轴在视口外时贴边绘制 */}
          <g stroke={colors.axis} strokeWidth={1.5} fill="none">
            <line x1={0} y1={axisY} x2={w - 4} y2={axisY} markerEnd={`url(#plane-arrow-${clipId})`} />
            <line x1={axisX} y1={h} x2={axisX} y2={4} markerEnd={`url(#plane-arrow-${clipId})`} />
          </g>

          {/* 刻度数字 */}
          <g fontSize={11} fill={colors.label} style={{ paintOrder: 'stroke' }} stroke={colors.halo} strokeWidth={3}>
            {xTicks
              .filter((value) => value !== 0)
              .map((value) => (
                <text key={`xl-${value}`} x={toScreenX(value)} y={axisY + 16} textAnchor="middle">
                  {formatPlaneNumber(value)}
                </text>
              ))}
            {yTicks
              .filter((value) => value !== 0)
              .map((value) => (
                <text key={`yl-${value}`} x={axisX - 7} y={toScreenY(value) + 4} textAnchor="end">
                  {formatPlaneNumber(value)}
                </text>
              ))}
            <text x={axisX - 7} y={axisY + 16} textAnchor="end">
              0
            </text>
            <text x={w - 14} y={axisY - 8} textAnchor="end" fontWeight={600}>
              x
            </text>
            <text x={axisX + 10} y={16} fontWeight={600}>
              y
            </text>
          </g>

          <g clipPath={`url(#plane-clip-${clipId})`}>
            {/* 折线：连线之外，每个顶点都是可悬浮色点（端点略大），坐标仅在悬浮时显示 */}
            {spec.polylines.map((line, index) => (
              <g key={`line-${index}`}>
                <polyline
                  points={line.points.map((p) => `${toScreenX(p.x)},${toScreenY(p.y)}`).join(' ')}
                  fill="none"
                  stroke={line.color}
                  strokeWidth={2.25}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
                {line.points.map((p, pointIndex) => {
                  const isEndpoint = pointIndex === 0 || pointIndex === line.points.length - 1
                  const id = `line-${index}-pt-${pointIndex}`
                  return (
                    <InteractiveDot
                      key={id}
                      id={id}
                      sx={toScreenX(p.x)}
                      sy={toScreenY(p.y)}
                      r={isEndpoint ? 4.5 : 3}
                      fill={line.color}
                      halo={colors.halo}
                      point={p}
                      active={hovered?.id === id}
                      onHover={setHovered}
                      onLeave={() => setHovered(null)}
                    />
                  )
                })}
              </g>
            ))}

            {/* 函数图像：按可见区间采样，间断点自动断线 */}
            {compiledFunctions.map((item, index) => (
              <path
                key={`fn-${index}`}
                d={sampleFunctionPath(item.fn!, view, w, h)}
                fill="none"
                stroke={item.color}
                strokeWidth={2.25}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            ))}

            {/* 交点：描边圆环，悬浮显示坐标 */}
            {intersections.map((p, index) => {
              const id = `intersection-${index}`
              return (
                <InteractiveDot
                  key={id}
                  id={id}
                  sx={toScreenX(p.x)}
                  sy={toScreenY(p.y)}
                  r={3.5}
                  fill={colors.axis}
                  halo={colors.halo}
                  point={p}
                  ring
                  active={hovered?.id === id}
                  onHover={setHovered}
                  onLeave={() => setHovered(null)}
                />
              )
            })}

            {/* create_point 声明的点：更大的色点，未悬浮时不显示坐标 */}
            {spec.points.map((point, index) => {
              const id = `point-${index}`
              return (
                <InteractiveDot
                  key={id}
                  id={id}
                  sx={toScreenX(point.x)}
                  sy={toScreenY(point.y)}
                  r={5}
                  fill={point.color}
                  halo={colors.halo}
                  point={{ x: point.x, y: point.y }}
                  active={hovered?.id === id}
                  onHover={setHovered}
                  onLeave={() => setHovered(null)}
                />
              )
            })}
          </g>
        </svg>

        {/* 函数表达式：左上角小标签，替代占整行的图例 */}
        {compiledFunctions.length > 0 && (
          <div className="pointer-events-none absolute left-3 top-3 flex flex-col gap-1">
            {compiledFunctions.map((item, index) => (
              <span
                key={`fn-label-${index}`}
                className={`inline-flex w-fit items-center gap-1.5 rounded-md border px-2 py-0.5 font-mono text-[11px] shadow-sm backdrop-blur-sm ${colors.chip}`}
              >
                <span className="h-0.5 w-3 rounded-full" style={{ backgroundColor: item.color }} />
                y = {item.expression}
              </span>
            ))}
          </div>
        )}

        {/* 浮动工具条：缩小 / 复位 / 放大 */}
        <div
          className={`absolute right-3 top-3 flex items-center gap-0.5 rounded-lg border p-0.5 shadow-sm backdrop-blur-md ${colors.chip}`}
        >
          <button type="button" aria-label="缩小" className={buttonClass} onClick={() => zoomCenter(1 / 1.25)}>
            <Minus size={14} />
          </button>
          <button
            type="button"
            aria-label="复位视角"
            className={buttonClass}
            onClick={() => setView(fitView(spec, w, h))}
            title="复位视角"
          >
            <RotateCcw size={13} />
          </button>
          <button type="button" aria-label="放大" className={buttonClass} onClick={() => zoomCenter(1.25)}>
            <Plus size={14} />
          </button>
        </div>

        {isEmpty && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-6 text-center text-xs text-ink-400 dark:text-ink-500">
            用 create_point / create_line 声明点、折线或关于 x 的函数图像
          </div>
        )}

        {/* 悬浮坐标气泡：只在指针进入某个点 / 端点 / 交点时出现 */}
        {hovered && (
          <div
            className="plane-tooltip pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-md border border-ink-200/70 bg-white/92 px-2 py-1 font-mono text-[11px] font-semibold text-ink-700 shadow-md backdrop-blur-sm dark:border-white/12 dark:bg-ink-900/90 dark:text-ink-100"
            style={{
              left: clamp(toScreenX(hovered.point.x), 48, w - 48),
              top: clamp(toScreenY(hovered.point.y) - 14, 26, h - 8),
            }}
          >
            {hovered.text}
          </div>
        )}

        {/* 语法错误：浮在左下角的小警示条，不挤占正文版面 */}
        {spec.errors.length > 0 && (
          <div className="absolute bottom-3 left-3 max-w-[85%] space-y-1 rounded-lg border border-amber-300/60 bg-amber-50/90 px-3 py-2 text-[11px] leading-5 text-amber-700 shadow-sm backdrop-blur-sm dark:border-amber-400/20 dark:bg-amber-400/15 dark:text-amber-300">
            {spec.errors.map((error, index) => (
              <div key={index} className="flex items-start gap-1.5">
                <AlertTriangle size={13} className="mt-1 shrink-0" />
                <span>
                  第 {error.statement} 条语句：{error.message}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}
