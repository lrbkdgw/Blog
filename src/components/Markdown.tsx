import { isValidElement, memo, useState } from 'react'
import type { ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import rehypeHighlight from 'rehype-highlight'
import rehypeSlug from 'rehype-slug'
import { Check, Copy, Link2 } from 'lucide-react'
// KaTeX 样式随本组件所在的懒加载分片一起加载，避免拖慢首屏
import 'katex/dist/katex.min.css'

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

function CodeBlock({ children }: { children?: ReactNode }) {
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
    <div className="group relative my-6">
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

function Heading({ level, id, children }: { level: 2 | 3 | 4; id?: string; children?: ReactNode }) {
  const Tag = `h${level}` as 'h2' | 'h3' | 'h4'
  return (
    <Tag id={id} className="group/heading relative">
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

export const Markdown = memo(function Markdown({ content }: { content: string }) {
  return (
    <div className="prose prose-lg dark:prose-invert prose-headings:font-semibold prose-headings:tracking-tight">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[
          rehypeSlug,
          [rehypeKatex, { strict: false, throwOnError: false, output: 'htmlAndMathml' }],
          [rehypeHighlight, { detect: true, ignoreMissing: true }],
        ]}
        components={{
          pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
          h2: ({ id, children }) => (
            <Heading level={2} id={id}>
              {children}
            </Heading>
          ),
          h3: ({ id, children }) => (
            <Heading level={3} id={id}>
              {children}
            </Heading>
          ),
          h4: ({ id, children }) => (
            <Heading level={4} id={id}>
              {children}
            </Heading>
          ),
          a: ({ href, children, ...rest }) => {
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
          img: ({ src, alt }) => (
            <img src={typeof src === 'string' ? src : ''} alt={alt ?? ''} loading="lazy" decoding="async" />
          ),
          table: ({ children }) => (
            <div className="my-6 overflow-x-auto rounded-xl border border-ink-200/70 shadow-[0_1px_2px_rgba(16,24,40,.05)] dark:border-white/10">
              <table className="!my-0 w-full">{children}</table>
            </div>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
})
