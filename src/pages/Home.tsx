import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowDown, ArrowRight, PenLine } from 'lucide-react'
import { PostGrid } from '../components/PostGrid'
import { AuroraText } from '../components/magicui/aurora-text'
import { NumberTicker } from '../components/magicui/number-ticker'
import { ShimmerButton, ShimmerLink } from '../components/magicui/shimmer-button'
import { siteConfig } from '../lib/config'
import { usePosts } from '../lib/usePosts'
import { getAllTags } from '../lib/posts'
import { useAuth } from '../lib/auth'

export default function Home() {
  const [posts] = usePosts()
  const { isAuthed } = useAuth()
  const [page, setPage] = useState(1)
  const [tag, setTag] = useState('')
  const tags = useMemo(() => getAllTags(posts), [posts])
  const filtered = tag ? posts.filter((post) => post.tags.includes(tag)) : posts
  const visible = filtered.slice(0, page * siteConfig.postsPerPage)
  const hasMore = visible.length < filtered.length

  return (
    <div className="container-page home-page pb-8 pt-8 sm:pt-12">
      <section id="posts" className="scroll-mt-24" aria-labelledby="posts-title">
        <div className="posts-heading mb-6 flex flex-wrap items-center justify-between gap-4">
          <h1 id="posts-title" className="section-heading">
            <AuroraText colors={['var(--magic-heading-from)', 'var(--magic-heading-to)']} speed={0.65}>最近的记录</AuroraText>
            <span className="section-count"><NumberTicker value={filtered.length} /></span>
          </h1>
          <Link to="/archive" className="section-more group">全部归档 <ArrowRight size={14} className="transition-transform group-hover:translate-x-1" /></Link>
        </div>
        {tags.length > 0 && <div className="post-filters" role="group" aria-label="按标签筛选文章">
          {[{ name: '', count: posts.length }, ...tags.slice(0, 5)].map((item) => <button key={item.name} type="button" aria-pressed={tag === item.name} className={`filter-chip ${tag === item.name ? 'is-active' : ''}`} onClick={() => { setTag(item.name); setPage(1) }}>{item.name ? `# ${item.name}` : '全部'}<span>{item.count}</span></button>)}
        </div>}
        <p className="sr-only" role="status">{tag ? `标签 ${tag}` : '全部文章'}：共 {filtered.length} 篇，已显示 {visible.length} 篇。</p>
        {posts.length === 0 ? (
          <div className="posts-empty flex flex-col items-center gap-3 px-6 py-20 text-center"><PenLine size={28} className="text-brand-400" /><p className="text-sm text-ink-500">每一段旅程，都从第一篇记录开始。</p><ShimmerLink to={isAuthed ? '/admin/new' : '/login'} className="mt-2">写下第一篇</ShimmerLink></div>
        ) : (
          <>
            <PostGrid posts={visible} />
            {filtered.length === 0 && <p className="py-12 text-center text-sm text-ink-500">这个话题暂时没有文章，试试其他标签。</p>}
            {hasMore && <div className="mt-9 flex justify-center"><ShimmerButton onClick={() => setPage((p) => p + 1)} className="magic-shimmer-secondary" background="rgb(var(--page-color))" shimmerColor="rgb(var(--brand-400))" shimmerDuration="7s">再读一些 <ArrowDown size={14} /><span className="text-xs opacity-75">还有 {filtered.length - visible.length} 篇</span></ShimmerButton></div>}
            {!hasMore && visible.length > 0 && <p className="end-note"><span />暂时写到这里，故事还在继续<span /></p>}
          </>
        )}
      </section>
    </div>
  )
}
