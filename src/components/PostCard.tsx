import { useEffect, useRef, type PointerEvent } from 'react'
import { Link } from 'react-router-dom'
import { ArrowUpRight, Clock, FileEdit, LockKeyhole, Pin } from 'lucide-react'
import type { Post } from '../lib/types'
import { formatDate, hasPublicDate } from '../lib/posts'
import { resolvePendingImageSrc } from '../lib/updateQueue'
import { useTheme } from '../lib/theme'
import { Reveal } from './Reveal'

export function PostCard({ post, index = 0 }: { post: Post; index?: number }) {
  const { effects } = useTheme()
  const frame = useRef(0)
  const rect = useRef<DOMRect | null>(null)
  useEffect(() => () => cancelAnimationFrame(frame.current), [])
  const spotlight = (event: PointerEvent<HTMLElement>) => {
    if (effects !== 'full' || event.pointerType !== 'mouse') return
    const node = event.currentTarget
    const bounds = rect.current || node.getBoundingClientRect()
    const x = event.clientX - bounds.left, y = event.clientY - bounds.top
    cancelAnimationFrame(frame.current)
    frame.current = requestAnimationFrame(() => {
      node.style.setProperty('--pointer-x', `${x}px`)
      node.style.setProperty('--pointer-y', `${y}px`)
    })
  }
  return (
    <Reveal delay={(index % 6) * 45} className="h-full">
      <article
        className="card post-card group relative flex h-full flex-col overflow-hidden p-6 sm:p-7"
        onPointerEnter={(event) => { rect.current = event.currentTarget.getBoundingClientRect() }}
        onPointerMove={spotlight}
        onPointerLeave={() => { rect.current = null; cancelAnimationFrame(frame.current) }}
      >
        <div className="card-spotlight" aria-hidden="true" />
        <div className="card-edge" aria-hidden="true" />
        {post.cover && <img src={resolvePendingImageSrc(post.cover)} alt="" loading="lazy" className="post-cover -mx-6 -mt-6 mb-5 h-44 w-[calc(100%+3rem)] max-w-none object-cover sm:-mx-7 sm:-mt-7 sm:w-[calc(100%+3.5rem)]" />}
        <div className="post-meta mb-4 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs">
          {hasPublicDate(post) && <time dateTime={post.date} className="font-mono tracking-wide">{formatDate(post.date)}</time>}
          <span className="flex items-center gap-1"><Clock size={12} />{post.readingTime} 分钟</span>
          {post.pinned && <span className="flex items-center gap-1 text-brand-600 dark:text-brand-300"><Pin size={12} />置顶</span>}
          {post.encryption && <span className="flex items-center gap-1 text-brand-600 dark:text-brand-300"><LockKeyhole size={12} />正文加密</span>}
          {post.draft && <span className="flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-amber-700 dark:text-amber-300"><FileEdit size={11} />草稿</span>}
          {post.source === 'local' && <span className="rounded-full bg-brand-500/10 px-2 py-0.5 text-brand-700 dark:text-brand-200">本地</span>}
        </div>
        <h3 className="post-title font-serif text-xl font-semibold leading-snug tracking-tight sm:text-[1.35rem]">
          <Link to={`/posts/${post.slug}`} className="after:absolute after:inset-0 after:content-['']">{post.title}</Link>
        </h3>
        <p className="post-summary mt-3 line-clamp-3 flex-1 text-[14px] leading-[1.85]">{post.summary}</p>
        <div className="post-card-footer mt-6 flex items-center justify-between gap-3 border-t pt-4">
          <div className="flex flex-wrap gap-1.5">{post.tags.slice(0, 3).map((tag) => <span key={tag} className="post-tag">#{tag}</span>)}</div>
          <span className="read-arrow flex h-8 w-8 shrink-0 items-center justify-center rounded-full" aria-hidden="true"><ArrowUpRight size={17} /></span>
        </div>
      </article>
    </Reveal>
  )
}
