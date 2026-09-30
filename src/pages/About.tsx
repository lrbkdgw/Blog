import aboutRaw from '/content/about.md?raw'
import { Github, Rocket, Settings, Sparkles } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Markdown } from '../components/Markdown'
import { parseFrontmatter } from '../lib/frontmatter'
import { siteConfig } from '../lib/config'

export default function About() {
  const { content } = parseFrontmatter(aboutRaw)

  return (
    <div className="container-page max-w-4xl pt-12">
      <header className="animate-fade-up overflow-hidden rounded-3xl border border-brand-200/70 bg-gradient-to-br from-brand-50 via-white to-indigo-50 p-7 shadow-sm sm:p-10 dark:border-brand-400/15 dark:from-brand-500/10 dark:via-ink-950 dark:to-indigo-500/10">
        <div className="flex items-center gap-2 text-sm font-medium text-brand-600 dark:text-brand-300">
          <Sparkles size={16} />
          关于本站
        </div>
        <h1 className="mt-4 font-serif text-4xl font-bold tracking-tight text-ink-900 sm:text-5xl dark:text-white">
          {siteConfig.title}
          {siteConfig.titleEn && <span className="ml-3 text-brand-500">{siteConfig.titleEn}</span>}
        </h1>
        <p className="mt-4 max-w-2xl text-base leading-relaxed text-ink-600 dark:text-ink-300">{siteConfig.description}</p>
        <div className="mt-7 flex flex-wrap gap-3">
          <Link to="/" className="btn-primary h-10"><Rocket size={15} />开始阅读</Link>
          <Link to="/settings" className="btn-outline h-10"><Settings size={15} />阅读设置</Link>
          {siteConfig.social.github && (
            <a href={siteConfig.social.github} target="_blank" rel="noreferrer" className="btn-outline h-10">
              <Github size={15} />GitHub
            </a>
          )}
        </div>
      </header>

      <div className="mt-12 animate-fade-up" style={{ animationDelay: '80ms' }}>
        <Markdown content={content} />
      </div>
    </div>
  )
}
