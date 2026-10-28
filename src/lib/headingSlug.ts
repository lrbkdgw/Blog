import {
  EMPTY_ARTICLE_DIRECTIVES,
  scanArticleDirectives,
  type ArticleDirectives,
} from './articleDirectives'
import {
  buildUiValueLookup,
  createInitialWidgetState,
  encodeUiPayload,
  evaluateUiCondition,
  expandInlineIfDirectives,
  extractUiWidgetDefs,
  parseUiChooseBlock,
  parseUiIfBlock,
  parseUiSelectBlock,
  parseUiWriteToken,
  substituteUiPlaceholdersInLine,
  type UiStateMap,
  type UiWriteWidgetDef,
} from './uiWidgets'
import { requestHeaderYieldRefresh } from './headerYield'
import { OFFLINE } from './runtime'

export interface HeadingTocItem {
  id: string
  text: string
  level: number
}

export type HastLikeNode = {
  type?: string
  tagName?: string
  value?: string
  properties?: Record<string, unknown>
  children?: HastLikeNode[]
  position?: { start?: { line?: number }; end?: { line?: number } }
}

export interface PreprocessedMarkdown {
  text: string
  /**
   * lineMap[i] 为处理后第 i 行（0 基）对应的原始 Markdown 起始行号（0 基）。
   * 指令（折叠框、Tuack 表格等）展开出的行都会映射回其指令行，
   * 供编辑器把渲染结果对齐回源文本行号。
   */
  lineMap: number[]
  /**
   * endLineMap[i] 为处理后第 i 行（0 基）对应的原始 Markdown 结束行号（0 基）。
   * 多行指令（如 ::show_begin、::begin_ui-ccs、::begin_ui-graph 等）压缩为单行 HTML 时，
   * 记录其闭合指令所在源行号，使双栏同步能精确对齐整个块的起止高度。
   */
  endLineMap: number[]
  /** 文首文章排版指令（issue #59：::set-font / ::set-code-font / ::set-background）。 */
  directives: ArticleDirectives
}

/** 判断某行是否为独占一行的块级 `[new]` 填空框指令。 */
function matchStandaloneNewWrite(line: string): UiWriteWidgetDef | null {
  const trimmed = line.trim()
  if (!trimmed.startsWith('::ui-write[')) return null
  const parsed = parseUiWriteToken(trimmed.slice('::ui-write'.length))
  if (!parsed) return null
  if (parsed.consumedLength + '::ui-write'.length !== trimmed.length) return null
  return parsed.def.isNew ? parsed.def : null
}

/** 将普通文本行中的 `::ui-write[...]` 替换为内联或独立行组件标签（跳过反引号行内代码）。 */
function expandInlineWriteDirectives(line: string): string {
  if (!line.includes('::ui-write[')) return line
  let out = ''
  let inInlineCode = false
  let pos = 0

  while (pos < line.length) {
    const ch = line[pos]
    if (ch === '`') {
      inInlineCode = !inInlineCode
      out += ch
      pos += 1
      continue
    }
    if (!inInlineCode && line.startsWith('::ui-write[', pos)) {
      const parsed = parseUiWriteToken(line.slice(pos + '::ui-write'.length))
      if (parsed) {
        if (parsed.def.isNew) {
          out += `\n\n<div data-ui-write-row="true" data-ui-id="${encodeURIComponent(parsed.def.id)}" data-ui-payload="${encodeUiPayload([parsed.def])}"></div>\n\n`
        } else {
          out += `<span data-ui-write="true" data-ui-id="${encodeURIComponent(parsed.def.id)}" data-ui-payload="${encodeUiPayload(parsed.def)}"></span>`
        }
        pos += '::ui-write'.length + parsed.consumedLength
        continue
      }
    }
    out += ch
    pos += 1
  }

  return out
}

interface ActiveFence {
  marker: '`' | '~'
  length: number
}

function matchFenceOpen(line: string): ActiveFence | null {
  const m = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/)
  if (!m) return null
  const marker = m[1][0] as '`' | '~'
  // CommonMark §4.5：反引号围栏的 info string 不能再含反引号（如单行 ```code``` 不是多行围栏）
  if (marker === '`' && m[2].includes('`')) return null
  return { marker, length: m[1].length }
}

function matchFenceClose(line: string, fence: ActiveFence): boolean {
  const m = line.match(/^ {0,3}(`{3,}|~{3,})\s*$/)
  if (!m) return false
  return m[1][0] === fence.marker && m[1].length >= fence.length
}

/** 预处理 Markdown，支持折叠框、Tuack 表格、坐标系、交互表单控件、条件映射与图论画布 */
export function preprocessMarkdownDetailed(
  md: string,
  options: {
    articleDirectives?: boolean
    uiLookup?: { exact: Map<string, string>; lower: Map<string, string> }
  } = {},
): PreprocessedMarkdown {
  if (!md) return { text: '', lineMap: [], endLineMap: [], directives: EMPTY_ARTICLE_DIRECTIVES }
  const normalized = md.includes('\r') ? md.replace(/\r\n?/g, '\n') : md
  const lines = normalized.split('\n')
  const scanned =
    options.articleDirectives !== false
      ? scanArticleDirectives(lines)
      : { directives: EMPTY_ARTICLE_DIRECTIVES, directiveLines: new Set<number>() }

  const lookup =
    options.uiLookup ??
    (() => {
      const defs = extractUiWidgetDefs(normalized)
      const defaults: UiStateMap = {}
      for (const d of defs) defaults[d.id] = createInitialWidgetState(d)
      return buildUiValueLookup(defs, defaults)
    })()

  const result: string[] = []
  const lineMap: number[] = []
  const endLineMap: number[] = []
  const stack: { colonsCount: number; type: string }[] = []
  const ifStack: boolean[] = []
  let activeFence: ActiveFence | null = null
  let rawGraphIndex = -1

  const isIfActive = () => ifStack.every(Boolean)

  const push = (line: string, sourceLine: number, sourceEndLine: number = sourceLine) => {
    result.push(line)
    lineMap.push(sourceLine)
    endLineMap.push(Math.max(sourceLine, sourceEndLine))
  }

  const transformLineText = (rawLine: string) =>
    expandInlineIfDirectives(substituteUiPlaceholdersInLine(rawLine, lookup))

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i]

    if (!activeFence) {
      const opened = matchFenceOpen(rawLine)
      if (opened) {
        activeFence = opened
        if (isIfActive()) push(rawLine, i)
        continue
      }
    } else {
      if (matchFenceClose(rawLine, activeFence)) {
        activeFence = null
      }
      if (isIfActive()) push(rawLine, i)
      continue
    }

    if (scanned.directiveLines.has(i)) {
      push('', i)
      continue
    }

    const subLine = substituteUiPlaceholdersInLine(rawLine, lookup)

    const blockIfOpen = subLine.match(/^\s*::IF\[([\s\S]*)\]\s*$/)
    if (blockIfOpen) {
      const condHolds = isIfActive() && evaluateUiCondition(blockIfOpen[1])
      ifStack.push(condHolds)
      continue
    }
    if (/^\s*::IF_END\s*$/.test(subLine)) {
      if (ifStack.length > 0) ifStack.pop()
      continue
    }

    const graphMatch = subLine.match(/^\s*::begin_ui-graph(?=$|\[|\s)([\s\S]*)$/)
    if (graphMatch) {
      const body: string[] = []
      let end = i + 1
      while (end < lines.length && !/^\s*::end_ui-graph\s*$/.test(lines[end])) {
        body.push(transformLineText(lines[end]))
        end += 1
      }
      if (end < lines.length) {
        rawGraphIndex += 1
        if (isIfActive()) {
          push(
            `<div data-ui-graph="true" data-graph-index="${rawGraphIndex}" data-graph-header="${encodeURIComponent(graphMatch[1])}" data-graph-source="${encodeURIComponent(body.join('\n'))}"></div>`,
            i,
            end,
          )
          push('', end)
        }
        i = end
        continue
      }
    }

    if (!isIfActive()) {
      continue
    }

    const line = expandInlineIfDirectives(subLine)

    const chooseMatch = line.match(/^\s*::begin_ui-choose([\s\S]*)$/)
    if (chooseMatch) {
      const body: string[] = []
      let end = i + 1
      while (end < lines.length && !/^\s*::end_ui-choose\s*$/.test(lines[end])) {
        body.push(transformLineText(lines[end]))
        end += 1
      }
      if (end < lines.length) {
        const def = parseUiChooseBlock(chooseMatch[1], body)
        if (def) {
          push('', i)
          push(
            `<div data-ui-choose="true" data-ui-id="${encodeURIComponent(def.id)}" data-ui-payload="${encodeUiPayload(def)}"></div>`,
            i,
            end,
          )
          push('', end)
        }
        i = end
        continue
      }
    }

    const selectMatch = line.match(/^\s*::begin_ui-select([\s\S]*)$/)
    if (selectMatch) {
      const body: string[] = []
      let end = i + 1
      while (end < lines.length && !/^\s*::end_ui-select\s*$/.test(lines[end])) {
        body.push(transformLineText(lines[end]))
        end += 1
      }
      if (end < lines.length) {
        const def = parseUiSelectBlock(selectMatch[1], body)
        if (def) {
          const selectHtml = `<span data-ui-select="true" data-ui-id="${encodeURIComponent(def.id)}" data-ui-payload="${encodeUiPayload(def)}"></span>`
          const prevLine = result.length > 0 ? result[result.length - 1] : ''
          const canAttachPrev =
            result.length > 0 &&
            prevLine.trim() !== '' &&
            !prevLine.trim().startsWith('<div') &&
            !prevLine.trim().startsWith('</')
          if (canAttachPrev) {
            result[result.length - 1] = `${prevLine}${selectHtml}`
          } else {
            push(selectHtml, i)
          }
        }
        i = end
        continue
      }
    }

    const uiIfMatch = line.match(/^\s*::begin_ui-if([\s\S]*)$/)
    if (uiIfMatch) {
      const body: string[] = []
      let end = i + 1
      while (end < lines.length && !/^\s*::end_ui-if\s*$/.test(lines[end])) {
        body.push(transformLineText(lines[end]))
        end += 1
      }
      if (end < lines.length) {
        const def = parseUiIfBlock(uiIfMatch[1], body)
        if (def) {
          push('', i)
          push(
            `<div data-ui-if="true" data-ui-id="${encodeURIComponent(def.id)}" data-ui-payload="${encodeUiPayload(def)}"></div>`,
            i,
            end,
          )
          push('', end)
        }
        i = end
        continue
      }
    }

    const standaloneNewWrite = matchStandaloneNewWrite(line)
    if (standaloneNewWrite) {
      const rowDefs: UiWriteWidgetDef[] = [standaloneNewWrite]
      let lastConsumed = i
      let scan = i + 1
      while (scan < lines.length) {
        if (lines[scan].trim() === '') {
          scan += 1
          continue
        }
        const candidateLine = transformLineText(lines[scan])
        const nextWrite = matchStandaloneNewWrite(candidateLine)
        if (nextWrite && nextWrite.merge) {
          rowDefs.push(nextWrite)
          lastConsumed = scan
          scan += 1
          continue
        }
        break
      }
      push('', i)
      push(
        `<div data-ui-write-row="true" data-ui-id="${encodeURIComponent(rowDefs[0].id)}" data-ui-payload="${encodeUiPayload(rowDefs)}"></div>`,
        i,
        lastConsumed,
      )
      push('', lastConsumed)
      i = lastConsumed
      continue
    }

    const showMatch = line.match(/^\s*::show_begin\{([^}]*)\}\{([\s\S]*)\}\s*$/i)
    if (showMatch) {
      const body: string[] = []
      let end = i + 1
      while (end < lines.length && !/^\s*::show_end\s*$/i.test(lines[end])) {
        body.push(transformLineText(lines[end]))
        end += 1
      }
      if (end < lines.length) {
        push(
          `<div data-show-box="true" data-show-title="${encodeURIComponent(showMatch[1])}" data-show-vars="${encodeURIComponent(showMatch[2])}" data-show-content="${encodeURIComponent(body.join('\n'))}"></div>`,
          i,
          end,
        )
        push('', end)
        i = end
        continue
      }
    }

    const ccsMatch = line.match(/^\s*::begin_ui-ccs(?:\{([^}]*)\})?\s*$/i)
    if (ccsMatch) {
      const body: string[] = []
      let end = i + 1
      while (end < lines.length && !/^\s*::end_ui-ccs\s*$/i.test(lines[end])) {
        body.push(transformLineText(lines[end]))
        end += 1
      }
      if (end < lines.length) {
        push(
          `<div data-ui-ccs="true" data-ccs-title="${encodeURIComponent(ccsMatch[1] ?? '')}" data-ccs-content="${encodeURIComponent(body.join('\n'))}"></div>`,
          i,
          end,
        )
        push('', end)
        i = end
        continue
      }
    }

    const tuackMatch = line.match(/^ *(?:::+|:::+)(?:cute-table)\s*\{([^}]+)\}\s*$/i)
    if (tuackMatch) {
      push('<div class="table-tuack-wrapper">', i)
      push('', i)
      let j = i + 1
      while (j < lines.length && lines[j].trim() === '') {
        j++
      }
      while (
        j < lines.length &&
        (lines[j].trim().startsWith('|') || lines[j].trim().includes('|'))
      ) {
        push(expandInlineWriteDirectives(transformLineText(lines[j])), j)
        j++
      }
      const tableEnd = Math.max(i, j - 1)
      push('', tableEnd)
      push('</div>', tableEnd)
      push('', tableEnd)
      i = j - 1
      continue
    }

    const closeMatch = line.match(/^ *(:{3,})\s*$/)
    if (closeMatch && stack.length > 0) {
      const colons = closeMatch[1].length
      const top = stack[stack.length - 1]
      if (colons >= top.colonsCount) {
        stack.pop()
        push('', i)
        push('</div>', i)
        push('</details>', i)
        push('', i)
        continue
      }
    }

    const openMatch = line.match(
      /^ *(:{3,})(info|success|warning|error|note|tip|danger)(?:\[([\s\S]*?)\])?(?:\{(open)\})?\s*$/i,
    )
    if (openMatch) {
      const colonsCount = openMatch[1].length
      const type = openMatch[2].toLowerCase()
      const rawTitle = openMatch[3] !== undefined ? openMatch[3] : ''
      const isOpen = Boolean(openMatch[4])

      stack.push({ colonsCount, type })
      const encodedTitle = encodeURIComponent(rawTitle)
      push('', i)
      push(
        `<details class="callout callout-${type}" data-callout="${type}" data-title="${encodedTitle}" ${
          isOpen ? 'open' : ''
        }>`,
        i,
      )
      push(
        `<summary class="callout-summary" data-callout="${type}" data-title="${encodedTitle}">${rawTitle}</summary>`,
        i,
      )
      push('<div class="callout-content">', i)
      push('', i)
      continue
    }

    const expandedWriteLine = expandInlineWriteDirectives(line)
    if (expandedWriteLine.includes('\n')) {
      for (const piece of expandedWriteLine.split('\n')) {
        push(piece, i)
      }
    } else {
      push(expandedWriteLine, i)
    }
  }

  while (stack.pop()) {
    const last = lines.length - 1
    push('', last)
    push('</div>', last)
    push('</details>', last)
  }

  return { text: result.join('\n'), lineMap, endLineMap, directives: scanned.directives }
}

export function preprocessMarkdown(md: string): string {
  return preprocessMarkdownDetailed(md).text
}

function classNamesOf(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String)
  if (typeof value === 'string') return value.split(/\s+/).filter(Boolean)
  return []
}

export function isHeadingElement(node: HastLikeNode): boolean {
  return node.type === 'element' && /^h[1-6]$/.test(node.tagName || '')
}

export function isCalloutElement(node: HastLikeNode): boolean {
  if (node.type !== 'element' || node.tagName !== 'details') return false
  const properties = node.properties || {}
  return Boolean(
    properties.dataCallout ||
      properties['data-callout'] ||
      classNamesOf(properties.className).includes('callout'),
  )
}

/** 提取 HAST 节点的纯文本内容（保留行内代码、数学公式源码与链接文字，跳过内嵌 UI 控件节点）。 */
export function hastNodeToString(node: HastLikeNode | null | undefined): string {
  if (!node) return ''
  if (node.type === 'text') return typeof node.value === 'string' ? node.value : ''
  if (node.type === 'element') {
    const props = node.properties || {}
    if (props.dataUiSelect || props['data-ui-select'] || props.dataUiWrite || props['data-ui-write']) {
      return ''
    }
  }
  if (!Array.isArray(node.children)) return ''
  return node.children.map((child) => hastNodeToString(child)).join('')
}

/**
 * 与 GitHub / rehype-slug 对齐的标题锚点生成器：
 * - 保留所有语言的字母、组合音标、数字、连字符 `-`、下划线 `_` 与空格（空格转 `-`）；
 * - 对纯符号标题（如 `### ???`）回退到 `'section'`，保证任何标题都拥有非空、可定位的 DOM id；
 * - 重复标题按出现顺序追加 `-1`、`-2` 后缀，且避免与已有显式 `-1` 标题冲突。
 */
export function createHeadingSlugger() {
  const occurrences = new Map<string, number>()

  return {
    slug(rawText: string): string {
      const normalized = rawText
        .trim()
        .toLowerCase()
        .replace(/[\t\r\n]+/g, ' ')
        .replace(/[^\p{L}\p{M}\p{N}\-_ ]/gu, '')
        .replace(/ /g, '-')
      const base = normalized || 'section'

      let candidate = base
      let count = occurrences.get(base) ?? 0
      if (count > 0) {
        do {
          candidate = `${base}-${count}`
          count += 1
        } while (occurrences.has(candidate))
        occurrences.set(base, count)
        occurrences.set(candidate, 1)
        return candidate
      }

      occurrences.set(base, 1)
      return candidate
    },
    reset() {
      occurrences.clear()
    },
  }
}

/**
 * 为正文标题赋予与 `extractTocFromMarkdown` 完全一致的 `id`：
 * - 默认跳过折叠框（callout）内的标题，既不暴露锚点也不占用重名计数；
 * - 当 `enabled = false`（如评论、展示框子渲染）时移除全部标题 `id`。
 */
export function rehypeHeadingSlug({
  enabled = true,
  skipCallouts = true,
}: {
  enabled?: boolean
  skipCallouts?: boolean
} = {}) {
  return function headingSlugPlugin() {
    return (tree: HastLikeNode) => {
      const slugger = createHeadingSlugger()
      const visit = (node: HastLikeNode, insideCallout: boolean) => {
        const nextInsideCallout = insideCallout || (skipCallouts && isCalloutElement(node))
        if (isHeadingElement(node)) {
          node.properties = node.properties || {}
          if (!enabled || nextInsideCallout) {
            delete node.properties.id
          } else {
            node.properties.id = slugger.slug(hastNodeToString(node))
          }
          return
        }
        for (const child of node.children || []) {
          visit(child, nextInsideCallout)
        }
      }
      visit(tree, false)
    }
  }
}

const NAMED_HTML_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: '\u00a0',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  middot: '·',
  times: '×',
  divide: '÷',
}

function decodeHtmlEntities(input: string): string {
  return input.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (full, entity: string) => {
    if (entity.startsWith('#x') || entity.startsWith('#X')) {
      const cp = Number.parseInt(entity.slice(2), 16)
      return Number.isFinite(cp) && cp > 0 ? String.fromCodePoint(cp) : full
    }
    if (entity.startsWith('#')) {
      const cp = Number.parseInt(entity.slice(1), 10)
      return Number.isFinite(cp) && cp > 0 ? String.fromCodePoint(cp) : full
    }
    return NAMED_HTML_ENTITIES[entity.toLowerCase()] ?? full
  })
}

/**
 * 提取单行 Markdown 标题的纯文本，与 `remark-parse` + `remark-math` + `hastNodeToString` 严格对齐：
 * - 保留行内代码 `` `code` `` 与行内数学 `$math$` 内部的文字（不吞掉）；
 * - 提取 `[text](url)` / `[text][ref]` 的显示文字，忽略图片 `![alt](url)`；
 * - 移除内嵌 UI 控件 span、HTML 标签与强调定界符（`**` / `*` / `~~` / `_`），还原转义字符。
 */
export function extractHeadingInlineText(rawHeading: string): string {
  let out = ''
  let i = 0
  const s = rawHeading
    .replace(/<span\s+data-ui-(?:select|write)="true"[^>]*><\/span>/gi, '')
    .trim()

  while (i < s.length) {
    const ch = s[i]

    // 反斜杠转义：CommonMark 标点转义
    if (ch === '\\' && i + 1 < s.length && /[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]/.test(s[i + 1])) {
      out += s[i + 1]
      i += 2
      continue
    }

    // 行内代码 `...` 或 ``...``：原样保留代码内容
    if (ch === '`') {
      let ticks = 1
      while (i + ticks < s.length && s[i + ticks] === '`') ticks += 1
      const fence = s.slice(i, i + ticks)
      const closeIdx = s.indexOf(fence, i + ticks)
      if (closeIdx !== -1) {
        let codeContent = s.slice(i + ticks, closeIdx)
        if (
          codeContent.length >= 2 &&
          codeContent.startsWith(' ') &&
          codeContent.endsWith(' ') &&
          codeContent.trim().length > 0
        ) {
          codeContent = codeContent.slice(1, -1)
        }
        out += codeContent
        i = closeIdx + ticks
        continue
      }
      out += fence
      i += ticks
      continue
    }

    // 行内数学公式 $...$ 或 $$...$$：remark-math 将内部文本作为 code 节点保留
    if (ch === '$') {
      const double = s[i + 1] === '$'
      const delim = double ? '$$' : '$'
      const closeIdx = s.indexOf(delim, i + delim.length)
      if (closeIdx !== -1 && closeIdx > i + delim.length) {
        out += s.slice(i + delim.length, closeIdx)
        i = closeIdx + delim.length
        continue
      }
    }

    // 图片 ![alt](url)：HTML img 无文本子节点，hastNodeToString 为空串
    if (ch === '!' && s[i + 1] === '[') {
      const linkParsed = consumeBracketLink(s, i + 1)
      if (linkParsed) {
        i = linkParsed.nextIndex
        continue
      }
    }

    // 链接 [text](url) 或 [text][ref]：保留递归解析后的显示文字
    if (ch === '[') {
      const linkParsed = consumeBracketLink(s, i)
      if (linkParsed) {
        out += extractHeadingInlineText(linkParsed.label)
        i = linkParsed.nextIndex
        continue
      }
    }

    // 原始 HTML 标签 <kbd>...</kbd> 等：移除标签外壳，保留内部文字
    if (ch === '<') {
      const tagMatch = s.slice(i).match(/^<\/?[a-zA-Z][^>]*>/)
      if (tagMatch) {
        i += tagMatch[0].length
        continue
      }
    }

    // 强调 / 删除线标记（**、*、~~；下划线仅在非词内边界时视作强调符）
    if (ch === '*' || ch === '~') {
      let run = 1
      while (i + run < s.length && s[i + run] === ch) run += 1
      if (ch === '*' || run === 2) {
        i += run
        continue
      }
    }
    if (ch === '_') {
      const prevChar = i > 0 ? s[i - 1] : ''
      let run = 1
      while (i + run < s.length && s[i + run] === '_') run += 1
      const nextChar = i + run < s.length ? s[i + run] : ''
      const prevIsWord = /[\p{L}\p{N}]/u.test(prevChar)
      const nextIsWord = /[\p{L}\p{N}]/u.test(nextChar)
      if (!(prevIsWord && nextIsWord)) {
        i += run
        continue
      }
    }

    out += ch
    i += 1
  }

  return decodeHtmlEntities(out).trim()
}

function consumeBracketLink(
  s: string,
  openBracketIdx: number,
): { label: string; nextIndex: number } | null {
  let depth = 0
  let closeBracketIdx = -1
  for (let j = openBracketIdx; j < s.length; j++) {
    if (s[j] === '\\') {
      j += 1
      continue
    }
    if (s[j] === '`') {
      const nextTick = s.indexOf('`', j + 1)
      if (nextTick !== -1) {
        j = nextTick
        continue
      }
    }
    if (s[j] === '[') depth += 1
    else if (s[j] === ']') {
      depth -= 1
      if (depth === 0) {
        closeBracketIdx = j
        break
      }
    }
  }
  if (closeBracketIdx === -1) return null
  const label = s.slice(openBracketIdx + 1, closeBracketIdx)
  const after = closeBracketIdx + 1

  if (s[after] === '(') {
    let parenDepth = 0
    for (let k = after; k < s.length; k++) {
      if (s[k] === '\\') {
        k += 1
        continue
      }
      if (s[k] === '(') parenDepth += 1
      else if (s[k] === ')') {
        parenDepth -= 1
        if (parenDepth === 0) {
          return { label, nextIndex: k + 1 }
        }
      }
    }
  }

  if (s[after] === '[') {
    const closeRef = s.indexOf(']', after + 1)
    if (closeRef !== -1) {
      return { label, nextIndex: closeRef + 1 }
    }
  }

  return null
}

/**
 * 从 Markdown 源码中抽取正文目录（h2 ~ h4）：
 * 先执行与 `<Markdown>` 完全一致的 `preprocessMarkdownDetailed`，
 * 跳过折叠框（`<details class="callout ...">`）与代码围栏，并用同一个 `createHeadingSlugger()` 生成锚点 ID。
 * 零 DOM 依赖、零统一语法树重包体积，可在浏览器首屏与 Node 环境直接同步运行。
 */
export function extractTocFromMarkdown(md: string): HeadingTocItem[] {
  if (!md || !md.trim()) return []
  const processed = preprocessMarkdownDetailed(md, { articleDirectives: true })
  if (!processed.text.trim()) return []

  const lines = processed.text.split('\n')
  const slugger = createHeadingSlugger()
  const items: HeadingTocItem[] = []
  let activeFence: ActiveFence | null = null
  let calloutDepth = 0

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    if (!activeFence) {
      const opened = matchFenceOpen(line)
      if (opened) {
        activeFence = opened
        continue
      }
    } else {
      if (matchFenceClose(line, activeFence)) {
        activeFence = null
      }
      continue
    }

    if (/^<details\s+class="callout\b/i.test(line.trim())) {
      calloutDepth += 1
      continue
    }
    if (calloutDepth > 0 && /^<\/details>\s*$/i.test(line.trim())) {
      calloutDepth = Math.max(0, calloutDepth - 1)
      continue
    }
    if (calloutDepth > 0) continue

    // ATX 标题：## 标题
    const atx = line.match(/^ {0,3}(#{1,6})(?:[ \t]+(.*?))??(?:[ \t]+#+)?[ \t]*$/)
    if (atx) {
      const level = atx[1].length
      const rawBody = atx[2] ?? ''
      const plainText = extractHeadingInlineText(rawBody)
      const id = slugger.slug(plainText)
      const displayText = plainText.replace(/\s+/g, ' ').trim() || rawBody.trim() || id
      if (level >= 2 && level <= 4) {
        items.push({ id, text: displayText, level })
      }
      continue
    }

    // 原始 HTML 标题：<h2>标题</h2>
    const rawHtmlHeading = line.match(/^\s*<h([1-6])(?:\s[^>]*)?>([\s\S]*?)<\/h\1>\s*$/i)
    if (rawHtmlHeading) {
      const level = Number.parseInt(rawHtmlHeading[1], 10)
      const plainText = decodeHtmlEntities(rawHtmlHeading[2].replace(/<[^>]+>/g, '')).trim()
      const id = slugger.slug(plainText)
      const displayText = plainText.replace(/\s+/g, ' ').trim() || id
      if (level >= 2 && level <= 4) {
        items.push({ id, text: displayText, level })
      }
    }
  }

  return items
}

/** 吸顶页头让路区的安全滚动偏移（高于 headerYield 的 96px 完全清晰线）。 */
export const HEADING_SCROLL_OFFSET = 100

function findHeadingTarget(rawId: string): HTMLElement | null {
  if (typeof document === 'undefined' || !rawId) return null
  const stripped = rawId.startsWith('#') ? rawId.slice(1) : rawId
  if (!stripped) return null

  const candidates = [stripped]
  try {
    const decoded = decodeURIComponent(stripped)
    if (decoded && decoded !== stripped) candidates.push(decoded)
  } catch {
    // 忽略畸形百分号编码
  }
  for (const base of [...candidates]) {
    candidates.push(`user-content-${base}`)
  }

  for (const candidate of candidates) {
    const el = document.getElementById(candidate)
    if (el) return el
  }
  return null
}

/**
 * 平滑滚动至指定标题锚点：
 * - 若目标位于未展开的 `<details>` 内则自动展开；
 * - 预留 `100px` 顶部安全距离，避免落入吸顶页头渐变消融带；
 * - 线上模式保留 React Router 的 `history.state` 更新 URL `#hash`；
 * - 离线模式（HashRouter 使用 `#/posts/...` 承载路由）绝不覆盖 `location.hash`。
 */
export function scrollToHeading(
  targetId: string,
  options: { updateHash?: boolean; behavior?: ScrollBehavior } = {},
): boolean {
  if (typeof window === 'undefined' || typeof document === 'undefined') return false
  const el = findHeadingTarget(targetId)
  if (!el) return false

  let parent: HTMLElement | null = el.parentElement
  while (parent) {
    if (parent.tagName === 'DETAILS' && !(parent as HTMLDetailsElement).open) {
      ;(parent as HTMLDetailsElement).open = true
    }
    parent = parent.parentElement
  }

  const currentY =
    window.scrollY || window.pageYOffset || document.documentElement.scrollTop || 0
  const top = Math.max(0, el.getBoundingClientRect().top + currentY - HEADING_SCROLL_OFFSET)
  const prefersReducedMotion =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const behavior: ScrollBehavior = options.behavior ?? (prefersReducedMotion ? 'auto' : 'smooth')

  try {
    window.scrollTo({ top, behavior })
  } catch {
    window.scrollTo(0, top)
  }

  requestHeaderYieldRefresh()
  window.setTimeout(() => {
    requestHeaderYieldRefresh()
  }, 360)

  const shouldUpdateHash =
    options.updateHash !== false &&
    !OFFLINE &&
    !window.location.hash.startsWith('#/')
  if (shouldUpdateHash && el.id) {
    try {
      window.history.replaceState(
        window.history.state,
        '',
        `${window.location.pathname}${window.location.search}#${encodeURIComponent(el.id)}`,
      )
    } catch {
      // file:// 或受限环境下忽略历史栈更新错误
    }
  }

  return true
}
