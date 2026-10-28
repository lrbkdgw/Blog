import { Children, cloneElement, createElement, isValidElement, memo, useCallback, useMemo, useRef, useState } from 'react'
import type { HTMLAttributes, ReactNode } from 'react'
import katex from 'katex'
import ReactMarkdown from 'react-markdown'
import type { UrlTransform } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeRaw from 'rehype-raw'
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize'
import rehypeKatex from 'rehype-katex'
import rehypeHighlight from 'rehype-highlight'
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
import { articleFontStyle } from '../lib/articleDirectives'
import {
  preprocessMarkdown,
  preprocessMarkdownDetailed,
  rehypeHeadingSlug,
  scrollToHeading,
  type PreprocessedMarkdown,
} from '../lib/headingSlug'
import {
  buildUiValueLookup,
  createInitialWidgetState,
  decodeUiPayload,
  extractUiWidgetDefs,
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

export { preprocessMarkdown, preprocessMarkdownDetailed }
export type { PreprocessedMarkdown }

const markdownSanitizeSchema = {
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames || []), 'details', 'summary', 'div', 'span', 'kbd'],
  attributes: {
    ...defaultSchema.attributes,
    '*': [...(defaultSchema.attributes?.['*'] || []), 'className', 'id'],
    details: [
      ...(defaultSchema.attributes?.details || []),
      'open',
      'dataCallout',
      'data-callout',
      'dataTitle',
      'data-title',
    ],
    summary: [
      ...(defaultSchema.attributes?.summary || []),
      'dataCallout',
      'data-callout',
      'dataTitle',
      'data-title',
    ],
    div: [
      ...(defaultSchema.attributes?.div || []),
      'dataShowBox',
      'data-show-box',
      'dataShowTitle',
      'data-show-title',
      'dataShowVars',
      'data-show-vars',
      'dataShowContent',
      'data-show-content',
      'dataUiCcs',
      'data-ui-ccs',
      'dataCcsTitle',
      'data-ccs-title',
      'dataCcsContent',
      'data-ccs-content',
      'dataUiChoose',
      'data-ui-choose',
      'dataUiIf',
      'data-ui-if',
      'dataUiWriteRow',
      'data-ui-write-row',
      'dataUiId',
      'data-ui-id',
      'dataUiPayload',
      'data-ui-payload',
      'dataUiGraph',
      'data-ui-graph',
      'dataGraphIndex',
      'data-graph-index',
      'dataGraphHeader',
      'data-graph-header',
      'dataGraphSource',
      'data-graph-source',
    ],
    span: [
      ...(defaultSchema.attributes?.span || []),
      'dataUiSelect',
      'data-ui-select',
      'dataUiWrite',
      'data-ui-write',
      'dataUiId',
      'data-ui-id',
      'dataUiPayload',
      'data-ui-payload',
    ],
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
  sourceEndLine,
}: {
  children?: ReactNode
  sourceLine?: number
  sourceEndLine?: number
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
    <div
      className="group relative my-6"
      data-source-line={sourceLine}
      data-source-line-end={sourceEndLine}
    >
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
  sourceEndLine,
  children,
}: {
  level: 2 | 3 | 4
  id?: string
  sourceLine?: number
  sourceEndLine?: number
  children?: ReactNode
}) {
  const Tag = `h${level}` as 'h2' | 'h3' | 'h4'
  return (
    <Tag
      id={id}
      data-source-line={sourceLine}
      data-source-line-end={sourceEndLine}
      className="group/heading relative"
    >
      {children}
      {id && (
        <a
          href={`#${encodeURIComponent(id)}`}
          aria-label="锚点链接"
          onClick={(e) => {
            if (scrollToHeading(id)) {
              e.preventDefault()
            }
          }}
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

const LINED_BLOCK_CONTAINERS = new Set([
  'p',
  'li',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'td',
  'th',
  'figcaption',
])

const NON_INLINE_TAGS = new Set([
  'div',
  'p',
  'ul',
  'ol',
  'li',
  'pre',
  'table',
  'thead',
  'tbody',
  'tr',
  'td',
  'th',
  'blockquote',
  'details',
  'summary',
  'section',
  'hr',
  'figure',
  'figcaption',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
])

function isInlineLinedNode(node: RehypeNode): boolean {
  if (node.type === 'text') return true
  if (node.type !== 'element') return false
  if (NON_INLINE_TAGS.has(node.tagName || '')) return false
  if (classNames(node.properties?.className).includes('katex-display')) return false
  return true
}

function hasVisibleInlineContent(nodes: RehypeNode[]): boolean {
  for (const n of nodes) {
    if (n.type === 'text' && (n as { value?: string }).value?.trim()) return true
    if (n.type === 'element' && n.tagName !== 'br') return true
  }
  return false
}

/**
 * 为 `ui-if[...][lined]` 的每个段落/列表项内联片段包裹 `.ui-if-strike-text`，
 * 配合 CSS `display: inline; box-decoration-break: clone` 实现支持多行折行、
 * `<br>` 换行与多段落的逐行平滑删除线动画。
 */
function rehypeWrapLinedRuns() {
  return function wrapLinedRunsPlugin() {
    return (tree: RehypeNode) => {
      const visit = (node: RehypeNode) => {
        if (!Array.isArray(node.children)) return

        if (node.type === 'element' && LINED_BLOCK_CONTAINERS.has(node.tagName || '')) {
          const nextChildren: RehypeNode[] = []
          let inlineBuffer: RehypeNode[] = []

          const flushBuffer = () => {
            if (inlineBuffer.length === 0) return
            if (hasVisibleInlineContent(inlineBuffer)) {
              nextChildren.push({
                type: 'element',
                tagName: 'span',
                properties: { className: ['ui-if-strike-text'] },
                children: inlineBuffer,
              })
            } else {
              nextChildren.push(...inlineBuffer)
            }
            inlineBuffer = []
          }

          for (const child of node.children) {
            if (isInlineLinedNode(child)) {
              inlineBuffer.push(child)
            } else {
              flushBuffer()
              visit(child)
              nextChildren.push(child)
            }
          }
          flushBuffer()
          node.children = nextChildren
          return
        }

        for (const child of node.children) {
          visit(child)
        }
      }

      visit(tree)
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

/** 上层元素缺失 position 时从有 position 的子元素回填首尾范围，并向上合并子元素的最大结束行（如 rehype-raw 生成的 details）。 */
function rehypeInheritPositions() {
  return function inheritPositionsPlugin() {
    return (tree: RehypeNode) => {
      const walk = (node: RehypeNode) => {
        for (const child of node.children || []) walk(child)
        if (node.type !== 'element') return
        const positioned = (node.children || []).filter((child) => child.position?.start?.line)
        if (positioned.length === 0) return
        let maxEndLine = node.position?.end?.line ?? node.position?.start?.line ?? 0
        for (const child of positioned) {
          const childEnd = child.position?.end?.line ?? child.position?.start?.line ?? 0
          if (childEnd > maxEndLine) maxEndLine = childEnd
        }
        if (!node.position) {
          const first = positioned[0]
          node.position = {
            start: first.position!.start,
            end: maxEndLine > 0 ? { line: maxEndLine } : first.position!.end ?? first.position!.start,
          }
        } else if (maxEndLine > (node.position.end?.line ?? node.position.start?.line ?? 0)) {
          node.position = {
            start: node.position.start,
            end: { ...(node.position.end || {}), line: maxEndLine },
          }
        }
      }
      walk(tree)
    }
  }
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
  sourceEndLine,
  ...props
}: HTMLAttributes<HTMLElement> & {
  'data-callout'?: string
  'data-title'?: string
  node?: unknown
  sourceLine?: number
  sourceEndLine?: number
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
    <summary
      {...props}
      data-source-line={sourceLine}
      data-source-line-end={sourceEndLine}
      className="callout-summary group/summary"
    >
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
  sourceEndLine,
  ...props
}: HTMLAttributes<HTMLTableElement> & {
  node?: unknown
  sourceLine?: number
  sourceEndLine?: number
}) {
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
      data-source-line-end={sourceEndLine}
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
  /**
   * 内部开关：由 `::begin_ui-if[...][lined]` 开启，为每个文本块/列表项的内联片段包裹 `.ui-if-strike-text`，
   * 实现支持多行折行、单行换行与多段落的逐行平滑删除线动画。
   */
  linedStrikethrough?: boolean
  /**
   * 内部开关：供交互控件（选择框、是否框）内部嵌套 Markdown 使用，移除正文级 `prose-base` 大字号与大行距。
   */
  compact?: boolean
}

type SourceLineRange = { start: number; end: number }
type SourceLineResolver = (node: unknown) => SourceLineRange | undefined

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
  const resolveRange: SourceLineResolver = marker ?? noSourceLine
  const lineProps = (node: unknown) => {
    const r = resolveRange(node)
    return { sourceLine: r?.start, sourceEndLine: r?.end }
  }
  const dataLineAttrs = (node: unknown) => {
    const r = resolveRange(node)
    return { 'data-source-line': r?.start, 'data-source-line-end': r?.end }
  }
  const passthrough = (tag: string) => {
    return function MarkerBlock({ node, ...rest }: { node?: unknown } & Record<string, unknown>) {
      return createElement(tag, {
        ...(rest as Record<string, unknown>),
        ...dataLineAttrs(node),
      })
    }
  }

  return {
    pre: ({ node, children }: { node?: unknown; children?: ReactNode }) => (
      <CodeBlock {...lineProps(node)}>{children}</CodeBlock>
    ),
    h2: ({ node, id, children }: { node?: unknown; id?: string; children?: ReactNode }) => (
      <Heading level={2} id={id} {...lineProps(node)}>
        {children}
      </Heading>
    ),
    h3: ({ node, id, children }: { node?: unknown; id?: string; children?: ReactNode }) => (
      <Heading level={3} id={id} {...lineProps(node)}>
        {children}
      </Heading>
    ),
    h4: ({ node, id, children }: { node?: unknown; id?: string; children?: ReactNode }) => (
      <Heading level={4} id={id} {...lineProps(node)}>
        {children}
      </Heading>
    ),
    p: ({ node, children, ...rest }: { node?: unknown; children?: ReactNode } & HTMLAttributes<HTMLParagraphElement>) => {
      const widgetKey = findEmbeddedWidgetKey(children)
      return (
        <p key={widgetKey} {...rest} {...dataLineAttrs(node)}>
          {children}
        </p>
      )
    },
    a: ({
      node: _node,
      href,
      children,
      onClick,
      ...rest
    }: {
      node?: unknown
      href?: string
      children?: ReactNode
    } & React.AnchorHTMLAttributes<HTMLAnchorElement>) => {
      const external = !!href && /^https?:\/\//.test(href)
      const inPageAnchor = !!href && href.startsWith('#') && !href.startsWith('#/') && href.length > 1
      return (
        <a
          href={href}
          {...rest}
          onClick={(e) => {
            onClick?.(e)
            if (!e.defaultPrevented && inPageAnchor && href) {
              if (scrollToHeading(href)) {
                e.preventDefault()
              }
            }
          }}
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
      <SmartTable {...lineProps(node)} className={className} {...props}>
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
            {...lineProps(node)}
            urlTransform={urlTransform}
          />
        )
      }
      if (attributes['data-ui-ccs'] === 'true') {
        return (
          <CoordinatePlane
            title={decodeShowAttribute(attributes['data-ccs-title'])}
            body={decodeShowAttribute(attributes['data-ccs-content'])}
            {...lineProps(node)}
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
            {...lineProps(node)}
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
        if (def) return <UiChooseCard key={`ui-choose-${def.id}`} def={def} {...lineProps(node)} />
      }
      if (attributes['data-ui-if'] === 'true') {
        const def = decodeUiPayload<UiIfWidgetDef>(attributes['data-ui-payload'])
        if (def) return <UiIfCard key={`ui-if-${def.id}`} def={def} {...lineProps(node)} />
      }
      if (attributes['data-ui-write-row'] === 'true') {
        const defs = decodeUiPayload<UiWriteWidgetDef[]>(attributes['data-ui-payload'])
        if (defs && defs.length > 0) {
          return <UiWriteRow key={`ui-write-row-${defs[0].id}`} defs={defs} {...lineProps(node)} />
        }
      }
      return <div {...props} {...dataLineAttrs(node)}>{children}</div>
    },
    summary: ({ node, ...props }: { node?: unknown } & HTMLAttributes<HTMLElement>) => (
      <CalloutSummary {...props} {...lineProps(node)} />
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
        <span {...props} {...dataLineAttrs(node)}>
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
  linedStrikethrough = false,
  compact = false,
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
    (fragment: string, options?: { linedStrikethrough?: boolean }) => (
      <Markdown
        content={fragment}
        headingAnchors={false}
        applyDirectives={false}
        urlTransform={urlTransform}
        linedStrikethrough={options?.linedStrikethrough}
        compact
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
  const endLineMapRef = useRef<number[]>(processed.endLineMap)
  endLineMapRef.current = processed.endLineMap

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
    const position = (
      node as { position?: { start?: { line?: number }; end?: { line?: number } } } | undefined
    )?.position
    const startProcessedLine = position?.start?.line
    if (typeof startProcessedLine !== 'number') return undefined
    const startSourceIndex = lineMapRef.current[startProcessedLine - 1]
    if (startSourceIndex === undefined) return undefined
    const endProcessedLine = position?.end?.line ?? startProcessedLine
    const endSourceIndex =
      endLineMapRef.current[endProcessedLine - 1] ??
      lineMapRef.current[endProcessedLine - 1] ??
      startSourceIndex
    return {
      start: startSourceIndex + 1,
      end: Math.max(startSourceIndex + 1, endSourceIndex + 1),
    }
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
        className={
          compact
            ? 'prose prose-sm max-w-none dark:prose-invert prose-headings:font-semibold prose-headings:tracking-tight'
            : 'prose prose-base dark:prose-invert prose-headings:font-semibold prose-headings:tracking-tight'
        }
        style={applyDirectives ? articleFontStyle(processed.directives) : undefined}
      >
        <ReactMarkdown
          urlTransform={urlTransform}
          remarkPlugins={[remarkGfm, remarkMath]}
          rehypePlugins={[
            rehypeRaw,
            [rehypeSanitize, markdownSanitizeSchema],
            rehypeHeadingSlug({ enabled: headingAnchors, skipCallouts: true }),
            ...(sourceLineMarkers ? [rehypeMarkBlockMath()] : []),
            [rehypeKatex, { strict: false, throwOnError: false, output: 'htmlAndMathml' }],
            [rehypeHighlight, { detect: true, ignoreMissing: true }],
            ...(linedStrikethrough ? [rehypeWrapLinedRuns()] : []),
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
