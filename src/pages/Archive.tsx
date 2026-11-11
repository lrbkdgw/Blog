import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Clock, Search } from 'lucide-react'
import { usePosts } from '../lib/usePosts'
import { formatDate, getArchive, hasPublicDate, searchPosts } from '../lib/posts'

export default function Archive() {
  const [posts] = usePosts()
  const [query, setQuery] = useState('')

  const groups = useMemo(() => getArchive(searchPosts(posts, query)), [posts, query])

  return (
    <div className="container-page max-w-3xl pt-16 sm:pt-20" data-yield-list>
      <header className="animate-fade-up">
        <p className="text-[11.5px] font-medium uppercase tracking-[0.16em] text-ink-400 dark:text-ink-500">
          Archive
        </p>
        <h1 className="mt-3 text-[2rem] font-semibold tracking-[-0.03em] text-ink-900 dark:text-white">
          归档
        </h1>
        <p className="mt-2 text-[13.5px] text-ink-500 dark:text-ink-400">
          共 {posts.length} 篇文章，按时间倒序排列。
        </p>
      </header>

      <div className="relative mt-8 animate-fade-up" style={{ animationDelay: '60ms' }}>
        <Search size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-400" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="筛选文章…"
          className="input h-10 !pl-10"
        />
      </div>

      <div className="mt-12 space-y-10" data-yield-list>
        {groups.length === 0 && (
          <p className="py-16 text-center text-[13px] text-ink-400">没有匹配的文章</p>
        )}

        {groups.map((group, gi) => (
          <section key={group.year} className="animate-fade-up" style={{ animationDelay: `${gi * 50}ms` }} data-yield-list>
            {/* 年份标题：大号等宽数字 + 一路延伸到右侧的细线 */}
            <div className="mb-3 flex items-center gap-3">
              <h2 className="font-mono text-[13px] font-semibold tracking-[0.08em] text-ink-900 dark:text-white">
                {group.year}
              </h2>
              <span className="text-[11px] text-ink-400 dark:text-ink-600">{group.posts.length} 篇</span>
              <span className="h-px flex-1 bg-ink-200/70 dark:bg-white/[0.07]" />
            </div>

            <ul className="divide-y divide-ink-200/60 dark:divide-white/[0.05]" data-yield-list>
              {group.posts.map((post) => (
                <li key={post.slug}>
                  <Link
                    to={`/posts/${post.slug}`}
                    className="group -mx-3 flex items-baseline gap-4 rounded-lg px-3 py-2.5 transition-colors duration-150 hover:bg-ink-900/[.03] dark:hover:bg-white/[.035]"
                  >
                    <time className="w-12 shrink-0 font-mono text-[11.5px] tabular-nums text-ink-400 dark:text-ink-500">
                      {hasPublicDate(post) ? formatDate(post.date, 'short') : '—'}
                    </time>
                    <span className="min-w-0 flex-1 truncate text-[14px] text-ink-700 transition-colors group-hover:text-brand-700 dark:text-ink-200 dark:group-hover:text-brand-200">
                      {post.title}
                    </span>
                    <span className="hidden shrink-0 items-center gap-1 text-[11px] text-ink-400 sm:flex dark:text-ink-500">
                      <Clock size={10} />
                      {post.readingTime}′
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  )
}
