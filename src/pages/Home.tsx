import { useState } from 'react'
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

  const perPage = siteConfig.postsPerPage
  const visible = posts.slice(0, page * perPage)
  const hasMore = visible.length < posts.length

  return (
    <section id="posts" className="container-page scroll-mt-20 pt-10 sm:pt-14">
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
