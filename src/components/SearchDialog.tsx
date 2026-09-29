import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CornerDownLeft, FileText, Search } from 'lucide-react'
import { excerpt, formatDate, getPublishedPosts, searchPosts } from '../lib/posts'

export function SearchDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const navigate = useNavigate()

  const posts = useMemo(() => (open ? getPublishedPosts() : []), [open])
  const results = useMemo(() => searchPosts(posts, query).slice(0, 8), [posts, query])

  useEffect(() => {
    if (open) {
      setQuery('')
      setActive(0)
      setTimeout(() => inputRef.current?.focus(), 30)
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => {
      document.body.style.overflow = ''
    }
  }, [open])

  useEffect(() => setActive(0), [query])

  if (!open) return null

  const go = (slug: string) => {
    navigate(`/posts/${slug}`)
    onClose()
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((i) => (i + 1) % Math.max(results.length, 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => (i - 1 + results.length) % Math.max(results.length, 1))
    } else if (e.key === 'Enter' && results[active]) {
      go(results[active].slug)
    } else if (e.key === 'Escape') {
      onClose()
    }
  }

  return (
    <div className="fixed inset-0 z-[90] flex items-start justify-center px-4 pt-[12vh]" role="dialog" aria-modal>
      <div className="absolute inset-0 animate-fade-in bg-ink-950/40 backdrop-blur-sm" onClick={onClose} />
      <div className="card relative w-full max-w-xl animate-scale-in overflow-hidden !bg-white/95 dark:!bg-ink-900/95">
        <div className="flex items-center gap-3 border-b border-ink-200/70 px-4 dark:border-white/10">
          <Search size={18} className="shrink-0 text-ink-400" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="搜索文章标题、标签或正文…"
            className="w-full bg-transparent py-4 text-[15px] outline-none placeholder:text-ink-400 dark:text-white"
          />
          <kbd className="hidden shrink-0 rounded border border-ink-200 px-1.5 py-0.5 font-mono text-[10px] text-ink-400 sm:block dark:border-white/15">
            ESC
          </kbd>
        </div>

        <div className="max-h-[52vh] overflow-y-auto p-2">
          {results.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-ink-400">
              {query ? '没有找到相关文章' : '输入关键词开始搜索'}
            </p>
          ) : (
            results.map((p, i) => (
              <button
                key={p.slug}
                onMouseEnter={() => setActive(i)}
                onClick={() => go(p.slug)}
                className={`flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left transition ${
                  i === active ? 'bg-brand-500/10 dark:bg-brand-400/10' : 'hover:bg-ink-100/70 dark:hover:bg-white/5'
                }`}
              >
                <FileText size={16} className="mt-1 shrink-0 text-brand-500" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-ink-900 dark:text-white">{p.title}</span>
                  <span className="mt-0.5 block truncate text-xs text-ink-500 dark:text-ink-400">
                    {formatDate(p.date)} · {excerpt(p.summary, 60)}
                  </span>
                </span>
                {i === active && <CornerDownLeft size={14} className="mt-1 shrink-0 text-ink-400" />}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
