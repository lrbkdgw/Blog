import { stripArticleDirectives } from './articleDirectives'
import {
  initialShowValues,
  parseShowMappings,
  parseShowVariables,
  renderShowContent,
} from './showBox'
import { formatCoordinateValue, parseUiCcs } from './uiCcs'
import { parseUiChoiceConfig, type UiWidgetKind } from './uiChoices'
import { parseUiWriteConfig, parseUiWriteToken } from './uiWrite'
import { parseUiGraph } from './uiGraph'

export type MarkdownCopyTarget = 'direct' | 'luogu' | 'basic'

function fenceMarker(line: string): string | null {
  const match = line.match(/^\s*(`{3,}|~{3,})/)
  return match ? match[1][0] : null
}

function findMarkdownBlockEnd(
  lines: string[],
  start: number,
  isEnd: (line: string) => boolean,
): number {
  let fence: { marker: string; length: number } | null = null
  for (let index = start; index < lines.length; index += 1) {
    const marker = lines[index].match(/^\s*(`{3,}|~{3,})/)
    if (marker) {
      if (!fence) fence = { marker: marker[1][0], length: marker[1].length }
      else if (fence.marker === marker[1][0] && marker[1].length >= fence.length) fence = null
      continue
    }
    if (!fence && isEnd(lines[index])) return index
  }
  return -1
}

function findConditionalBlockEnd(lines: string[], start: number): number {
  let depth = 1
  return findMarkdownBlockEnd(lines, start, (line) => {
    if (/^\s*::IF\[[\s\S]*\]\s*$/i.test(line)) {
      depth += 1
      return false
    }
    if (/^\s*::IF_END\s*$/i.test(line)) {
      depth -= 1
      return depth === 0
    }
    return false
  })
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

    // Capture to the final brace so definitions containing {faster_set} work.
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
    // An incomplete directive is source text, not a display box.
    if (end >= lines.length) {
      output.push(line)
      continue
    }

    const bodySource = body.join('\n')
    const variables = parseShowVariables(start[2], bodySource)
    const mappings = parseShowMappings(bodySource)
    const rendered = renderShowContent(bodySource, initialShowValues(variables), mappings)
    const title = start[1].trim() || '交互展示'

    output.push(`**${escapePlainMarkdown(title)}**`)
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
  if (!trimmed.includes('|')) return null
  const source = trimmed.startsWith('|') ? trimmed.slice(1) : trimmed
  const withoutTrailing = source.endsWith('|') && !source.endsWith('\\|') ? source.slice(0, -1) : source
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
      const ticks = '`'.repeat(count)
      current += ticks
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
  return Boolean(
    row &&
      row.cells.length > 0 &&
      row.cells.every((cell) => /^\s*:?-+:?\s*$/.test(cell)),
  )
}

function serializeTableRow(cells: string[]): string {
  return `| ${cells.map((cell) => cell.trim()).join(' | ')} |`
}

/**
 * 基础 Markdown 没有 rowspan/colspan；把 `^` / `<` 单元格展开为其所引用的
 * 内容，以保留表格信息，同时移除洛谷专属标记。
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
    if (fence || !line.includes('|')) {
      output.push(line)
      continue
    }

    let end = index
    const group: string[] = []
    while (end < lines.length && lines[end].trim() && lines[end].includes('|')) {
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
      const row = parsed[rowIndex]!
      if (!row) continue
      const cells = [...row.cells]
      if (rowIndex > 1) {
        for (let column = 0; column < cells.length; column += 1) {
          const token = cells[column].trim()
          if (token === '<') cells[column] = cells[column - 1] ?? ''
          if (token === '^') cells[column] = resolved[rowIndex - 1]?.[column] ?? ''
        }
      }
      resolved[rowIndex] = cells
      output.push(serializeTableRow(cells))
    }
    index = end - 1
  }

  return output.join('\n')
}

const CALLOUT_TITLES: Record<string, string> = {
  info: '信息提示',
  note: '注记',
  tip: '提示',
  success: '成功',
  warning: '警告',
  error: '错误',
  danger: '危险',
}

function quotePrefix(depth: number): string {
  return depth > 0 ? `${'> '.repeat(depth)}` : ''
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
      output.push(`${quotePrefix(callouts.length)}${line}`)
      continue
    }
    if (fence) {
      output.push(`${quotePrefix(callouts.length)}${line}`)
      continue
    }

    if (/^\s*:{2,}cute-table\s*\{[^}]+\}\s*$/i.test(line)) {
      continue
    }

    const close = line.match(/^\s*(:{3,})\s*$/)
    if (close && callouts.length > 0 && close[1].length >= callouts[callouts.length - 1]) {
      callouts.pop()
      output.push(quotePrefix(callouts.length).trimEnd())
      continue
    }

    const open = line.match(
      /^\s*(:{3,})(info|success|warning|error|note|tip|danger)(?:\[([\s\S]*?)\])?(?:\{open\})?\s*$/i,
    )
    if (open) {
      callouts.push(open[1].length)
      const type = open[2].toLowerCase()
      const title = open[3] === undefined || open[3] === '' ? CALLOUT_TITLES[type] : open[3]
      output.push(`${quotePrefix(callouts.length)}**${title}**`)
      output.push(quotePrefix(callouts.length).trimEnd())
      continue
    }

    output.push(`${quotePrefix(callouts.length)}${line}`.trimEnd())
  }

  return output.join('\n')
}

/** 将 `::begin_ui-ccs ... ::end_ui-ccs` 降级为不依赖交互 SVG 的标准 Markdown 描述块。 */
export function convertUiCcsToMarkdown(markdown: string): string {
  const lines = markdown.split('\n')
  const output: string[] = []
  let fence: string | null = null

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
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

    const match = line.match(/^\s*::begin_ui-ccs(?:\{([^}]*)\})?\s*$/i)
    if (match) {
      const body: string[] = []
      let end = i + 1
      while (end < lines.length && !/^\s*::end_ui-ccs\s*$/i.test(lines[end])) {
        body.push(lines[end])
        end += 1
      }
      if (end < lines.length) {
        const title = (match[1] ?? '').trim() || '直角坐标系'
        const { items } = parseUiCcs(body.join('\n'))
        output.push(`> **${title}**`)
        for (const item of items) {
          if (item.kind === 'point') {
            output.push(`> - 点：$(${formatCoordinateValue(item.x)}, ${formatCoordinateValue(item.y)})$`)
          } else if (item.kind === 'polyline') {
            const pts = item.points
              .map((p) => `(${formatCoordinateValue(p.x)}, ${formatCoordinateValue(p.y)})`)
              .join(' \\to ')
            output.push(`> - 折线：$${pts}$${item.color ? `（\`${item.color}\`）` : ''}`)
          } else {
            output.push(`> - 函数：$y = ${item.expression}$${item.color ? `（\`${item.color}\`）` : ''}`)
          }
        }
        i = end
        continue
      }
    }

    output.push(line)
  }

  return output.join('\n')
}

/** Render custom graph blocks as a readable, static list for Markdown copy targets. */
export function convertUiGraphToMarkdown(markdown: string): string {
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

    const start = line.match(/^\s*::begin_ui-graph(?:\[([^\]]*)\])?\s*$/i)
    if (!start) {
      output.push(line)
      continue
    }
    const end = findMarkdownBlockEnd(lines, index + 1, (candidate) => /^\s*::end_ui-graph\s*$/i.test(candidate))
    const body = end >= 0 ? lines.slice(index + 1, end) : []
    if (end < 0) {
      output.push(line)
      continue
    }

    const graph = parseUiGraph(body.join('\n'), start[1] ?? '')
    output.push('**图**')
    if (graph.nodes.length) output.push(`- 节点：${graph.nodes.map((node) => `\`${node.id}\``).join('、')}`)
    for (const edge of graph.edges) {
      const arrow = graph.directed ? ' → ' : ' — '
      output.push(`- ${edge.from}${arrow}${edge.to}${edge.weight === undefined ? '' : `（权重 ${edge.weight}）`}`)
    }
    for (const error of graph.errors) output.push(`- 解析提示：${error}`)
    if (graph.nodes.length === 0 && graph.edges.length === 0) output.push('- （空图）')
    output.push('')
    index = end
  }
  return output.join('\n')
}

function convertInlineUiWrites(line: string): string {
  let output = ''
  for (let index = 0; index < line.length;) {
    if (line[index] === '`') {
      let count = 1
      while (line[index + count] === '`') count += 1
      const marker = '`'.repeat(count)
      const end = line.indexOf(marker, index + count)
      if (end < 0) {
        output += line.slice(index)
        break
      }
      output += line.slice(index, end + count)
      index = end + count
      continue
    }
    if (line[index] === '$' && line[index - 1] !== '\\') {
      const marker = line[index + 1] === '$' ? '$$' : '$'
      const end = line.indexOf(marker, index + marker.length)
      if (end < 0) {
        output += line.slice(index)
        break
      }
      output += line.slice(index, end + marker.length)
      index = end + marker.length
      continue
    }
    const token = parseUiWriteToken(line, index)
    if (token) {
      const config = parseUiWriteConfig(token.id, token.options)
      const placeholder = config.name ? `**${config.name}**：________` : '________'
      output += config.newLine ? `\n\n${placeholder}\n\n` : placeholder
      index = token.end
      continue
    }
    output += line[index]
    index += 1
  }
  return output
}

function inlineUiReference(source: string, index: number): string | null {
  const remainder = source.slice(index)
  const double = remainder.match(/^<<[\p{L}\p{N}_.-]+>>/u)
  if (double) return double[0]
  const single = remainder.match(/^<[\p{L}_][\p{L}\p{N}_.-]*>/u)
  return single?.[0] ?? null
}

function findInlineConditionComma(source: string, start: number): number {
  let inMath = false
  let round = 0
  let square = 0
  let curly = 0
  for (let index = start; index < source.length; index += 1) {
    const char = source[index]
    if (char === '$' && source[index - 1] !== '\\') {
      inMath = !inMath
      continue
    }
    const reference = inlineUiReference(source, index)
    if (reference) {
      index += reference.length - 1
      continue
    }
    if (inMath) continue
    if (char === '(') round += 1
    else if (char === ')') round = Math.max(0, round - 1)
    else if (char === '[') square += 1
    else if (char === ']') square = Math.max(0, square - 1)
    else if (char === '{') curly += 1
    else if (char === '}') curly = Math.max(0, curly - 1)
    else if (char === ',' && round === 0 && square === 0 && curly === 0) return index
  }
  return -1
}

function findInlineConditionEnd(source: string, start: number): number {
  let inMath = false
  for (let index = start; index < source.length; index += 1) {
    if (source[index] === '`') {
      let count = 1
      while (source[index + count] === '`') count += 1
      const marker = '`'.repeat(count)
      const close = source.indexOf(marker, index + count)
      if (close < 0) return -1
      index = close + count - 1
      continue
    }
    const char = source[index]
    if (char === '$' && source[index - 1] !== '\\') {
      inMath = !inMath
      continue
    }
    const reference = inlineUiReference(source, index)
    if (reference) {
      index += reference.length - 1
      continue
    }
    if (char === '<') {
      const tag = source.slice(index).match(/^<\/?[A-Za-z][^>]*>/)
      if (tag) {
        index += tag[0].length - 1
        continue
      }
    }
    if (char === '>' && !inMath) return index
  }
  return -1
}

export function stripInlineUiConditionContent(line: string): string {
  let output = ''
  for (let index = 0; index < line.length;) {
    if (line[index] === '`') {
      let count = 1
      while (line[index + count] === '`') count += 1
      const marker = '`'.repeat(count)
      const end = line.indexOf(marker, index + count)
      if (end < 0) {
        output += line.slice(index)
        break
      }
      output += line.slice(index, end + count)
      index = end + count
      continue
    }
    if (line.slice(index, index + 4).toLowerCase() === '<if:') {
      const comma = findInlineConditionComma(line, index + 4)
      const end = comma >= 0 ? findInlineConditionEnd(line, comma + 1) : -1
      if (comma >= 0 && end >= 0) {
        output += ' '
        index = end + 1
        continue
      }
    }
    output += line[index]
    index += 1
  }
  return output
}

function convertInlineUiConditions(line: string): string {
  let output = ''
  for (let index = 0; index < line.length;) {
    if (line[index] === '`') {
      let count = 1
      while (line[index + count] === '`') count += 1
      const marker = '`'.repeat(count)
      const end = line.indexOf(marker, index + count)
      if (end < 0) {
        output += line.slice(index)
        break
      }
      output += line.slice(index, end + count)
      index = end + count
      continue
    }
    if (line.slice(index, index + 4).toLowerCase() === '<if:') {
      const comma = findInlineConditionComma(line, index + 4)
      const end = comma >= 0 ? findInlineConditionEnd(line, comma + 1) : -1
      if (comma >= 0 && end >= 0) {
        const expression = line.slice(index + 4, comma).trim()
        const body = line.slice(comma + 1, end).trim()
        output += `（当 ${expression} 成立时：${body}）`
        index = end + 1
        continue
      }
    }
    output += line[index]
    index += 1
  }
  return output
}

function convertInlineUiReferences(line: string): string {
  let output = ''
  for (let index = 0; index < line.length;) {
    if (line[index] === '`') {
      let count = 1
      while (line[index + count] === '`') count += 1
      const marker = '`'.repeat(count)
      const end = line.indexOf(marker, index + count)
      if (end < 0) {
        output += line.slice(index)
        break
      }
      output += line.slice(index, end + count)
      index = end + count
      continue
    }
    const reference = line.slice(index).match(/^<<([\p{L}\p{N}_.-]+)>>/u)
    if (reference) {
      output += `【${reference[1]}】`
      index += reference[0].length
      continue
    }
    output += line[index]
    index += 1
  }
  return output
}

function convertInlineTokensForCopy(line: string): string {
  return convertInlineUiReferences(convertInlineUiConditions(convertInlineUiWrites(line)))
}

/**
 * Replace interactive choice widgets and conditionals with readable static Markdown.
 * Live values have no meaning outside the site, so inline references become labels.
 */
export function convertUiChoicesToMarkdown(markdown: string): string {
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

    const condition = line.match(/^\s*::IF\[([\s\S]*)\]\s*$/i)
    if (condition) {
      const end = findConditionalBlockEnd(lines, index + 1)
      const body = end >= 0 ? lines.slice(index + 1, end) : []
      if (end >= 0) {
        output.push(`> **条件成立时（${condition[1].trim()}）：**`)
        output.push('>')
        for (const bodyLine of body) {
          const convertedLine = convertInlineTokensForCopy(bodyLine)
          output.push(convertedLine ? `> ${convertedLine}` : '>')
        }
        output.push('')
        index = end
        continue
      }
    }

    const blockMatch = line.match(/^\s*::begin_ui-(choose|select|if)\[([^\]]*)\](?:\[([^\]]*)\])?(?:\[([^\]]*)\])?\s*$/i)
    if (blockMatch) {
      const kind = blockMatch[1].toLowerCase() as UiWidgetKind
      const id = blockMatch[2]
      const title = kind === 'choose' ? blockMatch[3] ?? '' : id
      const extra = kind === 'choose' ? blockMatch[4] ?? '' : blockMatch[3] ?? ''
      const close = new RegExp(`^\\s*::end_ui-${kind}\\s*$`, 'i')
      const end = findMarkdownBlockEnd(lines, index + 1, (candidate) => close.test(candidate))
      const body = end >= 0 ? lines.slice(index + 1, end) : []
      if (end >= 0) {
        const config = parseUiChoiceConfig(kind, id, title, extra, body.join('\n'))
        output.push(`**${title || (kind === 'if' ? '是否选择' : kind === 'select' ? '下拉选择' : '选择框')}**`)
        if (kind === 'choose') {
          for (const option of config.options) {
            output.push(`- [ ] **${option.label}**`)
            if (option.content) {
              output.push(...option.content.split('\n').map((part) => {
                const convertedPart = convertInlineTokensForCopy(part)
                return convertedPart ? `  ${convertedPart}` : '  '
              }))
            }
          }
        } else {
          for (const option of config.options) output.push(`- [ ] ${convertInlineTokensForCopy(option.content)}`)
        }
        output.push('')
        index = end
        continue
      }
    }

    output.push(convertInlineTokensForCopy(line))
  }

  return output.join('\n')
}

/**
 * direct：原样源码；luogu：移除 Blog 专属语法（展示框、图表与文首排版指令），
 * 洛谷不认识这些指令，留着只会变成正文杂质；basic：再移除洛谷扩展。
 */
export function convertMarkdownForCopy(markdown: string, target: MarkdownCopyTarget): string {
  if (target === 'direct') return markdown
  const withoutBlogExtensions = convertUiChoicesToMarkdown(
    convertUiGraphToMarkdown(
      convertUiCcsToMarkdown(
        convertShowBoxesToMarkdown(stripArticleDirectives(markdown)),
      ),
    ),
  )
  if (target === 'luogu') return withoutBlogExtensions
  return convertLuoguExtensionsToMarkdown(expandMergedTableCells(withoutBlogExtensions))
}
