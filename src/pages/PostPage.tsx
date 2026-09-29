import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  ArrowLeft,
  ArrowUp,
  Calendar,
  Clock,
  FileEdit,
  Hash,
  Link2,
  PenLine,
  Type,
} from 'lucide-react'
import { Markdown } from '../components/Markdown'
import { Toc } from '../components/Toc'
import { extractToc, formatDate } from '../lib/posts'
import { usePosts } from '../lib/usePosts'
import { useAuth } from '../lib/auth'
import { useToast } from '../components/Toast'
import { siteConfig } from '../lib/config'

function ReadingProgress() {
  const [progress, setProgress] = useState(0)
  useEffect(() => {
    const onScroll = () => {
      const h = document.documentElement.scrollHeight - window.innerHeight
      setProgress(h > 0 ? Math.min(100, (window.scrollY / h) * 100) : 0)
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])
  return (
    <div className="no-print fixed inset-x-0 top-0 z-[60] h-0.5 bg-transparent">
      <div
        className="h-full bg-gradient-to-r from-brand-400 via-brand-500 to-indigo-500 transition-[width] duration-150"
        style={{ width: `${progress}%` }}
      />
    </div>
  )
}

export default function PostPage() {
  const { slug = '' } = useParams()
  const [posts] = usePosts(true)
  const { isAuthed } = useAuth()
  const toast = useToast()
  const [showTop, setShowTop] = useState(false)

  const post = useMemo(() => posts.find((p) => p.slug === slug), [posts, slug])
  const published = useMemo(() => posts.filter((p) => !p.draft), [posts])
  const index = published.findIndex((p) => p.slug === slug)
  const prev = index > 0 ? published[index - 1] : undefined
  const next = index >= 0 && index < published.length - 1 ? published[index + 1] : undefined
  const toc = useMemo(() => (post ? extractToc(post.content) : []), [post])

  useEffect(() => {
    if (post) document.title = `${post.title} · ${siteConfig.title}`
    return () => {
      document.title = `${siteConfig.title} · ${siteConfig.titleEn}`
    }
  }, [post])

  useEffect(() => {
    const onScroll = () => setShowTop(window.scrollY > 600)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  // 处理 hash 定位
  useEffect(() => {
    if (!post || !location.hash) return
    const id = decodeURIComponent(location.hash.slice(1))
    const t = setTimeout(() => {
      const el = document.getElementById(id)
      if (el) window.scrollTo({ top: el.offsetTop - 90, behavior: 'smooth' })
    }, 120)
    return () => clearTimeout(t)
  }, [post])

  if (!post) {
    return (
      <div className="container-page flex min-h-[60vh] flex-col items-center justify-center gap-4 text-center">
        <p className="font-mono text-6xl font-bold text-ink-200 dark:text-ink-800">404</p>
        <h1 className="font-serif text-xl font-semibold text-ink-800 dark:text-ink-100">这篇文章不存在</h1>
        <p className="max-w-sm text-sm text-ink-500">
          它可能已被删除，或者只存在于另一台设备的本地草稿里。
        </p>
        <Link to="/" className="btn-primary mt-2">
          <ArrowLeft size={15} />
          回到首页
        </Link>
      </div>
    )
  }

  const copyLink = async () => {
    await navigator.clipboard.writeText(window.location.href)
    toast('链接已复制到剪贴板', 'success')
  }

  return (
    <>
      <ReadingProgress />

      <div className="container-page grid grid-cols-1 gap-10 pt-10 xl:grid-cols-[minmax(0,1fr)_14rem]">
        <article className="min-w-0 animate-fade-up">
          {/* 面包屑 */}
          <Link
            to="/"
            className="no-print group mb-8 inline-flex items-center gap-1.5 text-sm text-ink-400 transition hover:text-brand-600 dark:hover:text-brand-300"
          >
            <ArrowLeft size={14} className="transition-transform group-hover:-translate-x-0.5" />
            返回文章列表
          </Link>

          {/* 标题区 */}
          <header className="border-b border-ink-200/60 pb-8 dark:border-white/[0.08]">
            <div className="mb-4 flex flex-wrap items-center gap-2">
              {post.draft && (
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2.5 py-0.5 text-xs font-medium text-amber-600 dark:text-amber-400">
                  <FileEdit size={11} />
                  草稿（仅你可见）
                </span>
              )}
              {post.tags.map((tag) => (
                <Link key={tag} to={`/tags/${encodeURIComponent(tag)}`} className="chip">
                  <Hash size={11} />
                  {tag}
                </Link>
              ))}
            </div>

            <h1 className="font-serif text-3xl font-bold leading-tight tracking-tight text-ink-900 sm:text-[2.6rem] dark:text-white">
              {post.title}
            </h1>

            {post.summary && (
              <p className="mt-4 text-[15.5px] leading-relaxed text-ink-500 dark:text-ink-400">{post.summary}</p>
            )}

            <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-ink-400">
              <span className="flex items-center gap-1.5">
                <Calendar size={13} />
                <time dateTime={post.date}>{formatDate(post.date)}</time>
              </span>
              {post.updated && post.updated !== post.date && (
                <span className="flex items-center gap-1.5">更新于 {formatDate(post.updated)}</span>
              )}
              <span className="flex items-center gap-1.5">
                <Type size={13} />
                {post.wordCount} 字
              </span>
              <span className="flex items-center gap-1.5">
                <Clock size={13} />
                约 {post.readingTime} 分钟
              </span>
              <span className="ml-auto flex items-center gap-1.5">
                <button onClick={copyLink} className="btn-ghost no-print h-7 !px-2 text-xs">
                  <Link2 size={13} />
                  复制链接
                </button>
                {isAuthed && (
                  <Link to={`/admin/edit/${post.slug}`} className="btn-ghost no-print h-7 !px-2 text-xs">
                    <PenLine size={13} />
                    编辑
                  </Link>
                )}
              </span>
            </div>
          </header>

          {post.cover && (
            <img src={post.cover} alt="" className="mt-8 w-full rounded-2xl object-cover shadow-xl" />
          )}

          {/* 正文 */}
          <div className="mt-8">
            <Markdown content={post.content} />
          </div>

          {/* 文末 */}
          <div className="no-print mt-16 border-t border-ink-200/60 pt-8 dark:border-white/[0.08]">
            <div className="grid gap-3 sm:grid-cols-2">
              {prev ? (
                <Link
                  to={`/posts/${prev.slug}`}
                  className="card group flex flex-col p-4 transition hover:border-brand-300 dark:hover:border-brand-400/30"
                >
                  <span className="text-xs text-ink-400">← 上一篇</span>
                  <span className="mt-1 line-clamp-2 text-sm font-medium text-ink-800 group-hover:text-brand-600 dark:text-ink-100 dark:group-hover:text-brand-300">
                    {prev.title}
                  </span>
                </Link>
              ) : (
                <span />
              )}
              {next && (
                <Link
                  to={`/posts/${next.slug}`}
                  className="card group flex flex-col p-4 text-right transition hover:border-brand-300 dark:hover:border-brand-400/30"
                >
                  <span className="text-xs text-ink-400">下一篇 →</span>
                  <span className="mt-1 line-clamp-2 text-sm font-medium text-ink-800 group-hover:text-brand-600 dark:text-ink-100 dark:group-hover:text-brand-300">
                    {next.title}
                  </span>
                </Link>
              )}
            </div>
          </div>
        </article>

        <Toc items={toc} />
      </div>

      {showTop && (
        <button
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          className="no-print card fixed bottom-6 left-6 z-40 flex h-10 w-10 animate-scale-in items-center justify-center !rounded-full text-ink-500 transition hover:text-brand-600 dark:hover:text-brand-300"
          aria-label="回到顶部"
        >
          <ArrowUp size={17} />
        </button>
      )}
    </>
  )
}
