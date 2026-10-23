import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, ChevronsDown, PenLine } from 'lucide-react'
import { PostCard } from '../components/PostCard'
import { siteConfig } from '../lib/config'
import { observeReachEnd } from '../lib/infiniteScroll'
import { usePosts } from '../lib/usePosts'
import { useAuth } from '../lib/auth'

export default function Home() {
  const [posts] = usePosts()
  const { isAuthed } = useAuth()
  const [page, setPage] = useState(1)

  const perPage = siteConfig.postsPerPage
  const visible = useMemo(() => posts.slice(0, page * perPage), [posts, page, perPage])
  const hasMore = visible.length < posts.length
  const remaining = Math.max(0, posts.length - visible.length)

  // 滚动到列表底部附近时自动加载下一页。
  // 每次 page 变化都会重新建立观察器：如果屏幕很高、一页填不满，哨兵仍在可视范围内，
  // 下一帧会继续补齐；一旦新卡片把哨兵推出 rootMargin，观察器自然停下。
  // 不支持 IntersectionObserver 的浏览器保持旧行为，用下方按钮手动加载。
  const sentinelRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!hasMore) return
    return observeReachEnd(sentinelRef.current, () => setPage((value) => value + 1), {
      rootMargin: '0px 0px 420px 0px',
    })
  }, [hasMore, page])

  // 文章数变少（删草稿）时把页码收回来，避免一直停在「加载更多」却什么也不发生。
  useEffect(() => {
    const maxPage = Math.max(1, Math.ceil(posts.length / perPage))
    setPage((value) => Math.min(value, maxPage))
  }, [posts.length, perPage])

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

          <div className="mt-10 flex flex-col items-center gap-3">
            {hasMore ? (
              <>
                {/* 哨兵：滚动到这里时自动翻页；用 aria-hidden 避免读屏器念出空节点 */}
                <div ref={sentinelRef} aria-hidden="true" className="h-px w-full max-w-xs" />
                <p className="flex items-center gap-1.5 text-xs text-ink-400" role="status">
                  <ChevronsDown size={13} className="animate-bounce" />
                  继续下滑，自动加载更多（已显示 {visible.length} / {posts.length} 篇）
                </p>
                <button onClick={() => setPage((value) => value + 1)} className="btn-outline h-10">
                  加载更多（还有 {remaining} 篇）
                </button>
              </>
            ) : (
              posts.length > perPage && (
                <p className="text-xs text-ink-400" role="status">
                  已经到底了 · 共 {posts.length} 篇
                </p>
              )
            )}
          </div>
        </>
      )}
    </section>
  )
}
