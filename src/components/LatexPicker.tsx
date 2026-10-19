import { useEffect, useMemo, useRef, useState } from 'react'
import katex from 'katex'
import { CornerDownLeft, Search, Sigma } from 'lucide-react'
import {
  LATEX_CATEGORIES,
  LATEX_SYMBOLS,
  latexCategoryName,
  searchLatexSymbols,
  type LatexCategoryId,
  type LatexSymbol,
} from '../lib/latexSymbols'

/**
 * LaTeX 符号选择框（issue #60）：站内编辑器里按 <kbd>Shift</kbd> + <kbd>↑</kbd> 打开
 * （评论框同理），可按命令或中文别名搜索（「正负」→ `\pm`、「异或」→ `\oplus`），
 * 方向键选择、Enter 或点击把符号插入回打开它之前的光标位置。
 *
 * 组件只负责「选哪个符号」，插入由宿主用 onInsert 完成；最近用过的符号
 * 记在 localStorage 里并在「最近」分类下露出。
 */

const RECENT_KEY = 'starlog:latex-recent'
const RECENT_MAX = 18

type CategoryFilter = 'all' | 'recent' | LatexCategoryId

function readRecentCommands(): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]')
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

function recordRecent(symbol: LatexSymbol) {
  try {
    const next = [symbol.command, ...readRecentCommands().filter((item) => item !== symbol.command)]
    localStorage.setItem(RECENT_KEY, JSON.stringify(next.slice(0, RECENT_MAX)))
  } catch {
    // 隐私模式等场景下写不进去就不记，不影响插入本身。
  }
}

/** KaTeX 预览 HTML 做模块级缓存：几百个符号只在首次打开时渲染一次。 */
const previewCache = new Map<string, string>()
function previewHtml(symbol: LatexSymbol): string {
  const cached = previewCache.get(symbol.command)
  if (cached) return cached
  let html: string
  try {
    html = katex.renderToString(symbol.preview, { throwOnError: false })
  } catch {
    html = ''
  }
  previewCache.set(symbol.command, html)
  return html
}

export function LatexPicker({
  open,
  onClose,
  onInsert,
}: {
  open: boolean
  onClose: () => void
  onInsert: (symbol: LatexSymbol) => void
}) {
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<CategoryFilter>('all')
  const [active, setActive] = useState(0)
  const [recentCommands, setRecentCommands] = useState<string[]>([])
  const inputRef = useRef<HTMLInputElement>(null)
  const gridRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    setQuery('')
    setCategory('all')
    setActive(0)
    setRecentCommands(readRecentCommands())
    setTimeout(() => inputRef.current?.focus(), 30)
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = ''
    }
  }, [open])

  const recentSymbols = useMemo(
    () =>
      recentCommands
        .map((command) => LATEX_SYMBOLS.find((symbol) => symbol.command === command))
        .filter((symbol): symbol is LatexSymbol => Boolean(symbol)),
    [recentCommands],
  )

  /** 有搜索词时在全部分类里搜（忽略当前分类签），没有搜索词时只浏览当前分类。 */
  const results = useMemo(() => {
    const trimmed = query.trim()
    if (trimmed) return searchLatexSymbols(trimmed)
    if (category === 'all') return [...LATEX_SYMBOLS]
    if (category === 'recent') return recentSymbols
    return LATEX_SYMBOLS.filter((symbol) => symbol.category === category)
  }, [query, category, recentSymbols])

  useEffect(() => setActive(0), [query, category])

  useEffect(() => {
    gridRef.current
      ?.querySelector<HTMLElement>(`[data-latex-index="${active}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [active])

  if (!open) return null

  const choose = (symbol: LatexSymbol) => {
    recordRecent(symbol)
    onInsert(symbol)
    onClose()
  }

  const columnCount = () => {
    const grid = gridRef.current
    if (!grid) return 6
    const columns = getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean).length
    return Math.max(1, columns)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    // 不让宿主的全局快捷键（编辑器全屏 Esc、全站搜索等）对选择框内的按键凑热闹。
    e.stopPropagation()
    const total = results.length
    if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
      return
    }
    if (total === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((i) => Math.min(i + columnCount(), total - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => Math.max(i - columnCount(), 0))
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      // 光标不在搜索文本的首尾边界时，左右键仍是编辑搜索词（原生行为）。
      const input = e.currentTarget as HTMLInputElement
      const collapsed = input.selectionStart === input.selectionEnd
      const atStart = collapsed && input.selectionStart === 0
      const atEnd = collapsed && input.selectionStart === input.value.length
      if (e.key === 'ArrowLeft' && atStart) {
        e.preventDefault()
        setActive((i) => Math.max(i - 1, 0))
      } else if (e.key === 'ArrowRight' && atEnd) {
        e.preventDefault()
        setActive((i) => Math.min(i + 1, total - 1))
      }
    } else if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
      e.preventDefault()
      const symbol = results[Math.min(active, total - 1)]
      if (symbol) choose(symbol)
    }
  }

  const current = results[Math.min(active, results.length - 1)]
  const categoryTabs: { id: CategoryFilter; name: string }[] = [
    { id: 'all', name: '全部' },
    ...(recentSymbols.length > 0 ? [{ id: 'recent' as const, name: '最近' }] : []),
    ...LATEX_CATEGORIES,
  ]

  return (
    <div className="fixed inset-0 z-[95] flex items-start justify-center px-4 pt-[10vh]" role="dialog" aria-modal aria-label="插入 LaTeX 符号">
      <div className="absolute inset-0 animate-fade-in bg-ink-950/40 backdrop-blur-sm" onClick={onClose} />
      <div className="card relative flex max-h-[78vh] w-full max-w-2xl animate-scale-in flex-col overflow-hidden !bg-white/95 dark:!bg-ink-900/95">
        <div className="flex items-center gap-3 border-b border-ink-200/70 px-4 dark:border-white/10">
          <Search size={18} className="shrink-0 text-ink-400" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="搜索命令或别名，如 pm、正负、异或、积分…"
            className="w-full bg-transparent py-4 text-[15px] outline-none placeholder:text-ink-400 dark:text-white"
            aria-label="搜索 LaTeX 符号"
          />
          <kbd className="hidden shrink-0 rounded border border-ink-200 px-1.5 py-0.5 font-mono text-[10px] text-ink-400 sm:block dark:border-white/15">
            ESC
          </kbd>
        </div>

        <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-ink-200/70 px-3 py-2 dark:border-white/10">
          {categoryTabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => {
                setCategory(tab.id)
                inputRef.current?.focus()
              }}
              className={`shrink-0 rounded-full px-2.5 py-1 text-xs transition ${
                !query && category === tab.id
                  ? 'bg-brand-500 text-white shadow-sm'
                  : 'bg-ink-100 text-ink-500 hover:text-ink-900 dark:bg-white/10 dark:text-ink-300 dark:hover:text-white'
              }`}
            >
              {tab.name}
            </button>
          ))}
        </div>

        <div ref={gridRef} className="min-h-[10rem] overflow-y-auto p-3">
          {results.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-10 text-center">
              <Sigma size={22} className="text-ink-300 dark:text-ink-600" />
              <p className="text-sm text-ink-400">
                {query.trim()
                  ? '没有匹配的符号，换个命令或叫法试试'
                  : '还没有用过的符号，搜一个插一次就会出现在这里'}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-6">
              {results.map((symbol, i) => (
                <button
                  key={`${symbol.category}-${symbol.command}`}
                  type="button"
                  data-latex-index={i}
                  title={`${symbol.command}（${symbol.aliases.join(' · ')}）`}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => choose(symbol)}
                  className={`flex min-h-[4.25rem] flex-col items-center justify-center gap-1 rounded-xl px-1 py-2 transition ${
                    i === active
                      ? 'bg-brand-500/10 ring-1 ring-brand-500/50 dark:bg-brand-400/10'
                      : 'hover:bg-ink-100/80 dark:hover:bg-white/5'
                  }`}
                >
                  <span
                    className="pointer-events-none flex max-w-full items-center justify-center overflow-hidden text-[17px] leading-none text-ink-900 dark:text-white [&_.katex-display]:!my-0"
                    dangerouslySetInnerHTML={{ __html: previewHtml(symbol) }}
                  />
                  <span className="pointer-events-none max-w-full truncate font-mono text-[10px] text-ink-400">
                    {symbol.command}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-3 border-t border-ink-200/70 px-4 py-2.5 text-xs text-ink-400 dark:border-white/10">
          {current ? (
            <>
              <span className="shrink-0 font-mono text-[12px] font-medium text-ink-700 dark:text-ink-100">
                {current.command}
              </span>
              <span className="min-w-0 flex-1 truncate">
                {latexCategoryName(current.category)} · {current.aliases.join(' · ')}
              </span>
            </>
          ) : (
            <span className="min-w-0 flex-1 truncate">输入命令或中文叫法搜索符号</span>
          )}
          <span className="hidden shrink-0 items-center gap-1 sm:flex">
            方向键选择
            <CornerDownLeft size={12} />
            插入
          </span>
        </div>
      </div>
    </div>
  )
}
