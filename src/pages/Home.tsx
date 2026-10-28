import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, PenLine } from 'lucide-react'
import { PostCard } from '../components/PostCard'
import { siteConfig } from '../lib/config'
import { OFFLINE } from '../lib/runtime'
import { usePosts } from '../lib/usePosts'
import { useAuth } from '../lib/auth'

/** 距离视口底部多少像素时提前触发下一页加载，避免用户滑到底部后等待。 */
const AUTO_LOAD_ROOT_MARGIN_PX = 240

export default function Home() {
  const [posts] = usePosts()
  const { isAuthed } = useAuth()
  const [page, setPage] = useState(1)
  const sentinelRef = useRef<HTMLDivElement>(null)

  const perPage = siteConfig.postsPerPage
  const maxPage = Math.max(1, Math.ceil(posts.length / perPage))
  const visible = posts.slice(0, page * perPage)
  const hasMore = visible.length < posts.length

  const loadMore = useCallback(() => {
    setPage((prev) => Math.min(maxPage, prev + 1))
  }, [maxPage])

  // 向下滑动接近列表底部时自动加载下一页；同时保留滚动监听兜底（兼容无 IntersectionObserver 环境与超宽/超高屏连载）。
  useEffect(() => {
    if (!hasMore) return
    const sentinel = sentinelRef.current
    if (!sentinel) return

    let observer: IntersectionObserver | null = null
    if (typeof IntersectionObserver !== 'undefined') {
      observer = new IntersectionObserver(
        (entries) => {
          if (entries.some((entry) => entry.isIntersecting)) {
            loadMore()
          }
        },
        { rootMargin: `${AUTO_LOAD_ROOT_MARGIN_PX}px 0px` },
      )
      observer.observe(sentinel)
    }

    const checkScrollNearBottom = () => {
      const rect = sentinel.getBoundingClientRect()
      if (rect.top <= window.innerHeight + AUTO_LOAD_ROOT_MARGIN_PX) {
        loadMore()
      }
    }

    window.addEventListener('scroll', checkScrollNearBottom, { passive: true })
    window.addEventListener('resize', checkScrollNearBottom, { passive: true })

    return () => {
      observer?.disconnect()
      window.removeEventListener('scroll', checkScrollNearBottom)
      window.removeEventListener('resize', checkScrollNearBottom)
    }
  }, [hasMore, visible.length, loadMore])

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
          <Link to={isAuthed || OFFLINE ? '/admin/new' : '/login'} className="btn-primary mt-2">
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
            <div ref={sentinelRef} data-infinite-scroll-sentinel className="mt-10 flex justify-center">
              <button onClick={loadMore} className="btn-outline h-10">
                加载更多（还有 {posts.length - visible.length} 篇）
              </button>
            </div>
          ) : (
            posts.length > perPage && (
              <p className="mt-10 text-center text-xs text-ink-400">
                已加载全部 {posts.length} 篇文章
              </p>
            )
          )}
        </>
      )}
    </section>
  )
}
