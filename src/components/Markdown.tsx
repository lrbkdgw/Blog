import { Children, cloneElement, createElement, isValidElement, memo, useCallback, useMemo, useState } from 'react'
import type { HTMLAttributes, ReactNode } from 'react'
import 'katex/dist/katex.min.css'
import katex from 'katex'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeRaw from 'rehype-raw'
import rehypeKatex from 'rehype-katex'
import rehypeHighlight from 'rehype-highlight'
import rehypeSlug from 'rehype-slug'
import { ShowBox } from './ShowBox'
import {
  AlertCircle,
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronRight,
  Copy,
  Info,
  Link2,
} from 'lucide-react'

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
}

/** 预处理 Markdown，支持折叠框与 Tuack 风格表格 */
export function preprocessMarkdownDetailed(md: string): PreprocessedMarkdown {
  if (!md) return { text: '', lineMap: [] }
  const lines = md.split('\n')
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
        push(lines[j], j)
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

    push(line, i)
  }

  while (stack.pop()) {
    const last = lines.length - 1
    push('', last)
    push('</div>', last)
    push('</details>', last)
  }

  return { text: result.join('\n'), lineMap }
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
  const rawTitle = props['data-title'] ? decodeURIComponent(props['data-title']) : extractText(children)

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
      className="markdown-table-wrapper"
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
  /**
   * 为块级元素标注其对应的原始 Markdown 行号（data-source-line，1 基）。
   * 编辑器双栏视图用它做滚动同步锚点；其他场景保持关闭即可。
   */
  sourceLineMarkers?: boolean
}

type SourceLineResolver = (node: unknown) => number | undefined

/** 在 sourceLineMarkers 关闭时不标注任何行号。 */
const noSourceLine: SourceLineResolver = () => undefined

/** 直接透传的块级标签（双栏同步时作为候选锚点）。 */
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

function buildComponents(marker: SourceLineResolver | null) {
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
    img: ({ src, alt }: { src?: string; alt?: string }) => (
      <img src={typeof src === 'string' ? src : ''} alt={alt ?? ''} loading="lazy" decoding="async" />
    ),
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
      }
      if (attributes['data-show-box'] === 'true') {
        return (
          <ShowBox
            title={decodeShowAttribute(attributes['data-show-title'])}
            variableSpec={decodeShowAttribute(attributes['data-show-vars'])}
            body={decodeShowAttribute(attributes['data-show-content'])}
            sourceLine={toSourceLine(node)}
          />
        )
      }
      return <div {...props} data-source-line={toSourceLine(node)}>{children}</div>
    },
    summary: ({ node, ...props }: { node?: unknown } & HTMLAttributes<HTMLElement>) => (
      <CalloutSummary {...props} sourceLine={toSourceLine(node)} />
    ),
    ...(marker
      ? Object.fromEntries(MARKER_TAGS.map((tag) => [tag, passthrough(tag)]))
      : {}),
  }
}

export const Markdown = memo(function Markdown({
  content,
  headingAnchors = true,
  sourceLineMarkers = false,
}: MarkdownProps) {
  const processed = useMemo(() => preprocessMarkdownDetailed(content), [content])

  const toSourceLine = useCallback<SourceLineResolver>(
    (node) => {
      if (!sourceLineMarkers) return undefined
      const position = (node as { position?: { start?: { line?: number } } } | undefined)?.position
      const processedLine = position?.start?.line
      if (typeof processedLine !== 'number') return undefined
      const sourceIndex = processed.lineMap[processedLine - 1]
      return sourceIndex === undefined ? undefined : sourceIndex + 1
    },
    [sourceLineMarkers, processed.lineMap],
  )

  const components = useMemo(
    () => buildComponents(sourceLineMarkers ? toSourceLine : noSourceLine),
    [sourceLineMarkers, toSourceLine],
  )

  return (
    <div className="prose prose-base dark:prose-invert prose-headings:font-semibold prose-headings:tracking-tight">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[
          rehypeRaw,
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
  )
})
