import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, BookOpen, Hash, PenLine, Sparkles, Tags as TagsIcon } from 'lucide-react'
import { PostCard } from '../components/PostCard'
import { siteConfig } from '../lib/config'
import { usePosts } from '../lib/usePosts'
import { getAllTags } from '../lib/posts'
import { useAuth } from '../lib/auth'

function Stat({ value, label }: { value: number | string; label: string }) {
  return (
    <div className="flex flex-col">
      <span className="font-mono text-2xl font-semibold text-ink-900 dark:text-white">{value}</span>
      <span className="mt-0.5 text-xs text-ink-400">{label}</span>
    </div>
  )
}

export default function Home() {
  const [posts] = usePosts()
  const { isAuthed } = useAuth()
  const [page, setPage] = useState(1)

  const tags = useMemo(() => getAllTags(posts).slice(0, 10), [posts])
  const totalWords = useMemo(() => posts.reduce((sum, p) => sum + p.wordCount, 0), [posts])

  const perPage = siteConfig.postsPerPage
  const visible = posts.slice(0, page * perPage)
  const hasMore = visible.length < posts.length

  return (
    <>
      {/* ---------------------------------- Hero --------------------------------- */}
      <section className="container-page pb-4 pt-16 sm:pt-24">
        <div className="max-w-3xl">
          <span className="inline-flex animate-fade-up items-center gap-2 rounded-full border border-brand-200 bg-brand-50/60 px-3 py-1 text-xs font-medium text-brand-700 dark:border-brand-400/25 dark:bg-brand-500/10 dark:text-brand-300">
            <Sparkles size={13} />
            支持 Markdown · KaTeX · 在线编辑
          </span>

          <h1
            className="mt-6 animate-fade-up font-serif text-4xl font-bold leading-[1.15] tracking-tight text-ink-900 sm:text-5xl lg:text-6xl dark:text-white"
            style={{ animationDelay: '60ms' }}
          >
            {siteConfig.description.replace(/[。.！!？?]+$/, '')}
            <span className="bg-gradient-to-r from-brand-500 via-indigo-500 to-violet-500 bg-clip-text text-transparent">
              。
            </span>
          </h1>

          <p
            className="mt-5 max-w-2xl animate-fade-up text-[15.5px] leading-relaxed text-ink-500 dark:text-ink-400"
            style={{ animationDelay: '120ms' }}
          >
            {siteConfig.intro}
          </p>

          <div className="mt-8 flex animate-fade-up flex-wrap items-center gap-3" style={{ animationDelay: '180ms' }}>
            <a href="#posts" className="btn-primary h-10">
              <BookOpen size={16} />
              开始阅读
            </a>
            <Link to={isAuthed ? '/admin/new' : '/login'} className="btn-outline h-10">
              <PenLine size={16} />
              {isAuthed ? '写一篇新文章' : '登录写作'}
            </Link>
          </div>

          <div
            className="mt-12 flex animate-fade-up items-center gap-10 border-t border-ink-200/60 pt-6 dark:border-white/[0.08]"
            style={{ animationDelay: '240ms' }}
          >
            <Stat value={posts.length} label="篇文章" />
            <Stat value={getAllTags(posts).length} label="个标签" />
            <Stat value={totalWords > 9999 ? `${(totalWords / 10000).toFixed(1)}w` : totalWords} label="总字数" />
          </div>
        </div>
      </section>

      {/* --------------------------------- 标签云 -------------------------------- */}
      {tags.length > 0 && (
        <section className="container-page mt-14">
          <div className="flex flex-wrap items-center gap-2">
            <span className="mr-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-ink-400">
              <TagsIcon size={13} />
              热门标签
            </span>
            {tags.map((t) => (
              <Link key={t.name} to={`/tags/${encodeURIComponent(t.name)}`} className="chip">
                <Hash size={11} />
                {t.name}
                <span className="text-ink-400">{t.count}</span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* --------------------------------- 文章列表 ------------------------------- */}
      <section id="posts" className="container-page mt-10 scroll-mt-20">
        <div className="mb-6 flex items-baseline justify-between">
          <h2 className="font-serif text-2xl font-semibold tracking-tight text-ink-900 dark:text-white">最新文章</h2>
          <Link to="/archive" className="group flex items-center gap-1 text-sm text-ink-500 hover:text-brand-600 dark:hover:text-brand-300">
            全部归档
            <ArrowRight size={14} className="transition-transform group-hover:translate-x-0.5" />
          </Link>
        </div>

        {posts.length === 0 ? (
          <div className="card flex flex-col items-center gap-3 px-6 py-20 text-center">
            <PenLine size={28} className="text-ink-300" />
            <p className="text-sm text-ink-500">还没有任何文章。</p>
            <Link to={isAuthed ? '/admin/new' : '/login'} className="btn-primary mt-2">
              写下第一篇
            </Link>
          </div>
        ) : (
          <>
            <div className="grid gap-5 sm:grid-cols-2">
              {visible.map((post, i) => (
                <PostCard key={post.slug} post={post} index={i} />
              ))}
            </div>
            {hasMore && (
              <div className="mt-10 flex justify-center">
                <button onClick={() => setPage((p) => p + 1)} className="btn-outline h-10">
                  加载更多（还有 {posts.length - visible.length} 篇）
                </button>
              </div>
            )}
          </>
        )}
      </section>
    </>
  )
}
