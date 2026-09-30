type AstNode = {
  type?: string
  /** mdast directive name */
  name?: string
  /** hast element tag */
  tagName?: string
  value?: string
  children?: AstNode[]
  attributes?: Record<string, string | null>
  data?: Record<string, unknown> & { hName?: string; hProperties?: Record<string, unknown>; directiveLabel?: boolean }
  properties?: Record<string, unknown>
}

function walk(node: AstNode, visitor: (node: AstNode) => void) {
  visitor(node)
  node.children?.forEach((child) => walk(child, visitor))
}

/** 将 :::info[标题]{open} 等容器指令转换为可访问的 details/summary。 */
export function remarkCallfold() {
  return (tree: AstNode) => {
    walk(tree, (node) => {
      if (node.type !== 'containerDirective' || !['info', 'success', 'warning', 'error'].includes(node.name || '')) return

      node.data ||= {}
      node.data.hName = 'details'
      node.data.hProperties = {
        className: `markdown-callfold markdown-callfold-${node.name}`,
        ...(Object.prototype.hasOwnProperty.call(node.attributes || {}, 'open') ? { open: true } : {}),
      }

      const label = node.children?.find((child) => child.data?.directiveLabel)
      if (label) {
        label.data ||= {}
        label.data.hName = 'summary'
        label.data.hProperties = { className: 'markdown-callfold-title' }
      } else {
        node.children ||= []
        node.children.unshift({
          type: 'paragraph',
          data: { hName: 'summary', hProperties: { className: 'markdown-callfold-title' } },
          children: [{ type: 'text', value: node.name === 'info' ? '提示' : node.name === 'success' ? '成功' : node.name === 'warning' ? '警告' : '错误' }],
        })
      }
    })
  }
}

function textOf(node: AstNode): string {
  if (node.type === 'text') return node.value || ''
  return node.children?.map(textOf).join('') || ''
}

function spanOf(cell: AstNode, key: 'rowSpan' | 'colSpan'): number {
  const value = Number(cell.properties?.[key] || 1)
  return Number.isFinite(value) && value > 0 ? value : 1
}

function addClass(cell: AstNode, className: string) {
  cell.properties ||= {}
  const current = cell.properties.className
  const classes = Array.isArray(current) ? current.map(String) : typeof current === 'string' ? current.split(/\s+/) : []
  if (!classes.includes(className)) classes.push(className)
  cell.properties.className = classes
}

/** 支持表格单元格中的 ^（向上合并）与 <（向左合并）。 */
export function rehypeTableSpan() {
  return (tree: AstNode) => {
    walk(tree, (table) => {
      if (table.type !== 'element' || table.tagName !== 'table') return
      const rows: AstNode[] = []
      walk(table, (node) => {
        if (node !== table && node.type === 'element' && node.tagName === 'tr') rows.push(node)
      })

      let above: Array<AstNode | undefined> = []
      for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
        const row = rows[rowIndex]
        const cells = (row.children || []).filter(
          (cell) => cell.type === 'element' && (cell.tagName === 'td' || cell.tagName === 'th'),
        )
        const next: Array<AstNode | undefined> = []
        const kept: AstNode[] = []
        // 同一个横向合并单元格可能在下一行对应多个 ^。rowSpan 每行只能增加一次，
        // 否则一个 colspan=3 的单元格会被错误地一次扩展三行。
        const extendedVertically = new Set<AstNode>()
        let column = 0
        let previous: AstNode | undefined

        for (let cellIndex = 0; cellIndex < cells.length; cellIndex += 1) {
          const cell = cells[cellIndex]
          const isRightEdge = cellIndex === cells.length - 1
          const marker = textOf(cell).trim()
          if (marker === '^' && above[column]) {
            const target = above[column]!
            target.properties ||= {}
            if (!extendedVertically.has(target)) {
              target.properties.rowSpan = spanOf(target, 'rowSpan') + 1
              addClass(target, 'table-cell-rowspan')
              extendedVertically.add(target)
            }
            if (isRightEdge) addClass(target, 'table-cell-edge-right')
            next[column] = target
            previous = target
            column += 1
            continue
          }
          if (marker === '<' && previous) {
            previous.properties ||= {}
            previous.properties.colSpan = spanOf(previous, 'colSpan') + 1
            addClass(previous, 'table-cell-colspan')
            if (isRightEdge) addClass(previous, 'table-cell-edge-right')
            next[column] = previous
            column += 1
            continue
          }

          kept.push(cell)
          previous = cell
          const width = spanOf(cell, 'colSpan')
          if (isRightEdge) addClass(cell, 'table-cell-edge-right')
          for (let i = 0; i < width; i += 1) next[column + i] = cell
          column += width
        }

        if (rowIndex === rows.length - 1) {
          for (const cell of new Set(next.filter((item): item is AstNode => !!item))) {
            addClass(cell, 'table-cell-edge-bottom')
          }
        }

        // 保留行内的空白文本节点，只替换实际单元格。
        let index = 0
        row.children = (row.children || []).filter((child) => {
          if (!(child.type === 'element' && (child.tagName === 'td' || child.tagName === 'th'))) return true
          return kept.includes(cells[index++])
        })
        above = next
      }
    })
  }
}
