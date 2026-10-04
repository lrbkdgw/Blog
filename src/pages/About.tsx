import aboutRaw from '/content/about.md?raw'
import { BookOpenText, Github, Rss, SlidersHorizontal } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Markdown } from '../components/Markdown'
import { parseFrontmatter } from '../lib/frontmatter'
import { siteConfig } from '../lib/config'
import logoVenti from '../assets/logo-venti.jpg'

/** 关于页 = 网站介绍页（issue #12）：像 README / 帮助文档一样介绍这个站本身 */
export default function About() {
  const { content } = parseFrontmatter(aboutRaw)
  const { social } = siteConfig

  const links = [
    social.github && { href: social.github, icon: Github, label: 'GitHub 源码' },
    social.rss && { href: social.rss, icon: Rss, label: 'RSS 订阅' },
  ].filter(Boolean) as { href: string; icon: typeof Github; label: string }[]

  return (
    <div className="container-page max-w-3xl pt-16">
      <header className="flex animate-fade-up flex-col items-start gap-5 sm:flex-row sm:items-center">
        <img
          src={logoVenti}
          alt={siteConfig.title}
          className="h-20 w-20 rounded-2xl object-cover shadow-lg ring-1 ring-black/5 dark:ring-white/10"
        />
        <div>
          <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-widest text-brand-600 dark:text-brand-300">
            <BookOpenText size={13} />
            关于本站
          </p>
          <h1 className="mt-1 font-serif text-3xl font-bold tracking-tight text-ink-900 dark:text-white">
            {siteConfig.title}
          </h1>
          <p className="mt-1.5 text-sm text-ink-500">{siteConfig.description}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {links.map((l) => (
              <a key={l.label} href={l.href} target="_blank" rel="noreferrer" className="chip">
                <l.icon size={12} />
                {l.label}
              </a>
            ))}
            <Link to="/settings" className="chip">
              <SlidersHorizontal size={12} />
              个性化设置
            </Link>
          </div>
        </div>
      </header>

      <div className="mt-12 animate-fade-up" style={{ animationDelay: '80ms' }}>
        <Markdown content={content} />
      </div>
    </div>
  )
}
