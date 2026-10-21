import { Children, cloneElement, createElement, isValidElement, memo, useCallback, useContext, useMemo, useState } from 'react'
import type { HTMLAttributes, ReactNode } from 'react'
import katex from 'katex'
import ReactMarkdown from 'react-markdown'
import type { UrlTransform } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeRaw from 'rehype-raw'
import rehypeSanitize, { defaultSchema, type Options as SanitizeOptions } from 'rehype-sanitize'
import rehypeKatex from 'rehype-katex'
import rehypeHighlight from 'rehype-highlight'
import rehypeSlug from 'rehype-slug'
import { ShowBox } from './ShowBox'
import { CoordinatePlane } from './CoordinatePlane'
import { CoordinateGraph } from './CoordinateGraph'
import { UiChoiceWidget } from './UiChoiceWidget'
import { UiWriteWidget } from './UiWriteWidget'
import { UiSyntaxProvider, UiSyntaxContext, useUiSyntaxContext } from '../lib/uiSyntaxContext'
import { evaluateUiCondition, formatUiReference, resolveUiMathReferences } from '../lib/uiChoices'
import { parseUiWriteConfig, parseUiWriteLine, parseUiWriteToken, type UiWriteToken } from '../lib/uiWrite'
import { resolvePendingImageSrc } from '../lib/updateQueue'
import {
  EMPTY_ARTICLE_DIRECTIVES,
  articleFontStyle,
  scanArticleDirectives,
  type ArticleDirectives,
} from '../lib/articleDirectives'
import { WifiOff, 
  AlertCircle,
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronRight,
  Copy,
  Info,
  Link2,
} from 'lucide-react'

/**
 * 原始 HTML 的净化规则（用于文章与评论）。
 *
 * 评论来自 GitHub Discussions，任何能评论的人都能提交内容，所以不能原样放行 HTML：
 * 否则可以插入 <iframe>、<form> 或全屏遮罩来做钓鱼。这里以 GitHub 默认规则为基础，
 * 只额外放行站内渲染需要的标签与属性（折叠框 callout、表格包裹、kbd 等）。
 * 脚本、事件属性（onerror 等）、style 以及 iframe/form 等依然会被移除。
 *
 * 注意：本规则只作用于用户写的原始 HTML（rehype-raw 之后）；KaTeX、代码高亮、
 * 标题锚点等由本项目自己生成的结构在之后的插件中添加，不会被过滤。
 */
const sanitizeSchema: SanitizeOptions = {
  ...defaultSchema,
  tagNames: [
    ...(defaultSchema.tagNames ?? []),
    'details',
    'summary',
    'kbd',
    'mark',
    'figure',
    'figcaption',
  ],
  attributes: {
    ...defaultSchema.attributes,
    '*': [
      ...(defaultSchema.attributes?.['*'] ?? []),
      'className',
      // 站内预处理生成的结构属性：折叠框、交互展示框与直角坐标系的配置
      'dataCallout',
      'dataTitle',
      'dataShowBox',
      'dataShowTitle',
      'dataShowVars',
      'dataShowContent',
      'dataUiCcs',
      'dataCcsTitle',
      'dataCcsContent',
      'dataUiWidget',
      'dataUiId',
      'dataUiTitle',
      'dataUiExtra',
      'dataUiContent',
      'dataUiGraph',
      'dataGraphExtra',
      'dataGraphContent',
      'dataUiRef',
      'dataUiIfInline',
      'dataUiIfContent',
      'dataUiIfBlock',
      'dataUiMath',
      'dataUiMathDisplay',
      'dataUiWrite',
      'dataUiWriteOptions',
      'dataUiWriteNew',
      'dataUiWriteMerge',
      'dataUiWriteGrouped',
      'dataUiWriteRow',
    ],
    details: [...(defaultSchema.attributes?.details ?? []), 'open'],
  },
}

function extractText(node: ReactNode): string {
  if (node == null || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(extractText).join('')
  if (isValidElement(node)) return extractText((node.props as { children?: ReactNode }).children)
  return ''
}

function languageOf(node: ReactNode): string {
  if (isValidElement(node)) {
    const cls = (node.props as { className?: string }).className || ''
    const m = cls.match(/language-([\w+#-]+)/)
    if (m) return m[1]
  }
  return ''
}

function CodeBlock({
  children,
  sourceLine,
}: {
  children?: ReactNode
  sourceLine?: number
}) {
  const [copied, setCopied] = useState(false)
  const lang = languageOf(children)
  const text = extractText(children)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      const ta = document.createElement('textarea')
      ta.value = text
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      ta.remove()
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 1600)
  }

  return (
    <div className="group relative my-6" data-source-line={sourceLine}>
      <div className="pointer-events-none absolute right-3 top-3 z-10 flex items-center gap-2">
        {lang && (
          <span className="rounded-md bg-ink-900/[.06] px-2 py-0.5 font-mono text-[11px] uppercase tracking-wide text-ink-500 dark:bg-white/10 dark:text-ink-400">
            {lang}
          </span>
        )}
        <button
          onClick={copy}
          type="button"
          aria-label="复制代码"
          className="pointer-events-auto rounded-md border border-ink-200/70 bg-white/85 p-1.5 text-ink-500 opacity-0 shadow-sm transition
                     hover:text-brand-600 focus:opacity-100 group-hover:opacity-100
                     dark:border-white/10 dark:bg-ink-900/80 dark:text-ink-400 dark:hover:text-brand-300"
        >
          {copied ? <Check size={14} className="text-emerald-500" /> : <Copy size={14} />}
        </button>
      </div>
      <pre className="!my-0">{children}</pre>
    </div>
  )
}

function Heading({
  level,
  id,
  sourceLine,
  children,
}: {
  level: 2 | 3 | 4
  id?: string
  sourceLine?: number
  children?: ReactNode
}) {
  const Tag = `h${level}` as 'h2' | 'h3' | 'h4'
  return (
    <Tag id={id} data-source-line={sourceLine} className="group/heading relative">
      {children}
      {id && (
        <a
          href={`#${id}`}
          aria-label="锚点链接"
          className="ml-2 inline-flex translate-y-[-1px] items-center align-middle text-ink-300 opacity-0 transition
                     hover:text-brand-500 group-hover/heading:opacity-100 dark:text-ink-600"
          style={{ borderBottom: 'none' }}
        >
          <Link2 size={15} />
        </a>
      )}
    </Tag>
  )
}

type RehypeNode = {
  type?: string
  tagName?: string
  value?: string
  properties?: Record<string, unknown>
  data?: {
    hName?: string
    hProperties?: Record<string, unknown>
    hChildren?: RehypeNode[]
  }
  children?: RehypeNode[]
  position?: { start?: { line?: number }; end?: { line?: number } }
}

function classNames(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String)
  if (typeof value === 'string') return value.split(/\s+/).filter(Boolean)
  return []
}

function isHeadingNode(node: RehypeNode): boolean {
  return node.type === 'element' && /^h[1-6]$/.test(node.tagName || '')
}

function isCalloutNode(node: RehypeNode): boolean {
  if (node.type !== 'element' || node.tagName !== 'details') return false
  const properties = node.properties || {}
  return Boolean(
    properties.dataCallout ||
      properties['data-callout'] ||
      classNames(properties.className).includes('callout'),
  )
}

// 折叠框/展示框里的标题不作为正文锚点暴露，避免目录滚动定位命中框内标题。
function rehypeRemoveHeadingIds({ calloutsOnly = false }: { calloutsOnly?: boolean } = {}) {
  return function removeHeadingIdsPlugin() {
    return (tree: RehypeNode) => {
      const visit = (node: RehypeNode, insideCallout: boolean) => {
        const nextInsideCallout = insideCallout || isCalloutNode(node)
        if (isHeadingNode(node) && (!calloutsOnly || nextInsideCallout)) {
          delete node.properties?.id
        }
        for (const child of node.children || []) visit(child, nextInsideCallout)
      }
      visit(tree, false)
    }
  }
}

function isBlockMathElement(node: RehypeNode): boolean {
  if (node.type !== 'element') return false
  const cls = classNames(node.properties?.className)
  // remark-math 的块级公式（$$…$$）。
  if (cls.includes('math-display')) return true
  // ```math 代码围栏：rehype-katex 会连外层 pre 一起替换。
  if (
    node.tagName === 'pre' &&
    (node.children || []).some(
      (child) => child.type === 'element' && classNames(child.properties?.className).includes('language-math'),
    )
  ) {
    return true
  }
  return false
}

/**
 * 给块级公式包一层保留 position 的透明容器：
 * rehype-katex 渲染时会整体替换公式节点且不回填 position，
 * 不包一层的话双栏滚动同步会丢失公式块的行号锚点。
 */
function rehypeMarkBlockMath() {
  return function markBlockMathPlugin() {
    return (tree: RehypeNode) => {
      const walk = (node: RehypeNode) => {
        const children = node.children
        if (!children) return
        for (let i = 0; i < children.length; i++) {
          const child = children[i]
          if (isBlockMathElement(child) && child.position) {
            children[i] = {
              type: 'element',
              tagName: 'div',
              properties: {},
              position: child.position,
              children: [child],
            }
          } else {
            walk(child)
          }
        }
      }
      walk(tree)
    }
  }
}

/** 上层元素缺失 position 时从第一个有 position 的子元素回填（如 rehype-raw 生成的 details）。 */
function rehypeInheritPositions() {
  return function inheritPositionsPlugin() {
    return (tree: RehypeNode) => {
      const walk = (node: RehypeNode) => {
        for (const child of node.children || []) walk(child)
        if (node.type === 'element' && !node.position) {
          const first = (node.children || []).find((child) => child.position)
          if (first) node.position = first.position
        }
      }
      walk(tree)
    }
  }
}

/** Math containing live `<<id>>` references is rendered by a React component so it can update with its widget. */
function remarkUiDynamicMath() {
  return function markDynamicMathPlugin() {
    return (tree: RehypeNode) => {
      const walk = (node: RehypeNode) => {
        for (const child of node.children || []) walk(child)
        if ((node.type === 'inlineMath' || node.type === 'math') && typeof node.value === 'string') {
          if (!/(?:<<[\p{L}\p{N}_.-]+>>|<[\p{L}_][\p{L}\p{N}_.-]*>)/u.test(node.value)) return
          const display = node.type === 'math'
          node.data = {
            ...node.data,
            hName: display ? 'div' : 'span',
            hProperties: {
              'data-ui-math': encodeURIComponent(node.value),
              'data-ui-math-display': display ? 'true' : 'false',
            },
            hChildren: [],
          }
        }
      }
      walk(tree)
    }
  }
}

function inlineReferenceAt(source: string, index: number): { id: string; end: number } | null {
  const remainder = source.slice(index)
  const double = remainder.match(/^<<([\p{L}\p{N}_.-]+)>>/u)
  if (double) return { id: double[1], end: index + double[0].length }
  return null
}

function findInlineIfComma(source: string, start: number): number {
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
    const reference = inlineReferenceAt(source, index)
    if (reference) {
      index = reference.end - 1
      continue
    }
    if (char === '<') {
      const variable = source.slice(index).match(/^<[\p{L}_][\p{L}\p{N}_.-]*>/u)
      if (variable) {
        index += variable[0].length - 1
        continue
      }
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

function findInlineIfEnd(source: string, start: number): number {
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
    const reference = inlineReferenceAt(source, index)
    if (reference) {
      index = reference.end - 1
      continue
    }
    if (char === '<') {
      const tag = source.slice(index).match(/^<\/?[A-Za-z][^>]*>/)
      if (tag) {
        index += tag[0].length - 1
        continue
      }
      const variable = source.slice(index).match(/^<[\p{L}_][\p{L}\p{N}_.-]*>/u)
      if (variable) {
        index += variable[0].length - 1
        continue
      }
    }
    if (char === '>' && !inMath) return index
  }
  return -1
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

function uiWriteMarker(token: UiWriteToken, grouped = false): string {
  const config = parseUiWriteConfig(token.id, token.options)
  return `<span data-ui-write="true" data-ui-id="${encodeURIComponent(token.id)}" data-ui-write-options="${encodeURIComponent(JSON.stringify(token.options))}" data-ui-write-new="${config.newLine}" data-ui-write-merge="${config.merge}" data-ui-write-grouped="${grouped}"></span>`
}

function inlineUiWriteMergeRow(line: string, first: UiWriteToken): { html: string; end: number } | null {
  const firstConfig = parseUiWriteConfig(first.id, first.options)
  if (!firstConfig.newLine || firstConfig.merge) return null

  const row: UiWriteToken[] = [first]
  let cursor = first.end
  while (cursor < line.length) {
    const whitespace = line.slice(cursor).match(/^[ \t]+/)?.[0] ?? ''
    if (!whitespace) break
    const next = parseUiWriteToken(line, cursor + whitespace.length)
    if (!next) break
    const config = parseUiWriteConfig(next.id, next.options)
    if (!config.newLine || !config.merge) break
    row.push(next)
    cursor = next.end
  }
  if (row.length < 2) return null
  return {
    html: `<span data-ui-write-row="true">${row.map((token) => uiWriteMarker(token, true)).join('')}</span>`,
    end: cursor,
  }
}

/** Replace inline widget references while leaving code spans and TeX for their own renderers. */
function transformInlineUiTokens(line: string): string {
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
    const uiWrite = parseUiWriteToken(line, index)
    if (uiWrite) {
      const mergeRow = inlineUiWriteMergeRow(line, uiWrite)
      if (mergeRow) {
        output += mergeRow.html
        index = mergeRow.end
      } else {
        output += uiWriteMarker(uiWrite)
        index = uiWrite.end
      }
      continue
    }
    if (line.slice(index, index + 4).toLowerCase() === '<if:') {
      const comma = findInlineIfComma(line, index + 4)
      const end = comma >= 0 ? findInlineIfEnd(line, comma + 1) : -1
      if (comma >= 0 && end >= 0) {
        const expression = line.slice(index + 4, comma).trim()
        const content = line.slice(comma + 1, end)
        output += `<span data-ui-if-inline="${encodeURIComponent(expression)}" data-ui-if-content="${encodeURIComponent(content)}"></span>`
        index = end + 1
        continue
      }
    }
    const reference = inlineReferenceAt(line, index)
    if (reference) {
      output += `<span data-ui-ref="${encodeURIComponent(reference.id)}"></span>`
      index = reference.end
      continue
    }
    output += line[index]
    index += 1
  }
  return output
}

export interface PreprocessedMarkdown {
  text: string
  /**
   * lineMap[i] 为处理后第 i 行（0 基）对应的原始 Markdown 行号（0 基）。
   * 指令（折叠框、Tuack 表格等）展开出的行都会映射回其指令行，
   * 供编辑器把渲染结果对齐回源文本行号。
   */
  lineMap: number[]
  /** 文首文章排版指令（issue #59：::set-font / ::set-code-font / ::set-background）。 */
  directives: ArticleDirectives
}

/** 预处理 Markdown，支持折叠框与 Tuack 风格表格 */
export function preprocessMarkdownDetailed(
  md: string,
  options: { articleDirectives?: boolean } = {},
): PreprocessedMarkdown {
  if (!md) return { text: '', lineMap: [], directives: EMPTY_ARTICLE_DIRECTIVES }
  const lines = md.split('\n')
  // 文章排版指令只认文首（见 articleDirectives.ts）：先整段扫描出要移除的指令行，
  // 代码围栏、正文之后的同形文字都不会被当成指令。评论、展示框片段等非文章
  // 内容关闭此项，指令样文字按普通文本显示、不执行也不吞掉。
  const scanned =
    options.articleDirectives !== false
      ? scanArticleDirectives(lines)
      : { directives: EMPTY_ARTICLE_DIRECTIVES, directiveLines: new Set<number>() }
  const result: string[] = []
  const lineMap: number[] = []
  const stack: { colonsCount: number; type: string }[] = []
  let inCodeFence = false

  const push = (line: string, sourceLine: number) => {
    result.push(line)
    lineMap.push(sourceLine)
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // 扩展指令不应解析代码示例；否则文档中的语法会被执行而无法展示源码。
    if (/^\s*(`{3,}|~{3,})/.test(line)) {
      inCodeFence = !inCodeFence
      push(line, i)
      continue
    }
    if (inCodeFence) {
      push(line, i)
      continue
    }

    // 文首排版指令行（::set-font[…] 等）不是正文：整体移除，
    // 只留一个映射回原行的空行，保持编辑器双栏的行号对齐。
    if (scanned.directiveLines.has(i)) {
      push('', i)
      continue
    }

    // 交互展示框：::show_begin{标题}{变量定义} … ::show_end
    // 编码到 data attribute 后再由 React component 接管，可保留框内完整 Markdown。
    // The variable definition may itself contain braces, e.g. Q{faster_set}.
    // Capture its final closing brace rather than stopping at the directive's
    // inner `}`.
    const showMatch = line.match(/^\s*::show_begin\{([^}]*)\}\{([\s\S]*)\}\s*$/i)
    if (showMatch) {
      const body: string[] = []
      let end = i + 1
      while (end < lines.length && !/^\s*::show_end\s*$/i.test(lines[end])) {
        body.push(lines[end])
        end += 1
      }
      if (end < lines.length) {
        push(
          `<div data-show-box="true" data-show-title="${encodeURIComponent(showMatch[1])}" data-show-vars="${encodeURIComponent(showMatch[2])}" data-show-content="${encodeURIComponent(body.join('\n'))}"></div>`,
          i,
        )
        push('', i)
        i = end
        continue
      }
    }

    // 直角坐标系（issue #76）：::begin_ui-ccs … ::end_ui-ccs（可选 {标题}）
    const ccsMatch = line.match(/^\s*::begin_ui-ccs(?:\{([^}]*)\})?\s*$/i)
    if (ccsMatch) {
      const body: string[] = []
      let end = i + 1
      while (end < lines.length && !/^\s*::end_ui-ccs\s*$/i.test(lines[end])) {
        body.push(lines[end])
        end += 1
      }
      if (end < lines.length) {
        push(
          `<div data-ui-ccs="true" data-ccs-title="${encodeURIComponent(ccsMatch[1] ?? '')}" data-ccs-content="${encodeURIComponent(body.join('\n'))}"></div>`,
          i,
        )
        push('', i)
        i = end
        continue
      }
    }

    // Graph widget (issue #83): edges create their endpoint nodes automatically.
    const graphMatch = line.match(/^\s*::begin_ui-graph(?:\[([^\]]*)\])?\s*$/i)
    if (graphMatch) {
      const end = findMarkdownBlockEnd(lines, i + 1, (candidate) => /^\s*::end_ui-graph\s*$/i.test(candidate))
      const body = end >= 0 ? lines.slice(i + 1, end) : []
      if (end >= 0) {
        push(
          `<div data-ui-graph="true" data-graph-extra="${encodeURIComponent(graphMatch[1] ?? '')}" data-graph-content="${encodeURIComponent(body.join('\n'))}"></div>`,
          i,
        )
        push('', i)
        i = end
        continue
      }
    }

    // Choice / dropdown / yes-no controls (issue #82): keep full Markdown bodies in encoded data attributes.
    const chooseMatch = line.match(/^\s*::begin_ui-choose\[([^\]]*)\]\[([^\]]*)\](?:\[([^\]]*)\])?\s*$/i)
    if (chooseMatch) {
      const end = findMarkdownBlockEnd(lines, i + 1, (candidate) => /^\s*::end_ui-choose\s*$/i.test(candidate))
      const body = end >= 0 ? lines.slice(i + 1, end) : []
      if (end >= 0) {
        push(
          `<div data-ui-widget="choose" data-ui-id="${encodeURIComponent(chooseMatch[1])}" data-ui-title="${encodeURIComponent(chooseMatch[2])}" data-ui-extra="${encodeURIComponent(chooseMatch[3] ?? '')}" data-ui-content="${encodeURIComponent(body.join('\n'))}"></div>`,
          i,
        )
        push('', i)
        i = end
        continue
      }
    }

    const selectMatch = line.match(/^\s*::begin_ui-select\[([^\]]*)\](?:\[([^\]]*)\])?\s*$/i)
    if (selectMatch) {
      const end = findMarkdownBlockEnd(lines, i + 1, (candidate) => /^\s*::end_ui-select\s*$/i.test(candidate))
      const body = end >= 0 ? lines.slice(i + 1, end) : []
      if (end >= 0) {
        push(
          `<span data-ui-widget="select" data-ui-id="${encodeURIComponent(selectMatch[1])}" data-ui-title="${encodeURIComponent(selectMatch[1])}" data-ui-extra="${encodeURIComponent(selectMatch[2] ?? '')}" data-ui-content="${encodeURIComponent(body.join('\n'))}"></span>`,
          i,
        )
        i = end
        continue
      }
    }

    const uiIfMatch = line.match(/^\s*::begin_ui-if\[([^\]]*)\](?:\[([^\]]*)\])?\s*$/i)
    if (uiIfMatch) {
      const end = findMarkdownBlockEnd(lines, i + 1, (candidate) => /^\s*::end_ui-if\s*$/i.test(candidate))
      const body = end >= 0 ? lines.slice(i + 1, end) : []
      if (end >= 0) {
        push(
          `<div data-ui-widget="if" data-ui-id="${encodeURIComponent(uiIfMatch[1])}" data-ui-title="${encodeURIComponent(uiIfMatch[1])}" data-ui-extra="${encodeURIComponent(uiIfMatch[2] ?? '')}" data-ui-content="${encodeURIComponent(body.join('\n'))}"></div>`,
          i,
        )
        push('', i)
        i = end
        continue
      }
    }

    // Standalone new inputs can share one row when later directives explicitly request `merge`.
    const writeLineToken = parseUiWriteLine(line)
    if (writeLineToken) {
      const writeConfig = parseUiWriteConfig(writeLineToken.id, writeLineToken.options)
      if (writeConfig.newLine && !writeConfig.merge) {
        const row: Array<{ token: UiWriteToken; line: number }> = [{ token: writeLineToken, line: i }]
        let scan = i + 1
        let end = i
        while (scan < lines.length) {
          if (lines[scan].trim() === '') {
            scan += 1
            continue
          }
          const nextToken = parseUiWriteLine(lines[scan])
          if (!nextToken) break
          const nextConfig = parseUiWriteConfig(nextToken.id, nextToken.options)
          if (!nextConfig.newLine || !nextConfig.merge) break
          row.push({ token: nextToken, line: scan })
          end = scan
          scan += 1
        }
        if (row.length > 1) {
          const controls = row.map(({ token }) => uiWriteMarker(token, true)).join('')
          push(`<div data-ui-write-row="true">${controls}</div>`, i)
          push('', end)
          i = end
          continue
        }
      }
      if (writeConfig.newLine) {
        push(uiWriteMarker(writeLineToken), i)
        push('', i)
        continue
      }
    }

    // Conditional arbitrary Markdown block. Nested ::IF blocks are balanced before capturing.
    const conditionBlockMatch = line.match(/^\s*::IF\[([\s\S]*)\]\s*$/i)
    if (conditionBlockMatch) {
      const end = findConditionalBlockEnd(lines, i + 1)
      if (end >= 0) {
        push(
          `<div data-ui-if-block="${encodeURIComponent(conditionBlockMatch[1])}" data-ui-if-content="${encodeURIComponent(lines.slice(i + 1, end).join('\n'))}"></div>`,
          i,
        )
        push('', i)
        i = end
        continue
      }
    }

    // ::cute-table{tuack} 或 :::cute-table{tuack}
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
        push(transformInlineUiTokens(lines[j]), j)
        j++
      }
      push('', i)
      push('</div>', i)
      push('', i)
      i = j - 1
      continue
    }

    // Callout 闭合行：:::、:::: 等
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

    // Callout 开启行：::::info[标题]{open}
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

    push(transformInlineUiTokens(line), i)
  }

  while (stack.pop()) {
    const last = lines.length - 1
    push('', last)
    push('</div>', last)
    push('</details>', last)
  }

  return { text: result.join('\n'), lineMap, directives: scanned.directives }
}

export function preprocessMarkdown(md: string): string {
  return preprocessMarkdownDetailed(md).text
}

function decodeShowAttribute(value: string | undefined): string {
  if (!value) return ''
  try {
    return decodeURIComponent(value)
  } catch {
    return ''
  }
}

function renderMathInText(text: string, values: Record<string, import('../lib/uiChoices').UiStateValue> = {}): ReactNode {
  if (!text) return null
  // 匹配 $$display$$ 与 $inline$
  const parts: ReactNode[] = []
  let lastIndex = 0
  const regex = /(\$\$[\s\S]+?\$\$|\$[^\$\n]+?\$)/g
  let match: RegExpExecArray | null

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index))
    }
    const rawFormula = match[0]
    const isDisplay = rawFormula.startsWith('$$')
    const formula = resolveUiMathReferences(
      isDisplay ? rawFormula.slice(2, -2) : rawFormula.slice(1, -1),
      values,
    )
    try {
      const html = katex.renderToString(formula, {
        displayMode: isDisplay,
        throwOnError: false,
      })
      parts.push(
        <span
          key={`${match.index}-${rawFormula}`}
          dangerouslySetInnerHTML={{ __html: html }}
          className={isDisplay ? 'inline-block my-1' : 'inline'}
        />,
      )
    } catch {
      parts.push(rawFormula)
    }
    lastIndex = regex.lastIndex
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex))
  }

  return parts.length > 0 ? parts : text
}

function DynamicMath({ formula, display }: { formula: string; display: boolean }) {
  const syntax = useUiSyntaxContext()
  const resolved = resolveUiMathReferences(formula, syntax?.values ?? {})
  let html = ''
  try {
    html = katex.renderToString(resolved, {
      displayMode: display,
      throwOnError: false,
      strict: false,
      output: 'htmlAndMathml',
    })
  } catch {
    html = ''
  }
  if (!html) return <span className="text-rose-500" title="公式无法渲染">公式错误</span>
  return display ? (
    <div className="my-3 overflow-x-auto text-center" dangerouslySetInnerHTML={{ __html: html }} />
  ) : (
    <span className="inline-block align-middle" dangerouslySetInnerHTML={{ __html: html }} />
  )
}

function UiReference({ id }: { id: string }) {
  const syntax = useUiSyntaxContext()
  return <>{formatUiReference(id, syntax?.values ?? {})}</>
}

function UiInlineCondition({
  expression,
  content,
  urlTransform,
}: {
  expression: string
  content: string
  urlTransform?: UrlTransform
}) {
  const syntax = useUiSyntaxContext()
  if (!evaluateUiCondition(expression, syntax?.values ?? {})) return null
  return <InlineMarkdown content={content} urlTransform={urlTransform} />
}

/** Render inline conditional content as full Markdown without introducing a nested paragraph. */
function InlineMarkdown({ content, urlTransform }: { content: string; urlTransform?: UrlTransform }) {
  const components = useMemo(() => ({
    ...buildComponents(noSourceLine, urlTransform),
    p: ({ children }: { children?: ReactNode }) => <>{children}</>,
  }), [urlTransform])
  return (
    <ReactMarkdown
      urlTransform={urlTransform}
      remarkPlugins={[remarkGfm, remarkMath, remarkUiDynamicMath()]}
      rehypePlugins={[
        rehypeRaw,
        [rehypeSanitize, sanitizeSchema],
        rehypeRemoveHeadingIds(),
        [rehypeKatex, { strict: false, throwOnError: false, output: 'htmlAndMathml' }],
        [rehypeHighlight, { detect: true, ignoreMissing: true }],
      ]}
      components={components}
    >
      {transformInlineUiTokens(content)}
    </ReactMarkdown>
  )
}

function UiConditionalBlock({
  expression,
  content,
  sourceLine,
  urlTransform,
}: {
  expression: string
  content: string
  sourceLine?: number
  urlTransform?: UrlTransform
}) {
  const syntax = useUiSyntaxContext()
  if (!evaluateUiCondition(expression, syntax?.values ?? {})) return null
  return (
    <div className="ui-if-content" data-source-line={sourceLine}>
      <Markdown
        content={content}
        headingAnchors={false}
        urlTransform={urlTransform}
        applyDirectives={false}
      />
    </div>
  )
}

function CalloutSummary({
  children,
  node: _node,
  sourceLine,
  ...props
}: HTMLAttributes<HTMLElement> & {
  'data-callout'?: string
  'data-title'?: string
  node?: unknown
  sourceLine?: number
}) {
  const calloutType = props['data-callout'] || 'info'
  const rawTitle = props['data-title'] ? decodeShowAttribute(props['data-title']) : extractText(children)

  const defaultTitles: Record<string, string> = {
    info: '信息提示',
    note: '注记',
    tip: '提示',
    success: '成功',
    warning: '警告',
    error: '错误',
    danger: '危险',
  }

  const titleNode = rawTitle ? renderMathInText(rawTitle) : defaultTitles[calloutType] || '提示'

  const IconComponent =
    calloutType === 'success'
      ? CheckCircle2
      : calloutType === 'warning'
        ? AlertTriangle
        : calloutType === 'error' || calloutType === 'danger'
          ? AlertCircle
          : Info

  return (
    <summary {...props} data-source-line={sourceLine} className="callout-summary group/summary">
      <IconComponent size={16} className="shrink-0 transition-transform group-hover/summary:scale-110" />
      <span className="flex-1 font-semibold">{titleNode}</span>
      <ChevronRight
        size={16}
        className="callout-chevron shrink-0 text-ink-400 group-hover/summary:text-ink-600 dark:text-ink-500"
      />
    </summary>
  )
}

/** 智能表格：支持向上合并 (^) 与向左合并 (<) */
function SmartTable({
  children,
  node: _node,
  className,
  sourceLine,
  ...props
}: HTMLAttributes<HTMLTableElement> & { node?: unknown; sourceLine?: number }) {
  const isTuack = className?.includes('table-tuack')

  const childrenArray = Children.toArray(children)
  const newChildren = childrenArray.map((section) => {
    if (!isValidElement(section) || section.type !== 'tbody') return section

    const sectionChildren = section.props as { children?: ReactNode }
    const rowElements = Children.toArray(sectionChildren.children).filter(isValidElement)
    const rows = rowElements.map((tr) =>
      Children.toArray((tr.props as { children?: ReactNode }).children).filter(isValidElement),
    )

    const H = rows.length
    if (H === 0) return section
    const W = Math.max(...rows.map((r) => r.length))

    interface GridCell {
      element: React.ReactElement<React.TdHTMLAttributes<HTMLTableCellElement>> | null
      text: string
      row: number
      col: number
      rowspan: number
      colspan: number
      hidden: boolean
      parent: GridCell | null
    }

    const grid: GridCell[][] = []
    for (let r = 0; r < H; r++) {
      grid[r] = []
      for (let c = 0; c < W; c++) {
        const td = rows[r] && rows[r][c] ? (rows[r][c] as React.ReactElement<React.TdHTMLAttributes<HTMLTableCellElement>>) : null
        const text = td ? extractText(td.props.children).trim() : ''
        grid[r][c] = {
          element: td,
          text,
          row: r,
          col: c,
          rowspan: 1,
          colspan: 1,
          hidden: false,
          parent: null,
        }
      }
    }

    function getRoot(r: number, c: number): GridCell {
      let curr = grid[r][c]
      while (curr.parent) curr = curr.parent
      return curr
    }

    for (let r = 0; r < H; r++) {
      for (let c = 0; c < W; c++) {
        const cell = grid[r][c]
        const t = cell.text
        if (t === '<') {
          if (c > 0) {
            const root = getRoot(r, c - 1)
            if (root.row === r) root.colspan += 1
            cell.hidden = true
            cell.parent = root
          }
        } else if (t === '^') {
          if (r > 0) {
            const root = getRoot(r - 1, c)
            if (root.col === c) root.rowspan += 1
            cell.hidden = true
            cell.parent = root
          }
        }
      }
    }

    const newRows = rowElements.map((tr, r) => {
      const renderedCells = grid[r]
        .filter((c) => !c.hidden && c.element)
        .map((c) =>
          cloneElement(c.element!, {
            rowSpan: c.rowspan > 1 ? c.rowspan : undefined,
            colSpan: c.colspan > 1 ? c.colspan : undefined,
          } as React.TdHTMLAttributes<HTMLTableCellElement>),
        )
      return cloneElement(tr as React.ReactElement<{ children?: ReactNode }>, {}, renderedCells)
    })

    return cloneElement(section as React.ReactElement<{ children?: ReactNode }>, {}, newRows)
  })

  return (
    <div
      className={`markdown-table-wrapper${isTuack ? ' table-tuack-wrapper' : ''}`}
      role="region"
      aria-label="文章表格"
      tabIndex={0}
      data-source-line={sourceLine}
    >
      <table className={`markdown-table ${className || ''} ${isTuack ? 'table-tuack' : ''}`} {...props}>
        {newChildren}
      </table>
    </div>
  )
}

interface MarkdownProps {
  content: string
  headingAnchors?: boolean
  /** 预览宿主可重写本地资源 URL；博客默认使用 react-markdown 的安全规则。 */
  urlTransform?: UrlTransform
  /**
   * 为块级元素标注其对应的原始 Markdown 行号（data-source-line，1 基）。
   * 编辑器双栏视图用它做滚动同步锚点；其他场景保持关闭即可。
   */
  sourceLineMarkers?: boolean
  /**
   * 是否识别文首的文章排版指令（::set-font / ::set-code-font / ::set-background）：
   * 默认识别（移除指令行并让字体作用于本渲染区域）。评论等他人提交的内容与
   * 展示框内的片段应传 false——指令样文字按普通文本显示（与 GitHub 上一致），
   * 既不执行也不会被吞掉（issue #59）。
   */
  applyDirectives?: boolean
  /** Enable the in-preview graph adjustment control (used by the editor only). */
  allowGraphAdjust?: boolean
  /** Persist graph-node drags back into the source Markdown. */
  onGraphBodyChange?: (sourceLine: number, nextBody: string) => void
}

type SourceLineResolver = (node: unknown) => number | undefined

/** 在 sourceLineMarkers 关闭时不标注任何行号。 */
const noSourceLine: SourceLineResolver = () => undefined

/** 直接透传的块级标签（双栏同步时作为候选锚点）。 */
type UiDataAttributes = {
  'data-show-box'?: string
  'data-show-title'?: string
  'data-show-vars'?: string
  'data-show-content'?: string
  'data-ui-ccs'?: string
  'data-ccs-title'?: string
  'data-ccs-content'?: string
  'data-ui-widget'?: string
  'data-ui-id'?: string
  'data-ui-title'?: string
  'data-ui-extra'?: string
  'data-ui-content'?: string
  'data-ui-graph'?: string
  'data-graph-extra'?: string
  'data-graph-content'?: string
  'data-ui-ref'?: string
  'data-ui-if-inline'?: string
  'data-ui-if-content'?: string
  'data-ui-if-block'?: string
  'data-ui-math'?: string
  'data-ui-math-display'?: string
  'data-ui-write'?: string
  'data-ui-write-options'?: string
  'data-ui-write-new'?: string
  'data-ui-write-merge'?: string
  'data-ui-write-grouped'?: string
  'data-ui-write-row'?: string
}

const MARKER_TAGS = [
  'p',
  'h1',
  'h5',
  'h6',
  'ul',
  'ol',
  'li',
  'blockquote',
  'hr',
  'figure',
  'span',
  'details',
] as const

function buildComponents(
  marker: SourceLineResolver | null,
  urlTransform?: UrlTransform,
  allowGraphAdjust = false,
  onGraphBodyChange?: (sourceLine: number, nextBody: string) => void,
) {
  const toSourceLine: SourceLineResolver = marker ?? noSourceLine
  const passthrough = (tag: string) => {
    return function MarkerBlock({ node, ...rest }: { node?: unknown } & Record<string, unknown>) {
      return createElement(tag, {
        ...(rest as Record<string, unknown>),
        'data-source-line': toSourceLine(node),
      })
    }
  }

  return {
    pre: ({ node, children }: { node?: unknown; children?: ReactNode }) => (
      <CodeBlock sourceLine={toSourceLine(node)}>{children}</CodeBlock>
    ),
    h2: ({ node, id, children }: { node?: unknown; id?: string; children?: ReactNode }) => (
      <Heading level={2} id={id} sourceLine={toSourceLine(node)}>
        {children}
      </Heading>
    ),
    h3: ({ node, id, children }: { node?: unknown; id?: string; children?: ReactNode }) => (
      <Heading level={3} id={id} sourceLine={toSourceLine(node)}>
        {children}
      </Heading>
    ),
    h4: ({ node, id, children }: { node?: unknown; id?: string; children?: ReactNode }) => (
      <Heading level={4} id={id} sourceLine={toSourceLine(node)}>
        {children}
      </Heading>
    ),
    a: ({ node, href, children, ...rest }: { node?: unknown; href?: string; children?: ReactNode }) => {
      const external = !!href && /^https?:\/\//.test(href)
      return (
        <a
          href={href}
          {...rest}
          {...(external ? { target: '_blank', rel: 'noreferrer noopener' } : {})}
        >
          {children}
        </a>
      )
    },
    img: ({ src, alt }: { src?: string; alt?: string }) => {
      const raw = typeof src === 'string' ? src : ''
      const resolved = resolvePendingImageSrc(raw)
      // 离线版不联网：远程 / 站内图片地址会被解析成空串（见 resolveOfflineImageSrc）。
      // 这里显示一条明确说明而不是破图，避免看起来像「文章坏了」。
      if (!resolved) {
        return (
          <span className="my-3 flex flex-wrap items-center gap-2 rounded-xl border border-dashed border-ink-300/70 bg-ink-50/60 px-3 py-2 text-xs text-ink-500 dark:border-white/12 dark:bg-white/[0.03]">
            <WifiOff size={13} className="shrink-0" />
            <span>
              离线版不加载远程图片{alt ? `「${alt}」` : ''}
              {raw ? <span className="ml-1 break-all text-ink-400">（{raw}）</span> : null}
              ：把图片放进离线包（导出文章包时会带上本机暂存图片），或在线上站点查看。
            </span>
          </span>
        )
      }
      return <img src={resolved} alt={alt ?? ''} loading="lazy" decoding="async" />
    },
    table: ({
      node,
      children,
      className,
      ...props
    }: {
      node?: unknown
      children?: ReactNode
      className?: string
    } & HTMLAttributes<HTMLTableElement>) => (
      <SmartTable sourceLine={toSourceLine(node)} className={className} {...props}>
        {children}
      </SmartTable>
    ),
    span: ({ node, children, ...props }: HTMLAttributes<HTMLSpanElement> & UiDataAttributes & { node?: unknown }) => {
      const attributes = props as unknown as Record<string, string | undefined>
      if (attributes['data-ui-write-row'] === 'true') {
        return (
          <span className="ui-write-row not-prose mx-1 inline-flex max-w-full flex-wrap items-center gap-3 align-middle" data-source-line={toSourceLine(node)}>
            {children}
          </span>
        )
      }
      if (attributes['data-ui-ref']) {
        return <UiReference id={decodeShowAttribute(attributes['data-ui-ref'])} />
      }
      if (attributes['data-ui-math']) {
        return (
          <DynamicMath
            formula={decodeShowAttribute(attributes['data-ui-math'])}
            display={attributes['data-ui-math-display'] === 'true'}
          />
        )
      }
      if (attributes['data-ui-write']) {
        return (
          <UiWriteWidget
            id={decodeShowAttribute(attributes['data-ui-id'])}
            optionsJson={decodeShowAttribute(attributes['data-ui-write-options']) || '[]'}
            grouped={attributes['data-ui-write-grouped'] === 'true'}
            sourceLine={toSourceLine(node)}
          />
        )
      }
      if (attributes['data-ui-if-inline']) {
        return (
          <UiInlineCondition
            expression={decodeShowAttribute(attributes['data-ui-if-inline'])}
            content={decodeShowAttribute(attributes['data-ui-if-content'])}
            urlTransform={urlTransform}
          />
        )
      }
      if (attributes['data-ui-widget'] === 'select') {
        return (
          <UiChoiceWidget
            kind="select"
            id={decodeShowAttribute(attributes['data-ui-id'])}
            title={decodeShowAttribute(attributes['data-ui-title'])}
            extra={decodeShowAttribute(attributes['data-ui-extra'])}
            body={decodeShowAttribute(attributes['data-ui-content'])}
            sourceLine={toSourceLine(node)}
          />
        )
      }
      return <span {...props} data-source-line={toSourceLine(node)}>{children}</span>
    },
    div: ({ node, children, ...props }: HTMLAttributes<HTMLDivElement> & UiDataAttributes & { node?: unknown }) => {
      const attributes = props as unknown as Record<string, string | undefined>
      if (attributes['data-ui-write-row'] === 'true') {
        return (
          <div className="ui-write-row not-prose my-2 flex flex-wrap items-center gap-3" data-source-line={toSourceLine(node)}>
            {children}
          </div>
        )
      }
      if (attributes['data-ui-math']) {
        return (
          <DynamicMath
            formula={decodeShowAttribute(attributes['data-ui-math'])}
            display={attributes['data-ui-math-display'] === 'true'}
          />
        )
      }
      if (attributes['data-show-box'] === 'true') {
        return (
          <ShowBox
            title={decodeShowAttribute(attributes['data-show-title'])}
            variableSpec={decodeShowAttribute(attributes['data-show-vars'])}
            body={decodeShowAttribute(attributes['data-show-content'])}
            sourceLine={toSourceLine(node)}
            urlTransform={urlTransform}
          />
        )
      }
      if (attributes['data-ui-ccs'] === 'true') {
        return (
          <CoordinatePlane
            title={decodeShowAttribute(attributes['data-ccs-title'])}
            body={decodeShowAttribute(attributes['data-ccs-content'])}
            sourceLine={toSourceLine(node)}
          />
        )
      }
      if (attributes['data-ui-graph'] === 'true') {
        return (
          <CoordinateGraph
            body={decodeShowAttribute(attributes['data-graph-content'])}
            extra={decodeShowAttribute(attributes['data-graph-extra'])}
            sourceLine={toSourceLine(node)}
            allowAdjust={allowGraphAdjust}
            onSourceChange={onGraphBodyChange}
          />
        )
      }
      if (attributes['data-ui-widget'] === 'choose' || attributes['data-ui-widget'] === 'if') {
        return (
          <UiChoiceWidget
            kind={attributes['data-ui-widget']}
            id={decodeShowAttribute(attributes['data-ui-id'])}
            title={decodeShowAttribute(attributes['data-ui-title'])}
            extra={decodeShowAttribute(attributes['data-ui-extra'])}
            body={decodeShowAttribute(attributes['data-ui-content'])}
            sourceLine={toSourceLine(node)}
          />
        )
      }
      if (attributes['data-ui-if-block']) {
        return (
          <UiConditionalBlock
            expression={decodeShowAttribute(attributes['data-ui-if-block'])}
            content={decodeShowAttribute(attributes['data-ui-if-content'])}
            sourceLine={toSourceLine(node)}
            urlTransform={urlTransform}
          />
        )
      }
      return <div {...props} data-source-line={toSourceLine(node)}>{children}</div>
    },
    summary: ({ node, ...props }: { node?: unknown } & HTMLAttributes<HTMLElement>) => (
      <CalloutSummary {...props} sourceLine={toSourceLine(node)} />
    ),
    ...(marker
      ? Object.fromEntries(MARKER_TAGS.filter((tag) => tag !== 'span').map((tag) => [tag, passthrough(tag)]))
      : {}),
  }
}

const MarkdownRenderer = memo(function MarkdownRenderer({
  content,
  headingAnchors = true,
  sourceLineMarkers = false,
  urlTransform,
  applyDirectives = true,
  allowGraphAdjust = false,
  onGraphBodyChange,
}: MarkdownProps) {
  const processed = useMemo(
    () => preprocessMarkdownDetailed(content, { articleDirectives: applyDirectives }),
    [content, applyDirectives],
  )
  const needsSourcePositions = sourceLineMarkers || Boolean(onGraphBodyChange)

  const toSourceLine = useCallback<SourceLineResolver>(
    (node) => {
      if (!needsSourcePositions) return undefined
      const position = (node as { position?: { start?: { line?: number } } } | undefined)?.position
      const processedLine = position?.start?.line
      if (typeof processedLine !== 'number') return undefined
      const sourceIndex = processed.lineMap[processedLine - 1]
      return sourceIndex === undefined ? undefined : sourceIndex + 1
    },
    [needsSourcePositions, processed.lineMap],
  )

  const components = useMemo(
    () => buildComponents(
      needsSourcePositions ? toSourceLine : noSourceLine,
      urlTransform,
      allowGraphAdjust,
      onGraphBodyChange,
    ),
    [needsSourcePositions, toSourceLine, urlTransform, allowGraphAdjust, onGraphBodyChange],
  )

  return (
    <div
      className="prose prose-base dark:prose-invert prose-headings:font-semibold prose-headings:tracking-tight"
      style={applyDirectives ? articleFontStyle(processed.directives) : undefined}
    >
      <ReactMarkdown
        urlTransform={urlTransform}
        remarkPlugins={[remarkGfm, remarkMath, remarkUiDynamicMath()]}
        rehypePlugins={[
          rehypeRaw,
          [rehypeSanitize, sanitizeSchema],
          ...(headingAnchors
            ? [rehypeSlug, rehypeRemoveHeadingIds({ calloutsOnly: true })]
            : [rehypeRemoveHeadingIds()]),
          ...(sourceLineMarkers ? [rehypeMarkBlockMath()] : []),
          [rehypeKatex, { strict: false, throwOnError: false, output: 'htmlAndMathml' }],
          [rehypeHighlight, { detect: true, ignoreMissing: true }],
          ...(needsSourcePositions ? [rehypeInheritPositions()] : []),
        ]}
        components={components}
      >
        {processed.text}
      </ReactMarkdown>
    </div>
  )
})

export const Markdown = memo(function Markdown(props: MarkdownProps) {
  const parentSyntax = useContext(UiSyntaxContext)
  if (parentSyntax) return <MarkdownRenderer {...props} />
  return (
    <UiSyntaxProvider resetKey={props.content}>
      <MarkdownRenderer {...props} />
    </UiSyntaxProvider>
  )
})
