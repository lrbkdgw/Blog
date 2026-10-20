import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Axis3d, RotateCcw, ZoomIn, ZoomOut } from 'lucide-react'
import {
  UI_CCS_VIEW_HEIGHT,
  UI_CCS_VIEW_WIDTH,
  buildFunctionSvgPath,
  buildPolylineSvgPath,
  chooseGridStep,
  clampUnitsPerPx,
  computeInitialUiCcsViewport,
  formatAxisTick,
  formatCoordinateValue,
  parseUiCcs,
  resolveCcsItemColor,
  type UiCcsItem,
  type UiCcsViewport,
} from '../lib/uiCcs'

function describeItem(item: UiCcsItem): string {
  if (item.label) return item.label
  if (item.kind === 'point') {
    return `(${formatCoordinateValue(item.x)}, ${formatCoordinateValue(item.y)})`
  }
  if (item.kind === 'polyline') {
    const preview = item.points
      .slice(0, 3)
      .map((p) => `(${formatCoordinateValue(p.x)},${formatCoordinateValue(p.y)})`)
      .join(' → ')
    return item.points.length > 3 ? `${preview} → …` : preview
  }
  return `y = ${item.expression}`
}

export function CoordinatePlane({
  title,
  body,
  sourceLine,
}: {
  title?: string
  body: string
  /** 原始 Markdown 行号（双栏编辑器滚动同步锚点用）。 */
  sourceLine?: number
}) {
  const parsed = useMemo(() => parseUiCcs(body), [body])
  const initialViewport = useMemo(
    () => computeInitialUiCcsViewport(parsed.items, UI_CCS_VIEW_WIDTH, UI_CCS_VIEW_HEIGHT),
    [parsed.items],
  )

  const [viewport, setViewport] = useState<UiCcsViewport>(initialViewport)
  const [userAdjusted, setUserAdjusted] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [hoverWorld, setHoverWorld] = useState<{ x: number; y: number } | null>(null)

  const svgRef = useRef<SVGSVGElement>(null)
  const pointersRef = useRef(new Map<number, { clientX: number; clientY: number }>())
  const pinchDistanceRef = useRef<number | null>(null)

  useEffect(() => {
    if (!userAdjusted) {
      setViewport(initialViewport)
    }
  }, [initialViewport, userAdjusted])

  const resetView = useCallback(() => {
    setUserAdjusted(false)
    setViewport(initialViewport)
  }, [initialViewport])

  const clientToSvg = useCallback((clientX: number, clientY: number) => {
    const svg = svgRef.current
    const rect = svg?.getBoundingClientRect()
    const renderW = rect && rect.width > 0 ? rect.width : UI_CCS_VIEW_WIDTH
    const renderH = rect && rect.height > 0 ? rect.height : UI_CCS_VIEW_HEIGHT
    const left = rect ? rect.left : 0
    const top = rect ? rect.top : 0
    return {
      sx: ((clientX - left) / renderW) * UI_CCS_VIEW_WIDTH,
      sy: ((clientY - top) / renderH) * UI_CCS_VIEW_HEIGHT,
      scaleX: UI_CCS_VIEW_WIDTH / renderW,
      scaleY: UI_CCS_VIEW_HEIGHT / renderH,
    }
  }, [])

  const zoomAround = useCallback((factor: number, sx = UI_CCS_VIEW_WIDTH / 2, sy = UI_CCS_VIEW_HEIGHT / 2) => {
    setUserAdjusted(true)
    setViewport((prev) => {
      const nextUnits = clampUnitsPerPx(prev.unitsPerPx * factor)
      const anchorWorldX = prev.centerX + (sx - UI_CCS_VIEW_WIDTH / 2) * prev.unitsPerPx
      const anchorWorldY = prev.centerY - (sy - UI_CCS_VIEW_HEIGHT / 2) * prev.unitsPerPx
      return {
        centerX: anchorWorldX - (sx - UI_CCS_VIEW_WIDTH / 2) * nextUnits,
        centerY: anchorWorldY + (sy - UI_CCS_VIEW_HEIGHT / 2) * nextUnits,
        unitsPerPx: nextUnits,
      }
    })
  }, [])

  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      const { sx, sy } = clientToSvg(event.clientX, event.clientY)
      const rawDelta =
        event.deltaMode === 1 ? event.deltaY * 24 : event.deltaMode === 2 ? event.deltaY * 120 : event.deltaY
      const clampedDelta = Math.max(-240, Math.min(240, rawDelta))
      const factor = Math.exp(clampedDelta * 0.0018)
      zoomAround(factor, sx, sy)
    }
    svg.addEventListener('wheel', onWheel, { passive: false })
    return () => svg.removeEventListener('wheel', onWheel)
  }, [clientToSvg, zoomAround])

  const onPointerDown = (event: React.PointerEvent<SVGSVGElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    event.currentTarget.setPointerCapture?.(event.pointerId)
    pointersRef.current.set(event.pointerId, { clientX: event.clientX, clientY: event.clientY })
    if (pointersRef.current.size === 2) {
      const [p1, p2] = [...pointersRef.current.values()]
      pinchDistanceRef.current = Math.hypot(p2.clientX - p1.clientX, p2.clientY - p1.clientY)
    } else {
      pinchDistanceRef.current = null
    }
    setDragging(true)
  }

  const onPointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
    const mapped = clientToSvg(event.clientX, event.clientY)
    setHoverWorld({
      x: viewport.centerX + (mapped.sx - UI_CCS_VIEW_WIDTH / 2) * viewport.unitsPerPx,
      y: viewport.centerY - (mapped.sy - UI_CCS_VIEW_HEIGHT / 2) * viewport.unitsPerPx,
    })

    const prevPoint = pointersRef.current.get(event.pointerId)
    if (!prevPoint) return

    if (pointersRef.current.size === 2) {
      pointersRef.current.set(event.pointerId, { clientX: event.clientX, clientY: event.clientY })
      const [p1, p2] = [...pointersRef.current.values()]
      const dist = Math.hypot(p2.clientX - p1.clientX, p2.clientY - p1.clientY)
      const prevDist = pinchDistanceRef.current
      if (prevDist && prevDist > 4 && dist > 4) {
        const mid = clientToSvg((p1.clientX + p2.clientX) / 2, (p1.clientY + p2.clientY) / 2)
        zoomAround(prevDist / dist, mid.sx, mid.sy)
      }
      pinchDistanceRef.current = dist
      return
    }

    const dxPx = (event.clientX - prevPoint.clientX) * mapped.scaleX
    const dyPx = (event.clientY - prevPoint.clientY) * mapped.scaleY
    pointersRef.current.set(event.pointerId, { clientX: event.clientX, clientY: event.clientY })
    if (dxPx === 0 && dyPx === 0) return

    setUserAdjusted(true)
    setViewport((prev) => ({
      ...prev,
      centerX: prev.centerX - dxPx * prev.unitsPerPx,
      centerY: prev.centerY + dyPx * prev.unitsPerPx,
    }))
  }

  const releasePointer = (event: React.PointerEvent<SVGSVGElement>) => {
    pointersRef.current.delete(event.pointerId)
    pinchDistanceRef.current = null
    if (pointersRef.current.size === 0) setDragging(false)
  }

  const onKeyDown = (event: React.KeyboardEvent<SVGSVGElement>) => {
    const panStep = viewport.unitsPerPx * 48
    if (event.key === '+' || event.key === '=') {
      event.preventDefault()
      zoomAround(0.8)
    } else if (event.key === '-' || event.key === '_') {
      event.preventDefault()
      zoomAround(1.25)
    } else if (event.key === '0') {
      event.preventDefault()
      resetView()
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault()
      setUserAdjusted(true)
      setViewport((prev) => ({ ...prev, centerX: prev.centerX - panStep }))
    } else if (event.key === 'ArrowRight') {
      event.preventDefault()
      setUserAdjusted(true)
      setViewport((prev) => ({ ...prev, centerX: prev.centerX + panStep }))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setUserAdjusted(true)
      setViewport((prev) => ({ ...prev, centerY: prev.centerY + panStep }))
    } else if (event.key === 'ArrowDown') {
      event.preventDefault()
      setUserAdjusted(true)
      setViewport((prev) => ({ ...prev, centerY: prev.centerY - panStep }))
    }
  }

  const halfW = (UI_CCS_VIEW_WIDTH / 2) * viewport.unitsPerPx
  const halfH = (UI_CCS_VIEW_HEIGHT / 2) * viewport.unitsPerPx
  const minX = viewport.centerX - halfW
  const maxX = viewport.centerX + halfW
  const minY = viewport.centerY - halfH
  const maxY = viewport.centerY + halfH
  const { major, minor } = chooseGridStep(viewport.unitsPerPx)

  const toSX = (wx: number) => UI_CCS_VIEW_WIDTH / 2 + (wx - viewport.centerX) / viewport.unitsPerPx
  const toSY = (wy: number) => UI_CCS_VIEW_HEIGHT / 2 - (wy - viewport.centerY) / viewport.unitsPerPx

  const minorPath = useMemo(() => {
    const parts: string[] = []
    const startX = Math.ceil(minX / minor) * minor
    for (let x = startX, guard = 0; x <= maxX && guard < 400; x += minor, guard += 1) {
      parts.push(`M${toSX(x).toFixed(2)} 0V${UI_CCS_VIEW_HEIGHT}`)
    }
    const startY = Math.ceil(minY / minor) * minor
    for (let y = startY, guard = 0; y <= maxY && guard < 400; y += minor, guard += 1) {
      parts.push(`M0 ${toSY(y).toFixed(2)}H${UI_CCS_VIEW_WIDTH}`)
    }
    return parts.join('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [minX, maxX, minY, maxY, minor])

  const { majorPath, xTicks, yTicks } = useMemo(() => {
    const parts: string[] = []
    const xs: Array<{ sx: number; text: string }> = []
    const ys: Array<{ sy: number; text: string }> = []

    const startX = Math.ceil(minX / major) * major
    for (let x = startX, guard = 0; x <= maxX && guard < 120; x += major, guard += 1) {
      const sx = toSX(x)
      parts.push(`M${sx.toFixed(2)} 0V${UI_CCS_VIEW_HEIGHT}`)
      if (Math.abs(x) >= major * 1e-4 && sx > 26 && sx < UI_CCS_VIEW_WIDTH - 26) {
        xs.push({ sx, text: formatAxisTick(x, major) })
      }
    }

    const startY = Math.ceil(minY / major) * major
    for (let y = startY, guard = 0; y <= maxY && guard < 120; y += major, guard += 1) {
      const sy = toSY(y)
      parts.push(`M0 ${sy.toFixed(2)}H${UI_CCS_VIEW_WIDTH}`)
      if (Math.abs(y) >= major * 1e-4 && sy > 18 && sy < UI_CCS_VIEW_HEIGHT - 18) {
        ys.push({ sy, text: formatAxisTick(y, major) })
      }
    }

    return { majorPath: parts.join(''), xTicks: xs, yTicks: ys }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [minX, maxX, minY, maxY, major])

  const originSX = toSX(0)
  const originSY = toSY(0)
  const xAxisVisible = originSY >= 0 && originSY <= UI_CCS_VIEW_HEIGHT
  const yAxisVisible = originSX >= 0 && originSX <= UI_CCS_VIEW_WIDTH
  // 坐标轴移出画面时，刻度贴靠视口边缘，保证平移到任意远处仍能读出坐标值。
  const xLabelBaselineY = Math.min(UI_CCS_VIEW_HEIGHT - 8, Math.max(16, originSY + 15))
  const yLabelAnchorX = Math.min(UI_CCS_VIEW_WIDTH - 10, Math.max(38, originSX - 7))

  const renderedShapes = useMemo(
    () =>
      parsed.items.map((item, idx) => {
        const color = resolveCcsItemColor(item, idx)
        if (item.kind === 'point') {
          return {
            key: `pt-${idx}`,
            kind: 'point' as const,
            sx: toSX(item.x),
            sy: toSY(item.y),
            x: item.x,
            y: item.y,
            color,
            label: item.label,
          }
        }
        const path =
          item.kind === 'polyline'
            ? buildPolylineSvgPath(item.points, viewport, UI_CCS_VIEW_WIDTH, UI_CCS_VIEW_HEIGHT)
            : buildFunctionSvgPath(item.evaluate, viewport, UI_CCS_VIEW_WIDTH, UI_CCS_VIEW_HEIGHT)
        return {
          key: `ln-${idx}`,
          kind: item.kind,
          path,
          points: item.kind === 'polyline' ? item.points : undefined,
          color,
        }
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [parsed.items, viewport],
  )

  return (
    <section
      className="ui-ccs-box not-prose my-6 overflow-hidden rounded-xl border border-ink-200 bg-ink-50/70 shadow-sm dark:border-white/10 dark:bg-white/[0.035]"
      data-source-line={sourceLine}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-200/80 bg-white/75 px-4 py-2 font-sans text-xs text-ink-700 dark:border-white/10 dark:bg-white/[0.035] dark:text-ink-200">
        <div className="flex items-center gap-2 font-semibold">
          <Axis3d size={14} className="text-brand-500" />
          <span>{title || '直角坐标系'}</span>
          <span className="hidden font-normal text-ink-400 sm:inline">拖拽平移 · 滚轮缩放</span>
        </div>

        <div className="flex items-center gap-1.5">
          <span className="mr-1 font-mono text-[11px] text-ink-500 dark:text-ink-400" data-ccs-readout>
            {hoverWorld
              ? `(${formatCoordinateValue(hoverWorld.x)}, ${formatCoordinateValue(hoverWorld.y)})`
              : `步长 ${formatAxisTick(major, major)}`}
          </span>
          <button
            type="button"
            onClick={() => zoomAround(0.75)}
            aria-label="放大坐标系"
            title="放大"
            className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-ink-200/80 bg-white/80 text-ink-600 transition hover:border-brand-400 hover:text-brand-600 dark:border-white/10 dark:bg-white/5 dark:text-ink-300 dark:hover:text-brand-300"
          >
            <ZoomIn size={13} />
          </button>
          <button
            type="button"
            onClick={() => zoomAround(1 / 0.75)}
            aria-label="缩小坐标系"
            title="缩小"
            className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-ink-200/80 bg-white/80 text-ink-600 transition hover:border-brand-400 hover:text-brand-600 dark:border-white/10 dark:bg-white/5 dark:text-ink-300 dark:hover:text-brand-300"
          >
            <ZoomOut size={13} />
          </button>
          <button
            type="button"
            onClick={resetView}
            aria-label="重置坐标系视角"
            title="回到初始视野"
            className="inline-flex h-6 items-center gap-1 rounded-md border border-ink-200/80 bg-white/80 px-2 text-[11px] text-ink-600 transition hover:border-brand-400 hover:text-brand-600 dark:border-white/10 dark:bg-white/5 dark:text-ink-300 dark:hover:text-brand-300"
          >
            <RotateCcw size={12} />
            <span className="hidden sm:inline">重置</span>
          </button>
        </div>
      </div>

      <div className="relative bg-white/90 dark:bg-ink-950/65">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${UI_CCS_VIEW_WIDTH} ${UI_CCS_VIEW_HEIGHT}`}
          role="application"
          tabIndex={0}
          aria-label={title || '可交互直角坐标系'}
          data-center-x={viewport.centerX.toFixed(4)}
          data-center-y={viewport.centerY.toFixed(4)}
          data-units-per-px={viewport.unitsPerPx.toExponential(4)}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={releasePointer}
          onPointerCancel={releasePointer}
          onPointerLeave={() => {
            if (!dragging) setHoverWorld(null)
          }}
          onKeyDown={onKeyDown}
          className={`block h-auto w-full select-none touch-none outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 ${
            dragging ? 'cursor-grabbing' : 'cursor-grab'
          }`}
        >
          {/* 细分副网格与主网格 */}
          <path d={minorPath} className="stroke-ink-900/[0.045] dark:stroke-white/[0.05]" strokeWidth={1} fill="none" />
          <path d={majorPath} className="stroke-ink-900/[0.11] dark:stroke-white/[0.12]" strokeWidth={1} fill="none" />

          {/* X / Y 主坐标轴与正方向箭头 */}
          {xAxisVisible && (
            <g className="text-ink-500 dark:text-ink-400">
              <line
                x1={0}
                y1={originSY}
                x2={UI_CCS_VIEW_WIDTH}
                y2={originSY}
                stroke="currentColor"
                strokeWidth={1.5}
              />
              <path
                d={`M${UI_CCS_VIEW_WIDTH - 9} ${(originSY - 4).toFixed(2)}L${UI_CCS_VIEW_WIDTH - 2} ${originSY.toFixed(2)}L${UI_CCS_VIEW_WIDTH - 9} ${(originSY + 4).toFixed(2)}`}
                fill="none"
                stroke="currentColor"
                strokeWidth={1.5}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <text
                x={UI_CCS_VIEW_WIDTH - 14}
                y={Math.max(14, originSY - 8)}
                textAnchor="end"
                className="fill-ink-600 font-serif text-[12px] italic dark:fill-ink-300"
              >
                x
              </text>
            </g>
          )}

          {yAxisVisible && (
            <g className="text-ink-500 dark:text-ink-400">
              <line
                x1={originSX}
                y1={UI_CCS_VIEW_HEIGHT}
                x2={originSX}
                y2={0}
                stroke="currentColor"
                strokeWidth={1.5}
              />
              <path
                d={`M${(originSX - 4).toFixed(2)} 9L${originSX.toFixed(2)} 2L${(originSX + 4).toFixed(2)} 9`}
                fill="none"
                stroke="currentColor"
                strokeWidth={1.5}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <text
                x={Math.min(UI_CCS_VIEW_WIDTH - 16, originSX + 9)}
                y={15}
                textAnchor="start"
                className="fill-ink-600 font-serif text-[12px] italic dark:fill-ink-300"
              >
                y
              </text>
            </g>
          )}

          {/* 刻度文字与原点标记 */}
          <g className="pointer-events-none font-mono text-[10px] fill-ink-500 dark:fill-ink-400">
            {xTicks.map((tick) => (
              <text key={`tx-${tick.text}-${tick.sx.toFixed(1)}`} x={tick.sx} y={xLabelBaselineY} textAnchor="middle">
                {tick.text}
              </text>
            ))}
            {yTicks.map((tick) => (
              <text key={`ty-${tick.text}-${tick.sy.toFixed(1)}`} x={yLabelAnchorX} y={tick.sy + 3.5} textAnchor="end">
                {tick.text}
              </text>
            ))}
            {xAxisVisible && yAxisVisible && originSX > 18 && originSX < UI_CCS_VIEW_WIDTH - 18 && (
              <text x={originSX - 7} y={Math.min(UI_CCS_VIEW_HEIGHT - 6, originSY + 14)} textAnchor="end">
                0
              </text>
            )}
          </g>

          {/* 图形元素层：折线、函数曲线与坐标点 */}
          <g data-ccs-shapes>
            {renderedShapes.map((shape) => {
              if (shape.kind === 'point') {
                if (
                  shape.sx < -24 ||
                  shape.sx > UI_CCS_VIEW_WIDTH + 24 ||
                  shape.sy < -24 ||
                  shape.sy > UI_CCS_VIEW_HEIGHT + 24
                ) {
                  return null
                }
                return (
                  <g key={shape.key} data-ccs-kind="point">
                    <circle
                      cx={shape.sx}
                      cy={shape.sy}
                      r={4.5}
                      fill={shape.color}
                      className="stroke-white dark:stroke-ink-950"
                      strokeWidth={1.6}
                    />
                    <text
                      x={shape.sx + 7}
                      y={shape.sy - 7}
                      className="pointer-events-none fill-ink-700 font-mono text-[10.5px] dark:fill-ink-200"
                    >
                      {shape.label || `(${formatCoordinateValue(shape.x)}, ${formatCoordinateValue(shape.y)})`}
                    </text>
                  </g>
                )
              }

              return (
                <g key={shape.key} data-ccs-kind={shape.kind}>
                  {shape.path && (
                    <path
                      d={shape.path}
                      fill="none"
                      stroke={shape.color}
                      strokeWidth={2.25}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  )}
                  {shape.points?.map((vertex, vIdx) => {
                    const vx = toSX(vertex.x)
                    const vy = toSY(vertex.y)
                    if (vx < -12 || vx > UI_CCS_VIEW_WIDTH + 12 || vy < -12 || vy > UI_CCS_VIEW_HEIGHT + 12) {
                      return null
                    }
                    return (
                      <circle
                        key={`${shape.key}-v-${vIdx}`}
                        cx={vx}
                        cy={vy}
                        r={3}
                        fill={shape.color}
                        className="stroke-white dark:stroke-ink-950"
                        strokeWidth={1.2}
                      />
                    )
                  })}
                </g>
              )
            })}
          </g>

          {/* 指针十字准星 */}
          {hoverWorld && !dragging && (
            <g className="pointer-events-none stroke-ink-500/35 dark:stroke-white/25" strokeDasharray="3 3" strokeWidth={1}>
              <line x1={toSX(hoverWorld.x)} y1={0} x2={toSX(hoverWorld.x)} y2={UI_CCS_VIEW_HEIGHT} />
              <line x1={0} y1={toSY(hoverWorld.y)} x2={UI_CCS_VIEW_WIDTH} y2={toSY(hoverWorld.y)} />
            </g>
          )}
        </svg>
      </div>

      {parsed.items.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-ink-200/80 bg-white/55 px-4 py-2 font-mono text-[11px] text-ink-600 dark:border-white/10 dark:bg-black/15 dark:text-ink-300">
          {parsed.items.map((item, idx) => (
            <span key={`legend-${idx}`} className="inline-flex items-center gap-1.5">
              <span
                className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: resolveCcsItemColor(item, idx) }}
              />
              <span>{describeItem(item)}</span>
            </span>
          ))}
        </div>
      )}

      {parsed.errors.length > 0 && (
        <div className="border-t border-rose-200/70 bg-rose-50/70 px-4 py-2 font-mono text-[11px] text-rose-700 dark:border-rose-400/20 dark:bg-rose-500/10 dark:text-rose-200">
          {parsed.errors.map((err, idx) => (
            <p key={`err-${idx}`}>{err}</p>
          ))}
        </div>
      )}
    </section>
  )
}
