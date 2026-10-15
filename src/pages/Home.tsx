import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowDown, ArrowRight, BookOpen, Palette, PenLine, Sparkles } from 'lucide-react'
import { PostCard } from '../components/PostCard'
import { ThemeArtwork } from '../components/ThemeArtwork'
import { AuroraText } from '../components/magicui/aurora-text'
import { BorderBeam } from '../components/magicui/border-beam'
import { ShimmerButton, ShimmerLink } from '../components/magicui/shimmer-button'
import { siteConfig } from '../lib/config'
import { usePosts } from '../lib/usePosts'
import { getAllTags } from '../lib/posts'
import { PALETTES } from '../lib/appearance'
import { useAuth } from '../lib/auth'
import { useTheme } from '../lib/theme'

export default function Home() {
  const [posts] = usePosts()
  const { isAuthed } = useAuth()
  const { palette, setPalette } = useTheme()
  const [page, setPage] = useState(1)
  const [tag, setTag] = useState('')
  const tags = useMemo(() => getAllTags(posts), [posts])
  const filtered = tag ? posts.filter((post) => post.tags.includes(tag)) : posts
  const visible = filtered.slice(0, page * siteConfig.postsPerPage)
  const hasMore = visible.length < filtered.length

  return (
    <div className="container-page home-page pb-8 pt-6 sm:pt-10">
      <section className="home-hero" aria-labelledby="home-title">
        <div className="hero-grid" aria-hidden="true" />
        <BorderBeam size={160} duration={16} colorFrom="rgb(var(--brand-400))" colorTo="rgb(var(--theme-secondary))" />
        <div className="hero-copy relative z-10">
          <div className="hero-eyebrow"><span className="status-dot" />{siteConfig.author.name} 的个人空间<span className="hero-eyebrow-line" /></div>
          <h1 id="home-title" className="hero-heading">记录思考，<br /><AuroraText colors={['var(--magic-heading-from)', 'var(--magic-heading-to)', 'var(--magic-heading-from)']} speed={0.65}>收藏一点灵光。</AuroraText></h1>
          <p className="hero-description">{siteConfig.description}</p>
          <div className="mt-7 flex flex-wrap items-center gap-3">
            <ShimmerLink to="#posts" className="hero-read">开始阅读 <ArrowDown size={15} /></ShimmerLink>
            <Link to="/archive" className="hero-secondary">浏览归档 <ArrowRight size={15} /></Link>
          </div>
          <div className="hero-stats"><span><BookOpen size={13} /><strong>{posts.length}</strong> 篇记录</span><span className="hero-stat-divider" /><span><strong>{tags.length}</strong> 个话题</span><span className="hero-stats-note">慢慢写，慢慢发现。</span></div>
        </div>
        <div className="hero-art" aria-hidden="true">
          <ThemeArtwork palette={palette.id} />
          <div className="hero-art-caption"><Sparkles size={13} /><span>让好奇心，自由生长。</span></div>
          <span className="hero-edition">{palette.english} / JOURNAL</span>
        </div>
      </section>

      <div className="theme-ribbon">
        <div className="flex shrink-0 items-center gap-2"><Palette size={14} /><span>今天的色彩</span><span className="theme-ribbon-name" aria-live="polite">{palette.name}</span></div>
        <div className="theme-ribbon-actions">
          <div className="theme-swatches" role="group" aria-label="快速切换主题">
            {PALETTES.map((item) => <button key={item.id} type="button" className={`theme-swatch ${item.id === palette.id ? 'is-selected' : ''}`} aria-label={`切换主题：${item.name}`} aria-pressed={item.id === palette.id} title={item.name} onClick={() => setPalette(item.id)}><span style={{ background: `linear-gradient(135deg, ${item.swatches[0]} 15%, ${item.swatches[1]} 100%)` }} /></button>)}
          </div>
          <Link to="/settings#appearance" className="theme-settings-link">装扮空间 <ArrowRight size={13} /></Link>
        </div>
      </div>

      <section id="posts" className="scroll-mt-24 pt-10 sm:pt-12" aria-labelledby="posts-title">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div><p className="section-eyebrow">THE LATEST NOTES</p><h2 id="posts-title" className="section-heading">最近的记录<span className="section-count">{filtered.length.toString().padStart(2, '0')}</span></h2></div>
          <Link to="/archive" className="section-more group">全部归档 <ArrowRight size={14} className="transition-transform group-hover:translate-x-1" /></Link>
        </div>
        {tags.length > 0 && <div className="post-filters" role="group" aria-label="按标签筛选文章">
          {[{ name: '', count: posts.length }, ...tags.slice(0, 5)].map((item) => <button key={item.name} type="button" aria-pressed={tag === item.name} className={`filter-chip ${tag === item.name ? 'is-active' : ''}`} onClick={() => { setTag(item.name); setPage(1) }}>{item.name ? `# ${item.name}` : '全部'}<span>{item.count}</span></button>)}
        </div>}
        {posts.length === 0 ? (
          <div className="card flex flex-col items-center gap-3 px-6 py-20 text-center"><PenLine size={28} className="text-brand-400" /><p className="text-sm text-ink-500">每一段旅程，都从第一篇记录开始。</p><ShimmerLink to={isAuthed ? '/admin/new' : '/login'} className="mt-2">写下第一篇</ShimmerLink></div>
        ) : (
          <>
            <div className="grid gap-5 sm:grid-cols-2">{visible.map((post, i) => <PostCard key={post.slug} post={post} index={i} />)}</div>
            {filtered.length === 0 && <p className="py-12 text-center text-sm text-ink-500">这个话题暂时没有文章，试试其他标签。</p>}
            {hasMore && <div className="mt-9 flex justify-center"><ShimmerButton onClick={() => setPage((p) => p + 1)} className="magic-shimmer-secondary" background="rgb(var(--surface))" shimmerColor="rgb(var(--brand-400))" shimmerDuration="7s">再读一些 <ArrowDown size={14} /><span className="text-xs opacity-75">还有 {filtered.length - visible.length} 篇</span></ShimmerButton></div>}
            {!hasMore && visible.length > 0 && <p className="end-note"><span />暂时写到这里，故事还在继续<span /></p>}
          </>
        )}
      </section>
    </div>
  )
}
