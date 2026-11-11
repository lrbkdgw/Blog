import aboutRaw from '/content/about.md?raw'
import { BookOpen, Compass, ExternalLink, Github, PenLine, Settings } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Markdown } from '../components/Markdown'
import { parseFrontmatter } from '../lib/frontmatter'
import { siteConfig } from '../lib/config'

export default function About() {
  const { data, content } = parseFrontmatter(aboutRaw)
  const helpTitle = typeof data.title === 'string' ? data.title : '博客帮助中心'
  const { social } = siteConfig

  return (
    <div className="container-page max-w-3xl pt-16 sm:pt-20" data-yield-list>
      <header className="animate-fade-up">
        <p className="text-[11.5px] font-medium uppercase tracking-[0.16em] text-ink-400 dark:text-ink-500">
          Help
        </p>
        <h1 className="mt-3 text-[2rem] font-semibold tracking-[-0.03em] text-ink-900 dark:text-white">
          {helpTitle}
        </h1>
        <p className="mt-2.5 max-w-xl text-[13.5px] leading-relaxed text-ink-500 dark:text-ink-400">
          阅读、创作、发布和全部 Markdown 扩展语法，都可以在这里找到具体用法。
        </p>

        <div className="mt-6 flex flex-wrap items-center gap-2">
          <Link to="/admin/new" className="btn-primary h-9">
            <PenLine size={14} />
            在线创作
          </Link>
          <Link to="/settings" className="btn-outline h-9">
            <Settings size={14} />
            个性化设置
          </Link>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2 text-[12.5px] text-ink-500 dark:text-ink-400">
          <Link to="/" className="inline-flex items-center gap-1.5 transition hover:text-brand-600 dark:hover:text-brand-300">
            <Compass size={13} />
            浏览首页
          </Link>
          <Link to="/archive" className="inline-flex items-center gap-1.5 transition hover:text-brand-600 dark:hover:text-brand-300">
            <BookOpen size={13} />
            文章归档
          </Link>
          {social.github && (
            <a
              href={social.github}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 transition hover:text-brand-600 dark:hover:text-brand-300"
            >
              <Github size={13} />
              GitHub 仓库
              <ExternalLink size={10} className="opacity-60" />
            </a>
          )}
        </div>
      </header>

      {/* 帮助手册正文 */}
      <div className="mt-12 animate-fade-up" style={{ animationDelay: '80ms' }} data-yield-list>
        <Markdown content={content} />
      </div>
    </div>
  )
}
