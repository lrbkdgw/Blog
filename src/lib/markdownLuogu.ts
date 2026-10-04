/**
 * 【新增 Markdown 语法】洛谷风格扩展（issue #11 / #19 / #20）：
 *
 * 1. 折叠框（remarkFold，搭配 remark-directive 解析容器指令）
 *    ::::info[标题]{open}
 *    正文（支持完整 Markdown，标题支持行内公式）
 *    ::::
 *    类型：info / success / warning / error（另支持别名 fold、details）。
 *
 * 2. 表格合并（rehypeTableSpan）
 *    单元格内仅含 `^`  → 与正上方同列单元格纵向合并
 *    单元格内仅含 `<`  → 与左侧同行单元格横向合并
 *    发生合并的表会被加上 `md-table-merged` class（方边全网格、无交替行色）。
 *
 * 3. Tuack 风格表格（remarkCuteTable）
 *    ::cute-table{tuack}
 *
 *    | 表头 | … |
 *    紧随其后的表格会被加上 `md-tuack` class，渲染为方边全网格的评测风格表格。
 */
import remarkDirective from 'remark-directive'
import type { Paragraph, PhrasingContent, Root } from 'mdast'
import type { Element, ElementContent } from 'hast'

/* -------------------------------------------------------------------------- */
/*                                   折叠框                                    */
/* -------------------------------------------------------------------------- */

export { remarkDirective }

type AnyNode = {
  type: string
  name?: string
  attributes?: Record<string, string>
  data?: Record<string, unknown>
  children?: AnyNode[]
}

const FOLD_TYPES = new Set(['info', 'success', 'warning', 'error', 'fold', 'details'])

const DEFAULT_TITLES: Record<string, string> = {
  info: '信息',
  success: '完成',
  warning: '注意',
  error: '错误',
  fold: '折叠内容',
  details: '折叠内容',
}

function mapFoldDirectives(parent: AnyNode) {
  if (!Array.isArray(parent.children)) return
  for (const child of parent.children) {
    if (child.type === 'containerDirective' && FOLD_TYPES.has(String(child.name ?? ''))) {
      const styleName = child.name === 'fold' || child.name === 'details' ? 'info' : String(child.name)
      const open = child.attributes ? Object.prototype.hasOwnProperty.call(child.attributes, 'open') : false

      // 标题：directive label（第一段且带 directiveLabel 标记），语法同 Luogu 的 [标题]
      let summaryChildren: PhrasingContent[] = []
      const body = (child.children ?? []) as unknown as Paragraph[]
      if (body.length > 0 && body[0].data && (body[0].data as { directiveLabel?: boolean }).directiveLabel) {
        summaryChildren = body.shift()!.children ?? []
      }
      if (!summaryChildren || summaryChildren.length === 0) {
        summaryChildren = [{ type: 'text', value: DEFAULT_TITLES[styleName] ?? '折叠内容' }]
      }

      child.data = {
        ...child.data,
        hName: 'details',
        hProperties: {
          className: ['md-fold', `md-fold-${styleName}`],
          ...(open ? { open: true } : {}),
        },
      }
      child.children = child.children ?? []
      child.children.unshift({
        type: 'paragraph',
        data: { hName: 'summary', hProperties: { className: ['md-fold-summary'] } },
        children: summaryChildren,
      } as unknown as AnyNode)
    }
    mapFoldDirectives(child)
  }
}

/** remark 插件：把 ::: 折叠指令映射为 details/summary 元素 */
export function remarkFold() {
  return (tree: Root) => {
    mapFoldDirectives(tree as unknown as AnyNode)
  }
}

/* -------------------------------------------------------------------------- */
/*                                  表格合并                                   */
/* -------------------------------------------------------------------------- */

function cellText(el: Element): string {
  let text = ''
  const visit = (node: ElementContent | Element) => {
    if (node.type === 'text') text += (node as { value: string }).value
    if ('children' in node && Array.isArray(node.children)) node.children.forEach(visit)
  }
  el.children.forEach(visit)
  return text.trim()
}

function tableRows(table: Element): Element[] {
  const rows: Element[] = []
  for (const child of table.children) {
    if (child.type !== 'element') continue
    if (child.tagName === 'tr') rows.push(child)
    else if (child.tagName === 'thead' || child.tagName === 'tbody' || child.tagName === 'tfoot') {
      for (const row of child.children) {
        if (row.type === 'element' && row.tagName === 'tr') rows.push(row)
      }
    }
  }
  return rows
}

interface SpanMeta {
  row: number
  col: number
  rowSpan: number
  colSpan: number
}

/** 处理单个 <table>：把 ^ / < 标记单元格合并进目标单元格（rowspan / colspan） */
function processTable(table: Element) {
  const rows = tableRows(table)
  // covered["r,c"] = 占据该网格位置的单元格元素
  const covered = new Map<string, Element>()
  const meta = new Map<Element, SpanMeta>()
  const emptyRows: Element[] = []
  let merged = false

  rows.forEach((row, r) => {
    const cells = row.children.filter(
      (c): c is Element => c.type === 'element' && (c.tagName === 'td' || c.tagName === 'th'),
    )
    let col = 0
    const keep: ElementContent[] = []

    for (const cell of cells) {
      while (covered.has(`${r},${col}`)) col++
      const marker = cellText(cell)

      if (marker === '^') {
        // 向上合并：目标是上一行同一网格列的单元格
        const owner = covered.get(`${r - 1},${col}`)
        if (owner) {
          const m = meta.get(owner)!
          m.rowSpan += 1
          owner.properties = { ...owner.properties, rowSpan: m.rowSpan }
          for (let cc = 0; cc < m.colSpan; cc++) covered.set(`${r},${m.col + cc}`, owner)
          col += 1
          merged = true
          continue
        }
      } else if (marker === '<') {
        // 向上合并不了的 ^ 与无法左合并的 < 保留原文；目标是同行左侧可见单元格
        const owner = col > 0 ? covered.get(`${r},${col - 1}`) : undefined
        if (owner) {
          const m = meta.get(owner)!
          m.colSpan += 1
          owner.properties = { ...owner.properties, colSpan: m.colSpan }
          for (let rr = 0; rr < m.rowSpan; rr++) covered.set(`${m.row + rr},${col}`, owner)
          col += 1
          merged = true
          continue
        }
      }

      // 普通单元格（或无法合并的降级标记）
      if (!meta.has(cell)) meta.set(cell, { row: r, col, rowSpan: 1, colSpan: 1 })
      const m = meta.get(cell)!
      m.row = r
      m.col = col
      for (let rr = 0; rr < m.rowSpan; rr++) {
        for (let cc = 0; cc < m.colSpan; cc++) covered.set(`${r + rr},${col + cc}`, cell)
      }
      keep.push(cell)
      col += m.colSpan
    }

    // 移除被完全合并的空行；其余行剔除被合并掉的单元格（保留空白文本节点）
    if (keep.length === 0 && cells.length > 0) {
      emptyRows.push(row)
    } else {
      const removed = new Set(cells.filter((c) => !keep.includes(c)))
      row.children = row.children.filter((c) => !removed.has(c as Element))
    }
  })

  for (const row of emptyRows) {
    for (const child of table.children) {
      if (child.type !== 'element') continue
      if (child === row) {
        table.children.splice(table.children.indexOf(row), 1)
        break
      }
      if (child.tagName === 'thead' || child.tagName === 'tbody' || child.tagName === 'tfoot') {
        const idx = child.children.indexOf(row)
        if (idx !== -1) {
          child.children.splice(idx, 1)
          break
        }
      }
    }
  }

  // issue #19：发生合并的表改用「方边全网格、无交替行色」的专属样式，避免
  // 斑马纹/圆角在跨行跨列单元格上产生错位感。
  if (merged) {
    const prev = table.properties?.className
    const classes = Array.isArray(prev) ? prev.map(String) : typeof prev === 'string' ? [prev] : []
    if (!classes.includes('md-table-merged')) classes.push('md-table-merged')
    table.properties = { ...table.properties, className: classes }
  }
}

/** rehype 插件：扫描所有表格应用 ^ / < 合并规则 */
export function rehypeTableSpan() {
  return (tree: unknown) => {
    const visit = (node: unknown) => {
      if (!node || typeof node !== 'object') return
      const n = node as { type?: string; tagName?: string; children?: unknown[] }
      if (n.type === 'element' && n.tagName === 'table') processTable(n as unknown as Element)
      if (Array.isArray(n.children)) n.children.forEach(visit)
    }
    visit(tree)
  }
}

/* -------------------------------------------------------------------------- */
/*                               Tuack 风格表格                                */
/* -------------------------------------------------------------------------- */

/**
 * remark 插件（issue #20）：`::cute-table{tuack}` 让紧随其后的第一张表格
 * 渲染为 Tuack 风格（方边全网格）。无 tuack 属性或后面没有表格时原样保留。
 */
export function remarkCuteTable() {
  return (tree: Root) => {
    const visit = (node: AnyNode) => {
      if (!Array.isArray(node.children)) return
      for (let i = 0; i < node.children.length; i++) {
        const child = node.children[i]
        if (
          child.type === 'leafDirective' &&
          child.name === 'cute-table' &&
          child.attributes &&
          Object.prototype.hasOwnProperty.call(child.attributes, 'tuack')
        ) {
          // 向后找同级的第一张表格
          const table = node.children.slice(i + 1).find((c) => c.type === 'table') as
            | (AnyNode & { data?: Record<string, unknown> })
            | undefined
          if (table) {
            const hProps = ((table.data as { hProperties?: { className?: unknown[] } })?.hProperties ?? {}) as {
              className?: unknown[]
              [key: string]: unknown
            }
            const classes = Array.isArray(hProps.className) ? hProps.className.map(String) : []
            if (!classes.includes('md-tuack')) classes.push('md-tuack')
            hProps.className = classes
            table.data = { ...(table.data ?? {}), hProperties: hProps }
            node.children.splice(i, 1)
            i--
            continue
          }
        }
        visit(child)
      }
    }
    visit(tree as unknown as AnyNode)
  }
}
