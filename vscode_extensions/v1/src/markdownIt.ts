/**
 * VS Code 内置 Markdown 预览使用的 markdown-it 插件。
 *
 * 1. 在 normalize 之前把 Blog 的特殊语法转成「Markdown + HTML」；
 * 2. 在 inline 解析之后，把表格里的 `^` / `<` 合并标记变成 rowspan / colspan。
 */

import { transformMarkdown } from './core/transform'

type AnyToken = {
  type: string
  tag: string
  content: string
  hidden: boolean
  attrSet(name: string, value: string): void
  attrGet(name: string): string | null
}

interface MarkdownIt {
  set(options: Record<string, unknown>): MarkdownIt
  core: { ruler: { before(name: string, id: string, fn: (state: any) => void): void; push(id: string, fn: (state: any) => void): void } }
}

interface Cell {
  open: number
  inline: number
  close: number
  text: string
  row: number
  col: number
  rowspan: number
  colspan: number
  hidden: boolean
  parent: Cell | null
}

/** 把 `<`（向左合并）与 `^`（向上合并）标记转成 colspan / rowspan。 */
function mergeTableCells(state: { tokens: AnyToken[] }): void {
  const tokens = state.tokens
  const removed: boolean[] = []

  for (let index = 0; index < tokens.length; index += 1) {
    if (tokens[index].type !== 'tbody_open') continue
    const bodyStart = index
    let bodyEnd = index
    let depth = 0
    for (let scan = index; scan < tokens.length; scan += 1) {
      if (tokens[scan].type === 'tbody_open') depth += 1
      if (tokens[scan].type === 'tbody_close') {
        depth -= 1
        if (depth === 0) {
          bodyEnd = scan
          break
        }
      }
    }

    const rows: Cell[][] = []
    let current: Cell[] | null = null
    for (let scan = bodyStart + 1; scan < bodyEnd; scan += 1) {
      const token = tokens[scan]
      if (token.type === 'tr_open') {
        current = []
        rows.push(current)
        continue
      }
      if (token.type === 'td_open' && current) {
        const inline = scan + 1 < bodyEnd && tokens[scan + 1].type === 'inline' ? scan + 1 : -1
        let close = scan + 1
        while (close < bodyEnd && tokens[close].type !== 'td_close') close += 1
        current.push({
          open: scan,
          inline,
          close,
          text: inline >= 0 ? tokens[inline].content.trim() : '',
          row: rows.length - 1,
          col: current.length,
          rowspan: 1,
          colspan: 1,
          hidden: false,
          parent: null,
        })
      }
    }

    if (rows.length) {
      const width = Math.max.apply(null, rows.map((row) => row.length))
      const root = (row: number, col: number): Cell | null => {
        let cell = rows[row] && rows[row][col] ? rows[row][col] : null
        while (cell && cell.parent) cell = cell.parent
        return cell
      }
      for (let r = 0; r < rows.length; r += 1) {
        for (let c = 0; c < width; c += 1) {
          const cell = rows[r] && rows[r][c]
          if (!cell) continue
          if (cell.text === '<' && c > 0) {
            const target = root(r, c - 1)
            if (target) {
              if (target.row === r) target.colspan += 1
              cell.hidden = true
              cell.parent = target
            }
          } else if (cell.text === '^' && r > 0) {
            const target = root(r - 1, c)
            if (target) {
              if (target.col === c) target.rowspan += 1
              cell.hidden = true
              cell.parent = target
            }
          }
        }
      }
      for (const row of rows) {
        for (const cell of row) {
          if (cell.hidden) {
            for (let scan = cell.open; scan <= cell.close; scan += 1) removed[scan] = true
            continue
          }
          if (cell.rowspan > 1) tokens[cell.open].attrSet('rowspan', String(cell.rowspan))
          if (cell.colspan > 1) tokens[cell.open].attrSet('colspan', String(cell.colspan))
        }
      }
    }

    index = bodyEnd
  }

  if (removed.length) {
    state.tokens = tokens.filter((_token, position) => !removed[position])
  }
}

export function extendMarkdownIt(md: MarkdownIt): MarkdownIt {
  md.set({ html: true })

  md.core.ruler.before('normalize', 'starlog_preprocess', (state: { src: string }) => {
    state.src = transformMarkdown(state.src, { interactive: true })
  })

  md.core.ruler.push('starlog_table_merge', (state: any) => {
    mergeTableCells(state)
  })

  return md
}
