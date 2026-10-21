import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { Check, Move, RotateCcw } from 'lucide-react'
import {
  chooseGridStep,
  clampUnitsPerPx,
  formatAxisTick,
  formatCoordinateValue,
  UI_CCS_VIEW_HEIGHT,
  UI_CCS_VIEW_WIDTH,
  type UiCcsViewport,
} from '../lib/uiCcs'
import {
  computeGraphEdgeGeometries,
  computeInitialUiGraphViewport,
  findNearestUiGraphNode,
  parseUiGraph,
  UI_GRAPH_NODE_RADIUS_PX,
  type UiGraphHoverNode,
} from '../lib/uiGraph'

interface GraphPlaneProps {
  header: string
  source: string
  sourceLine?: number
  /** 文章编辑模式下传入：开启「调整模式」并允许可视化拖拽保存节点坐标至 Markdown 源码。 */
  onCommitPositions?: (positions: Record<string, { x: number; y: number }> | null) => void
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}

function fmtSvg(n: number): string {
  return String(Number(n.toFixed(2)))
}

export function GraphPlane({ header, source, sourceLine, onCommitPositions }: GraphPlaneProps) {
  const clipId = `ui-graph-clip-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
  const svgRef = useRef<SVGSVGElement>(null)

  const parsed = useMemo(() => parseUiGraph(header, source), [header, source])

  // 本地实时节点坐标（支持 60fps 丝滑拖拽并在松手/点击保存时写回源码）
  const [localPositions, setLocalPositions] = useState<Record<string, { x: number; y: number }>>(() => {
    const map: Record<string, { x: number; y: number }> = {}
    for (const n of parsed.nodes) map[n.id] = { x: n.x, y: n.y }
    return map
  })
  const [adjustMode, setAdjustMode] = useState(false)
  const [justSaved, setJustSaved] = useState(false)

  useEffect(() => {
    const map: Record<string, { x: number; y: number }> = {}
    for (const n of parsed.nodes) {
      map[n.id] = { x: n.x, y: n.y }
    }
    setLocalPositions(map)
  }, [parsed])

  const liveNodes = useMemo(
    () =>
      parsed.nodes.map((n) => ({
        ...n,
        x: localPositions[n.id]?.x ?? n.x,
        y: localPositions[n.id]?.y ?? n.y,
      })),
    [parsed.nodes, localPositions],
  )

  const initialViewport = useMemo(() => computeInitialUiGraphViewport(parsed.nodes), [parsed.nodes])
  const [viewport, setViewport] = useState<UiCcsViewport>(initialViewport)
  const [hover, setHover] = useState<UiGraphHoverNode | null>(null)
  const [isPanning, setIsPanning] = useState(false)
  const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null)

  useEffect(() => {
    setViewport(initialViewport)
  }, [initialViewport])

  const pointersRef = useRef<Map<number, { clientX: number; clientY: number }>>(new Map())
  const lastDragRef = useRef<{
    mode: 'single' | 'pinch' | 'node'
    nodeId?: string
    clientX: number
    clientY: number
    pinchDist: number
  } | null>(null)
  const latestPositionsRef = useRef(localPositions)
  latestPositionsRef.current = localPositions

  const clientToSvgPoint = useCallback((clientX: number, clientY: number) => {
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

  const zoomAround = useCallback((factor: number, svgX: number, svgY: number) => {
    setViewport((prev) => {
      const nextUnits = clampUnitsPerPx(prev.unitsPerPx * factor)
      const anchorWorldX = prev.centerX + (svgX - UI_CCS_VIEW_WIDTH / 2) * prev.unitsPerPx
      const anchorWorldY = prev.centerY - (svgY - UI_CCS_VIEW_HEIGHT / 2) * prev.unitsPerPx
      return {
        centerX: anchorWorldX - (svgX - UI_CCS_VIEW_WIDTH / 2) * nextUnits,
        centerY: anchorWorldY + (svgY - UI_CCS_VIEW_HEIGHT / 2) * nextUnits,
        unitsPerPx: nextUnits,
      }
    })
  }, [])

  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      const pt = clientToSvgPoint(event.clientX, event.clientY)
      const delta = clamp(event.deltaY, -160, 160)
      zoomAround(Math.exp(delta * 0.0016), pt.sx, pt.sy)
    }
    svg.addEventListener('wheel', onWheel, { passive: false })
    return () => svg.removeEventListener('wheel', onWheel)
  }, [clientToSvgPoint, zoomAround])

  const commitPositionsToSource = useCallback(
    (map: Record<string, { x: number; y: number }> | null) => {
      if (!onCommitPositions) return
      onCommitPositions(map)
      setJustSaved(true)
      window.setTimeout(() => setJustSaved(false), 1400)
    },
    [onCommitPositions],
  )

  const handlePointerDown = (event: React.PointerEvent<SVGSVGElement>) => {
    if (event.button !== 0 && event.pointerType === 'mouse') return
    event.currentTarget.setPointerCapture?.(event.pointerId)
    pointersRef.current.set(event.pointerId, { clientX: event.clientX, clientY: event.clientY })

    const pts = [...pointersRef.current.values()]
    if (pts.length === 1) {
      const svgPt = clientToSvgPoint(pts[0].clientX, pts[0].clientY)
      if (adjustMode) {
        const hitNode = findNearestUiGraphNode(
          liveNodes,
          viewport,
          svgPt.sx,
          svgPt.sy,
          UI_GRAPH_NODE_RADIUS_PX + 6,
        )
        if (hitNode) {
          lastDragRef.current = {
            mode: 'node',
            nodeId: hitNode.id,
            clientX: pts[0].clientX,
            clientY: pts[0].clientY,
            pinchDist: 0,
          }
          setDraggingNodeId(hitNode.id)
          setHover(hitNode)
          return
        }
      }
      lastDragRef.current = {
        mode: 'single',
        clientX: pts[0].clientX,
        clientY: pts[0].clientY,
        pinchDist: 0,
      }
      setIsPanning(true)
    } else if (pts.length >= 2) {
      const midX = (pts[0].clientX + pts[1].clientX) * 0.5
      const midY = (pts[0].clientY + pts[1].clientY) * 0.5
      const dist = Math.hypot(pts[1].clientX - pts[0].clientX, pts[1].clientY - pts[0].clientY)
      lastDragRef.current = { mode: 'pinch', clientX: midX, clientY: midY, pinchDist: Math.max(dist, 1) }
      setIsPanning(true)
    }
  }

  const handlePointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
    const svgPt = clientToSvgPoint(event.clientX, event.clientY)
    if (pointersRef.current.has(event.pointerId)) {
      pointersRef.current.set(event.pointerId, { clientX: event.clientX, clientY: event.clientY })
      const pts = [...pointersRef.current.values()]
      const prev = lastDragRef.current

      if (pts.length === 1 && prev?.mode === 'node' && prev.nodeId) {
        const worldX = viewport.centerX + (svgPt.sx - UI_CCS_VIEW_WIDTH / 2) * viewport.unitsPerPx
        const worldY = viewport.centerY - (svgPt.sy - UI_CCS_VIEW_HEIGHT / 2) * viewport.unitsPerPx
        const rx = Number(worldX.toFixed(2))
        const ry = Number(worldY.toFixed(2))
        const nodeId = prev.nodeId
        setLocalPositions((curr) => {
          const next = { ...curr, [nodeId]: { x: rx, y: ry } }
          latestPositionsRef.current = next
          return next
        })
        setHover({
          id: nodeId,
          x: rx,
          y: ry,
          sx: svgPt.sx,
          sy: svgPt.sy,
          distancePx: 0,
        })
        return
      }

      if (pts.length === 1 && prev?.mode === 'single') {
        const dxSvg = (pts[0].clientX - prev.clientX) * svgPt.scaleX
        const dySvg = (pts[0].clientY - prev.clientY) * svgPt.scaleY
        lastDragRef.current = { ...prev, clientX: pts[0].clientX, clientY: pts[0].clientY }
        setViewport((v) => ({
          ...v,
          centerX: v.centerX - dxSvg * v.unitsPerPx,
          centerY: v.centerY + dySvg * v.unitsPerPx,
        }))
        return
      }

      if (pts.length >= 2) {
        const midX = (pts[0].clientX + pts[1].clientX) * 0.5
        const midY = (pts[0].clientY + pts[1].clientY) * 0.5
        const dist = Math.max(
          Math.hypot(pts[1].clientX - pts[0].clientX, pts[1].clientY - pts[0].clientY),
          1,
        )
        const midSvg = clientToSvgPoint(midX, midY)
        if (prev?.mode === 'pinch') {
          const dxSvg = (midX - prev.clientX) * midSvg.scaleX
          const dySvg = (midY - prev.clientY) * midSvg.scaleY
          const scaleFactor = prev.pinchDist / dist
          setViewport((v) => {
            const nextUnits = clampUnitsPerPx(v.unitsPerPx * scaleFactor)
            const pannedCenterX = v.centerX - dxSvg * v.unitsPerPx
            const pannedCenterY = v.centerY + dySvg * v.unitsPerPx
            const anchorWorldX = pannedCenterX + (midSvg.sx - UI_CCS_VIEW_WIDTH / 2) * v.unitsPerPx
            const anchorWorldY = pannedCenterY - (midSvg.sy - UI_CCS_VIEW_HEIGHT / 2) * v.unitsPerPx
            return {
              centerX: anchorWorldX - (midSvg.sx - UI_CCS_VIEW_WIDTH / 2) * nextUnits,
              centerY: anchorWorldY + (midSvg.sy - UI_CCS_VIEW_HEIGHT / 2) * nextUnits,
              unitsPerPx: nextUnits,
            }
          })
        }
        lastDragRef.current = { mode: 'pinch', clientX: midX, clientY: midY, pinchDist: dist }
        return
      }
    }

    setHover(findNearestUiGraphNode(liveNodes, viewport, svgPt.sx, svgPt.sy))
  }

  const endPointer = (event: React.PointerEvent<SVGSVGElement>) => {
    const finishedNodeDrag = lastDragRef.current?.mode === 'node'
    pointersRef.current.delete(event.pointerId)
    if (finishedNodeDrag && adjustMode) {
      commitPositionsToSource(latestPositionsRef.current)
    }
    setDraggingNodeId(null)
    if (pointersRef.current.size === 0) {
      lastDragRef.current = null
      setIsPanning(false)
    }
  }

  const handleKeyDown = (event: React.KeyboardEvent<SVGSVGElement>) => {
    const panStep = viewport.unitsPerPx * 42
    if (event.key === '+' || event.key === '=') {
      event.preventDefault()
      zoomAround(0.8, UI_CCS_VIEW_WIDTH / 2, UI_CCS_VIEW_HEIGHT / 2)
    } else if (event.key === '-' || event.key === '_') {
      event.preventDefault()
      zoomAround(1.25, UI_CCS_VIEW_WIDTH / 2, UI_CCS_VIEW_HEIGHT / 2)
    } else if (event.key === '0') {
      event.preventDefault()
      setViewport(initialViewport)
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault()
      setViewport((v) => ({ ...v, centerX: v.centerX - panStep }))
    } else if (event.key === 'ArrowRight') {
      event.preventDefault()
      setViewport((v) => ({ ...v, centerX: v.centerX + panStep }))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setViewport((v) => ({ ...v, centerY: v.centerY + panStep }))
    } else if (event.key === 'ArrowDown') {
      event.preventDefault()
      setViewport((v) => ({ ...v, centerY: v.centerY - panStep }))
    }
  }

  // 与 CoordinatePlane.tsx 完全一致的网格、坐标轴箭头与刻度计算
  const layout = useMemo(() => {
    const width = UI_CCS_VIEW_WIDTH
    const height = UI_CCS_VIEW_HEIGHT
    const { major, minor } = chooseGridStep(viewport.unitsPerPx)
    const halfW = (width / 2) * viewport.unitsPerPx
    const halfH = (height / 2) * viewport.unitsPerPx
    const minX = viewport.centerX - halfW
    const maxX = viewport.centerX + halfW
    const minY = viewport.centerY - halfH
    const maxY = viewport.centerY + halfH

    const toSX = (wx: number) => width / 2 + (wx - viewport.centerX) / viewport.unitsPerPx
    const toSY = (wy: number) => height / 2 - (wy - viewport.centerY) / viewport.unitsPerPx

    const minorLines: string[] = []
    for (let x = Math.ceil(minX / minor) * minor; x <= maxX + minor * 0.001; x += minor) {
      minorLines.push(`M${fmtSvg(toSX(x))} 0V${height}`)
    }
    for (let y = Math.ceil(minY / minor) * minor; y <= maxY + minor * 0.001; y += minor) {
      minorLines.push(`M0 ${fmtSvg(toSY(y))}H${width}`)
    }

    const majorLines: string[] = []
    const xTicks: Array<{ sx: number; label: string }> = []
    const yTicks: Array<{ sy: number; label: string }> = []

    for (let x = Math.ceil(minX / major) * major; x <= maxX + major * 0.001; x += major) {
      const sx = toSX(x)
      majorLines.push(`M${fmtSvg(sx)} 0V${height}`)
      if (Math.abs(x) >= major * 1e-4 && sx > 24 && sx < width - 24) {
        xTicks.push({ sx, label: formatAxisTick(x, major) })
      }
    }
    for (let y = Math.ceil(minY / major) * major; y <= maxY + major * 0.001; y += major) {
      const sy = toSY(y)
      majorLines.push(`M0 ${fmtSvg(sy)}H${width}`)
      if (Math.abs(y) >= major * 1e-4 && sy > 16 && sy < height - 16) {
        yTicks.push({ sy, label: formatAxisTick(y, major) })
      }
    }

    const originSX = toSX(0)
    const originSY = toSY(0)
    const yAxisVisible = originSX >= 0 && originSX <= width
    const xAxisVisible = originSY >= 0 && originSY <= height
    const yLabelAnchorX = clamp(originSX, 34, width - 16)
    const xLabelBaselineY = clamp(originSY + 14, 16, height - 8)

    const edgeGeometries = computeGraphEdgeGeometries(
      liveNodes,
      parsed.edges,
      parsed.directed,
      viewport,
      UI_GRAPH_NODE_RADIUS_PX,
      width,
      height,
    )

    const renderedNodes = liveNodes.map((n) => ({
      ...n,
      sx: toSX(n.x),
      sy: toSY(n.y),
    }))

    return {
      width,
      height,
      minorPath: minorLines.join(''),
      majorPath: majorLines.join(''),
      xTicks,
      yTicks,
      originSX,
      originSY,
      xAxisVisible,
      yAxisVisible,
      yLabelAnchorX,
      xLabelBaselineY,
      edgeGeometries,
      renderedNodes,
    }
  }, [liveNodes, parsed.edges, parsed.directed, viewport])

  return (
    <section
      data-source-line={sourceLine}
      data-directed={parsed.directed ? 'true' : 'false'}
      data-adjust-mode={adjustMode ? 'on' : 'off'}
      className="ui-graph-box ui-ccs-box not-prose ui-ccs-frame ui-graph-frame relative my-6 overflow-hidden rounded-2xl border border-ink-200/80 bg-white/95 shadow-sm dark:border-white/10 dark:bg-ink-950/90"
    >
      {/* 文章编辑模式下专属的可视化「调整模式」控制浮条 */}
      {onCommitPositions && (
        <div className="absolute right-2.5 top-2.5 z-10 flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            data-graph-adjust-toggle
            onClick={() => setAdjustMode((v) => !v)}
            className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs font-medium shadow-xs backdrop-blur-xs transition ${
              adjustMode
                ? 'border-brand-500 bg-brand-500 text-white'
                : 'border-ink-200/80 bg-white/90 text-ink-700 hover:border-brand-400 hover:text-brand-600 dark:border-white/15 dark:bg-ink-900/90 dark:text-ink-200'
            }`}
            title="开启后可直接拖拽图中节点调整坐标并自动写入源码"
          >
            <Move size={12} />
            {adjustMode ? '退出调整模式' : '调整模式'}
          </button>

          {adjustMode && (
            <>
              <button
                type="button"
                data-graph-save-btn
                onClick={() => commitPositionsToSource(latestPositionsRef.current)}
                className="inline-flex items-center gap-1 rounded-lg border border-ink-200/80 bg-white/90 px-2.5 py-1 text-xs font-medium text-ink-700 shadow-xs backdrop-blur-xs transition hover:border-brand-400 hover:text-brand-600 dark:border-white/15 dark:bg-ink-900/90 dark:text-ink-200"
              >
                <Check size={12} className={justSaved ? 'text-emerald-500' : ''} />
                {justSaved ? '已写入源码' : '保存位置'}
              </button>
              <button
                type="button"
                data-graph-reset-btn
                onClick={() => commitPositionsToSource(null)}
                className="inline-flex items-center gap-1 rounded-lg border border-ink-200/80 bg-white/90 px-2 py-1 text-xs text-ink-500 shadow-xs backdrop-blur-xs transition hover:text-ink-900 dark:border-white/15 dark:bg-ink-900/90 dark:text-ink-300"
                title="清除手动保存的点坐标，恢复自动布局"
              >
                <RotateCcw size={12} />
              </button>
            </>
          )}
        </div>
      )}

      <svg
        ref={svgRef}
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        role="application"
        tabIndex={0}
        aria-label={parsed.directed ? '有向图交互画布' : '无向图交互画布'}
        data-center-x={viewport.centerX}
        data-center-y={viewport.centerY}
        data-units-per-px={viewport.unitsPerPx}
        onKeyDown={handleKeyDown}
        onDoubleClick={() => setViewport(initialViewport)}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endPointer}
        onPointerCancel={endPointer}
        onPointerLeave={() => {
          if (pointersRef.current.size === 0) setHover(null)
        }}
        className={`block h-auto w-full select-none touch-none outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 ${
          draggingNodeId || isPanning
            ? 'cursor-grabbing'
            : hover
              ? 'cursor-pointer'
              : 'cursor-grab'
        }`}
      >
        <defs>
          <clipPath id={clipId}>
            <rect x="0" y="0" width={layout.width} height={layout.height} />
          </clipPath>
        </defs>

        {/* 细分副网格与主网格（与 CoordinatePlane 完全一致） */}
        <path
          d={layout.minorPath}
          className="stroke-ink-900/[0.045] dark:stroke-white/[0.05]"
          strokeWidth={1}
          fill="none"
        />
        <path
          d={layout.majorPath}
          className="stroke-ink-900/[0.11] dark:stroke-white/[0.12]"
          strokeWidth={1}
          fill="none"
        />

        {/* X / Y 主坐标轴与正方向箭头 */}
        {layout.xAxisVisible && (
          <g className="text-ink-500/75 dark:text-ink-400/75">
            <line
              x1={0}
              y1={layout.originSY}
              x2={layout.width}
              y2={layout.originSY}
              stroke="currentColor"
              strokeWidth={1.4}
            />
            <path
              d={`M${layout.width - 9} ${(layout.originSY - 4).toFixed(2)}L${layout.width - 2} ${layout.originSY.toFixed(2)}L${layout.width - 9} ${(layout.originSY + 4).toFixed(2)}`}
              fill="none"
              stroke="currentColor"
              strokeWidth={1.4}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <text
              x={layout.width - 14}
              y={Math.max(14, layout.originSY - 8)}
              textAnchor="end"
              className="fill-ink-600 font-serif text-[12px] italic dark:fill-ink-300"
            >
              x
            </text>
          </g>
        )}

        {layout.yAxisVisible && (
          <g className="text-ink-500/75 dark:text-ink-400/75">
            <line
              x1={layout.originSX}
              y1={layout.height}
              x2={layout.originSX}
              y2={0}
              stroke="currentColor"
              strokeWidth={1.4}
            />
            <path
              d={`M${(layout.originSX - 4).toFixed(2)} 9L${layout.originSX.toFixed(2)} 2L${(layout.originSX + 4).toFixed(2)} 9`}
              fill="none"
              stroke="currentColor"
              strokeWidth={1.4}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <text
              x={Math.min(layout.width - 16, layout.originSX + 9)}
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
          {layout.xTicks.map((tick) => (
            <text
              key={`gx-${tick.label}-${tick.sx.toFixed(1)}`}
              x={tick.sx}
              y={layout.xLabelBaselineY}
              textAnchor="middle"
            >
              {tick.label}
            </text>
          ))}
          {layout.yTicks.map((tick) => (
            <text
              key={`gy-${tick.label}-${tick.sy.toFixed(1)}`}
              x={layout.yLabelAnchorX - 7}
              y={tick.sy + 3.5}
              textAnchor="end"
            >
              {tick.label}
            </text>
          ))}
          {layout.xAxisVisible &&
            layout.yAxisVisible &&
            layout.originSX > 18 &&
            layout.originSX < layout.width - 18 && (
              <text
                x={layout.originSX - 7}
                y={Math.min(layout.height - 6, layout.originSY + 14)}
                textAnchor="end"
              >
                0
              </text>
            )}
        </g>

        {/* 图论边、有向箭头与边权 */}
        <g clipPath={`url(#${clipId})`} data-graph-layer>
          {layout.edgeGeometries.map((geom) => {
            const weightStr = geom.edge.weight
            const pillW = weightStr ? Math.max(20, weightStr.length * 7.5 + 10) : 0
            return (
              <g key={`edge-${geom.edge.index}`} data-graph-edge={`${geom.edge.source}->${geom.edge.target}`}>
                <path
                  d={geom.pathD}
                  fill="none"
                  stroke="rgb(var(--brand-500))"
                  strokeOpacity={0.85}
                  strokeWidth={2.15}
                  strokeLinecap="round"
                />
                {geom.arrowTip && (
                  <polygon
                    data-graph-arrow
                    points="0,0 -9.5,-4.4 -7.5,0 -9.5,4.4"
                    fill="rgb(var(--brand-500))"
                    transform={`translate(${fmtSvg(geom.arrowTip.x)},${fmtSvg(geom.arrowTip.y)}) rotate(${fmtSvg(geom.arrowTip.angleDeg)})`}
                  />
                )}
                {weightStr && (
                  <g transform={`translate(${fmtSvg(geom.labelPos.x)},${fmtSvg(geom.labelPos.y)})`}>
                    <rect
                      x={-pillW / 2}
                      y={-9.5}
                      width={pillW}
                      height={18}
                      rx={6}
                      className="fill-white/95 stroke-ink-200/90 dark:fill-ink-900/95 dark:stroke-white/15"
                      strokeWidth={1}
                    />
                    <text
                      x={0}
                      y={3.5}
                      textAnchor="middle"
                      className="fill-ink-800 font-mono text-[11px] font-semibold dark:fill-ink-100"
                    >
                      {weightStr}
                    </text>
                  </g>
                )}
              </g>
            )
          })}

          {/* 图论节点 */}
          {layout.renderedNodes.map((node) => {
            const isHovered = hover?.id === node.id
            return (
              <g
                key={`node-${node.id}`}
                data-node-id={node.id}
                transform={`translate(${fmtSvg(node.sx)},${fmtSvg(node.sy)})`}
              >
                {(isHovered || adjustMode) && (
                  <circle
                    r={UI_GRAPH_NODE_RADIUS_PX + 5}
                    fill="rgb(var(--brand-500))"
                    fillOpacity={isHovered ? 0.2 : 0.09}
                    stroke={adjustMode ? 'rgb(var(--brand-500))' : 'none'}
                    strokeDasharray={adjustMode && !isHovered ? '3 3' : undefined}
                    strokeOpacity={0.55}
                  />
                )}
                <circle
                  r={UI_GRAPH_NODE_RADIUS_PX}
                  className="fill-white dark:fill-ink-900"
                  stroke="rgb(var(--brand-500))"
                  strokeWidth={isHovered ? 2.6 : 2}
                />
                <text
                  x={0}
                  y={4.2}
                  textAnchor="middle"
                  fontSize={node.id.length > 3 ? 10.5 : 12.5}
                  fontWeight={650}
                  className="fill-ink-900 dark:fill-ink-100"
                >
                  {node.id}
                </text>
              </g>
            )
          })}
        </g>

        {/* 悬浮节点坐标胶囊（与 CoordinatePlane 完全一致的浮层样式） */}
        {hover && (
          <g data-graph-tooltip className="pointer-events-none">
            {(() => {
              const labelText = `${hover.id}: (${formatCoordinateValue(hover.x)}, ${formatCoordinateValue(hover.y)})`
              const badgeW = Math.max(76, labelText.length * 7.1 + 18)
              const badgeH = 22
              const boxX = clamp(hover.sx - badgeW / 2, 8, layout.width - badgeW - 8)
              const boxY =
                hover.sy > 46
                  ? hover.sy - UI_GRAPH_NODE_RADIUS_PX - badgeH - 8
                  : hover.sy + UI_GRAPH_NODE_RADIUS_PX + 8
              return (
                <>
                  <rect
                    x={boxX}
                    y={boxY}
                    width={badgeW}
                    height={badgeH}
                    rx={6}
                    className="fill-ink-900/90 stroke-white/15 dark:fill-ink-900/95 dark:stroke-white/20"
                    strokeWidth={1}
                  />
                  <text
                    x={boxX + badgeW / 2}
                    y={boxY + 14.5}
                    textAnchor="middle"
                    className="fill-white font-mono text-[11px] font-medium"
                  >
                    {labelText}
                  </text>
                </>
              )
            })()}
          </g>
        )}
      </svg>

      {adjustMode && (
        <div className="pointer-events-none absolute bottom-2.5 left-2.5 rounded-lg border border-brand-500/25 bg-brand-500/10 px-2.5 py-1 text-[11px] font-medium text-brand-700 backdrop-blur-xs dark:text-brand-200">
          拖拽节点调整坐标，松手自动保存至源码
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
