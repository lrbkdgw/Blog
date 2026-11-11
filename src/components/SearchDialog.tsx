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
      <div className="absolute inset-0 animate-fade-in bg-ink-950/35 backdrop-blur-[3px]" onClick={onClose} />
      <div className="card-pop relative w-full max-w-lg animate-scale-in overflow-hidden">
        <div className="flex items-center gap-3 border-b border-ink-200/70 px-4 dark:border-white/[0.07]">
          <Search size={17} className="shrink-0 text-ink-400" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="搜索文章标题、标签或正文…"
            className="w-full bg-transparent py-4 text-[14.5px] text-ink-900 outline-none placeholder:text-ink-400 dark:text-white dark:placeholder:text-ink-500"
          />
          <kbd className="hidden shrink-0 rounded-[5px] border border-ink-200/80 bg-ink-50 px-1.5 pb-px font-mono text-[10px] text-ink-400 sm:block dark:border-white/[0.08] dark:bg-white/[0.05] dark:text-ink-500">
            ESC
          </kbd>
        </div>

        <div className="max-h-[52vh] overflow-y-auto p-1.5">
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
                className={`flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left transition-colors duration-150 ${
                  i === active ? 'bg-ink-900/[.045] dark:bg-white/[0.07]' : 'hover:bg-ink-900/[.025] dark:hover:bg-white/[0.04]'
                }`}
              >
                <FileText size={15} className={`mt-0.5 shrink-0 transition-colors ${i === active ? 'text-brand-500' : 'text-ink-300 dark:text-ink-600'}`} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] font-medium text-ink-900 dark:text-white">{p.title}</span>
                  <span className="mt-0.5 block truncate text-[11.5px] text-ink-500 dark:text-ink-500">
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
