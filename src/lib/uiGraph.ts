import {
  chooseGridStep,
  clampUnitsPerPx,
  formatAxisTick,
  UI_CCS_VIEW_HEIGHT,
  UI_CCS_VIEW_WIDTH,
  type UiCcsViewport,
} from './uiCcs'
import { parseLeadingBracketGroups } from './uiWidgets'

/**
 * 图论画布语法（issue #83）：
 *
 * ::begin_ui-graph[<附加项>]
 * <point_1>
 * <s_1> <t_1> <w_1> <x_1> <y_1>
 * <s_2> <t_2> <w_2> <x_2> <y_2>
 * ::end_ui-graph
 *
 * - 风格与平面直角坐标系（`CoordinatePlane`）保持完全一致；
 * - 支持 `dag`（有向图）、孤立点 `<point>`、显式点坐标 `<point> (<x>, <y>)`、
 *   以及 `<s_i> <t_i> [<w_i> [<x_i> <y_i>]]`（`w, x, y` 可选）；
 * - 即使某个点从未显式声明，只要出现在边中也自动创建；
 * - 文章编辑时支持「调整模式」，可视化拖拽节点位置并写回 Markdown 源码保存。
 */

export interface UiGraphNode {
  id: string
  x: number
  y: number
  hasExplicitPosition: boolean
}

export interface UiGraphEdge {
  index: number
  source: string
  target: string
  weight?: string
  anchorX?: number
  anchorY?: number
}

export interface ParsedUiGraph {
  directed: boolean
  nodes: UiGraphNode[]
  edges: UiGraphEdge[]
  errors: string[]
}

export interface UiGraphHoverNode {
  id: string
  x: number
  y: number
  sx: number
  sy: number
  distancePx: number
}

export const UI_GRAPH_NODE_RADIUS_PX = 18
export const UI_GRAPH_HOVER_RADIUS_PX = 24

function isFiniteNumToken(token: string): boolean {
  if (!token.trim()) return false
  return Number.isFinite(Number(token.trim()))
}

function parseCoordPairText(text: string): { x: number; y: number } | null {
  const parts = text.split(/[,\s]+/).map((t) => t.trim()).filter(Boolean)
  if (parts.length !== 2) return null
  const x = Number(parts[0])
  const y = Number(parts[1])
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null
  return { x, y }
}

/** 解析点声明行：`<id>`、`<id> (<x>, <y>)`、`<id>[<x>, <y>]` 或 `<id>: <x> <y>`。 */
function parseExplicitVertexLine(trimmed: string): {
  id: string
  x?: number
  y?: number
} | null {
  // 1) `<id> (<x>, <y>)` 或 `<id>(<x>, <y>)` 或 `<id> [<x>, <y>]`
  const tupleMatch = trimmed.match(/^([^\s()[\]:]+)\s*(?:\(([^()]+)\)|\[([^\][]+)\])$/)
  if (tupleMatch) {
    const coord = parseCoordPairText(tupleMatch[2] ?? tupleMatch[3] ?? '')
    if (coord) return { id: tupleMatch[1], x: coord.x, y: coord.y }
  }

  // 2) `<id>: <x> <y>`
  const colonMatch = trimmed.match(/^([^\s:]+)\s*:\s*([\s\S]+)$/)
  if (colonMatch) {
    const coord = parseCoordPairText(colonMatch[2])
    if (coord) return { id: colonMatch[1], x: coord.x, y: coord.y }
  }

  return null
}

/** 确定性力导向 + 分层初始布局（保证同一源码每次渲染完全一致，且显式坐标始终锁死不变）。 */
function computeGraphNodeLayout(
  nodeOrder: string[],
  explicitMap: Map<string, { x: number; y: number }>,
  edges: UiGraphEdge[],
  directed: boolean,
): UiGraphNode[] {
  const n = nodeOrder.length
  if (n === 0) return []

  const indexOf = new Map<string, number>()
  nodeOrder.forEach((id, idx) => indexOf.set(id, idx))

  const posX = new Float64Array(n)
  const posY = new Float64Array(n)
  const pinned = new Uint8Array(n)

  const radius = Math.max(3.2, Math.min(9.5, 1.9 * Math.sqrt(Math.max(1, n))))

  // DAG 分层种子布局：有向图优先按入度拓扑层级自左向右展开，无向图按均匀圆周展开
  const levels = new Int32Array(n)
  if (directed && edges.length > 0) {
    const indeg = new Int32Array(n)
    const adj: number[][] = Array.from({ length: n }, () => [])
    for (const e of edges) {
      const u = indexOf.get(e.source)
      const v = indexOf.get(e.target)
      if (u !== undefined && v !== undefined && u !== v) {
        adj[u].push(v)
        indeg[v] += 1
      }
    }
    const queue: number[] = []
    for (let i = 0; i < n; i += 1) {
      if (indeg[i] === 0) queue.push(i)
    }
    let head = 0
    while (head < queue.length) {
      const u = queue[head++]
      for (const v of adj[u]) {
        levels[v] = Math.max(levels[v], levels[u] + 1)
        indeg[v] -= 1
        if (indeg[v] === 0) queue.push(v)
      }
    }
  }

  const maxLevel = Math.max(...levels)
  if (directed && maxLevel >= 1) {
    const buckets: number[][] = Array.from({ length: maxLevel + 1 }, () => [])
    for (let i = 0; i < n; i += 1) buckets[levels[i]].push(i)
    const spanX = Math.max(6, maxLevel * 3.4)
    for (let lv = 0; lv <= maxLevel; lv += 1) {
      const group = buckets[lv]
      const x = -spanX / 2 + (spanX * lv) / maxLevel
      group.forEach((nodeIdx, k) => {
        const y = ((group.length - 1) / 2 - k) * 3.0
        posX[nodeIdx] = x
        posY[nodeIdx] = y
      })
    }
  } else {
    for (let i = 0; i < n; i += 1) {
      if (n === 1) {
        posX[0] = 0
        posY[0] = 0
      } else {
        const angle = Math.PI / 2 - (2 * Math.PI * i) / n
        posX[i] = radius * Math.cos(angle)
        posY[i] = radius * Math.sin(angle)
      }
    }
  }

  // 写入显式坐标并固定
  for (let i = 0; i < n; i += 1) {
    const exp = explicitMap.get(nodeOrder[i])
    if (exp) {
      posX[i] = exp.x
      posY[i] = exp.y
      pinned[i] = 1
    }
  }

  // 对未固定节点执行确定性 Fruchterman–Reingold 松弛，消除重叠与过短边
  const unpinnedCount = pinned.reduce((s, v) => s + (v === 0 ? 1 : 0), 0)
  if (unpinnedCount > 1 || (unpinnedCount === 1 && n > 1)) {
    const idealLen = 3.4
    const dispX = new Float64Array(n)
    const dispY = new Float64Array(n)

    for (let iter = 0; iter < 90; iter += 1) {
      const temp = Math.max(0.05, 1.4 * (1 - iter / 90))
      dispX.fill(0)
      dispY.fill(0)

      // 节点间库仑斥力
      for (let i = 0; i < n; i += 1) {
        for (let j = i + 1; j < n; j += 1) {
          let dx = posX[i] - posX[j]
          let dy = posY[i] - posY[j]
          if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) {
            dx = 0.05 * ((i + 1) % 3 === 0 ? -1 : 1)
            dy = 0.05 * ((j + 1) % 2 === 0 ? 1 : -1)
          }
          const dist = Math.hypot(dx, dy)
          const force = (idealLen * idealLen) / Math.max(dist, 0.25)
          const fx = (dx / dist) * force
          const fy = (dy / dist) * force
          dispX[i] += fx
          dispY[i] += fy
          dispX[j] -= fx
          dispY[j] -= fy
        }
      }

      // 边胡克引力
      for (const e of edges) {
        const u = indexOf.get(e.source)
        const v = indexOf.get(e.target)
        if (u === undefined || v === undefined || u === v) continue
        const dx = posX[u] - posX[v]
        const dy = posY[u] - posY[v]
        const dist = Math.max(Math.hypot(dx, dy), 1e-4)
        const force = (dist * dist) / idealLen
        const fx = (dx / dist) * force
        const fy = (dy / dist) * force
        dispX[u] -= fx
        dispY[u] -= fy
        dispX[v] += fx
        dispY[v] += fy
      }

      // 轻微向心力防止孤立连通块飘远
      for (let i = 0; i < n; i += 1) {
        dispX[i] -= posX[i] * 0.08
        dispY[i] -= posY[i] * 0.08
      }

      for (let i = 0; i < n; i += 1) {
        if (pinned[i]) continue
        const d = Math.hypot(dispX[i], dispY[i])
        if (d > 1e-9) {
          const step = Math.min(d, temp)
          posX[i] += (dispX[i] / d) * step
          posY[i] += (dispY[i] / d) * step
        }
      }
    }
  }

  return nodeOrder.map((id, i) => ({
    id,
    x: Number(posX[i].toFixed(3)),
    y: Number(posY[i].toFixed(3)),
    hasExplicitPosition: pinned[i] === 1,
  }))
}

/** 解析 `::begin_ui-graph[<附加项>]` 头部修饰项与主体定义。 */
export function parseUiGraph(headerRest: string, sourceBody: string): ParsedUiGraph {
  const { groups } = parseLeadingBracketGroups(headerRest.trim(), true)
  let directed = false
  for (const grp of groups) {
    for (const part of grp.split(/[;,\s]+/)) {
      if (/^(?:dag|directed)$/i.test(part.trim())) {
        directed = true
      }
    }
  }

  const nodeOrder: string[] = []
  const explicitPositions = new Map<string, { x: number; y: number }>()
  const edges: UiGraphEdge[] = []
  const errors: string[] = []

  const ensureNode = (rawId: string) => {
    const id = rawId.trim()
    if (!id) return
    if (!nodeOrder.includes(id)) nodeOrder.push(id)
  }

  for (const rawLine of sourceBody.replace(/\r\n/g, '\n').split('\n')) {
    const cleaned = rawLine.replace(/^\s*(?:\/\/|#).*$/, '').trim()
    if (!cleaned) continue

    const explicitVertex = parseExplicitVertexLine(cleaned)
    if (explicitVertex) {
      ensureNode(explicitVertex.id)
      if (explicitVertex.x !== undefined && explicitVertex.y !== undefined) {
        explicitPositions.set(explicitVertex.id, { x: explicitVertex.x, y: explicitVertex.y })
      }
      continue
    }

    const tokens = cleaned.split(/\s+/).filter(Boolean)
    if (tokens.length === 1) {
      ensureNode(tokens[0])
      continue
    }

    const s = tokens[0]
    const t = tokens[1]
    ensureNode(s)
    ensureNode(t)

    if (tokens.length === 2) {
      edges.push({ index: edges.length, source: s, target: t })
      continue
    }

    if (tokens.length === 3) {
      const weight = tokens[2] === '-' ? undefined : tokens[2]
      edges.push({ index: edges.length, source: s, target: t, weight })
      continue
    }

    if (tokens.length === 4 && isFiniteNumToken(tokens[2]) && isFiniteNumToken(tokens[3])) {
      const x = Number(tokens[2])
      const y = Number(tokens[3])
      explicitPositions.set(s, { x, y })
      edges.push({ index: edges.length, source: s, target: t })
      continue
    }

    if (tokens.length >= 5 && isFiniteNumToken(tokens[3]) && isFiniteNumToken(tokens[4])) {
      const weight = tokens[2] === '-' ? undefined : tokens[2]
      const x = Number(tokens[3])
      const y = Number(tokens[4])
      explicitPositions.set(s, { x, y })
      edges.push({ index: edges.length, source: s, target: t, weight })
      continue
    }

    errors.push(`无法解析的图语句：${cleaned}`)
  }

  const nodes = computeGraphNodeLayout(nodeOrder, explicitPositions, edges, directed)
  return { directed, nodes, edges, errors }
}

export function computeInitialUiGraphViewport(
  nodes: Array<{ x: number; y: number }>,
  width = UI_CCS_VIEW_WIDTH,
  height = UI_CCS_VIEW_HEIGHT,
): UiCcsViewport {
  if (nodes.length === 0) {
    return {
      centerX: 0,
      centerY: 0,
      unitsPerPx: clampUnitsPerPx(14 / height),
    }
  }

  let minX = Math.min(...nodes.map((p) => p.x))
  let maxX = Math.max(...nodes.map((p) => p.x))
  let minY = Math.min(...nodes.map((p) => p.y))
  let maxY = Math.max(...nodes.map((p) => p.y))

  const centerX = (minX + maxX) / 2
  const centerY = (minY + maxY) / 2
  const spanX = Math.max(maxX - minX, 8) * 1.45
  const spanY = Math.max(maxY - minY, 6) * 1.55
  const unitsPerPx = clampUnitsPerPx(Math.max(spanX / width, spanY / height, 12 / height))
  return { centerX, centerY, unitsPerPx }
}

export function findNearestUiGraphNode(
  nodes: Array<{ id: string; x: number; y: number }>,
  viewport: UiCcsViewport,
  svgX: number,
  svgY: number,
  maxRadiusPx = UI_GRAPH_HOVER_RADIUS_PX,
  width = UI_CCS_VIEW_WIDTH,
  height = UI_CCS_VIEW_HEIGHT,
): UiGraphHoverNode | null {
  let best: UiGraphHoverNode | null = null
  let bestDist = maxRadiusPx
  for (const node of nodes) {
    const sx = width / 2 + (node.x - viewport.centerX) / viewport.unitsPerPx
    const sy = height / 2 - (node.y - viewport.centerY) / viewport.unitsPerPx
    const dist = Math.hypot(sx - svgX, sy - svgY)
    if (dist <= bestDist) {
      bestDist = dist
      best = { id: node.id, x: node.x, y: node.y, sx, sy, distancePx: dist }
    }
  }
  return best
}

export interface ComputedGraphEdgeGeometry {
  edge: UiGraphEdge
  pathD: string
  arrowTip?: { x: number; y: number; angleDeg: number }
  labelPos: { x: number; y: number }
}

/**
 * 计算屏幕像素空间中的边路径、平行边弧线偏移、自环弧线、箭头精确落点（停在节点圆周上）与边权标签位置。
 */
export function computeGraphEdgeGeometries(
  nodes: Array<{ id: string; x: number; y: number }>,
  edges: UiGraphEdge[],
  directed: boolean,
  viewport: UiCcsViewport,
  nodeRadiusPx = UI_GRAPH_NODE_RADIUS_PX,
  width = UI_CCS_VIEW_WIDTH,
  height = UI_CCS_VIEW_HEIGHT,
): ComputedGraphEdgeGeometry[] {
  const screenById = new Map<string, { sx: number; sy: number }>()
  for (const n of nodes) {
    screenById.set(n.id, {
      sx: width / 2 + (n.x - viewport.centerX) / viewport.unitsPerPx,
      sy: height / 2 - (n.y - viewport.centerY) / viewport.unitsPerPx,
    })
  }

  // 统计无序节点对之间的平行边数量，自动错开弧度防止重叠
  const pairBuckets = new Map<string, number[]>()
  edges.forEach((e, idx) => {
    const key = e.source <= e.target ? `${e.source}\0${e.target}` : `${e.target}\0${e.source}`
    const arr = pairBuckets.get(key)
    if (arr) arr.push(idx)
    else pairBuckets.set(key, [idx])
  })

  const fmt = (n: number) => String(Number(n.toFixed(2)))
  const out: ComputedGraphEdgeGeometry[] = []

  edges.forEach((edge, idx) => {
    const u = screenById.get(edge.source)
    const v = screenById.get(edge.target)
    if (!u || !v) return

    // 自环 u -> u
    if (edge.source === edge.target) {
      const r = nodeRadiusPx
      const x0 = u.sx - r * 0.55
      const y0 = u.sy - r * 0.82
      const x1 = u.sx + r * 0.55
      const y1 = u.sy - r * 0.82
      const cx1 = u.sx - r * 2.1
      const cy1 = u.sy - r * 3.1
      const cx2 = u.sx + r * 2.1
      const cy2 = u.sy - r * 3.1
      const pathD = `M${fmt(x0)} ${fmt(y0)} C${fmt(cx1)} ${fmt(cy1)} ${fmt(cx2)} ${fmt(cy2)} ${fmt(x1)} ${fmt(y1)}`
      const angleDeg = (Math.atan2(y1 - cy2, x1 - cx2) * 180) / Math.PI
      out.push({
        edge,
        pathD,
        arrowTip: directed ? { x: x1, y: y1, angleDeg } : undefined,
        labelPos: { x: u.sx, y: u.sy - r * 2.65 },
      })
      return
    }

    const key = edge.source <= edge.target ? `${edge.source}\0${edge.target}` : `${edge.target}\0${edge.source}`
    const group = pairBuckets.get(key) ?? [idx]
    const slot = group.indexOf(idx)
    const sign = edge.source <= edge.target ? 1 : -1
    const baseOffset = group.length > 1 ? (slot - (group.length - 1) / 2) * 34 * sign : 0

    const dx = v.sx - u.sx
    const dy = v.sy - u.sy
    const dist = Math.max(Math.hypot(dx, dy), 1e-4)
    const ux = dx / dist
    const uy = dy / dist
    const nx = -uy
    const ny = ux

    let ctrlX = (u.sx + v.sx) * 0.5 + nx * baseOffset
    let ctrlY = (u.sy + v.sy) * 0.5 + ny * baseOffset
    if (edge.anchorX !== undefined && edge.anchorY !== undefined) {
      ctrlX = width / 2 + (edge.anchorX - viewport.centerX) / viewport.unitsPerPx
      ctrlY = height / 2 - (edge.anchorY - viewport.centerY) / viewport.unitsPerPx
    }

    const isStraight = Math.abs(baseOffset) < 0.01 && edge.anchorX === undefined
    if (isStraight) {
      const sx0 = u.sx + ux * nodeRadiusPx
      const sy0 = u.sy + uy * nodeRadiusPx
      const sx1 = v.sx - ux * nodeRadiusPx
      const sy1 = v.sy - uy * nodeRadiusPx
      const angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI
      out.push({
        edge,
        pathD: `M${fmt(sx0)} ${fmt(sy0)} L${fmt(sx1)} ${fmt(sy1)}`,
        arrowTip: directed ? { x: sx1, y: sy1, angleDeg } : undefined,
        labelPos: { x: (sx0 + sx1) * 0.5 + nx * 13, y: (sy0 + sy1) * 0.5 + ny * 13 },
      })
    } else {
      const startAngle = Math.atan2(ctrlY - u.sy, ctrlX - u.sx)
      const endAngle = Math.atan2(v.sy - ctrlY, v.sx - ctrlX)
      const sx0 = u.sx + Math.cos(startAngle) * nodeRadiusPx
      const sy0 = u.sy + Math.sin(startAngle) * nodeRadiusPx
      const sx1 = v.sx - Math.cos(endAngle) * nodeRadiusPx
      const sy1 = v.sy - Math.sin(endAngle) * nodeRadiusPx
      const midX = 0.25 * sx0 + 0.5 * ctrlX + 0.25 * sx1
      const midY = 0.25 * sy0 + 0.5 * ctrlY + 0.25 * sy1
      out.push({
        edge,
        pathD: `M${fmt(sx0)} ${fmt(sy0)} Q${fmt(ctrlX)} ${fmt(ctrlY)} ${fmt(sx1)} ${fmt(sy1)}`,
        arrowTip: directed ? { x: sx1, y: sy1, angleDeg: (endAngle * 180) / Math.PI } : undefined,
        labelPos: { x: midX, y: midY - 10 },
      })
    }
  })

  return out
}

/**
 * 将「调整模式」中拖拽后的点坐标（或 `null` 表示重置自动布局）精确写回文章源码的第 `graphIndex` 个 `::begin_ui-graph` 块。
 */
export function updateUiGraphBlockPositions(
  markdown: string,
  graphIndex: number,
  positions: Record<string, { x: number; y: number }> | null,
): string {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n')
  let inFence = false
  let fenceChar = ''
  let fenceLen = 0
  let currentIdx = -1

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    const fenceMatch = line.match(/^\s*(`{3,}|~{3,})/)
    if (fenceMatch) {
      const ch = fenceMatch[1][0]
      const len = fenceMatch[1].length
      if (!inFence) {
        inFence = true
        fenceChar = ch
        fenceLen = len
      } else if (ch === fenceChar && len >= fenceLen) {
        inFence = false
      }
      continue
    }
    if (inFence) continue

    const openMatch = line.match(/^\s*::begin_ui-graph(?=$|\[|\s)([\s\S]*)$/)
    if (!openMatch) continue

    let closeLine = i + 1
    while (closeLine < lines.length && !/^\s*::end_ui-graph\s*$/.test(lines[closeLine])) {
      closeLine += 1
    }
    if (closeLine >= lines.length) break

    currentIdx += 1
    if (currentIdx !== graphIndex) {
      i = closeLine
      continue
    }

    const oldBodyLines = lines.slice(i + 1, closeLine)
    const fmtNum = (n: number) => String(Number(n.toFixed(2)))

    if (positions === null) {
      // 重置自动布局：把 `<id> (x, y)` 还原为孤立点 `<id>`，若该点已在边中出现则移除纯坐标辅助行
      const parsed = parseUiGraph(openMatch[1], oldBodyLines.join('\n'))
      const edgeEndpoints = new Set<string>()
      for (const e of parsed.edges) {
        edgeEndpoints.add(e.source)
        edgeEndpoints.add(e.target)
      }
      const resetBody: string[] = []
      for (const bl of oldBodyLines) {
        const trimmed = bl.trim()
        const expV = parseExplicitVertexLine(trimmed)
        if (expV) {
          if (!edgeEndpoints.has(expV.id)) {
            resetBody.push(expV.id)
          }
          continue
        }
        resetBody.push(bl)
      }
      return [...lines.slice(0, i + 1), ...resetBody, ...lines.slice(closeLine)].join('\n')
    }

    // 保留所有注释与边语句，并按顺序写入每个点的最新坐标 `<id> (<x>, <y>)`
    const parsed = parseUiGraph(openMatch[1], oldBodyLines.join('\n'))
    const writtenIds = new Set<string>()
    const keptLines: string[] = []

    for (const bl of oldBodyLines) {
      const trimmed = bl.replace(/^\s*(?:\/\/|#).*$/, '').trim()
      if (!trimmed) {
        keptLines.push(bl)
        continue
      }
      const expV = parseExplicitVertexLine(trimmed)
      if (expV) {
        const p = positions[expV.id]
        if (p) {
          keptLines.push(`${expV.id} (${fmtNum(p.x)}, ${fmtNum(p.y)})`)
          writtenIds.add(expV.id)
        } else {
          keptLines.push(bl)
        }
        continue
      }
      const tokens = trimmed.split(/\s+/).filter(Boolean)
      if (tokens.length === 1) {
        const id = tokens[0]
        const p = positions[id]
        if (p) {
          keptLines.push(`${id} (${fmtNum(p.x)}, ${fmtNum(p.y)})`)
          writtenIds.add(id)
        } else {
          keptLines.push(bl)
        }
        continue
      }
      // 若旧边行带 4/5 列内联坐标，剥离旧坐标以免覆盖显式顶点坐标
      if (tokens.length === 4 && isFiniteNumToken(tokens[2]) && isFiniteNumToken(tokens[3])) {
        keptLines.push(`${tokens[0]} ${tokens[1]}`)
        continue
      }
      if (tokens.length >= 5 && isFiniteNumToken(tokens[3]) && isFiniteNumToken(tokens[4])) {
        keptLines.push(tokens[2] === '-' ? `${tokens[0]} ${tokens[1]}` : `${tokens[0]} ${tokens[1]} ${tokens[2]}`)
        continue
      }
      keptLines.push(bl)
    }

    const prefixCoordLines: string[] = []
    for (const node of parsed.nodes) {
      if (!writtenIds.has(node.id) && positions[node.id]) {
        const p = positions[node.id]
        prefixCoordLines.push(`${node.id} (${fmtNum(p.x)}, ${fmtNum(p.y)})`)
        writtenIds.add(node.id)
      }
    }

    return [
      ...lines.slice(0, i + 1),
      ...prefixCoordLines,
      ...keptLines,
      ...lines.slice(closeLine),
    ].join('\n')
  }

  return markdown
}

/** 静态 SVG 渲染（用于 VS Code MPE 静态兼容模式）。 */
export function renderStaticUiGraphSvg(headerRest: string, sourceBody: string): string {
  const { directed, nodes, edges } = parseUiGraph(headerRest, sourceBody)
  const width = UI_CCS_VIEW_WIDTH
  const height = UI_CCS_VIEW_HEIGHT
  const viewport = computeInitialUiGraphViewport(nodes, width, height)
  const { major, minor } = chooseGridStep(viewport.unitsPerPx)
  const halfW = (width / 2) * viewport.unitsPerPx
  const halfH = (height / 2) * viewport.unitsPerPx
  const minX = viewport.centerX - halfW
  const maxX = viewport.centerX + halfW
  const minY = viewport.centerY - halfH
  const maxY = viewport.centerY + halfH
  const toSX = (wx: number) => width / 2 + (wx - viewport.centerX) / viewport.unitsPerPx
  const toSY = (wy: number) => height / 2 - (wy - viewport.centerY) / viewport.unitsPerPx
  const fmt = (n: number) => String(Number(n.toFixed(2)))
  const esc = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

  const minorParts: string[] = []
  for (let x = Math.ceil(minX / minor) * minor; x <= maxX; x += minor) minorParts.push(`M${fmt(toSX(x))} 0V${height}`)
  for (let y = Math.ceil(minY / minor) * minor; y <= maxY; y += minor) minorParts.push(`M0 ${fmt(toSY(y))}H${width}`)

  const majorParts: string[] = []
  const ticks: string[] = []
  const axisX = Math.min(width - 26, Math.max(26, toSX(0)))
  const axisY = Math.min(height - 20, Math.max(20, toSY(0)))
  for (let x = Math.ceil(minX / major) * major; x <= maxX; x += major) {
    const sx = toSX(x)
    majorParts.push(`M${fmt(sx)} 0V${height}`)
    if (Math.abs(x) >= major * 1e-4 && sx > 22 && sx < width - 22) {
      ticks.push(
        `<text x="${fmt(sx)}" y="${fmt(Math.min(height - 6, axisY + 15))}" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.5">${formatAxisTick(x, major)}</text>`,
      )
    }
  }
  for (let y = Math.ceil(minY / major) * major; y <= maxY; y += major) {
    const sy = toSY(y)
    majorParts.push(`M0 ${fmt(sy)}H${width}`)
    if (Math.abs(y) >= major * 1e-4 && sy > 16 && sy < height - 16) {
      ticks.push(
        `<text x="${fmt(Math.max(8, axisX - 7))}" y="${fmt(sy + 3.5)}" text-anchor="end" font-size="10" fill="currentColor" opacity="0.5">${formatAxisTick(y, major)}</text>`,
      )
    }
  }

  const geoms = computeGraphEdgeGeometries(nodes, edges, directed, viewport, UI_GRAPH_NODE_RADIUS_PX, width, height)
  const edgeSvg = geoms
    .map((g) => {
      const arrow = g.arrowTip
        ? `<polygon points="0,0 -9,-4.2 -7.2,0 -9,4.2" fill="#4f46e5" transform="translate(${fmt(g.arrowTip.x)},${fmt(g.arrowTip.y)}) rotate(${fmt(g.arrowTip.angleDeg)})" />`
        : ''
      const weight = g.edge.weight
        ? `<text x="${fmt(g.labelPos.x)}" y="${fmt(g.labelPos.y + 3.5)}" text-anchor="middle" font-size="11" font-weight="600" fill="currentColor">${esc(g.edge.weight)}</text>`
        : ''
      return `<path d="${g.pathD}" fill="none" stroke="#4f46e5" stroke-opacity="0.82" stroke-width="2" stroke-linecap="round" />${arrow}${weight}`
    })
    .join('')

  const nodeSvg = nodes
    .map((n) => {
      const sx = toSX(n.x)
      const sy = toSY(n.y)
      return (
        `<circle cx="${fmt(sx)}" cy="${fmt(sy)}" r="${UI_GRAPH_NODE_RADIUS_PX}" fill="#ffffff" stroke="#4f46e5" stroke-width="2" />` +
        `<text x="${fmt(sx)}" y="${fmt(sy + 4)}" text-anchor="middle" font-size="12" font-weight="600" fill="#18181b">${esc(n.id)}</text>`
      )
    })
    .join('')

  return (
    `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${directed ? '有向图' : '无向图'}">` +
    `<path d="${minorParts.join('')}" stroke="currentColor" stroke-opacity="0.06" stroke-width="1" />` +
    `<path d="${majorParts.join('')}" stroke="currentColor" stroke-opacity="0.14" stroke-width="1" />` +
    `<line x1="0" y1="${fmt(axisY)}" x2="${width}" y2="${fmt(axisY)}" stroke="currentColor" stroke-opacity="0.35" stroke-width="1.2" />` +
    `<line x1="${fmt(axisX)}" y1="0" x2="${fmt(axisX)}" y2="${height}" stroke="currentColor" stroke-opacity="0.35" stroke-width="1.2" />` +
    ticks.join('') +
    edgeSvg +
    nodeSvg +
    `</svg>`
  )
}
