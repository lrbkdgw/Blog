import { useMemo } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Hash } from 'lucide-react'
import { usePosts } from '../lib/usePosts'
import { getAllTags } from '../lib/posts'
import { PostCard } from '../components/PostCard'

export default function TagsPage() {
  const { tag } = useParams()
  const [posts] = usePosts()
  const tags = useMemo(() => getAllTags(posts), [posts])

  const decoded = useMemo(() => {
    if (!tag) return ''
    try {
      return decodeURIComponent(tag)
    } catch {
      return tag
    }
  }, [tag])

  const filtered = useMemo(
    () => (decoded ? posts.filter((p) => p.tags && p.tags.includes(decoded)) : []),
    [posts, decoded],
  )

  const max = useMemo(() => {
    if (tags.length === 0) return 1
    return Math.max(1, ...tags.map((t) => t.count))
  }, [tags])

  if (decoded) {
    return (
      <div className="container-page pt-16">
        <Link
          to="/tags"
          className="group mb-6 inline-flex items-center gap-1.5 text-sm text-ink-400 transition hover:text-brand-600 dark:hover:text-brand-300"
        >
          <ArrowLeft size={14} className="transition-transform group-hover:-translate-x-0.5" />
          所有标签
        </Link>
        <h1 className="flex items-center gap-2 font-serif text-3xl font-bold tracking-tight text-ink-900 dark:text-white">
          <Hash size={26} className="text-brand-500" />
          {decoded}
        </h1>
        <p className="mt-2 text-sm text-ink-500">共 {filtered.length} 篇文章</p>

        <div className="mt-10 grid gap-5 sm:grid-cols-2">
          {filtered.map((p, i) => (
            <PostCard key={p.slug} post={p} index={i} />
          ))}
        </div>
        {filtered.length === 0 && (
          <p className="py-20 text-center text-sm text-ink-400">这个标签下还没有文章</p>
        )}
      </div>
    )
  }

  return (
    <div className="container-page max-w-4xl pt-16">
      <header className="animate-fade-up">
        <h1 className="font-serif text-3xl font-bold tracking-tight text-ink-900 sm:text-4xl dark:text-white">
          标签
        </h1>
        <p className="mt-2 text-sm text-ink-500">
          用 {tags.length} 个标签整理了 {posts.length} 篇文章。
        </p>
      </header>

      <div className="mt-10 flex flex-wrap gap-3">
        {tags.map((t, i) => {
          const scale = 0.85 + (t.count / max) * 0.45
          return (
            <Link
              key={t.name}
              to={`/tags/${encodeURIComponent(t.name)}`}
              className="card group animate-fade-up px-4 py-2.5 transition hover:-translate-y-0.5 hover:border-brand-300 dark:hover:border-brand-400/30"
              style={{ animationDelay: `${Math.min(i, 12) * 35}ms` }}
            >
              <span
                className="font-medium text-ink-700 transition group-hover:text-brand-600 dark:text-ink-200 dark:group-hover:text-brand-300"
                style={{ fontSize: `${scale}rem` }}
              >
                #{t.name}
              </span>
              <span className="ml-2 font-mono text-xs text-ink-400">{t.count}</span>
            </Link>
          )
        })}
        {tags.length === 0 && <p className="py-16 text-sm text-ink-400">还没有标签</p>}
      </div>
    </div>
  )
}
