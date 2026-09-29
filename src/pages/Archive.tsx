import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Clock, Search } from 'lucide-react'
import { usePosts } from '../lib/usePosts'
import { formatDate, getArchive, searchPosts } from '../lib/posts'

export default function Archive() {
  const [posts] = usePosts()
  const [query, setQuery] = useState('')

  const groups = useMemo(() => getArchive(searchPosts(posts, query)), [posts, query])

  return (
    <div className="container-page max-w-4xl pt-16">
      <header className="animate-fade-up">
        <h1 className="font-serif text-3xl font-bold tracking-tight text-ink-900 sm:text-4xl dark:text-white">归档</h1>
        <p className="mt-2 text-sm text-ink-500">共 {posts.length} 篇文章，按时间倒序排列。</p>
      </header>

      <div className="relative mt-8 animate-fade-up" style={{ animationDelay: '60ms' }}>
        <Search size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-400" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="筛选文章…"
          className="input !pl-10"
        />
      </div>

      <div className="mt-12 space-y-12">
        {groups.length === 0 && <p className="py-16 text-center text-sm text-ink-400">没有匹配的文章</p>}

        {groups.map((group, gi) => (
          <section key={group.year} className="animate-fade-up" style={{ animationDelay: `${gi * 60}ms` }}>
            <div className="mb-4 flex items-baseline gap-3">
              <h2 className="font-mono text-2xl font-bold text-ink-900 dark:text-white">{group.year}</h2>
              <span className="text-xs text-ink-400">{group.posts.length} 篇</span>
              <span className="h-px flex-1 bg-gradient-to-r from-ink-200 to-transparent dark:from-white/10" />
            </div>

            <ul className="space-y-1">
              {group.posts.map((post) => (
                <li key={post.slug}>
                  <Link
                    to={`/posts/${post.slug}`}
                    className="group flex items-baseline gap-4 rounded-xl px-3 py-2.5 transition hover:bg-ink-900/[.035] dark:hover:bg-white/[.05]"
                  >
                    <time className="w-14 shrink-0 font-mono text-xs text-ink-400">{formatDate(post.date, 'short')}</time>
                    <span className="min-w-0 flex-1 truncate text-[15px] text-ink-700 transition group-hover:text-brand-600 dark:text-ink-200 dark:group-hover:text-brand-300">
                      {post.title}
                    </span>
                    <span className="hidden shrink-0 items-center gap-1 text-xs text-ink-400 sm:flex">
                      <Clock size={11} />
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
