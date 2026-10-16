import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, PenLine, Sparkles, BookOpen, Tags } from 'lucide-react'
import { PostCard } from '../components/PostCard'
import { siteConfig } from '../lib/config'
import { usePosts } from '../lib/usePosts'
import { useAuth } from '../lib/auth'

export default function Home() {
  const [posts] = usePosts()
  const { isAuthed } = useAuth()
  const [page, setPage] = useState(1)

  const perPage = siteConfig.postsPerPage
  const visible = posts.slice(0, page * perPage)
  const hasMore = visible.length < posts.length

  return (
    <section id="posts" className="container-page scroll-mt-24 pb-8 pt-7 sm:pt-10">
      <div className="hero-stage relative isolate mb-12 overflow-hidden rounded-[2rem] border border-white/60 px-6 py-12 shadow-[0_30px_90px_-42px_rgba(82,88,220,.45)] sm:px-12 sm:py-16 dark:border-white/10">
        <div className="hero-orb hero-orb-one" aria-hidden="true" />
        <div className="hero-orb hero-orb-two" aria-hidden="true" />
        <div className="hero-stars" aria-hidden="true" />
        <div className="relative z-10 max-w-2xl">
          <span className="hero-kicker"><Sparkles size={13} /> NOTES FROM THE NIGHT SKY</span>
          <h1 className="mt-5 font-serif text-4xl font-bold leading-tight tracking-tight text-ink-950 sm:text-6xl dark:text-white">
            把灵感，写进<br /><span className="hero-gradient-text">星河之间。</span>
          </h1>
          <p className="mt-5 max-w-xl text-sm leading-7 text-ink-600 sm:text-base dark:text-ink-300">
            {siteConfig.description}
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <a href="#posts-list" className="hero-cta">探索文章 <ArrowRight size={16} /></a>
            <Link to={isAuthed ? '/admin/new' : '/about'} className="hero-secondary">{isAuthed ? '开始写作' : '关于本站'}</Link>
          </div>
          <div className="mt-9 flex flex-wrap gap-5 text-xs font-medium text-ink-500 dark:text-ink-300">
            <span className="flex items-center gap-2"><BookOpen size={14} /> {posts.length} 篇记录</span>
            <span className="flex items-center gap-2"><Tags size={14} /> 数学 · 代码 · 随想</span>
          </div>
        </div>
        <div className="hero-planet" aria-hidden="true"><span /></div>
        <div className="hero-bottom-glow" aria-hidden="true" />
      </div>

      <div id="posts-list" className="mb-6 flex items-baseline justify-between scroll-mt-24">
        <div>
          <span className="section-eyebrow">THE LATEST</span>
          <h2 className="mt-1 font-serif text-2xl font-semibold tracking-tight text-ink-900 dark:text-white">最新文章</h2>
        </div>
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
  )
}
