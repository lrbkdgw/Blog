import { Children, cloneElement, createElement, isValidElement, memo, useCallback, useMemo, useRef, useState } from 'react'
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
import { GraphPlane } from './GraphPlane'
import {
  UiChooseCard,
  UiIfCard,
  UiSelectInline,
  UiWidgetsContext,
  UiWriteField,
  UiWriteRow,
  type UiWidgetsContextValue,
} from './UiWidgets'
import { resolvePendingImageSrc } from '../lib/updateQueue'
import {
  EMPTY_ARTICLE_DIRECTIVES,
  articleFontStyle,
  scanArticleDirectives,
  type ArticleDirectives,
} from '../lib/articleDirectives'
import {
  buildUiValueLookup,
  createInitialWidgetState,
  decodeUiPayload,
  encodeUiPayload,
  evaluateUiCondition,
  expandInlineIfDirectives,
  extractUiWidgetDefs,
  parseUiChooseBlock,
  parseUiIfBlock,
  parseUiSelectBlock,
  parseUiWriteToken,
  substituteUiPlaceholdersInLine,
  type UiChooseWidgetDef,
  type UiIfWidgetDef,
  type UiSelectWidgetDef,
  type UiStateMap,
  type UiWidgetState,
  type UiWriteWidgetDef,
} from '../lib/uiWidgets'
import { updateUiGraphBlockPositions } from '../lib/uiGraph'
import {
  WifiOff,
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
      // 站内预处理生成的结构属性：折叠框、交互展示框、直角坐标系、交互表单控件与图论画布
      'dataCallout',
      'dataTitle',
      'dataShowBox',
      'dataShowTitle',
      'dataShowVars',
      'dataShowContent',
      'dataUiCcs',
      'dataCcsTitle',
      'dataCcsContent',
      'dataUiChoose',
      'dataUiSelect',
      'dataUiIf',
      'dataUiWrite',
      'dataUiWriteRow',
      'dataUiPayload',
      'dataUiId',
      'dataUiGraph',
      'dataGraphHeader',
      'dataGraphSource',
      'dataGraphIndex',
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

/** 提取子树中第一个交互控件 ID，用作上层 `<p>` 的稳定 React key，防止上方条件块显隐切换时打断输入框焦点。 */
function findEmbeddedWidgetKey(node: ReactNode): string | undefined {
  if (node == null || typeof node === 'boolean' || typeof node === 'string' || typeof node === 'number') {
    return undefined
  }
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findEmbeddedWidgetKey(child)
      if (found) return found
    }
    return undefined
  }
  if (isValidElement(node)) {
    const props = node.props as Record<string, unknown>
    if (typeof props['data-ui-id'] === 'string' && props['data-ui-id']) {
      return `ui-host-${props['data-ui-id']}`
    }
    return findEmbeddedWidgetKey(props.children as ReactNode)
  }
  return undefined
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
  properties?: Record<string, unknown>
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

/** 预处理 Markdown，支持折叠框、Tuack 表格、坐标系、交互表单控件、条件映射与图论画布 */
export function preprocessMarkdownDetailed(
  md: string,
  options: {
    articleDirectives?: boolean
    uiLookup?: { exact: Map<string, string>; lower: Map<string, string> }
  } = {},
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

  // 若调用方未显式传入 uiLookup，则自动按本文声明的 UI 控件初始状态构建映射表
  const lookup =
    options.uiLookup ??
    (() => {
      const defs = extractUiWidgetDefs(md)
      const defaults: UiStateMap = {}
      for (const d of defs) defaults[d.id] = createInitialWidgetState(d)
      return buildUiValueLookup(defs, defaults)
    })()

  const result: string[] = []
  const lineMap: number[] = []
  const stack: { colonsCount: number; type: string }[] = []
  const ifStack: boolean[] = []
  let inCodeFence = false
  let rawGraphIndex = -1

  const isIfActive = () => ifStack.every(Boolean)

  const push = (line: string, sourceLine: number) => {
    result.push(line)
    lineMap.push(sourceLine)
  }

  const transformLineText = (rawLine: string) =>
    expandInlineIfDirectives(substituteUiPlaceholdersInLine(rawLine, lookup))

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i]

    // 扩展指令不应解析代码示例；否则文档中的语法会被执行而无法展示源码。
    if (/^\s*(`{3,}|~{3,})/.test(rawLine)) {
      inCodeFence = !inCodeFence
      if (isIfActive()) push(rawLine, i)
      continue
    }
    if (inCodeFence) {
      if (isIfActive()) push(rawLine, i)
      continue
    }

    // 文首排版指令行（::set-font[…] 等）不是正文：整体移除，
    // 只留一个映射回原行的空行，保持编辑器双栏的行号对齐。
    if (scanned.directiveLines.has(i)) {
      push('', i)
      continue
    }

    // 最高优先级替换 <<id>> / <id> / <<id-number>> / <id-number>
    const subLine = substituteUiPlaceholdersInLine(rawLine, lookup)

    // 块级条件渲染：::IF[<a>] … ::IF_END（支持任意多层嵌套）
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

    // 图论画布（issue #83）：::begin_ui-graph[<附加项>] … ::end_ui-graph
    // 注意：即使位于条件为假的 ::IF 块中，也要递增 rawGraphIndex 以保证源码写回索引严格对齐！
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
          )
          push('', i)
        }
        i = end
        continue
      }
    }

    if (!isIfActive()) {
      continue
    }

    const line = expandInlineIfDirectives(subLine)

    // 选择框（issue #82）：::begin_ui-choose[<id>][<name>][<附加项>] … ::end_ui-choose
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
          )
          push('', i)
        }
        i = end
        continue
      }
    }

    // 下拉选择框（issue #82）：::begin_ui-select[<id>][<附加项>] … ::end_ui-select（紧跟在上一行文本后）
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

    // 是否框（issue #82）：::begin_ui-if[<id>][<附加项>] … ::end_ui-if
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
          )
          push('', i)
        }
        i = end
        continue
      }
    }

    // 块级填空框（issue #82）：`new` 独占一行；后续紧接且中间无任何非空内容的 `new` + `merge` 共用同一行
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
      )
      push('', i)
      i = lastConsumed
      continue
    }

    // 交互展示框：::show_begin{标题}{变量定义} … ::show_end
    // 编码到 data attribute 后再由 React component 接管，可保留框内完整 Markdown。
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
        body.push(transformLineText(lines[end]))
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
        push(expandInlineWriteDirectives(transformLineText(lines[j])), j)
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

    // 行内 ::ui-write[...]（若嵌在行中带 [new] 则自动拆行）
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

function renderMathInText(text: string): ReactNode {
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
    const formula = isDisplay ? rawFormula.slice(2, -2) : rawFormula.slice(1, -1)
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
  /**
   * 文章编辑模式下传入：允许可视化交互组件（如图论画布「调整模式」）将修改写回 Markdown 源码。
   */
  onContentChange?: (updater: (prevMarkdown: string) => string) => void
}

type SourceLineResolver = (node: unknown) => number | undefined

/** 在 sourceLineMarkers 关闭时不标注任何行号。 */
const noSourceLine: SourceLineResolver = () => undefined

/** 直接透传的块级标签（双栏同步时作为候选锚点）。 */
const MARKER_TAGS = [
  'h1',
  'h5',
  'h6',
  'ul',
  'ol',
  'li',
  'blockquote',
  'hr',
  'figure',
  'details',
] as const

function buildComponents(
  marker: SourceLineResolver | null,
  urlTransform?: UrlTransform,
  onContentChange?: (updater: (prevMarkdown: string) => string) => void,
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
    p: ({ node, children, ...rest }: { node?: unknown; children?: ReactNode } & HTMLAttributes<HTMLParagraphElement>) => {
      const widgetKey = findEmbeddedWidgetKey(children)
      return (
        <p key={widgetKey} {...rest} data-source-line={toSourceLine(node)}>
          {children}
        </p>
      )
    },
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
    div: ({ node, children, ...props }: { node?: unknown; children?: ReactNode }) => {
      const attributes = props as React.HTMLAttributes<HTMLDivElement> & {
        'data-show-box'?: string
        'data-show-title'?: string
        'data-show-vars'?: string
        'data-show-content'?: string
        'data-ui-ccs'?: string
        'data-ccs-title'?: string
        'data-ccs-content'?: string
        'data-ui-choose'?: string
        'data-ui-if'?: string
        'data-ui-write-row'?: string
        'data-ui-payload'?: string
        'data-ui-id'?: string
        'data-ui-graph'?: string
        'data-graph-header'?: string
        'data-graph-source'?: string
        'data-graph-index'?: string
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
        const graphIdx = Number.parseInt(attributes['data-graph-index'] ?? '0', 10)
        return (
          <GraphPlane
            key={`ui-graph-${graphIdx}`}
            header={decodeShowAttribute(attributes['data-graph-header'])}
            source={decodeShowAttribute(attributes['data-graph-source'])}
            sourceLine={toSourceLine(node)}
            onCommitPositions={
              onContentChange
                ? (positions) => {
                    onContentChange((prev) => updateUiGraphBlockPositions(prev, graphIdx, positions))
                  }
                : undefined
            }
          />
        )
      }
      if (attributes['data-ui-choose'] === 'true') {
        const def = decodeUiPayload<UiChooseWidgetDef>(attributes['data-ui-payload'])
        if (def) return <UiChooseCard key={`ui-choose-${def.id}`} def={def} sourceLine={toSourceLine(node)} />
      }
      if (attributes['data-ui-if'] === 'true') {
        const def = decodeUiPayload<UiIfWidgetDef>(attributes['data-ui-payload'])
        if (def) return <UiIfCard key={`ui-if-${def.id}`} def={def} sourceLine={toSourceLine(node)} />
      }
      if (attributes['data-ui-write-row'] === 'true') {
        const defs = decodeUiPayload<UiWriteWidgetDef[]>(attributes['data-ui-payload'])
        if (defs && defs.length > 0) {
          return <UiWriteRow key={`ui-write-row-${defs[0].id}`} defs={defs} sourceLine={toSourceLine(node)} />
        }
      }
      return <div {...props} data-source-line={toSourceLine(node)}>{children}</div>
    },
    summary: ({ node, ...props }: { node?: unknown } & HTMLAttributes<HTMLElement>) => (
      <CalloutSummary {...props} sourceLine={toSourceLine(node)} />
    ),
    ...(marker
      ? Object.fromEntries(MARKER_TAGS.map((tag) => [tag, passthrough(tag)]))
      : {}),
    span: ({ node, children, ...props }: { node?: unknown; children?: ReactNode } & HTMLAttributes<HTMLSpanElement>) => {
      const attributes = props as HTMLAttributes<HTMLSpanElement> & {
        'data-ui-select'?: string
        'data-ui-write'?: string
        'data-ui-payload'?: string
      }
      if (attributes['data-ui-select'] === 'true') {
        const def = decodeUiPayload<UiSelectWidgetDef>(attributes['data-ui-payload'])
        if (def) return <UiSelectInline key={`ui-select-${def.id}`} def={def} />
      }
      if (attributes['data-ui-write'] === 'true') {
        const def = decodeUiPayload<UiWriteWidgetDef>(attributes['data-ui-payload'])
        if (def) return <UiWriteField key={`ui-write-${def.id}`} def={def} />
      }
      return (
        <span {...props} data-source-line={toSourceLine(node)}>
          {children}
        </span>
      )
    },
  }
}

export const Markdown = memo(function Markdown({
  content,
  headingAnchors = true,
  sourceLineMarkers = false,
  urlTransform,
  applyDirectives = true,
  onContentChange,
}: MarkdownProps) {
  const widgetDefs = useMemo(() => extractUiWidgetDefs(content), [content])
  const [userWidgetStates, setUserWidgetStates] = useState<UiStateMap>({})

  const effectiveUiStates = useMemo<UiStateMap>(() => {
    const merged: UiStateMap = {}
    for (const def of widgetDefs) {
      const prev = userWidgetStates[def.id]
      if (prev && prev.kind === def.kind) {
        merged[def.id] = prev
      } else {
        merged[def.id] = createInitialWidgetState(def)
      }
    }
    return merged
  }, [widgetDefs, userWidgetStates])

  const setWidgetState = useCallback((id: string, next: UiWidgetState) => {
    setUserWidgetStates((prev) => ({ ...prev, [id]: next }))
  }, [])

  const uiLookup = useMemo(
    () => buildUiValueLookup(widgetDefs, effectiveUiStates),
    [widgetDefs, effectiveUiStates],
  )

  const renderMarkdownBlock = useCallback(
    (fragment: string) => (
      <Markdown
        content={fragment}
        headingAnchors={false}
        applyDirectives={false}
        urlTransform={urlTransform}
      />
    ),
    [urlTransform],
  )

  const uiContextValue = useMemo<UiWidgetsContextValue>(
    () => ({
      states: effectiveUiStates,
      setWidgetState,
      renderMarkdownBlock,
    }),
    [effectiveUiStates, setWidgetState, renderMarkdownBlock],
  )

  const processed = useMemo(
    () =>
      preprocessMarkdownDetailed(content, {
        articleDirectives: applyDirectives,
        uiLookup,
      }),
    [content, applyDirectives, uiLookup],
  )

  const lineMapRef = useRef<number[]>(processed.lineMap)
  lineMapRef.current = processed.lineMap

  const onContentChangeRef = useRef(onContentChange)
  onContentChangeRef.current = onContentChange

  const hasContentChangeHandler = Boolean(onContentChange)
  const stableOnContentChange = useMemo<MarkdownProps['onContentChange']>(
    () =>
      hasContentChangeHandler
        ? (updater) => {
            onContentChangeRef.current?.(updater)
          }
        : undefined,
    [hasContentChangeHandler],
  )

  const toSourceLine = useCallback<SourceLineResolver>((node) => {
    const position = (node as { position?: { start?: { line?: number } } } | undefined)?.position
    const processedLine = position?.start?.line
    if (typeof processedLine !== 'number') return undefined
    const sourceIndex = lineMapRef.current[processedLine - 1]
    return sourceIndex === undefined ? undefined : sourceIndex + 1
  }, [])

  const components = useMemo(
    () =>
      buildComponents(
        sourceLineMarkers ? toSourceLine : noSourceLine,
        urlTransform,
        stableOnContentChange,
      ),
    [sourceLineMarkers, toSourceLine, urlTransform, stableOnContentChange],
  )

  return (
    <UiWidgetsContext.Provider value={uiContextValue}>
      <div
        className="prose prose-base dark:prose-invert prose-headings:font-semibold prose-headings:tracking-tight"
        style={applyDirectives ? articleFontStyle(processed.directives) : undefined}
      >
        <ReactMarkdown
          urlTransform={urlTransform}
          remarkPlugins={[remarkGfm, remarkMath]}
          rehypePlugins={[
            rehypeRaw,
            [rehypeSanitize, sanitizeSchema],
            ...(headingAnchors
              ? [rehypeSlug, rehypeRemoveHeadingIds({ calloutsOnly: true })]
              : [rehypeRemoveHeadingIds()]),
            ...(sourceLineMarkers ? [rehypeMarkBlockMath()] : []),
            [rehypeKatex, { strict: false, throwOnError: false, output: 'htmlAndMathml' }],
            [rehypeHighlight, { detect: true, ignoreMissing: true }],
            ...(sourceLineMarkers ? [rehypeInheritPositions()] : []),
          ]}
          components={components}
        >
          {processed.text}
        </ReactMarkdown>
      </div>
    </UiWidgetsContext.Provider>
  )
})
