export interface UiGraphNode {
  id: string
  x: number | null
  y: number | null
  /** Whether a source declaration supplied an explicit coordinate pair. */
  positioned: boolean
}

export interface UiGraphEdge {
  from: string
  to: string
  weight?: string
  index: number
}

export interface ParsedUiGraph {
  nodes: UiGraphNode[]
  edges: UiGraphEdge[]
  errors: string[]
  directed: boolean
}

export interface UiGraphPosition {
  id: string
  x: number
  y: number
}

export interface UiGraphTransform {
  centerX: number
  centerY: number
  scale: number
}

export const UI_GRAPH_VIEW_WIDTH = 680
export const UI_GRAPH_VIEW_HEIGHT = 420
export const UI_GRAPH_NODE_RADIUS = 21

const NUMBER_RE = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i

function finiteNumber(value: string | undefined): number | null {
  if (value === undefined || !NUMBER_RE.test(value)) return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function cleanId(value: string): string {
  return value.trim().replace(/[,;]+$/, '')
}

function isNodeId(value: string): boolean {
  return /^[^\s,;]+$/u.test(value) && value !== '->' && value !== '--'
}

/**
 * Parse the line-oriented `ui-graph` notation.
 *
 * - A bare identifier declares a node.
 * - `point ID X Y` / `node ID X Y` declares a positioned node.
 * - `FROM TO [WEIGHT [X Y]]` declares an edge. If X/Y are supplied, they
 *   specify the destination node's position unless an explicit `point` line
 *   overrides it.
 * - `dag` in the directive options enables arrowheads.
 */
export function parseUiGraph(source: string, extra = ''): ParsedUiGraph {
  const nodeMap = new Map<string, UiGraphNode>()
  const edges: UiGraphEdge[] = []
  const errors: string[] = []
  let edgeIndex = 0

  const ensureNode = (rawId: string): UiGraphNode | null => {
    const id = cleanId(rawId)
    if (!isNodeId(id)) return null
    let node = nodeMap.get(id)
    if (!node) {
      node = { id, x: null, y: null, positioned: false }
      nodeMap.set(id, node)
    }
    return node
  }

  const setPosition = (node: UiGraphNode, x: number | null, y: number | null, explicit: boolean) => {
    if (x === null || y === null) return
    if (explicit || !node.positioned) {
      node.x = x
      node.y = y
      node.positioned = explicit
    }
  }

  for (const rawLine of source.replace(/\r\n?/g, '\n').split('\n')) {
    const line = rawLine.replace(/\s+(?:#|\/\/).*$/, '').trim()
    if (!line || line.startsWith('#') || line.startsWith('//')) continue

    const nodeMatch = line.match(/^(?:point|node)\s+(\S+)(?:\s+([^\s,;]+)\s+([^\s,;]+))?\s*$/i)
    if (nodeMatch) {
      const node = ensureNode(nodeMatch[1])
      if (!node) {
        errors.push(`无效节点名称：${nodeMatch[1]}`)
        continue
      }
      if (nodeMatch[2] !== undefined || nodeMatch[3] !== undefined) {
        const x = finiteNumber(nodeMatch[2])
        const y = finiteNumber(nodeMatch[3])
        if (x === null || y === null) {
          errors.push(`节点 ${node.id} 的坐标必须是有限数字。`)
        } else {
          setPosition(node, x, y, true)
        }
      }
      continue
    }

    const bare = line.match(/^([^\s,;]+)[,;]?$/)
    if (bare) {
      const node = ensureNode(bare[1])
      if (!node) errors.push(`无法识别节点：${bare[1]}`)
      continue
    }

    const arrow = line.match(/^(\S+)\s*(->|--)\s*(\S+)(?:\s+(.*))?$/)
    const parts = arrow
      ? [cleanId(arrow[1]), cleanId(arrow[3]), ...(arrow[4] ? arrow[4].replace(/[,;]/g, ' ').trim().split(/\s+/) : [])]
      : line.replace(/[,;]/g, ' ').trim().split(/\s+/)

    if (parts.length < 2 || !isNodeId(parts[0]) || !isNodeId(parts[1])) {
      errors.push(`无法解析图指令：${rawLine.trim()}`)
      continue
    }

    const from = ensureNode(parts[0])
    const to = ensureNode(parts[1])
    if (!from || !to) {
      errors.push(`无效边：${parts[0]} → ${parts[1]}`)
      continue
    }

    const tail = parts.slice(2).filter(Boolean)
    let weight: string | undefined
    let coordinateX: number | null = null
    let coordinateY: number | null = null
    if (tail.length === 1) {
      weight = tail[0] === '-' ? undefined : tail[0]
    } else if (tail.length === 2) {
      const x = finiteNumber(tail[0])
      const y = finiteNumber(tail[1])
      if (x !== null && y !== null) {
        coordinateX = x
        coordinateY = y
      } else {
        weight = tail[0] === '-' ? undefined : tail[0]
        errors.push(`边 ${from.id} → ${to.id} 的坐标需要同时提供 x 与 y。`)
      }
    } else if (tail.length >= 3) {
      weight = tail[0] === '-' ? undefined : tail[0]
      coordinateX = finiteNumber(tail[1])
      coordinateY = finiteNumber(tail[2])
      if (coordinateX === null || coordinateY === null) {
        coordinateX = null
        coordinateY = null
        errors.push(`边 ${from.id} → ${to.id} 的可选坐标必须是有限数字。`)
      }
    }

    if (coordinateX !== null && coordinateY !== null) setPosition(to, coordinateX, coordinateY, false)
    edges.push({ from: from.id, to: to.id, weight, index: edgeIndex++ })
  }

  return {
    nodes: [...nodeMap.values()],
    edges,
    errors,
    directed: /(?:^|\s)(?:dag|directed)(?:\s|$)/i.test(extra),
  }
}

/** Fill in a deterministic circular layout for nodes without source coordinates. */
export function layoutUiGraphNodes(nodes: readonly UiGraphNode[]): UiGraphPosition[] {
  if (nodes.length === 0) return []
  const explicit = nodes.filter((node): node is UiGraphNode & { x: number; y: number } => node.x !== null && node.y !== null)
  const minX = explicit.length ? Math.min(...explicit.map((node) => node.x)) : 50
  const maxX = explicit.length ? Math.max(...explicit.map((node) => node.x)) : 50
  const minY = explicit.length ? Math.min(...explicit.map((node) => node.y)) : 50
  const maxY = explicit.length ? Math.max(...explicit.map((node) => node.y)) : 50
  const centerX = (minX + maxX) / 2
  const centerY = (minY + maxY) / 2
  const radius = Math.max(40, maxX - minX, maxY - minY) * 0.62
  const missing = nodes.filter((node) => node.x === null || node.y === null)

  return nodes.map((node) => {
    if (node.x !== null && node.y !== null) return { id: node.id, x: node.x, y: node.y }
    const index = missing.findIndex((item) => item.id === node.id)
    if (missing.length === 1 && explicit.length === 0) return { id: node.id, x: 50, y: 50 }
    const angle = -Math.PI / 2 + (index * 2 * Math.PI) / Math.max(1, missing.length)
    const fallbackCenterX = explicit.length ? centerX : 50
    const fallbackCenterY = explicit.length ? centerY : 50
    return {
      id: node.id,
      x: fallbackCenterX + radius * Math.cos(angle),
      y: fallbackCenterY + radius * Math.sin(angle),
    }
  })
}

export function computeUiGraphTransform(
  positions: readonly UiGraphPosition[],
  width = UI_GRAPH_VIEW_WIDTH,
  height = UI_GRAPH_VIEW_HEIGHT,
  padding = 54,
): UiGraphTransform {
  if (positions.length === 0) return { centerX: 0, centerY: 0, scale: 1 }
  const minX = Math.min(...positions.map((point) => point.x))
  const maxX = Math.max(...positions.map((point) => point.x))
  const minY = Math.min(...positions.map((point) => point.y))
  const maxY = Math.max(...positions.map((point) => point.y))
  const rangeX = Math.max(1, maxX - minX)
  const rangeY = Math.max(1, maxY - minY)
  const scale = Math.min((width - 2 * padding) / rangeX, (height - 2 * padding) / rangeY)
  return {
    centerX: (minX + maxX) / 2,
    centerY: (minY + maxY) / 2,
    scale: Number.isFinite(scale) && scale > 0 ? scale : 1,
  }
}

export function uiGraphToSvg(
  point: Pick<UiGraphPosition, 'x' | 'y'>,
  transform: UiGraphTransform,
  width = UI_GRAPH_VIEW_WIDTH,
  height = UI_GRAPH_VIEW_HEIGHT,
): { x: number; y: number } {
  return {
    x: width / 2 + (point.x - transform.centerX) * transform.scale,
    y: height / 2 - (point.y - transform.centerY) * transform.scale,
  }
}

function formatGraphCoordinate(value: number): string {
  const rounded = Math.round(value * 100) / 100
  return Object.is(rounded, -0) ? '0' : String(rounded)
}

/** Serialize all dragged positions as explicit `point ID X Y` lines. */
export function formatUiGraphPositions(source: string, positions: readonly UiGraphPosition[]): string {
  const lines = source.replace(/\r\n?/g, '\n').split('\n')
  const remaining = lines.filter((line) => {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('//')) return true
    if (/^(?:point|node)\s+\S+(?:\s+\S+\s+\S+)?\s*$/i.test(trimmed)) return false
    return !/^[^\s,;]+[,;]?$/.test(trimmed)
  })
  const declarations = positions.map(
    ({ id, x, y }) => `point ${id} ${formatGraphCoordinate(x)} ${formatGraphCoordinate(y)}`,
  )
  const combined = [...declarations, ...remaining]
  // Keep one blank line between the generated node list and original edge text.
  if (declarations.length > 0 && remaining.some((line) => line.trim())) {
    combined.splice(declarations.length, 0, '')
  }
  return combined.join('\n').replace(/^\n+/, '').replace(/\n+$/, '')
}

const GRAPH_OPEN_RE = /^\s*::begin_ui-graph(?:\[[^\]]*\])?\s*$/i
const GRAPH_CLOSE_RE = /^\s*::end_ui-graph\s*$/i

/** Replace a graph body in its original Markdown block (sourceLine is 1-indexed). */
export function replaceUiGraphBodyAtLine(markdown: string, sourceLine: number, body: string): string {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n')
  const expected = Number.isInteger(sourceLine) ? sourceLine - 1 : -1
  const start = expected >= 0 && expected < lines.length && GRAPH_OPEN_RE.test(lines[expected]) ? expected : -1
  if (start < 0) return markdown
  const end = lines.findIndex((line, index) => index > start && GRAPH_CLOSE_RE.test(line))
  if (end < 0) return markdown
  lines.splice(start + 1, end - start - 1, ...body.replace(/\r\n?/g, '\n').split('\n'))
  return lines.join('\n')
}
