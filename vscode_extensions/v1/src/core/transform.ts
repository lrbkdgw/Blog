/**
 * 仅供第三方 Markdown Preview Enhanced 使用的静态兼容转换。
 * MPE 不加载本扩展的 React 脚本；完整同款渲染请使用 VS Code 内置预览。
 * 求值器直接复用博客，不再维护交互占位符/独立的变量计算逻辑。
 */

import {
  initialShowValues,
  parseShowMappings,
  parseShowVariables,
  renderShowContent,
  showValueKey,
  type ShowVariable,
} from './showBox'

export interface TransformOptions {
  /** MPE 兼容模式只渲染默认值，不提供交互脚本。 */
  interactive?: false
  /** 类名前缀，默认 `starlog`。 */
  prefix?: string
}

export const CALLOUT_TYPES = ['info', 'success', 'warning', 'error', 'note', 'tip', 'danger']

export const CALLOUT_TITLES: Record<string, string> = {
  info: '信息提示',
  note: '注记',
  tip: '提示',
  success: '成功',
  warning: '警告',
  error: '错误',
  danger: '危险',
}

const CALLOUT_ICONS: Record<string, string> = {
  info: 'ℹ',
  note: 'ℹ',
  tip: 'ℹ',
  success: '✓',
  warning: '⚠',
  error: '✕',
  danger: '✕',
}

export function escapeHtml(value: string): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** MPE 静态展示框的稳定标识。 */
export function hashString(value: string): string {
  let hash = 5381
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) + hash + value.charCodeAt(index)) | 0
  }
  return (hash >>> 0).toString(36)
}

/* ---------------------------- 展示框 ---------------------------- */

function variableMeta(variable: ShowVariable): string {
  if (variable.type === 'string') {
    return '字符串 ' + (variable.minLength || 0) + '–' + (variable.maxLength === undefined ? 100 : variable.maxLength) + ' 字'
  }
  const label = variable.type === 'integer' ? '整数' : '有理数'
  return label + ' ∈ [' + variable.min + ', ' + variable.max + ']'
}

function variablesHtml(variables: ShowVariable[], prefix: string): string {
  if (!variables.length) return ''
  const items = variables.map((variable) => (
    '<span class="' + prefix + '-var">' +
    '<code>' + escapeHtml(variable.name) + '</code>' +
    '<span class="' + prefix + '-var-value">' + escapeHtml(showValueKey(variable.initial)) + '</span>' +
    '<span class="' + prefix + '-var-meta">' + escapeHtml(variableMeta(variable)) + '</span>' +
    '</span>'
  ))
  return '<div class="' + prefix + '-showbox-vars">' + items.join('') + '</div>'
}

export interface ShowBoxRender {
  /** 需要插入到 Markdown 里的若干行。 */
  lines: string[]
}

export function renderShowBox(
  title: string,
  variableSpec: string,
  body: string,
  options: TransformOptions = {},
): ShowBoxRender {
  const prefix = options.prefix || 'starlog'
  const variables = parseShowVariables(variableSpec, body)
  const mappings = parseShowMappings(body)
  const rendered = renderShowContent(body, initialShowValues(variables), mappings)

  const identifier = hashString(title + '\u0000' + variableSpec + '\u0000' + body)
  const heading =
    '<div class="' + prefix + '-showbox-head">' +
    '<span class="' + prefix + '-showbox-icon" aria-hidden="true">🎛</span>' +
    '<span class="' + prefix + '-showbox-title">' + escapeHtml(title || '交互展示') + '</span></div>'

  const lines: string[] = []
  lines.push('')
  lines.push(
    '<div class="' + prefix + '-showbox" data-sl-box="' + identifier + '"' +
    '>',
  )
  lines.push(heading)
  lines.push('<div class="' + prefix + '-showbox-body">')
  lines.push('')
  lines.push(rendered)
  lines.push('')
  lines.push('</div>')
  const controls = variablesHtml(variables, prefix)
  if (controls) lines.push(controls)
  lines.push('</div>')
  lines.push('')
  return { lines }
}

/* ---------------------------- 表格合并 ---------------------------- */

function isTableLine(line: string): boolean {
  return line.indexOf('|') >= 0
}

/**
 * 把向左合并标记 `<` 换成空单元格。
 *
 * MPE 的「扩展表格语法」用空单元格表示与左侧合并、用 `^` 表示与上方合并，
 * 因此只要做这一步转换，Blog 的 `<` / `^` 就能在 MPE 中得到正确的
 * colspan / rowspan，而单元格内的 Markdown 仍由 MPE 自己渲染。
 */
export function convertMergeMarkersForMpe(markdown: string): string {
  return mapOutsideFences(markdown, (line) => {
    if (!isTableLine(line)) return line
    return line.replace(/(^|\|)([ \t]*)<([ \t]*)(?=\||$)/g, (_all, head: string, left: string) => head + left + ' ')
  })
}

function mapOutsideFences(markdown: string, mapper: (line: string) => string): string {
  const lines = markdown.split('\n')
  let fence: string | null = null
  return lines
    .map((line) => {
      const marker = line.match(/^\s*(`{3,}|~{3,})/)
      if (marker) {
        if (!fence) fence = marker[1][0]
        else if (fence === marker[1][0]) fence = null
        return line
      }
      return fence ? line : mapper(line)
    })
    .join('\n')
}

/* ---------------------------- 主转换 ---------------------------- */

/**
 * 预处理 Markdown：展示框、折叠框、Tuack 表格。
 *
 * 返回的字符串仍然是 Markdown，可以继续交给 markdown-it / MPE 渲染。
 */
export function transformMarkdown(markdown: string, options: TransformOptions = {}): string {
  if (!markdown) return ''
  const prefix = options.prefix || 'starlog'
  const lines = markdown.split('\n')
  const result: string[] = []
  const stack: Array<{ colonsCount: number; type: string }> = []
  let inCodeFence = false

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]

    // 扩展指令不应解析代码示例，否则文档中的语法会被执行而无法展示源码。
    if (/^\s*(`{3,}|~{3,})/.test(line)) {
      inCodeFence = !inCodeFence
      result.push(line)
      continue
    }
    if (inCodeFence) {
      result.push(line)
      continue
    }

    // 交互展示框：::show_begin{标题}{变量定义} … ::show_end
    // 变量定义本身可能含花括号（如 Q{faster_set}），所以匹配到最后一个 `}`。
    const showMatch = line.match(/^\s*::show_begin\{([^}]*)\}\{([\s\S]*)\}\s*$/i)
    if (showMatch) {
      const body: string[] = []
      let end = i + 1
      while (end < lines.length && !/^\s*::show_end\s*$/i.test(lines[end])) {
        body.push(lines[end])
        end += 1
      }
      if (end < lines.length) {
        const rendered = renderShowBox(showMatch[1], showMatch[2], body.join('\n'), options)
        for (const outputLine of rendered.lines) result.push(outputLine)
        i = end
        continue
      }
    }

    // ::cute-table{tuack} / :::cute-table{tuack}
    const tuackMatch = line.match(/^ *(?::{2,})(?:cute-table)\s*\{([^}]+)\}\s*$/i)
    if (tuackMatch) {
      const style = tuackMatch[1].trim().toLowerCase()
      result.push('')
      result.push('<div class="' + prefix + '-table-wrapper ' + prefix + '-table-' + escapeHtml(style) + '">')
      result.push('')
      let j = i + 1
      while (j < lines.length && lines[j].trim() === '') j += 1
      while (j < lines.length && lines[j].indexOf('|') >= 0) {
        result.push(lines[j])
        j += 1
      }
      result.push('')
      result.push('</div>')
      result.push('')
      i = j - 1
      continue
    }

    // 折叠框闭合行：:::、:::: 等
    const closeMatch = line.match(/^ *(:{3,})\s*$/)
    if (closeMatch && stack.length > 0) {
      const colons = closeMatch[1].length
      const top = stack[stack.length - 1]
      if (colons >= top.colonsCount) {
        stack.pop()
        result.push('')
        result.push('</div>')
        result.push('</details>')
        result.push('')
        continue
      }
    }

    // 折叠框开启行：::::info[标题]{open}
    const openMatch = line.match(
      /^ *(:{3,})(info|success|warning|error|note|tip|danger)(?:\[([\s\S]*?)\])?(?:\{(open)\})?\s*$/i,
    )
    if (openMatch) {
      const colonsCount = openMatch[1].length
      const type = openMatch[2].toLowerCase()
      const rawTitle = openMatch[3] !== undefined && openMatch[3] !== '' ? openMatch[3] : CALLOUT_TITLES[type]
      const isOpen = Boolean(openMatch[4])

      stack.push({ colonsCount, type })
      result.push('')
      result.push(
        '<details class="' + prefix + '-callout ' + prefix + '-callout-' + type + '" data-callout="' + type + '"' +
        (isOpen ? ' open' : '') + '>',
      )
      result.push(
        '<summary class="' + prefix + '-callout-summary">' +
        '<span class="' + prefix + '-callout-icon" aria-hidden="true">' + CALLOUT_ICONS[type] + '</span>' +
        '<span class="' + prefix + '-callout-title">' + escapeHtml(rawTitle) + '</span></summary>',
      )
      result.push('<div class="' + prefix + '-callout-content">')
      result.push('')
      continue
    }

    result.push(line)
  }

  while (stack.pop()) {
    result.push('')
    result.push('</div>')
    result.push('</details>')
  }

  const output = result.join('\n')
  return convertMergeMarkersForMpe(output)
}
