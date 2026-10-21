import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Check, Move, RotateCcw } from 'lucide-react'
import {
  clampUnitsPerPx,
  UI_CCS_VIEW_HEIGHT,
  UI_CCS_VIEW_WIDTH,
  type UiCcsViewport,
} from '../lib/uiCcs'
import {
  computeGraphEdgeGeometries,
  computeInitialUiGraphViewport,
  findNearestUiGraphNode,
  parseUiGraph,
  UI_GRAPH_HOVER_RADIUS_PX,
  UI_GRAPH_NODE_RADIUS_PX,
  type UiGraphHoverNode,
} from '../lib/uiGraph'

interface GraphPlaneProps {
  header: string
  source: string
  /** 原始 Markdown 行号（双栏编辑器滚动同步锚点用）。 */
  sourceLine?: number
  /**
   * 仅在站内文章编辑器中传入：支持开启「调整模式」，可视化拖拽调整节点位置并写回 Markdown 源码。
   * 传入 `null` 表示重置该图的自定义坐标并恢复自动布局。
   */
  onCommitPositions?: (positions: Record<string, { x: number; y: number }> | null) => void
}

function fmtSvg(n: number): string {
  return String(Number(n.toFixed(2)))
}

export function GraphPlane({ header, source, sourceLine, onCommitPositions }: GraphPlaneProps) {
  const clipId = useId().replace(/:/g, '_')
  const svgRef = useRef<SVGSVGElement>(null)

  const parsed = useMemo(() => parseUiGraph(header, source), [header, source])

  const initialPositions = useMemo(() => {
    const map: Record<string, { x: number; y: number }> = {}
    for (const node of parsed.nodes) {
      map[node.id] = { x: node.x, y: node.y }
    }
    return map
  }, [parsed.nodes])

  const [localPositions, setLocalPositions] = useState<Record<string, { x: number; y: number }>>(initialPositions)
  const latestPositionsRef = useRef<Record<string, { x: number; y: number }>>(initialPositions)

  useEffect(() => {
    setLocalPositions(initialPositions)
    latestPositionsRef.current = initialPositions
  }, [initialPositions])

  const liveNodes = useMemo(
    () =>
      parsed.nodes.map((node) => {
        const override = localPositions[node.id]
        return override ? { ...node, x: override.x, y: override.y } : node
      }),
    [parsed.nodes, localPositions],
  )

  const initialViewport = useMemo(
    () => computeInitialUiGraphViewport(parsed.nodes, UI_CCS_VIEW_WIDTH, UI_CCS_VIEW_HEIGHT),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [source, header],
  )

  const [viewport, setViewport] = useState<UiCcsViewport>(initialViewport)
  useEffect(() => {
    setViewport(initialViewport)
  }, [initialViewport])

  const [hover, setHover] = useState<UiGraphHoverNode | null>(null)
  const [isPanning, setIsPanning] = useState(false)
  const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null)
  const [adjustMode, setAdjustMode] = useState(false)
  const [savedNotice, setSavedNotice] = useState(false)

  useEffect(() => {
    if (!onCommitPositions && adjustMode) {
      setAdjustMode(false)
    }
  }, [onCommitPositions, adjustMode])

  const pointersRef = useRef<Map<number, { clientX: number; clientY: number }>>(new Map())
  const lastDragRef = useRef<{
    mode: 'single' | 'pinch' | 'node'
    clientX: number
    clientY: number
    pinchDist: number
    nodeId?: string
  } | null>(null)

  const clientToSvgPoint = (clientX: number, clientY: number) => {
    const svg = svgRef.current
    if (!svg) return { sx: UI_CCS_VIEW_WIDTH / 2, sy: UI_CCS_VIEW_HEIGHT / 2, scaleX: 1, scaleY: 1 }
    const rect = svg.getBoundingClientRect()
    const w = rect.width > 0 ? rect.width : UI_CCS_VIEW_WIDTH
    const h = rect.height > 0 ? rect.height : UI_CCS_VIEW_HEIGHT
    const scaleX = UI_CCS_VIEW_WIDTH / w
    const scaleY = UI_CCS_VIEW_HEIGHT / h
    return {
      sx: (clientX - rect.left) * scaleX,
      sy: (clientY - rect.top) * scaleY,
      scaleX,
      scaleY,
    }
  }

  const zoomAround = (factor: number, sx: number, sy: number) => {
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
  }

  // 非被动滚轮缩放（阻止页面跟随滚动，以光标为缩放中心，交互手感与 CoordinatePlane 一致）
  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      const rect = svg.getBoundingClientRect()
      const w = rect.width > 0 ? rect.width : UI_CCS_VIEW_WIDTH
      const h = rect.height > 0 ? rect.height : UI_CCS_VIEW_HEIGHT
      const sx = ((event.clientX - rect.left) / w) * UI_CCS_VIEW_WIDTH
      const sy = ((event.clientY - rect.top) / h) * UI_CCS_VIEW_HEIGHT
      const normalized = Math.max(-120, Math.min(120, event.deltaY))
      const factor = Math.exp(normalized * 0.0022)
      zoomAround(factor, sx, sy)
    }
    svg.addEventListener('wheel', onWheel, { passive: false })
    return () => svg.removeEventListener('wheel', onWheel)
  }, [])

  const commitPositionsToSource = (posMap: Record<string, { x: number; y: number }>) => {
    if (!onCommitPositions) return
    onCommitPositions(posMap)
    setSavedNotice(true)
    window.setTimeout(() => setSavedNotice(false), 1400)
  }

  const handlePointerDown = (event: React.PointerEvent<SVGSVGElement>) => {
    if (event.button !== 0 && event.pointerType === 'mouse') return
    event.currentTarget.setPointerCapture?.(event.pointerId)
    pointersRef.current.set(event.pointerId, { clientX: event.clientX, clientY: event.clientY })
    const pts = [...pointersRef.current.values()]

    if (pts.length === 1) {
      const svgPt = clientToSvgPoint(event.clientX, event.clientY)
      if (adjustMode && onCommitPositions) {
        const hit = findNearestUiGraphNode(
          liveNodes,
          viewport,
          svgPt.sx,
          svgPt.sy,
          UI_GRAPH_HOVER_RADIUS_PX + 4,
        )
        if (hit) {
          lastDragRef.current = {
            mode: 'node',
            clientX: event.clientX,
            clientY: event.clientY,
            pinchDist: 0,
            nodeId: hit.id,
          }
          setDraggingNodeId(hit.id)
          setHover(hit)
          return
        }
      }
      lastDragRef.current = {
        mode: 'single',
        clientX: event.clientX,
        clientY: event.clientY,
        pinchDist: 0,
      }
      setIsPanning(true)
    } else if (pts.length >= 2) {
      setDraggingNodeId(null)
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

  const layout = useMemo(() => {
    const width = UI_CCS_VIEW_WIDTH
    const height = UI_CCS_VIEW_HEIGHT
    const toSX = (wx: number) => width / 2 + (wx - viewport.centerX) / viewport.unitsPerPx
    const toSY = (wy: number) => height / 2 - (wy - viewport.centerY) / viewport.unitsPerPx

    const edgeGeoms = computeGraphEdgeGeometries(
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
      edgeGeoms,
      renderedNodes,
    }
  }, [liveNodes, parsed.edges, parsed.directed, viewport])

  return (
    <section
      className="ui-graph-box ui-ccs-box not-prose relative my-6 overflow-hidden rounded-xl border border-ink-200 bg-white/95 shadow-sm dark:border-white/10 dark:bg-ink-950/70"
      data-source-line={sourceLine}
    >
      {/* 仅在编辑器中提供极简「调整模式」悬浮胶囊 */}
      {onCommitPositions && (
        <div className="pointer-events-auto absolute top-2.5 right-2.5 z-10 flex items-center gap-1.5 rounded-lg border border-ink-200/80 bg-white/90 px-2 py-1 text-xs shadow-2xs backdrop-blur-xs dark:border-white/15 dark:bg-ink-900/90">
          <button
            type="button"
            onClick={() => setAdjustMode((v) => !v)}
            className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 font-medium transition ${
              adjustMode
                ? 'bg-brand-500 text-white'
                : 'text-ink-600 hover:bg-ink-100 hover:text-ink-900 dark:text-ink-300 dark:hover:bg-white/10 dark:hover:text-white'
            }`}
          >
            <Move size={12} />
            <span>{adjustMode ? '退出调整' : '调整模式'}</span>
          </button>

          {adjustMode && (
            <>
              <button
                type="button"
                onClick={() => commitPositionsToSource(latestPositionsRef.current)}
                title="保存当前图中所有点位到 Markdown 源码"
                className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 font-medium text-brand-600 transition hover:bg-brand-500/10 dark:text-brand-300"
              >
                <Check size={12} />
                <span>{savedNotice ? '已保存' : '保存'}</span>
              </button>
              <button
                type="button"
                onClick={() => onCommitPositions(null)}
                title="重置自定义坐标并恢复自动布局"
                className="inline-flex items-center rounded-md p-1 text-ink-400 transition hover:bg-ink-100 hover:text-ink-700 dark:text-ink-400 dark:hover:bg-white/10 dark:hover:text-ink-100"
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
            : adjustMode && hover
              ? 'cursor-move'
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

        <g clipPath={`url(#${clipId})`}>
          {/* 图论边、箭头与边权标签 */}
          {layout.edgeGeoms.map((geom) => {
            const weightStr = geom.edge.weight
            const pillW = weightStr ? Math.max(20, weightStr.length * 7.2 + 10) : 0
            const isIncidentHovered =
              hover !== null && (geom.edge.source === hover.id || geom.edge.target === hover.id)
            return (
              <g key={`edge-${geom.edge.index}`} data-graph-edge={geom.edge.index}>
                <path
                  d={geom.pathD}
                  fill="none"
                  stroke={isIncidentHovered ? 'rgb(var(--brand-500))' : 'currentColor'}
                  className={
                    isIncidentHovered
                      ? 'transition-colors duration-150'
                      : 'text-ink-400/90 transition-colors duration-150 dark:text-ink-500/90'
                  }
                  strokeOpacity={isIncidentHovered ? 0.95 : 0.85}
                  strokeWidth={isIncidentHovered ? 2.15 : 1.75}
                  strokeLinecap="round"
                />
                {geom.arrowTip && (
                  <polygon
                    data-graph-arrow
                    points="0,0 -8.6,-3.8 -6.8,0 -8.6,3.8"
                    fill={isIncidentHovered ? 'rgb(var(--brand-500))' : 'currentColor'}
                    className={
                      isIncidentHovered
                        ? 'transition-colors duration-150'
                        : 'text-ink-500 transition-colors duration-150 dark:text-ink-400'
                    }
                    transform={`translate(${fmtSvg(geom.arrowTip.x)},${fmtSvg(geom.arrowTip.y)}) rotate(${fmtSvg(geom.arrowTip.angleDeg)})`}
                  />
                )}
                {weightStr && (
                  <g
                    transform={`translate(${fmtSvg(geom.labelPos.x)},${fmtSvg(geom.labelPos.y)})`}
                    className="pointer-events-none"
                  >
                    <rect
                      x={-pillW / 2}
                      y={-9}
                      width={pillW}
                      height={18}
                      rx={5}
                      className="fill-white/95 dark:fill-ink-950/95"
                    />
                    <text
                      x={0}
                      y={3.6}
                      textAnchor="middle"
                      className={`font-mono text-[11px] font-medium transition-colors duration-150 ${
                        isIncidentHovered
                          ? 'fill-brand-600 dark:fill-brand-300'
                          : 'fill-ink-600 dark:fill-ink-300'
                      }`}
                    >
                      {weightStr}
                    </text>
                  </g>
                )}
              </g>
            )
          })}

          {/* 图论节点（纯图节点展示，悬浮仅柔和聚光高亮，绝不弹出坐标气泡） */}
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
                    r={UI_GRAPH_NODE_RADIUS_PX + 4.5}
                    fill="rgb(var(--brand-500))"
                    fillOpacity={isHovered ? 0.14 : 0.06}
                    stroke={adjustMode ? 'rgb(var(--brand-500))' : 'none'}
                    strokeDasharray={adjustMode && !isHovered ? '3 3' : undefined}
                    strokeOpacity={0.45}
                  />
                )}
                <circle
                  r={UI_GRAPH_NODE_RADIUS_PX}
                  className="fill-white transition-colors duration-150 dark:fill-ink-900"
                  stroke={isHovered ? 'rgb(var(--brand-500))' : 'rgb(var(--brand-500) / 0.72)'}
                  strokeWidth={isHovered ? 2.2 : 1.75}
                />
                <text
                  x={0}
                  y={4.2}
                  textAnchor="middle"
                  fontSize={node.id.length > 3 ? 10.5 : 12.5}
                  fontWeight={600}
                  className="pointer-events-none fill-ink-800 dark:fill-ink-100"
                >
                  {node.id}
                </text>
              </g>
            )
          })}
        </g>
      </svg>
    </section>
  )
}
