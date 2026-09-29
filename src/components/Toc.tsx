import { useEffect, useState } from 'react'
import { List } from 'lucide-react'
import type { TocItem } from '../lib/posts'

export function Toc({ items }: { items: TocItem[] }) {
  const [activeId, setActiveId] = useState<string>('')

  useEffect(() => {
    if (items.length === 0) return
    const headings = items
      .map((i) => document.getElementById(i.id))
      .filter((el): el is HTMLElement => Boolean(el))
    if (headings.length === 0) return

    const onScroll = () => {
      const offset = 120
      let current = headings[0].id
      for (const h of headings) {
        if (h.getBoundingClientRect().top <= offset) current = h.id
        else break
      }
      // 滚到底部时高亮最后一项
      if (window.innerHeight + window.scrollY >= document.body.scrollHeight - 40) {
        current = headings[headings.length - 1].id
      }
      setActiveId(current)
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [items])

  if (items.length < 2) return null

  return (
    <nav className="no-print hidden xl:block">
      <div className="sticky top-24 max-h-[calc(100vh-8rem)] overflow-y-auto pr-2">
        <p className="mb-3 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-ink-400">
          <List size={13} />
          目录
        </p>
        <ul className="space-y-0.5 border-l border-ink-200/80 dark:border-white/10">
          {items.map((item) => (
            <li key={item.id}>
              <a
                href={`#${item.id}`}
                onClick={(e) => {
                  e.preventDefault()
                  const el = document.getElementById(item.id)
                  if (el) {
                    window.scrollTo({ top: el.offsetTop - 90, behavior: 'smooth' })
                    history.replaceState(null, '', `#${item.id}`)
                  }
                }}
                className={`-ml-px block border-l-2 py-1 text-[13px] leading-snug transition-all duration-200 ${
                  activeId === item.id
                    ? 'border-brand-500 font-medium text-brand-600 dark:text-brand-300'
                    : 'border-transparent text-ink-400 hover:border-ink-300 hover:text-ink-700 dark:hover:text-ink-200'
                }`}
                style={{ paddingLeft: `${(item.level - 2) * 12 + 14}px` }}
              >
                {item.text}
              </a>
            </li>
          ))}
        </ul>
      </div>
    </nav>
  )
}
