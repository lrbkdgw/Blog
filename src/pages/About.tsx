import aboutRaw from '/content/about.md?raw'
import { BookOpen, Compass, ExternalLink, Github, PenLine, Settings, Sparkles } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Markdown } from '../components/Markdown'
import { parseFrontmatter } from '../lib/frontmatter'
import { siteConfig } from '../lib/config'

export default function About() {
  const { content } = parseFrontmatter(aboutRaw)
  const { social } = siteConfig

  return (
    <div className="container-page max-w-4xl pt-16">
      {/* 网站介绍 Banner */}
      <header className="card animate-fade-up overflow-hidden p-8 sm:p-10 border-brand-200/80 bg-gradient-to-br from-brand-50/60 via-white/80 to-indigo-50/40 dark:border-brand-500/20 dark:from-brand-500/[0.08] dark:via-white/[0.02] dark:to-indigo-500/[0.05]">
        <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center justify-between">
          <div>
            <div className="inline-flex items-center gap-1.5 rounded-full bg-brand-500/10 px-3 py-1 text-xs font-semibold text-brand-600 dark:text-brand-300">
              <Sparkles size={13} />
              静态博客 · 在线交互系统
            </div>
            <h1 className="mt-3 font-serif text-3xl font-bold tracking-tight text-ink-900 sm:text-4xl dark:text-white">
              {siteConfig.title}
              {siteConfig.titleEn && (
                <span className="ml-2.5 font-sans text-xl font-normal text-ink-400 sm:text-2xl">
                  {siteConfig.titleEn}
                </span>
              )}
            </h1>
            <p className="mt-2 text-sm text-ink-600 dark:text-ink-300 max-w-xl">
              {siteConfig.description || '记录数学、代码与一些深夜里的胡思乱想。'}
            </p>
          </div>

          <div className="flex flex-wrap gap-2 sm:flex-col sm:items-end">
            <Link to="/admin/new" className="btn-primary h-9 px-4 text-xs">
              <PenLine size={14} />
              在线创作
            </Link>
            <Link to="/settings" className="btn-outline h-9 px-4 text-xs">
              <Settings size={14} />
              个性化设置
            </Link>
          </div>
        </div>

        <div className="mt-6 flex flex-wrap gap-2 border-t border-ink-200/60 pt-4 dark:border-white/10">
          <Link to="/" className="chip">
            <Compass size={12} />
            浏览首页
          </Link>
          <Link to="/archive" className="chip">
            <BookOpen size={12} />
            文章归档
          </Link>
          {social.github && (
            <a
              href={social.github}
              target="_blank"
              rel="noreferrer"
              className="chip text-ink-600 dark:text-ink-300"
            >
              <Github size={12} />
              GitHub 仓库
              <ExternalLink size={10} />
            </a>
          )}
        </div>
      </header>

      {/* 网站介绍与帮助手册正文 */}
      <div className="mt-10 animate-fade-up" style={{ animationDelay: '80ms' }}>
        <Markdown content={content} />
      </div>
    </div>
  )
}
