import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, ArrowUpRight, PenLine } from 'lucide-react'
import { PostCard } from '../components/PostCard'
import { siteConfig } from '../lib/config'
import { usePosts } from '../lib/usePosts'
import { useAuth } from '../lib/auth'

/** 距离视口底部多少像素时提前触发下一页加载，避免用户滑到底部后等待。 */
const AUTO_LOAD_ROOT_MARGIN_PX = 240

/**
 * 首页。
 *
 * 上半屏是一个安静的自我介绍区（站点名 + 一句话简介 + 两个入口），
 * 下面直接接文章列表；没有大色块、没有装饰性渐变标题，信息层级只靠字号与留白。
 */
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
    <>
      {/* ------------------------------- 首屏 ------------------------------- */}
      <section className="container-page pb-4 pt-14 sm:pt-20" data-yield-list>
        <div className="max-w-2xl animate-fade-up">
          <p className="flex items-center gap-2 text-[12px] font-medium tracking-[0.16em] text-ink-400 uppercase dark:text-ink-500">
            <span className="h-[5px] w-[5px] rounded-full bg-brand-500" />
            {siteConfig.titleEn || 'Journal'}
          </p>
          <h1 className="mt-5 text-[2.1rem] font-semibold leading-[1.15] tracking-[-0.03em] text-ink-900 sm:text-[2.85rem] dark:text-white">
            {siteConfig.title}
          </h1>
          <p className="mt-4 max-w-xl text-[15px] leading-[1.85] text-ink-500 dark:text-ink-400">
            {siteConfig.intro}
          </p>

          <div className="mt-7 flex flex-wrap items-center gap-2.5">
            <a href="#posts" className="btn-primary h-9 px-4">
              阅读文章
              <ArrowRight size={14} />
            </a>
            <Link to={isAuthed ? '/admin/new' : '/archive'} className="btn-outline h-9 px-4">
              <PenLine size={14} />
              {isAuthed ? '写一篇' : '翻翻归档'}
            </Link>
            <span className="ml-1 hidden text-[12.5px] text-ink-400 sm:inline dark:text-ink-500">
              {siteConfig.author.name}
              {posts.length > 0 ? ` · 已发布 ${posts.length} 篇` : ''}
            </span>
          </div>
        </div>
      </section>

      {/* ------------------------------ 文章列表 ------------------------------ */}
      <section id="posts" className="container-page scroll-mt-24 pb-8 pt-14" data-yield-list>
        <div className="mb-7 flex items-baseline justify-between border-t border-ink-200/70 pt-8 dark:border-white/[0.07]">
          <h2 className="text-[15px] font-semibold tracking-tight text-ink-900 dark:text-white">最新文章</h2>
          <Link
            to="/archive"
            className="group flex items-center gap-1 text-[12.5px] text-ink-400 transition hover:text-brand-600 dark:text-ink-500 dark:hover:text-brand-300"
          >
            全部归档
            <ArrowRight size={13} className="transition-transform duration-300 ease-smooth group-hover:translate-x-0.5" />
          </Link>
        </div>

        {posts.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-ink-200 py-20 text-center dark:border-white/[0.09]">
            <PenLine size={22} className="text-ink-300 dark:text-ink-600" />
            <p className="text-[13.5px] text-ink-500">还没有任何文章。</p>
            <Link to={isAuthed ? '/admin/new' : '/login'} className="btn-outline mt-1">
              写下第一篇
              <ArrowUpRight size={14} />
            </Link>
          </div>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2" data-yield-list>
              {visible.map((post, i) => (
                <PostCard key={post.slug} post={post} index={i} />
              ))}
            </div>
            {hasMore ? (
              <div ref={sentinelRef} data-infinite-scroll-sentinel className="mt-10 flex justify-center">
                <button onClick={loadMore} className="btn-outline h-9">
                  加载更多（还有 {posts.length - visible.length} 篇）
                </button>
              </div>
            ) : (
              posts.length > perPage && (
                <p className="mt-10 text-center text-[11.5px] tracking-wide text-ink-400 dark:text-ink-600">
                  已加载全部 {posts.length} 篇文章
                </p>
              )
            )}
          </>
        )}
      </section>
    </>
  )
}
