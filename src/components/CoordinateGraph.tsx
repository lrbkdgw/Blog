import { useEffect, useId, useMemo, useRef, useState } from 'react'
import {
  computeUiGraphTransform,
  layoutUiGraphNodes,
  parseUiGraph,
  UI_GRAPH_NODE_RADIUS,
  UI_GRAPH_VIEW_HEIGHT,
  UI_GRAPH_VIEW_WIDTH,
  uiGraphToSvg,
  formatUiGraphPositions,
  type UiGraphPosition,
  type UiGraphTransform,
} from '../lib/uiGraph'

interface GraphDrag {
  id: string
  pointerId: number
  startClientX: number
  startClientY: number
  startSvgX: number
  startSvgY: number
  startPosition: UiGraphPosition
  transform: UiGraphTransform
  moved: boolean
}

export function CoordinateGraph({
  body,
  extra,
  sourceLine,
  allowAdjust = false,
  onSourceChange,
}: {
  body: string
  extra?: string
  /** Original Markdown line, 1-indexed. */
  sourceLine?: number
  /** Only the in-site editor enables coordinate adjustment. */
  allowAdjust?: boolean
  onSourceChange?: (sourceLine: number, nextBody: string) => void
}) {
  const parsed = useMemo(() => parseUiGraph(body, extra), [body, extra])
  const initialPositions = useMemo(() => layoutUiGraphNodes(parsed.nodes), [parsed.nodes])
  const [positions, setPositions] = useState(initialPositions)
  const positionsRef = useRef(positions)
  const [adjusting, setAdjusting] = useState(false)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const dragRef = useRef<GraphDrag | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const markerId = `ui-graph-arrow-${useId().replace(/:/g, '')}`

  useEffect(() => {
    positionsRef.current = initialPositions
    setPositions(initialPositions)
    dragRef.current = null
    setDraggingId(null)
  }, [initialPositions])

  const computedTransform = useMemo(() => computeUiGraphTransform(positions), [positions])
  const transform = dragRef.current?.transform ?? computedTransform
  const svgPositions = useMemo(
    () => new Map(positions.map((position) => [position.id, uiGraphToSvg(position, transform)])),
    [positions, transform],
  )

  const clientToSvg = (clientX: number, clientY: number) => {
    const rect = svgRef.current?.getBoundingClientRect()
    const width = rect && rect.width > 0 ? rect.width : UI_GRAPH_VIEW_WIDTH
    const height = rect && rect.height > 0 ? rect.height : UI_GRAPH_VIEW_HEIGHT
    return {
      x: ((clientX - (rect?.left ?? 0)) / width) * UI_GRAPH_VIEW_WIDTH,
      y: ((clientY - (rect?.top ?? 0)) / height) * UI_GRAPH_VIEW_HEIGHT,
    }
  }

  const beginDrag = (event: React.PointerEvent<SVGGElement>, id: string) => {
    if (!adjusting || event.button !== 0) return
    const position = positionsRef.current.find((item) => item.id === id)
    if (!position) return
    event.preventDefault()
    event.stopPropagation()
    const svg = svgRef.current
    svg?.setPointerCapture?.(event.pointerId)
    const start = clientToSvg(event.clientX, event.clientY)
    dragRef.current = {
      id,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startSvgX: start.x,
      startSvgY: start.y,
      startPosition: position,
      transform: computedTransform,
      moved: false,
    }
    setDraggingId(id)
  }

  const moveDrag = (event: React.PointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const current = clientToSvg(event.clientX, event.clientY)
    const dx = (current.x - drag.startSvgX) / drag.transform.scale
    const dy = -(current.y - drag.startSvgY) / drag.transform.scale
    const next = positionsRef.current.map((position) =>
      position.id === drag.id
        ? { ...position, x: drag.startPosition.x + dx, y: drag.startPosition.y + dy }
        : position,
    )
    drag.moved ||= Math.abs(event.clientX - drag.startClientX) + Math.abs(event.clientY - drag.startClientY) > 1
    positionsRef.current = next
    setPositions(next)
  }

  const finishDrag = (event: React.PointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    dragRef.current = null
    setDraggingId(null)
    svgRef.current?.releasePointerCapture?.(event.pointerId)
    if (drag.moved && onSourceChange && sourceLine !== undefined) {
      onSourceChange(sourceLine, formatUiGraphPositions(body, positionsRef.current))
    }
  }

  const edgeOccurrences = new Map<string, number>()
  const totalEdges = new Map<string, number>()
  for (const edge of parsed.edges) {
    const key = `${edge.from}\u0000${edge.to}`
    totalEdges.set(key, (totalEdges.get(key) ?? 0) + 1)
  }

  return (
    <section
      className="ui-graph-box not-prose my-6 overflow-hidden rounded-xl border border-ink-200 bg-white/95 shadow-sm dark:border-white/10 dark:bg-ink-950/70"
      data-source-line={sourceLine}
    >
      {allowAdjust && (
        <div className="flex items-center justify-between gap-3 border-b border-ink-200/70 bg-ink-50/70 px-4 py-2.5 dark:border-white/10 dark:bg-white/[.035]">
          <span className="text-xs font-semibold text-ink-600 dark:text-ink-300">图</span>
          <button
            type="button"
            aria-pressed={adjusting}
            onClick={() => {
              setAdjusting((value) => !value)
              dragRef.current = null
              setDraggingId(null)
            }}
            className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
              adjusting
                ? 'border-brand-500 bg-brand-500 text-white shadow-sm'
                : 'border-ink-200 bg-white text-ink-600 hover:border-brand-300 hover:text-brand-600 dark:border-white/15 dark:bg-white/[.04] dark:text-ink-300 dark:hover:text-brand-300'
            }`}
          >
            {adjusting ? '退出调整模式' : '调整模式'}
          </button>
        </div>
      )}
      <svg
        ref={svgRef}
        viewBox={`0 0 ${UI_GRAPH_VIEW_WIDTH} ${UI_GRAPH_VIEW_HEIGHT}`}
        role={adjusting ? 'application' : 'img'}
        aria-label={adjusting ? '可拖动节点的交互图' : '交互图'}
        className={`block h-auto w-full ${adjusting ? 'touch-none select-none' : ''}`}
        onPointerMove={moveDrag}
        onPointerUp={finishDrag}
        onPointerCancel={finishDrag}
      >
        <defs>
          <marker
            id={markerId}
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M0 0L10 5L0 10Z" fill="context-stroke" />
          </marker>
        </defs>

        {/* A faint canvas grid keeps the visual language aligned with ui-ccs. */}
        <path
          d="M0 70H680M0 140H680M0 210H680M0 280H680M0 350H680M68 0V420M136 0V420M204 0V420M272 0V420M340 0V420M408 0V420M476 0V420M544 0V420M612 0V420"
          className="stroke-ink-900/[.035] dark:stroke-white/[.045]"
          strokeWidth="1"
        />

        {/* Edges */}
        <g className="text-ink-500 dark:text-ink-400">
          {parsed.edges.map((edge) => {
            const from = svgPositions.get(edge.from)
            const to = svgPositions.get(edge.to)
            if (!from || !to) return null
            const edgeKey = `${edge.from}\u0000${edge.to}`
            const occurrence = edgeOccurrences.get(edgeKey) ?? 0
            edgeOccurrences.set(edgeKey, occurrence + 1)
            const count = totalEdges.get(edgeKey) ?? 1
            const offset = (occurrence - (count - 1) / 2) * 11
            const dx = to.x - from.x
            const dy = to.y - from.y
            const length = Math.hypot(dx, dy) || 1
            const nx = -dy / length
            const ny = dx / length
            const start = {
              x: from.x + nx * offset,
              y: from.y + ny * offset,
            }
            const end = {
              x: to.x + nx * offset,
              y: to.y + ny * offset,
            }
            const selfLoop = edge.from === edge.to
            const weightX = selfLoop ? from.x + 31 : (start.x + end.x) / 2 + nx * 12
            const weightY = selfLoop ? from.y - 37 : (start.y + end.y) / 2 + ny * 12
            const path = selfLoop
              ? `M${(from.x + 8).toFixed(2)} ${(from.y - 18).toFixed(2)} C${(from.x + 56).toFixed(2)} ${(from.y - 68).toFixed(2)} ${(from.x - 46).toFixed(2)} ${(from.y - 68).toFixed(2)} ${(from.x - 8).toFixed(2)} ${(from.y - 18).toFixed(2)}`
              : `M${start.x.toFixed(2)} ${start.y.toFixed(2)}L${end.x.toFixed(2)} ${end.y.toFixed(2)}`
            return (
              <g key={`edge-${edge.index}`} data-graph-edge={`${edge.from}-${edge.to}`}>
                <path
                  d={path}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.8}
                  markerEnd={parsed.directed ? `url(#${markerId})` : undefined}
                />
                {edge.weight !== undefined && (
                  <g transform={`translate(${weightX.toFixed(2)} ${weightY.toFixed(2)})`}>
                    <rect
                      x={-Math.max(12, edge.weight.length * 3.5 + 6)}
                      y={-9}
                      width={Math.max(24, edge.weight.length * 7 + 12)}
                      height={18}
                      rx={6}
                      className="fill-white/95 dark:fill-ink-950/95"
                      stroke="currentColor"
                      strokeOpacity=".18"
                    />
                    <text
                      textAnchor="middle"
                      dominantBaseline="central"
                      className="fill-ink-600 font-mono text-[10px] dark:fill-ink-300"
                    >
                      {edge.weight}
                    </text>
                  </g>
                )}
              </g>
            )
          })}
        </g>

        {/* Nodes */}
        <g>
          {positions.map((position) => {
            const point = svgPositions.get(position.id)
            if (!point) return null
            const radius = Math.min(32, Math.max(UI_GRAPH_NODE_RADIUS, position.id.length * 4 + 12))
            return (
              <g
                key={position.id}
                data-graph-node={position.id}
                data-graph-x={position.x.toFixed(2)}
                data-graph-y={position.y.toFixed(2)}
                transform={`translate(${point.x.toFixed(2)} ${point.y.toFixed(2)})`}
                onPointerDown={(event) => beginDrag(event, position.id)}
                className={adjusting ? (draggingId === position.id ? 'cursor-grabbing' : 'cursor-grab') : ''}
              >
                {adjusting && <circle r={radius + 9} fill="transparent" />}
                <circle
                  r={radius}
                  className="fill-brand-500 stroke-white dark:fill-brand-400 dark:stroke-ink-950"
                  strokeWidth={2.2}
                  filter={draggingId === position.id ? 'drop-shadow(0 3px 6px rgb(15 23 42 / .28))' : undefined}
                />
                <text
                  textAnchor="middle"
                  dominantBaseline="central"
                  className="fill-white font-mono text-[11px] font-semibold dark:fill-ink-950"
                  pointerEvents="none"
                >
                  {position.id}
                </text>
              </g>
            )
          })}
        </g>
      </svg>

      {parsed.errors.length > 0 && (
        <div className="border-t border-rose-200/70 bg-rose-50/70 px-4 py-2 font-mono text-[11px] text-rose-700 dark:border-rose-400/20 dark:bg-rose-500/10 dark:text-rose-200">
          {parsed.errors.map((error, index) => <p key={`error-${index}`}>{error}</p>)}
        </div>
      )}
      {allowAdjust && adjusting && (
        <p className="border-t border-brand-200/70 bg-brand-50/60 px-4 py-2 text-xs text-brand-700 dark:border-brand-400/20 dark:bg-brand-500/[.06] dark:text-brand-200">
          拖动节点调整位置；松开鼠标后坐标会写回文章源码。
        </p>
      )}
    </section>
  )
}
