import { useEffect, useMemo, useRef, useState } from 'react'
import katex from 'katex'
import { CornerDownLeft, Search, Sigma } from 'lucide-react'
import {
  LATEX_CATEGORIES,
  displayAliases,
  searchLatexSymbols,
  type LatexCategoryId,
  type LatexSymbol,
} from '../lib/latexSymbols'

/**
 * LaTeX 符号选择框（issue #60）。
 *
 * 编辑器中按 <kbd>Shift</kbd> + <kbd>↑</kbd> 或点击工具栏的 Σ 符号按钮打开，
 * 支持按命令、中文别名、英文名搜索（例如「正负」→ `\pm`、「异或」→ `\oplus`），
 * 方向键选择、Enter 插入、Esc 关闭。
 */

/** KaTeX 渲染结果按「预览公式」缓存，搜索时不必反复排版同一批符号。 */
const previewCache = new Map<string, string>()

function renderPreview(symbol: LatexSymbol): string {
  const formula = symbol.preview ?? symbol.latex
  const cached = previewCache.get(formula)
  if (cached !== undefined) return cached
  let html: string
  try {
    html = katex.renderToString(formula, { throwOnError: false, displayMode: false, output: 'html' })
  } catch {
    html = ''
  }
  previewCache.set(formula, html)
  return html
}

export function LatexSymbolPicker({
  open,
  onClose,
  onInsert,
}: {
  open: boolean
  onClose: () => void
  /** cursor 为插入后光标相对符号起点的偏移（模板类命令使用） */
  onInsert: (latex: string, cursor?: number) => void
}) {
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<LatexCategoryId | 'all'>('all')
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const activeRef = useRef<HTMLButtonElement>(null)

  const results = useMemo(() => searchLatexSymbols(query, category), [query, category])

  useEffect(() => {
    if (!open) return
    setQuery('')
    setCategory('all')
    setActive(0)
    const timer = window.setTimeout(() => inputRef.current?.focus(), 30)
    document.body.style.overflow = 'hidden'
    return () => {
      window.clearTimeout(timer)
      document.body.style.overflow = ''
    }
  }, [open])

  useEffect(() => {
    setActive(0)
  }, [query, category])

  // 焦点可能停在分类按钮上，因此 Escape 在窗口级别也监听一次。
  useEffect(() => {
    if (!open) return
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.isComposing) onClose()
    }
    window.addEventListener('keydown', onEscape)
    return () => window.removeEventListener('keydown', onEscape)
  }, [open, onClose])

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest' })
  }, [active, results])

  if (!open) return null

  const insert = (symbol: LatexSymbol) => {
    onInsert(symbol.latex, symbol.cursor)
    onClose()
  }

  const onKeyDown = (event: React.KeyboardEvent) => {
    // 中文输入法组合中的 Enter / 方向键用于选词，不触发插入或切换。
    if (event.nativeEvent.isComposing) return
    const total = results.length
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
      event.preventDefault()
      if (total > 0) setActive((index) => (index + 1) % total)
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
      event.preventDefault()
      if (total > 0) setActive((index) => (index - 1 + total) % total)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      if (results[active]) insert(results[active])
    } else if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
    }
  }

  return (
    <div
      className="fixed inset-0 z-[90] flex items-start justify-center px-4 pt-[8vh]"
      role="dialog"
      aria-modal="true"
      aria-label="选择 LaTeX 符号"
    >
      <div className="absolute inset-0 animate-fade-in bg-ink-950/40 backdrop-blur-sm" onClick={onClose} />
      <div className="card relative flex max-h-[80vh] w-full max-w-2xl animate-scale-in flex-col overflow-hidden !bg-white/95 dark:!bg-ink-900/95">
        <div className="flex items-center gap-3 border-b border-ink-200/70 px-4 dark:border-white/10">
          <Search size={18} className="shrink-0 text-ink-400" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder="搜索符号或别名，例如：正负 / 异或 / oplus…"
            aria-label="搜索 LaTeX 符号"
            className="w-full bg-transparent py-4 text-[15px] outline-none placeholder:text-ink-400 dark:text-white"
          />
          <kbd className="hidden shrink-0 rounded border border-ink-200 px-1.5 py-0.5 font-mono text-[10px] text-ink-400 sm:block dark:border-white/15">
            ESC
          </kbd>
        </div>

        <div className="flex flex-wrap gap-1.5 border-b border-ink-200/70 px-4 py-2 dark:border-white/10">
          {[{ id: 'all' as const, name: '全部' }, ...LATEX_CATEGORIES].map((item) => {
            const selected = category === item.id
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setCategory(item.id)}
                aria-pressed={selected}
                className={`rounded-full px-2.5 py-1 text-xs font-medium transition ${
                  selected
                    ? 'bg-brand-500/12 text-brand-700 dark:bg-brand-400/15 dark:text-brand-200'
                    : 'text-ink-500 hover:bg-ink-100/70 dark:text-ink-400 dark:hover:bg-white/5'
                }`}
              >
                {item.name}
              </button>
            )
          })}
        </div>

        <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto p-3">
          {results.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-ink-400">
              没有找到相关符号，试试 `oplus`、「异或」或「正负」。
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
              {results.map((symbol, index) => {
                const isActive = index === active
                const aliases = displayAliases(symbol)
                return (
                  <button
                    key={`${symbol.category}-${symbol.latex}`}
                    ref={isActive ? activeRef : undefined}
                    type="button"
                    onMouseEnter={() => setActive(index)}
                    onClick={() => insert(symbol)}
                    title={`${symbol.latex}\n${symbol.aliases.join('、')}`}
                    className={`flex flex-col items-center gap-1 rounded-xl border px-2 py-2.5 text-center transition ${
                      isActive
                        ? 'border-brand-300 bg-brand-500/10 dark:border-brand-400/40 dark:bg-brand-400/10'
                        : 'border-transparent hover:border-ink-200/70 hover:bg-ink-100/60 dark:hover:border-white/10 dark:hover:bg-white/5'
                    }`}
                  >
                    <span
                      className="flex h-8 items-center justify-center text-lg text-ink-900 dark:text-white"
                      // KaTeX 自己的输出结构；输入来自本地符号表，且 throwOnError 关闭。
                      dangerouslySetInnerHTML={{ __html: renderPreview(symbol) }}
                    />
                    <code className="max-w-full truncate font-mono text-[11px] text-brand-600 dark:text-brand-300">
                      {symbol.latex}
                    </code>
                    <span className="max-w-full truncate text-[10px] text-ink-400 dark:text-ink-500">
                      {aliases.join(' · ')}
                    </span>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-t border-ink-200/70 px-4 py-2 text-[11px] text-ink-400 dark:border-white/10">
          <span className="flex items-center gap-1">
            <Sigma size={12} /> {results.length} 个符号
          </span>
          <span>方向键选择</span>
          <span className="flex items-center gap-1">
            <CornerDownLeft size={12} /> 插入
          </span>
          <span className="ml-auto hidden sm:inline">多个别名都可以搜索，例如 `\pm` = 正负 / 加减 / ±</span>
        </div>
      </div>
    </div>
  )
}
