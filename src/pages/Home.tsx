import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, PenLine } from 'lucide-react'
import { PostCard } from '../components/PostCard'
import { siteConfig } from '../lib/config'
import { usePosts } from '../lib/usePosts'
import { useAuth } from '../lib/auth'

export default function Home() {
  const [posts] = usePosts()
  const { isAuthed } = useAuth()
  const [page, setPage] = useState(1)
  const loadMoreRef = useRef<HTMLDivElement>(null)

  const perPage = siteConfig.postsPerPage
  const visible = posts.slice(0, page * perPage)
  const hasMore = visible.length < posts.length
  const loadMore = useCallback(() => {
    setPage((current) => {
      const lastPage = Math.max(1, Math.ceil(posts.length / perPage))
      return Math.min(current + 1, lastPage)
    })
  }, [perPage, posts.length])

  // 提前一小屏加载，读者接近列表末尾时无需停下来点按钮。
  // page 变化后重新观察：若宽屏/超高视口仍容得下 sentinel，会继续补齐下一页；
  // 不支持 IntersectionObserver 的旧浏览器保留下方按钮作为回退。
  useEffect(() => {
    const sentinel = loadMoreRef.current
    if (!sentinel || !hasMore || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) loadMore()
      },
      { rootMargin: '360px 0px', threshold: 0.01 },
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [hasMore, loadMore, page])

  return (
    <section id="posts" className="container-page scroll-mt-24 pb-8 pt-12 sm:pt-14" data-yield-list>
      <div className="mb-6 flex items-baseline justify-between">
        <h1 className="font-serif text-2xl font-semibold tracking-tight text-ink-900 dark:text-white">最新文章</h1>
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
          <div className="grid gap-5 sm:grid-cols-2" data-yield-list>
            {visible.map((post, i) => (
              <PostCard key={post.slug} post={post} index={i} />
            ))}
          </div>
          {hasMore ? (
            <div
              ref={loadMoreRef}
              className="mt-10 flex flex-col items-center gap-2"
              data-load-more-sentinel
            >
              <button type="button" onClick={loadMore} className="btn-outline h-10">
                立即加载更多（还有 {posts.length - visible.length} 篇）
              </button>
              <p className="text-xs text-ink-400">继续向下滑动将自动加载</p>
            </div>
          ) : posts.length > perPage ? (
            <p className="mt-10 text-center text-xs text-ink-400" role="status">
              已加载全部 {posts.length} 篇文章
            </p>
          ) : null}
        </>
      )}
    </section>
  )
}
