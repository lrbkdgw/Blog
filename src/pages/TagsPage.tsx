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
      <div className="container-page pt-16 sm:pt-20" data-yield-list>
        <Link
          to="/tags"
          className="group mb-7 inline-flex items-center gap-1.5 text-[12.5px] text-ink-400 transition hover:text-brand-600 dark:text-ink-500 dark:hover:text-brand-300"
        >
          <ArrowLeft size={13} className="transition-transform duration-300 ease-smooth group-hover:-translate-x-0.5" />
          所有标签
        </Link>
        <h1 className="flex items-center gap-2 text-[2rem] font-semibold tracking-[-0.03em] text-ink-900 dark:text-white">
          <Hash size={22} className="text-brand-500" strokeWidth={2.4} />
          {decoded}
        </h1>
        <p className="mt-2 text-[13.5px] text-ink-500 dark:text-ink-400">共 {filtered.length} 篇文章</p>

        <div className="mt-10 grid gap-4 sm:grid-cols-2" data-yield-list>
          {filtered.map((p, i) => (
            <PostCard key={p.slug} post={p} index={i} />
          ))}
        </div>
        {filtered.length === 0 && (
          <p className="py-20 text-center text-[13px] text-ink-400">这个标签下还没有文章</p>
        )}
      </div>
    )
  }

  return (
    <div className="container-page max-w-3xl pt-16 sm:pt-20" data-yield-list>
      <header className="animate-fade-up">
        <p className="text-[11.5px] font-medium uppercase tracking-[0.16em] text-ink-400 dark:text-ink-500">
          Tags
        </p>
        <h1 className="mt-3 text-[2rem] font-semibold tracking-[-0.03em] text-ink-900 dark:text-white">
          标签
        </h1>
        <p className="mt-2 text-[13.5px] text-ink-500 dark:text-ink-400">
          用 {tags.length} 个标签整理了 {posts.length} 篇文章。
        </p>
      </header>

      {/* 标签云：字重随文章数变化，整体像一段可点击的索引，而不是一排彩色药丸 */}
      <div className="mt-9 animate-fade-up" style={{ animationDelay: '60ms' }} data-yield-list>
        <div className="flex flex-wrap items-baseline gap-x-5 gap-y-3">
          {tags.map((t, i) => {
            const weight = t.count / max
            return (
              <Link
                key={t.name}
                to={`/tags/${encodeURIComponent(t.name)}`}
                className="group inline-flex animate-fade-up items-baseline gap-1.5 text-ink-600 transition-colors duration-200 hover:text-brand-600 dark:text-ink-300 dark:hover:text-brand-200"
                style={{
                  animationDelay: `${Math.min(i, 14) * 30}ms`,
                  fontSize: `${0.95 + weight * 0.42}rem`,
                  fontWeight: weight > 0.66 ? 600 : weight > 0.33 ? 500 : 400,
                }}
              >
                <span className="text-ink-300 transition-colors group-hover:text-brand-400 dark:text-ink-600">#</span>
                {t.name}
                <span className="font-mono text-[10.5px] tabular-nums text-ink-400 dark:text-ink-600">{t.count}</span>
              </Link>
            )
          })}
        </div>
        {tags.length === 0 && <p className="py-16 text-[13px] text-ink-400">还没有标签</p>}
      </div>
    </div>
  )
}
