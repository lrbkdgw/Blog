import { useMemo } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Hash } from 'lucide-react'
import { usePosts } from '../lib/usePosts'
import { getAllTags } from '../lib/posts'
import { PostGrid } from '../components/PostGrid'
import { MagicCard } from '../components/magicui/magic-card'
import { NumberTicker } from '../components/magicui/number-ticker'
import { Reveal } from '../components/Reveal'

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
        <p className="mt-2 text-sm text-ink-500">共 <NumberTicker value={filtered.length} /> 篇文章</p>

        <PostGrid posts={filtered} className="mt-10" />
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
          用 <NumberTicker value={tags.length} /> 个标签整理了 <NumberTicker value={posts.length} /> 篇文章。
        </p>
      </header>

      <div className="mt-10 flex flex-wrap gap-3">
        {tags.map((t, i) => {
          const scale = 0.85 + (t.count / max) * 0.45
          return (
            <Reveal key={t.name} delay={Math.min(i, 6) * 35}>
              <MagicCard surface="transparent" className="tag-card group">
                <Link to={`/tags/${encodeURIComponent(t.name)}`} className="block px-4 py-2.5">
                  <span
                    className="font-medium text-ink-700 transition group-hover:text-brand-600 dark:text-ink-200 dark:group-hover:text-brand-300"
                    style={{ fontSize: `${scale}rem` }}
                  >
                    #{t.name}
                  </span>
                  <span className="ml-2 font-mono text-xs text-ink-400">{t.count}</span>
                </Link>
              </MagicCard>
            </Reveal>
          )
        })}
        {tags.length === 0 && <p className="py-16 text-sm text-ink-400">还没有标签</p>}
      </div>
    </div>
  )
}
