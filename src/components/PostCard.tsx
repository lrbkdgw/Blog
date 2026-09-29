import { Link } from 'react-router-dom'
import { ArrowUpRight, Clock, FileEdit, Pin } from 'lucide-react'
import type { Post } from '../lib/types'
import { formatDate } from '../lib/posts'

export function PostCard({ post, index = 0 }: { post: Post; index?: number }) {
  return (
    <article
      className="card group relative flex animate-fade-up flex-col overflow-hidden p-6 transition-all duration-300 hover:-translate-y-1 hover:border-brand-300/80 hover:shadow-[0_2px_4px_rgba(16,24,40,.04),0_24px_48px_-20px_rgba(53,99,246,.35)] dark:hover:border-brand-400/30"
      style={{ animationDelay: `${Math.min(index, 8) * 55}ms` }}
    >
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-brand-400/60 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />

      {post.cover && (
        <Link to={`/posts/${post.slug}`} className="-mx-6 -mt-6 mb-5 block overflow-hidden">
          <img
            src={post.cover}
            alt=""
            loading="lazy"
            className="h-44 w-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
          />
        </Link>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-ink-400">
        <time dateTime={post.date} className="font-mono">
          {formatDate(post.date)}
        </time>
        <span className="flex items-center gap-1">
          <Clock size={12} />
          {post.readingTime} 分钟
        </span>
        {post.pinned && (
          <span className="flex items-center gap-1 text-amber-500">
            <Pin size={12} />
            置顶
          </span>
        )}
        {post.draft && (
          <span className="flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 font-medium text-amber-600 dark:text-amber-400">
            <FileEdit size={11} />
            草稿
          </span>
        )}
        {post.source === 'local' && (
          <span className="rounded-full bg-ink-900/[.06] px-2 py-0.5 text-[11px] text-ink-500 dark:bg-white/10 dark:text-ink-400">
            本地
          </span>
        )}
      </div>

      <h2 className="font-serif text-xl font-semibold leading-snug tracking-tight text-ink-900 dark:text-white">
        <Link to={`/posts/${post.slug}`} className="before:absolute before:inset-0 before:content-['']">
          {post.title}
        </Link>
      </h2>

      <p className="mt-2.5 line-clamp-3 flex-1 text-[14.5px] leading-relaxed text-ink-500 dark:text-ink-400">
        {post.summary}
      </p>

      <div className="mt-5 flex items-end justify-between gap-3">
        <div className="flex flex-wrap gap-1.5">
          {post.tags.slice(0, 3).map((tag) => (
            <span key={tag} className="chip">
              #{tag}
            </span>
          ))}
        </div>
        <span className="flex shrink-0 items-center gap-1 text-xs font-medium text-brand-600 opacity-0 transition-all duration-300 group-hover:translate-x-0 group-hover:opacity-100 dark:text-brand-300 sm:-translate-x-1">
          阅读
          <ArrowUpRight size={14} />
        </span>
      </div>
    </article>
  )
}
