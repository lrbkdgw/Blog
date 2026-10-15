import { Clock, FileEdit, LockKeyhole, Pin } from 'lucide-react'
import type { Post } from '../lib/types'
import { formatDate, hasPublicDate } from '../lib/posts'
import { resolvePendingImageSrc } from '../lib/updateQueue'
import { useTheme } from '../lib/theme'
import { cn } from '../lib/utils'
import { Reveal } from './Reveal'
import { MagicCard } from './magicui/magic-card'
import { BentoCard } from './magicui/bento-grid'
import { BorderBeam } from './magicui/border-beam'

export function PostCard({ post, index = 0, className, wide = false }: { post: Post; index?: number; className?: string; wide?: boolean }) {
  const { palette, theme } = useTheme()
  const glow = palette.id === 'aurora' || palette.id === 'neon'
    ? { mode: 'orb' as const, glowFrom: 'rgb(var(--brand-400))', glowTo: 'rgb(var(--theme-secondary))', glowOpacity: theme === 'dark' ? 0.14 : 0.09, glowBlur: 50 }
    : { mode: 'gradient' as const, gradientColor: 'rgb(var(--brand-400))', gradientOpacity: theme === 'dark' ? 0.14 : 0.1 }
  return (
    <Reveal delay={(index % 6) * 45} className={cn('h-full min-w-0', className)}>
      <MagicCard surface="transparent" className={cn('post-card h-full', wide && 'post-card-wide')} contentClassName="rounded-[inherit]" gradientSize={320} gradientFrom="rgb(var(--brand-400))" gradientTo="rgb(var(--theme-secondary))" {...glow}>
        {post.pinned && index === 0 && <BorderBeam size={100} duration={14} colorFrom="rgb(var(--brand-400))" colorTo="rgb(var(--theme-secondary))" />}
        <BentoCard
          name={post.title}
          description={post.summary}
          href={`/posts/${post.slug}`}
          background={post.cover && <img src={resolvePendingImageSrc(post.cover)} alt="" loading="lazy" className="post-cover h-44 w-full object-cover" />}
          metadata={<div className="post-meta mb-4 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs">
            {hasPublicDate(post) && <time dateTime={post.date} className="font-mono tracking-wide">{formatDate(post.date)}</time>}
            <span className="flex items-center gap-1"><Clock size={12} />{post.readingTime} 分钟</span>
            {post.pinned && <span className="flex items-center gap-1 text-brand-600 dark:text-brand-300"><Pin size={12} />置顶</span>}
            {post.encryption && <span className="flex items-center gap-1 text-brand-600 dark:text-brand-300"><LockKeyhole size={12} />正文加密</span>}
            {post.draft && <span className="flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-amber-700 dark:text-amber-300"><FileEdit size={11} />草稿</span>}
            {post.source === 'local' && <span className="rounded-full bg-brand-500/10 px-2 py-0.5 text-brand-700 dark:text-brand-200">本地</span>}
          </div>}
          footer={post.tags.slice(0, 3).map((tag) => <span key={tag} className="post-tag">#{tag}</span>)}
        />
      </MagicCard>
    </Reveal>
  )
}
