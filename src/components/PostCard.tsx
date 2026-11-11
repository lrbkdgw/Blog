import { Link } from 'react-router-dom'
import { ArrowUpRight, Clock, FileEdit, LockKeyhole, Pin } from 'lucide-react'
import type { Post } from '../lib/types'
import { formatDate, hasPublicDate } from '../lib/posts'
import { resolvePendingImageSrc } from '../lib/updateQueue'

/**
 * 文章卡片。
 *
 * 重设计后的结构刻意扁平：细描边、白纸底、无彩色渐变与投影，
 * 悬浮时只做两件事——整卡轻微上浮 + 右侧出现箭头。
 */
export function PostCard({ post, index = 0 }: { post: Post; index?: number }) {
  // 离线版：远程 / 站内封面图不加载（解析结果为空）→ 整块封面都不渲染，不留破图
  const coverSrc = post.cover ? resolvePendingImageSrc(post.cover) : ''
  return (
    <article
      className="card card-hover group relative flex animate-fade-up flex-col overflow-hidden"
      style={{ animationDelay: `${Math.min(index, 8) * 50}ms` }}
    >
      {coverSrc && (
        <Link to={`/posts/${post.slug}`} className="block overflow-hidden border-b border-ink-200/70 dark:border-white/[0.07]">
          <img
            src={coverSrc}
            alt=""
            loading="lazy"
            className="h-40 w-full object-cover transition-transform duration-700 ease-smooth group-hover:scale-[1.03]"
          />
        </Link>
      )}

      <div className="flex flex-1 flex-col p-5 sm:p-6">
        <div className="mb-3 flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-[11.5px] text-ink-400 dark:text-ink-500">
          {hasPublicDate(post) && (
            <time dateTime={post.date} className="font-mono tracking-tight">
              {formatDate(post.date)}
            </time>
          )}
          <span className="h-2.5 w-px bg-ink-200 dark:bg-white/[0.12]" />
          <span className="flex items-center gap-1">
            <Clock size={11} />
            {post.readingTime} 分钟
          </span>
          {post.pinned && (
            <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400">
              <Pin size={11} />
              置顶
            </span>
          )}
          {post.encryption && (
            <span className="flex items-center gap-1 text-brand-600 dark:text-brand-300">
              <LockKeyhole size={11} />
              正文加密
            </span>
          )}
          {post.draft && (
            <span className="flex items-center gap-1 rounded-full border border-amber-300/60 px-1.5 py-px font-medium text-amber-600 dark:border-amber-500/30 dark:text-amber-400">
              <FileEdit size={10} />
              草稿
            </span>
          )}
          {post.source === 'local' && (
            <span className="rounded-full bg-ink-900/[.05] px-1.5 py-px text-[10.5px] text-ink-500 dark:bg-white/[.08] dark:text-ink-400">
              本地
            </span>
          )}
        </div>

        <h3 className="text-[17px] font-semibold leading-snug tracking-[-0.01em] text-ink-900 transition-colors duration-200 group-hover:text-brand-700 dark:text-white dark:group-hover:text-brand-200">
          <Link to={`/posts/${post.slug}`} className="before:absolute before:inset-0 before:content-['']">
            {post.title}
          </Link>
        </h3>

        <p className="mt-2 line-clamp-2 flex-1 text-[13.5px] leading-[1.7] text-ink-500 dark:text-ink-400">
          {post.summary}
        </p>

        <div className="mt-4 flex items-center justify-between gap-3">
          <div className="flex flex-wrap gap-1.5">
            {post.tags.slice(0, 3).map((tag) => (
              <span
                key={tag}
                className="rounded-full bg-ink-900/[.045] px-2 py-0.5 text-[11px] font-medium text-ink-500 transition-colors dark:bg-white/[.06] dark:text-ink-400"
              >
                {tag}
              </span>
            ))}
          </div>
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-ink-200/80 text-ink-400 transition-all duration-300 ease-smooth group-hover:-translate-y-px group-hover:translate-x-0.5 group-hover:border-brand-400/60 group-hover:text-brand-600 dark:border-white/[0.1] dark:text-ink-500 dark:group-hover:border-brand-400/40 dark:group-hover:text-brand-300">
            <ArrowUpRight size={13} />
          </span>
        </div>
      </div>
    </article>
  )
}
