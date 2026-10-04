import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  ArrowLeft,
  ArrowUp,
  Calendar,
  Clock,
  FileClock,
  FileEdit,
  Hash,
  History,
  Link2,
  Loader2,
  PenLine,
  Type,
  X,
} from 'lucide-react'
import { Markdown } from '../components/Markdown'
import { PasswordPrompt } from '../components/PasswordPrompt'
import { Toc } from '../components/Toc'
import { Comments } from '../components/Comments'
import {
  buildPost,
  extractToc,
  formatDate,
  getAllAdminPosts,
  getPostBySlug,
  postFingerprint,
} from '../lib/posts'
import { decryptPost, isEncryptedPost } from '../lib/crypto'
import {
  fetchPostHistoryMarkdown,
  getRepoTarget,
  listPostHistory,
} from '../lib/github'
import type { PostHistoryVersion } from '../lib/github'
import type { Post } from '../lib/types'
import { usePosts } from '../lib/usePosts'
import { useAuth } from '../lib/auth'
import { useToast } from '../components/Toast'
import { siteConfig } from '../lib/config'

function ReadingProgress() {
  const [progress, setProgress] = useState(0)
  useEffect(() => {
    const onScroll = () => {
      const height = document.documentElement.scrollHeight - window.innerHeight
      setProgress(height > 0 ? Math.min(100, (window.scrollY / height) * 100) : 0)
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

function HistoryDialog({
  versions,
  loading,
  error,
  onClose,
  onSelect,
  selecting,
}: {
  versions: PostHistoryVersion[]
  loading: boolean
  error: string
  onClose: () => void
  onSelect: (version: PostHistoryVersion) => void
  selecting: string | null
}) {
  return (
    <div className="no-print fixed inset-0 z-[90] flex items-center justify-center bg-ink-950/45 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="文章历史版本">
      <div className="card flex max-h-[min(40rem,calc(100vh-2rem))] w-full max-w-2xl flex-col overflow-hidden">
        <div className="flex items-center justify-between border-b border-ink-200/70 px-5 py-4 dark:border-white/10">
          <div>
            <h2 className="flex items-center gap-2 font-serif text-lg font-bold text-ink-900 dark:text-white">
              <History size={18} className="text-brand-500" />
              文章历史版本
            </h2>
            <p className="mt-1 text-xs text-ink-400">每次发布都会保留为一个 Git 提交，可在此查看任一版本。</p>
          </div>
          <button type="button" onClick={onClose} className="btn-ghost h-8 w-8 !px-0" aria-label="关闭历史版本">
            <X size={16} />
          </button>
        </div>
        <div className="min-h-32 overflow-y-auto divide-y divide-ink-200/60 dark:divide-white/10">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-14 text-sm text-ink-500">
              <Loader2 size={16} className="animate-spin" /> 正在读取 Git 历史…
            </div>
          ) : error ? (
            <p className="p-5 text-sm text-rose-600 dark:text-rose-400">{error}</p>
          ) : versions.length === 0 ? (
            <p className="p-8 text-center text-sm text-ink-500">尚未找到可查看的历史版本。</p>
          ) : (
            versions.map((version, index) => (
              <button
                type="button"
                key={version.sha}
                onClick={() => onSelect(version)}
                disabled={Boolean(selecting)}
                className="flex w-full items-center gap-3 px-5 py-3.5 text-left transition hover:bg-ink-50 disabled:cursor-wait dark:hover:bg-white/[0.04]"
              >
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-500/10 font-mono text-[11px] font-bold text-brand-600 dark:text-brand-300">
                  {selecting === version.sha ? <Loader2 size={14} className="animate-spin" /> : index + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-ink-800 dark:text-ink-100">{version.message}</span>
                  <span className="mt-1 block font-mono text-[11px] text-ink-400">
                    {version.sha.slice(0, 8)} · {version.author.name}
                    {version.committedAt ? ` · ${new Date(version.committedAt).toLocaleString('zh-CN')}` : ''}
                  </span>
                </span>
                <span className="shrink-0 text-xs text-brand-600 dark:text-brand-300">查看</span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  )
}

export default function PostPage() {
  const { slug = '' } = useParams()
  const navigate = useNavigate()
  const [posts] = usePosts(true)
  const { isAuthed } = useAuth()
  const toast = useToast()
  const [showTop, setShowTop] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyError, setHistoryError] = useState('')
  const [history, setHistory] = useState<PostHistoryVersion[]>([])
  const [selectingVersion, setSelectingVersion] = useState<string | null>(null)
  const [historicalPost, setHistoricalPost] = useState<Post | null>(null)
  const [unlockedPost, setUnlockedPost] = useState<Post | null>(null)

  const post = useMemo(() => posts.find((item) => item.slug === slug), [posts, slug])
  const repoPost = useMemo(() => getPostBySlug(slug, 'repo'), [slug])
  const historyBase = repoPost || post
  const snapshot = historicalPost || post
  const visiblePost = unlockedPost || snapshot
  const published = useMemo(() => posts.filter((item) => !item.draft), [posts])
  const index = published.findIndex((item) => item.slug === slug)
  const previous = index > 0 ? published[index - 1] : undefined
  const next = index >= 0 && index < published.length - 1 ? published[index + 1] : undefined
  const toc = useMemo(() => (visiblePost && !isEncryptedPost(visiblePost) ? extractToc(visiblePost.content) : []), [visiblePost])

  useEffect(() => {
    setHistoricalPost(null)
    setUnlockedPost(null)
    setHistoryOpen(false)
    setHistory([])
    setHistoryError('')
  }, [slug])

  useEffect(() => {
    if (visiblePost) document.title = `${visiblePost.title} · ${siteConfig.title}`
    return () => {
      document.title = siteConfig.titleEn ? `${siteConfig.title} · ${siteConfig.titleEn}` : siteConfig.title
    }
  }, [visiblePost])

  useEffect(() => {
    const onScroll = () => setShowTop(window.scrollY > 600)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    if (!visiblePost || isEncryptedPost(visiblePost) || !window.location.hash) return
    const id = decodeURIComponent(window.location.hash.slice(1))
    const timer = window.setTimeout(() => {
      const element = document.getElementById(id)
      if (element) window.scrollTo({ top: element.offsetTop - 90, behavior: 'smooth' })
    }, 120)
    return () => window.clearTimeout(timer)
  }, [visiblePost])

  if (!post || !snapshot || !historyBase) {
    return (
      <div className="container-page flex min-h-[60vh] flex-col items-center justify-center gap-4 text-center">
        <p className="font-mono text-6xl font-bold text-ink-200 dark:text-ink-800">404</p>
        <h1 className="font-serif text-xl font-semibold text-ink-800 dark:text-ink-100">这篇文章不存在</h1>
        <p className="max-w-sm text-sm text-ink-500">它可能已被删除，或者只存在于另一台设备的本地草稿里。</p>
        <Link to="/" className="btn-primary mt-2"><ArrowLeft size={15} />回到首页</Link>
      </div>
    )
  }

  const openHistory = async () => {
    setHistoryOpen(true)
    setHistoryError('')
    if (history.length > 0) return
    setHistoryLoading(true)
    try {
      setHistory(await listPostHistory(historyBase.slug, getRepoTarget(), historyBase.path))
    } catch (error) {
      setHistoryError(error instanceof Error ? error.message : '无法加载文章历史')
    } finally {
      setHistoryLoading(false)
    }
  }

  const selectHistory = async (version: PostHistoryVersion) => {
    setSelectingVersion(version.sha)
    try {
      const raw = await fetchPostHistoryMarkdown(
        historyBase.slug,
        version.sha,
        getRepoTarget(),
        historyBase.path,
      )
      setHistoricalPost(buildPost(raw, { slug: historyBase.slug, path: historyBase.path, source: 'repo' }))
      setUnlockedPost(null)
      setHistoryOpen(false)
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch (error) {
      setHistoryError(error instanceof Error ? error.message : '无法读取这个历史版本')
    } finally {
      setSelectingVersion(null)
    }
  }

  const unlock = async (password: string) => {
    if (!snapshot) return
    setUnlockedPost(await decryptPost(snapshot, password))
  }

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href)
      toast('链接已复制到剪贴板', 'success')
    } catch {
      toast('无法访问剪贴板，请手动复制地址', 'warning')
    }
  }

  const editCurrentVersion = () => {
    if (!visiblePost || isEncryptedPost(visiblePost)) return
    // The current repository version always has a matching editor target. A historical
    // snapshot is only opened in-place if an identical local/repository article exists.
    if (!historicalPost) {
      navigate(`/admin/edit/${post.slug}?source=${post.source}`)
      return
    }
    const matching = getAllAdminPosts().find((candidate) => postFingerprint(candidate) === postFingerprint(visiblePost))
    if (matching) {
      navigate(`/admin/edit/${matching.slug}?source=${matching.source}`)
      return
    }
    navigate('/admin/new', {
      state: { draft: visiblePost, protected: Boolean(historicalPost?.encryption) },
    })
  }

  const locked = isEncryptedPost(snapshot) && !unlockedPost
  if (locked) {
    return (
      <>
        <ReadingProgress />
        <div className="container-page pt-12">
          <Link to="/" className="no-print group mb-8 inline-flex items-center gap-1.5 text-sm text-ink-400 transition hover:text-brand-600 dark:hover:text-brand-300">
            <ArrowLeft size={14} className="transition-transform group-hover:-translate-x-0.5" /> 返回文章列表
          </Link>
          {historicalPost && (
            <div className="mx-auto mb-4 flex max-w-md items-center gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
              <FileClock size={14} /> 正在查看一个历史版本；解锁后可阅读其内容。
            </div>
          )}
          <PasswordPrompt onUnlock={unlock} />
          <div className="mt-5 text-center">
            <button type="button" onClick={openHistory} className="btn-ghost h-8 text-xs"><History size={13} />历史版本</button>
          </div>
        </div>
        {historyOpen && <HistoryDialog versions={history} loading={historyLoading} error={historyError} onClose={() => setHistoryOpen(false)} onSelect={selectHistory} selecting={selectingVersion} />}
      </>
    )
  }

  const article = visiblePost!
  return (
    <>
      <ReadingProgress />
      <div className="container-page grid grid-cols-1 gap-10 pt-10 xl:grid-cols-[minmax(0,1fr)_14rem]">
        <article className="min-w-0 animate-fade-up">
          <Link to="/" className="no-print group mb-8 inline-flex items-center gap-1.5 text-sm text-ink-400 transition hover:text-brand-600 dark:hover:text-brand-300">
            <ArrowLeft size={14} className="transition-transform group-hover:-translate-x-0.5" /> 返回文章列表
          </Link>
          <header className="border-b border-ink-200/60 pb-8 dark:border-white/[0.08]">
            {historicalPost && (
              <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
                <FileClock size={14} /> 正在查看历史版本
                <button type="button" onClick={() => { setHistoricalPost(null); setUnlockedPost(null) }} className="ml-auto underline underline-offset-2">返回最新版本</button>
              </div>
            )}
            <div className="mb-4 flex flex-wrap items-center gap-2">
              {article.draft && <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2.5 py-0.5 text-xs font-medium text-amber-600 dark:text-amber-400"><FileEdit size={11} />草稿（仅你可见）</span>}
              {article.tags.map((tag) => <Link key={tag} to={`/tags/${encodeURIComponent(tag)}`} className="chip"><Hash size={11} />{tag}</Link>)}
            </div>
            <h1 className="font-serif text-3xl font-bold leading-tight tracking-tight text-ink-900 sm:text-[2.6rem] dark:text-white">{article.title}</h1>
            {article.summary && <p className="mt-4 text-[15.5px] leading-relaxed text-ink-500 dark:text-ink-400">{article.summary}</p>}
            <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-ink-400">
              <span className="flex items-center gap-1.5"><Calendar size={13} /><time dateTime={article.date}>{formatDate(article.date)}</time></span>
              {article.updated && article.updated !== article.date && <span className="flex items-center gap-1.5">更新于 {formatDate(article.updated)}</span>}
              <span className="flex items-center gap-1.5"><Type size={13} />{article.wordCount} 字</span>
              <span className="flex items-center gap-1.5"><Clock size={13} />约 {article.readingTime} 分钟</span>
              <span className="ml-auto flex flex-wrap items-center gap-1.5">
                <button onClick={copyLink} className="btn-ghost no-print h-7 !px-2 text-xs"><Link2 size={13} />复制链接</button>
                {repoPost && <button onClick={openHistory} className="btn-ghost no-print h-7 !px-2 text-xs"><History size={13} />历史</button>}
                {isAuthed && <button type="button" onClick={editCurrentVersion} className="btn-ghost no-print h-7 !px-2 text-xs"><PenLine size={13} />编辑</button>}
              </span>
            </div>
          </header>
          {article.cover && <img src={article.cover} alt="" className="mt-8 w-full rounded-2xl object-cover shadow-xl" />}
          <div className="mt-8"><Markdown content={article.content} /></div>
          <div className="no-print mt-16 border-t border-ink-200/60 pt-8 dark:border-white/[0.08]">
            <div className="grid gap-3 sm:grid-cols-2">
              {previous ? <Link to={`/posts/${previous.slug}`} className="card group flex flex-col p-4 transition hover:border-brand-300 dark:hover:border-brand-400/30"><span className="text-xs text-ink-400">← 上一篇</span><span className="mt-1 line-clamp-2 text-sm font-medium text-ink-800 group-hover:text-brand-600 dark:text-ink-100 dark:group-hover:text-brand-300">{previous.title}</span></Link> : <span />}
              {next && <Link to={`/posts/${next.slug}`} className="card group flex flex-col p-4 text-right transition hover:border-brand-300 dark:hover:border-brand-400/30"><span className="text-xs text-ink-400">下一篇 →</span><span className="mt-1 line-clamp-2 text-sm font-medium text-ink-800 group-hover:text-brand-600 dark:text-ink-100 dark:group-hover:text-brand-300">{next.title}</span></Link>}
            </div>
          </div>
          <Comments postSlug={article.slug} postTitle={article.title} />
        </article>
        <Toc items={toc} />
      </div>
      {historyOpen && <HistoryDialog versions={history} loading={historyLoading} error={historyError} onClose={() => setHistoryOpen(false)} onSelect={selectHistory} selecting={selectingVersion} />}
      {showTop && <button onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })} className="no-print card fixed bottom-6 left-6 z-40 flex h-10 w-10 animate-scale-in items-center justify-center !rounded-full text-ink-500 transition hover:text-brand-600 dark:hover:text-brand-300" aria-label="回到顶部"><ArrowUp size={17} /></button>}
    </>
  )
}
