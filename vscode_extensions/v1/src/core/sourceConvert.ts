/**
 * 把 Blog 专属语法降级为通用 Markdown，对应 Blog 仓库的 `src/lib/markdownSource.ts`。
 *
 * - `luogu`：只把交互展示框按变量默认值展开（保留折叠框 / Tuack 表格 / 合并单元格）。
 * - `basic`：再把折叠框转成引用、展开合并单元格、移除 Tuack 指令。
 */

import {
  initialShowValues,
  parseShowMappings,
  parseShowVariables,
  renderShowContent,
} from './showBox'
import { CALLOUT_TITLES } from './transform'

export type MarkdownCopyTarget = 'direct' | 'luogu' | 'basic'

function fenceMarker(line: string): string | null {
  const match = line.match(/^\s*(`{3,}|~{3,})/)
  return match ? match[1][0] : null
}

function escapePlainMarkdown(value: string): string {
  return value.replace(/([\\`*_[\]<>])/g, '\\$1')
}

/** 将 Blog 专属展示框按变量默认值转成静态、通用的 Markdown。 */
export function convertShowBoxesToMarkdown(markdown: string): string {
  const lines = markdown.split('\n')
  const output: string[] = []
  let fence: string | null = null

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const marker = fenceMarker(line)
    if (marker) {
      if (!fence) fence = marker
      else if (fence === marker) fence = null
      output.push(line)
      continue
    }
    if (fence) {
      output.push(line)
      continue
    }

    const start = line.match(/^\s*::show_begin\{([^}]*)\}\{([\s\S]*)\}\s*$/i)
    if (!start) {
      output.push(line)
      continue
    }

    const body: string[] = []
    let end = index + 1
    while (end < lines.length && !/^\s*::show_end\s*$/i.test(lines[end])) {
      body.push(lines[end])
      end += 1
    }
    // 没有闭合的指令只是普通正文，不是展示框。
    if (end >= lines.length) {
      output.push(line)
      continue
    }

    const bodySource = body.join('\n')
    const variables = parseShowVariables(start[2], bodySource)
    const mappings = parseShowMappings(bodySource)
    const rendered = renderShowContent(bodySource, initialShowValues(variables), mappings)
    const title = start[1].trim() || '交互展示'

    output.push('**' + escapePlainMarkdown(title) + '**')
    output.push('')
    output.push(rendered)
    output.push('')
    index = end
  }

  return output.join('\n')
}

interface ParsedTableRow {
  cells: string[]
}

function parseTableRow(line: string): ParsedTableRow | null {
  const trimmed = line.trim()
  if (trimmed.indexOf('|') < 0) return null
  const source = trimmed.charAt(0) === '|' ? trimmed.slice(1) : trimmed
  const withoutTrailing =
    source.slice(-1) === '|' && source.slice(-2) !== '\\|' ? source.slice(0, -1) : source
  const cells: string[] = []
  let current = ''
  let escaped = false
  let codeTicks = 0

  for (let index = 0; index < withoutTrailing.length; index += 1) {
    const char = withoutTrailing[index]
    if (escaped) {
      current += char
      escaped = false
      continue
    }
    if (char === '\\') {
      current += char
      escaped = true
      continue
    }
    if (char === '`') {
      let count = 1
      while (withoutTrailing[index + count] === '`') count += 1
      current += new Array(count + 1).join('`')
      index += count - 1
      codeTicks = codeTicks === count ? 0 : codeTicks === 0 ? count : codeTicks
      continue
    }
    if (char === '|' && codeTicks === 0) {
      cells.push(current)
      current = ''
      continue
    }
    current += char
  }
  cells.push(current)
  return { cells }
}

function isAlignmentRow(row: ParsedTableRow | null): boolean {
  return Boolean(row && row.cells.length > 0 && row.cells.every((cell) => /^\s*:?-+:?\s*$/.test(cell)))
}

function serializeTableRow(cells: string[]): string {
  return '| ' + cells.map((cell) => cell.trim()).join(' | ') + ' |'
}

/**
 * 基础 Markdown 没有 rowspan/colspan；把 `^` / `<` 单元格展开为其所引用的内容，
 * 以保留表格信息，同时移除洛谷专属标记。
 */
export function expandMergedTableCells(markdown: string): string {
  const lines = markdown.split('\n')
  const output: string[] = []
  let fence: string | null = null

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const marker = fenceMarker(line)
    if (marker) {
      if (!fence) fence = marker
      else if (fence === marker) fence = null
      output.push(line)
      continue
    }
    if (fence || line.indexOf('|') < 0) {
      output.push(line)
      continue
    }

    let end = index
    const group: string[] = []
    while (end < lines.length && lines[end].trim() && lines[end].indexOf('|') >= 0) {
      group.push(lines[end])
      end += 1
    }
    const parsed = group.map(parseTableRow)
    if (group.length < 2 || !parsed[0] || !isAlignmentRow(parsed[1])) {
      output.push(line)
      continue
    }

    const resolved: string[][] = []
    for (let rowIndex = 0; rowIndex < parsed.length; rowIndex += 1) {
      const row = parsed[rowIndex]
      if (!row) continue
      const cells = row.cells.slice()
      if (rowIndex > 1) {
        for (let column = 0; column < cells.length; column += 1) {
          const token = cells[column].trim()
          if (token === '<') cells[column] = cells[column - 1] === undefined ? '' : cells[column - 1]
          if (token === '^') {
            const above = resolved[rowIndex - 1]
            cells[column] = above && above[column] !== undefined ? above[column] : ''
          }
        }
      }
      resolved[rowIndex] = cells
      output.push(serializeTableRow(cells))
    }
    index = end - 1
  }

  return output.join('\n')
}

function quotePrefix(depth: number): string {
  return depth > 0 ? new Array(depth + 1).join('> ') : ''
}

/** 把折叠框转成普通引用，并移除 Tuack 样式指令。 */
export function convertLuoguExtensionsToMarkdown(markdown: string): string {
  const lines = markdown.split('\n')
  const output: string[] = []
  const callouts: number[] = []
  let fence: string | null = null

  for (const line of lines) {
    const marker = fenceMarker(line)
    if (marker) {
      if (!fence) fence = marker
      else if (fence === marker) fence = null
      output.push(quotePrefix(callouts.length) + line)
      continue
    }
    if (fence) {
      output.push(quotePrefix(callouts.length) + line)
      continue
    }

    if (/^\s*:{2,}cute-table\s*\{[^}]+\}\s*$/i.test(line)) continue

    const close = line.match(/^\s*(:{3,})\s*$/)
    if (close && callouts.length > 0 && close[1].length >= callouts[callouts.length - 1]) {
      callouts.pop()
      output.push(quotePrefix(callouts.length).replace(/\s+$/, ''))
      continue
    }

    const open = line.match(
      /^\s*(:{3,})(info|success|warning|error|note|tip|danger)(?:\[([\s\S]*?)\])?(?:\{open\})?\s*$/i,
    )
    if (open) {
      callouts.push(open[1].length)
      const type = open[2].toLowerCase()
      const title = open[3] === undefined || open[3] === '' ? CALLOUT_TITLES[type] : open[3]
      output.push(quotePrefix(callouts.length) + '**' + title + '**')
      output.push(quotePrefix(callouts.length).replace(/\s+$/, ''))
      continue
    }

    output.push((quotePrefix(callouts.length) + line).replace(/\s+$/, ''))
  }

  return output.join('\n')
}

/** direct：原样源码；luogu：只移除 Blog 展示框语法；basic：再移除洛谷扩展。 */
export function convertMarkdownForCopy(markdown: string, target: MarkdownCopyTarget): string {
  if (target === 'direct') return markdown
  const withoutBlogExtensions = convertShowBoxesToMarkdown(markdown)
  if (target === 'luogu') return withoutBlogExtensions
  return convertLuoguExtensionsToMarkdown(expandMergedTableCells(withoutBlogExtensions))
}
