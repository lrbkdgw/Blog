import { useEffect, useState } from 'react'
import { List } from 'lucide-react'
import type { TocItem } from '../lib/posts'
import { OFFLINE } from '../lib/runtime'

export function Toc({ items, id = 'starlog-toc' }: { items: TocItem[]; id?: string }) {
  const [activeId, setActiveId] = useState<string>('')

  useEffect(() => {
    if (items.length === 0) return
    const headings = items
      .map((i) => document.getElementById(i.id))
      .filter((el): el is HTMLElement => Boolean(el))
    if (headings.length === 0) return

    const onScroll = () => {
      const offset = 108
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

  /**
   * 点击目录项跳转到对应标题（issue #110）。
   *
   * 用 `scrollIntoView` 而不是手写 `window.scrollTo`：滚动会带上
   * `scroll-margin-top`，标题不会钻到吸顶页头下面；元素万一还没渲染出来
   * （正文是延迟渲染的），稍后再试一次。hash 只在 History 路由下同步，
   * 离线版的 hash 路由里改 hash 会连带改路由，必须避免。
   */
  const jump = (item: TocItem) => {
    const target = document.getElementById(item.id)
    if (!target) {
      window.setTimeout(() => {
        const retry = document.getElementById(item.id)
        retry?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }, 140)
      return
    }
    target.scrollIntoView({ behavior: 'smooth', block: 'start' })
    if (!OFFLINE && window.location.hash) {
      history.replaceState(null, '', `#${item.id}`)
    }
  }

  return (
    <nav id={id} className="no-print hidden xl:block" aria-label="目录">
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
                  jump(item)
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
