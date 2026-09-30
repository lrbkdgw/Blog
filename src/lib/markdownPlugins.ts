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
      for (const row of rows) {
        const cells = (row.children || []).filter(
          (cell) => cell.type === 'element' && (cell.tagName === 'td' || cell.tagName === 'th'),
        )
        const next: Array<AstNode | undefined> = []
        const kept: AstNode[] = []
        let column = 0
        let previous: AstNode | undefined

        for (const cell of cells) {
          const marker = textOf(cell).trim()
          if (marker === '^' && above[column]) {
            const target = above[column]!
            target.properties ||= {}
            target.properties.rowSpan = spanOf(target, 'rowSpan') + 1
            next[column] = target
            column += 1
            continue
          }
          if (marker === '<' && previous) {
            previous.properties ||= {}
            previous.properties.colSpan = spanOf(previous, 'colSpan') + 1
            next[column] = previous
            column += 1
            continue
          }

          kept.push(cell)
          previous = cell
          const width = spanOf(cell, 'colSpan')
          for (let i = 0; i < width; i += 1) next[column + i] = cell
          column += width
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
