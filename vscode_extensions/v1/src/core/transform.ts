/**
 * 把 Blog 的特殊语法预处理成「Markdown + 少量 HTML」。
 *
 * 对应 Blog 仓库 `src/components/Markdown.tsx` 里的 `preprocessMarkdown`，
 * 但这里不会生成 React 组件，而是直接生成带 data-* 属性的 HTML 结构：
 *
 * - `interactive` 模式：供 VS Code 内置 Markdown 预览使用，会额外输出控件与
 *   可被前端脚本实时刷新的 `<span data-sl-kind>`；
 * - `static` 模式：供 Markdown Preview Enhanced 使用（其预览不执行我们的脚本），
 *   按变量默认值静态渲染，并在底部列出变量清单。
 *
 * 两种模式都保证展示框 / 折叠框的正文仍然是 Markdown（HTML 块与正文之间留空行），
 * 因此框内的标题、列表、表格、KaTeX 公式都能照常被渲染。
 */

import {
  initialShowValues,
  parseShowMappings,
  parseShowVariables,
  renderShowContent,
  showValueKey,
  type ShowToken,
  type ShowValue,
  type ShowVariable,
} from './showBox'

export interface TransformOptions {
  /** 展示框是否输出可交互控件（需要配套的前端脚本）。 */
  interactive?: boolean
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

/** 稳定的短哈希，用于在重新渲染后恢复展示框的当前取值。 */
export function hashString(value: string): string {
  let hash = 5381
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) + hash + value.charCodeAt(index)) | 0
  }
  return (hash >>> 0).toString(36)
}

/* ---------------------------- 展示框 ---------------------------- */

/** 代码块、行内代码与数学公式内部不能插入 <span>，否则会破坏渲染。 */
function protectedRanges(body: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = []

  // 围栏代码块
  const fence = /^[ \t]*(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:^[ \t]*\1[^\n]*$|$)/gm
  let match: RegExpExecArray | null
  while ((match = fence.exec(body))) ranges.push([match.index, match.index + match[0].length])

  // 行内代码
  const inline = /(`+)(?:[\s\S]*?[^`])?\1(?!`)/g
  while ((match = inline.exec(body))) ranges.push([match.index, match.index + match[0].length])

  // 数学公式：$$…$$ 与 $…$
  const math = /\$\$[\s\S]*?\$\$|\$[^$\n]+?\$/g
  while ((match = math.exec(body))) ranges.push([match.index, match.index + match[0].length])

  return ranges
}

function isProtected(ranges: Array<[number, number]>, token: ShowToken): boolean {
  for (const range of ranges) if (token.start >= range[0] && token.end <= range[1]) return true
  return false
}

function variableMeta(variable: ShowVariable): string {
  if (variable.type === 'string') {
    return '字符串 ' + (variable.minLength || 0) + '–' + (variable.maxLength === undefined ? 100 : variable.maxLength) + ' 字'
  }
  const label = variable.type === 'integer' ? '整数' : '有理数'
  return label + ' ∈ [' + variable.min + ', ' + variable.max + ']'
}

function controlsHtml(variables: ShowVariable[], prefix: string, interactive: boolean): string {
  if (!variables.length) return ''
  if (!interactive) {
    const items = variables.map((variable) => {
      return (
        '<span class="' + prefix + '-var">' +
        '<code>' + escapeHtml(variable.name) + '</code>' +
        '<span class="' + prefix + '-var-value">' + escapeHtml(showValueKey(variable.initial)) + '</span>' +
        '<span class="' + prefix + '-var-meta">' + escapeHtml(variableMeta(variable)) + '</span>' +
        '</span>'
      )
    })
    return '<div class="' + prefix + '-showbox-vars">' + items.join('') + '</div>'
  }

  const rows = variables.map((variable) => {
    const value = escapeHtml(showValueKey(variable.initial))
    const name = escapeHtml(variable.name)
    const head =
      '<span class="' + prefix + '-ctl-head"><span class="' + prefix + '-ctl-name">' + name + '</span>' +
      '<span class="' + prefix + '-ctl-meta">' + escapeHtml(variableMeta(variable)) + '</span></span>'
    if (variable.type === 'string') {
      return (
        '<label class="' + prefix + '-ctl">' + head +
        '<input class="' + prefix + '-ctl-text" type="text" value="' + value + '"' +
        ' minlength="' + (variable.minLength || 0) + '" maxlength="' + (variable.maxLength === undefined ? 100 : variable.maxLength) + '"' +
        ' data-sl-input="' + name + '"></label>'
      )
    }
    const canSlide = variable.type === 'integer' || variable.fastSet
    const bounds =
      ' min="' + variable.min + '" max="' + variable.max + '" step="' + (variable.step || 1) + '"'
    const slider = canSlide
      ? '<input class="' + prefix + '-ctl-range" type="range" value="' + value + '"' + bounds +
        ' data-sl-input="' + name + '" aria-label="' + name + ' 滑动条">'
      : ''
    return (
      '<label class="' + prefix + '-ctl">' + head +
      '<span class="' + prefix + '-ctl-inputs">' +
      '<input class="' + prefix + '-ctl-number" type="number" value="' + value + '"' + bounds +
      ' data-sl-input="' + name + '">' + slider + '</span></label>'
    )
  })
  return '<div class="' + prefix + '-showbox-controls">' + rows.join('') + '</div>'
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
  const interactive = options.interactive !== false
  const variables = parseShowVariables(variableSpec, body)
  const mappings = parseShowMappings(body)
  const values: Record<string, ShowValue> = initialShowValues(variables)
  const ranges = interactive ? protectedRanges(body) : []

  const rendered = renderShowContent(body, values, mappings, (token, text) => {
    if (!interactive || isProtected(ranges, token)) return text
    return (
      '<span class="' + prefix + '-dyn" data-sl-kind="' + token.kind + '"' +
      ' data-sl-arg="' + escapeHtml(token.arg) + '">' + escapeHtml(text) + '</span>'
    )
  })

  const model = encodeURIComponent(JSON.stringify({ variables, mappings }))
  const identifier = hashString(title + '\u0000' + variableSpec + '\u0000' + body)
  const heading =
    '<div class="' + prefix + '-showbox-head">' +
    '<span class="' + prefix + '-showbox-icon" aria-hidden="true">🎛</span>' +
    '<span class="' + prefix + '-showbox-title">' + escapeHtml(title || '交互展示') + '</span></div>'

  const lines: string[] = []
  lines.push('')
  lines.push(
    '<div class="' + prefix + '-showbox" data-sl-box="' + identifier + '"' +
    (interactive ? ' data-sl-model="' + escapeHtml(model) + '"' : '') + '>',
  )
  lines.push(heading)
  lines.push('<div class="' + prefix + '-showbox-body">')
  lines.push('')
  lines.push(rendered)
  lines.push('')
  lines.push('</div>')
  const controls = controlsHtml(variables, prefix, interactive)
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
  const interactive = options.interactive !== false
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
  return interactive ? output : convertMergeMarkersForMpe(output)
}
