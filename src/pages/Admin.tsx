import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  CloudUpload,
  Eye,
  FileText,
  GitMerge,
  GitPullRequest,
  Github,
  HardDrive,
  History,
  Hourglass,
  Loader2,
  PenLine,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Trash2,
  XCircle,
} from 'lucide-react'
import { useAuth } from '../lib/auth'
import { useAdminPosts } from '../lib/usePosts'
import { useToast } from '../components/Toast'
import { deleteLocalPost, formatDate, relativeTime, searchPosts, serializePost } from '../lib/posts'
import {
  closePull,
  commitPost,
  deleteRemotePost,
  fetchCommitTimes,
  getRepoAccess,
  getRepoTarget,
  listOpenPulls,
  mergePull,
  readCommitTimeCache,
} from '../lib/github'
import type { PullInfo, RepoAccess } from '../lib/github'
import { fetchSubmissionStates, getSubmissions, submitPostAsPR } from '../lib/submissions'
import type { Submission, SubmissionState } from '../lib/submissions'
import type { Post } from '../lib/types'

type Filter = 'all' | 'published' | 'draft' | 'local' | 'repo'

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: '全部' },
  { id: 'published', label: '已发布' },
  { id: 'draft', label: '草稿' },
  { id: 'local', label: '本地' },
  { id: 'repo', label: '仓库' },
]

/** 行状态：已发布（仓库·公开）/ 仓库草稿 / 本地草稿 */
function statusOf(post: Post) {
  if (post.source === 'local')
    return { label: post.draft ? '本地草稿' : '本地（待发布）', className: 'bg-amber-500/10 text-amber-600 dark:text-amber-400' }
  if (post.draft)
    return { label: '仓库草稿', className: 'bg-orange-500/10 text-orange-600 dark:text-orange-400' }
  return { label: '已发布', className: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' }
}

export default function Admin() {
  const [posts, refresh] = useAdminPosts()
  const { canPublish, ghUser } = useAuth()
  const toast = useToast()
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [busy, setBusy] = useState<string | null>(null)
  const [commitTimes, setCommitTimes] = useState<Record<string, number>>(() => readCommitTimeCache())

  // issue #15：仓库权限、我的投稿、待审核 PR（管理者）
  const [access, setAccess] = useState<RepoAccess | null>(null)
  const [submissions, setSubmissions] = useState<Submission[]>(() => getSubmissions())
  const [subStates, setSubStates] = useState<Map<number, SubmissionState>>(new Map())
  const [subRefreshing, setSubRefreshing] = useState(false)
  const [subBusy, setSubBusy] = useState<string | null>(null)
  const [pulls, setPulls] = useState<PullInfo[] | null>(null)
  const [prBusy, setPrBusy] = useState<number | null>(null)

  const target = getRepoTarget()

  // 查询当前账号对目标仓库的权限
  useEffect(() => {
    if (!canPublish) {
      setAccess(null)
      return
    }
    let alive = true
    getRepoAccess()
      .then((a) => alive && setAccess(a))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [canPublish])

  // 拉取我的投稿的最新处理状态
  const refreshSubStates = async () => {
    const list = getSubmissions()
    setSubmissions(list)
    if (list.length === 0 || !canPublish) return
    setSubRefreshing(true)
    try {
      const states = await fetchSubmissionStates(list)
      setSubStates(states)
    } finally {
      setSubRefreshing(false)
    }
  }
  useEffect(() => {
    void refreshSubStates()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canPublish])

  // 管理者视角：目标仓库的待审核 PR
  const refreshPulls = async () => {
    try {
      setPulls(await listOpenPulls())
    } catch {
      setPulls([])
    }
  }
  useEffect(() => {
    if (access?.push) void refreshPulls()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [access?.push])

  // 同 slug 的仓库文章与本地草稿要分行显示（issue #8），先统计每个 slug 的来源
  const slugSources = useMemo(() => {
    const map = new Map<string, Set<Post['source']>>()
    for (const p of posts) {
      if (!map.has(p.slug)) map.set(p.slug, new Set())
      map.get(p.slug)!.add(p.source)
    }
    return map
  }, [posts])

  const repoPaths = useMemo(
    () => [...new Set(posts.filter((p) => p.source === 'repo' && p.path).map((p) => p.path!))].sort(),
    [posts],
  )

  // 连接 GitHub 后，补全「上次发布到 GitHub 的时间」（有缓存先用缓存）
  useEffect(() => {
    if (!canPublish || repoPaths.length === 0) return
    let alive = true
    fetchCommitTimes(repoPaths)
      .then((map) => {
        if (alive) setCommitTimes(map)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [canPublish, repoPaths])

  const filtered = useMemo(() => {
    let list = searchPosts(posts, query)
    if (filter === 'published') list = list.filter((p) => p.source === 'repo' && !p.draft)
    if (filter === 'draft') list = list.filter((p) => p.draft || p.source === 'local')
    if (filter === 'local') list = list.filter((p) => p.source === 'local')
    if (filter === 'repo') list = list.filter((p) => p.source === 'repo')
    return list
  }, [posts, query, filter])

  const counts = useMemo(
    () => ({
      all: posts.length,
      published: posts.filter((p) => p.source === 'repo' && !p.draft).length,
      draft: posts.filter((p) => p.draft || p.source === 'local').length,
      local: posts.filter((p) => p.source === 'local').length,
      repo: posts.filter((p) => p.source === 'repo').length,
    }),
    [posts],
  )

  /** 该行唯一的操作标识：同 slug 会有仓库/本地两行 */
  const rowId = (p: Post) => `${p.source}:${p.slug}`

  const publishOne = async (post: Post) => {
    if (!canPublish || !ghUser) {
      toast('请先在「设置」中连接 GitHub', 'warning')
      return
    }
    setBusy(rowId(post))
    try {
      const repoAccess = access ?? (await getRepoAccess())
      if (!repoAccess.exists) {
        throw new Error(`找不到仓库 ${target.owner}/${target.repo}，请到「设置 → 目标仓库」检查配置`)
      }
      if (repoAccess.push) {
        const res = await commitPost(post.slug, serializePost(post), `post(blog): ${post.title}`)
        toast(`已提交 ${res.path}，Actions 部署中…`, 'success', { label: '查看提交', href: res.commitUrl })
      } else {
        // 无写权限：以 PR 申请发表（issue #15）
        const sub = await submitPostAsPR(post, ghUser)
        setSubmissions(getSubmissions())
        void refreshSubStates()
        toast(`已提交投稿 PR #${sub.prNumber}，等待仓库管理者审核`, 'success', { label: '查看 PR', href: sub.prUrl })
      }
    } catch (err) {
      toast(err instanceof Error ? err.message : '提交失败', 'error')
    } finally {
      setBusy(null)
    }
  }

  /** 投稿被关闭后重新提交同一篇文章 */
  const resubmit = async (sub: Submission) => {
    if (!ghUser) return
    const post = posts.find((p) => p.slug === sub.slug && p.source === 'local')
    if (!post) {
      toast('找不到这篇文章的本地草稿，无法重新提交', 'error')
      return
    }
    setSubBusy(sub.prUrl)
    try {
      await submitPostAsPR(post, ghUser)
      setSubmissions(getSubmissions())
      await refreshSubStates()
      toast('已重新提交投稿，等待审核', 'success')
    } catch (err) {
      toast(err instanceof Error ? err.message : '重新提交失败', 'error')
    } finally {
      setSubBusy(null)
    }
  }

  const reviewPull = async (pr: PullInfo, action: 'merge' | 'close') => {
    if (action === 'merge' && !confirm(`合并 PR #${pr.number}「${pr.title}」？文章将立即提交进仓库并触发部署。`)) return
    if (action === 'close' && !confirm(`关闭（拒绝）PR #${pr.number}「${pr.title}」？`)) return
    setPrBusy(pr.number)
    try {
      if (action === 'merge') {
        await mergePull(pr.number)
        toast(`已合并 PR #${pr.number}，Actions 部署中…`, 'success')
      } else {
        await closePull(pr.number)
        toast(`已关闭 PR #${pr.number}`, 'info')
      }
      await refreshPulls()
    } catch (err) {
      toast(err instanceof Error ? err.message : '操作失败', 'error')
    } finally {
      setPrBusy(null)
    }
  }

  const removePost = async (post: Post) => {
    if (post.source === 'local') {
      if (!confirm(`删除本地草稿「${post.title}」？`)) return
      deleteLocalPost(post.slug)
      refresh()
      toast('本地草稿已删除', 'info')
      return
    }
    if (!canPublish) {
      toast('删除仓库文章需要先连接 GitHub', 'warning')
      return
    }
    if (!confirm(`将从 GitHub 仓库中删除「${post.title}」，确定吗？`)) return
    setBusy(rowId(post))
    try {
      await deleteRemotePost(post.slug)
      toast('已从仓库删除，重新部署后生效', 'success')
    } catch (err) {
      toast(err instanceof Error ? err.message : '删除失败', 'error')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="container-page max-w-5xl pt-12">
      {/* 头部 */}
      <header className="flex animate-fade-up flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-serif text-3xl font-bold tracking-tight text-ink-900 dark:text-white">内容管理</h1>
          <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-500">
            <span>共 {posts.length} 条（仓库 {counts.repo} · 本地 {counts.local}）</span>
            <span className="text-ink-300 dark:text-ink-700">|</span>
            {canPublish ? (
              <span className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
                <Github size={14} />
                已连接 @{ghUser?.login} → {target.owner}/{target.repo}
              </span>
            ) : (
              <Link to="/admin/settings" className="flex items-center gap-1.5 text-brand-600 hover:underline dark:text-brand-300">
                <Github size={14} />
                未连接 GitHub，点此设置
              </Link>
            )}
          </p>
        </div>
        <div className="flex gap-2">
          <Link to="/admin/settings" className="btn-outline h-9">
            <Settings size={15} />
            设置
          </Link>
          <Link to="/admin/new" className="btn-primary h-9">
            <Plus size={15} />
            写新文章
          </Link>
        </div>
      </header>

      {/* --------------------- 投稿审核（仓库管理者视角，issue #15） --------------------- */}
      {access?.push && pulls && pulls.length > 0 && (
        <section className="card mt-8 animate-fade-up overflow-hidden" style={{ animationDelay: '40ms' }}>
          <div className="flex items-center gap-2 border-b border-ink-200/60 px-4 py-3 dark:border-white/[0.07]">
            <GitPullRequest size={16} className="text-brand-500" />
            <h2 className="text-sm font-medium text-ink-900 dark:text-white">
              投稿审核
              <span className="ml-2 rounded-full bg-brand-500/10 px-2 py-0.5 font-mono text-[11px] text-brand-600 dark:text-brand-300">
                {pulls.length} 个待处理 PR
              </span>
            </h2>
            <button onClick={() => void refreshPulls()} className="btn-ghost ml-auto h-7 w-7 !px-0" title="刷新 PR 列表" aria-label="刷新 PR 列表">
              <RefreshCw size={13} />
            </button>
          </div>
          <ul className="divide-y divide-ink-200/60 dark:divide-white/[0.07]">
            {pulls.map((pr) => (
              <li key={pr.number} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                  <GitPullRequest size={15} />
                </span>
                <div className="min-w-0 flex-1">
                  <a href={pr.url} target="_blank" rel="noreferrer" className="truncate text-sm font-medium text-ink-900 hover:text-brand-600 dark:text-white dark:hover:text-brand-300">
                    #{pr.number} {pr.title}
                  </a>
                  <p className="mt-0.5 truncate font-mono text-xs text-ink-400">
                    @{pr.author} → {pr.headLabel} · {relativeTime(pr.createdAt)}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <button
                    onClick={() => reviewPull(pr, 'merge')}
                    disabled={prBusy === pr.number}
                    className="btn-primary h-8 !px-3 text-xs"
                    title="合并此 PR（文章随即进入仓库并触发部署）"
                  >
                    {prBusy === pr.number ? <Loader2 size={13} className="animate-spin" /> : <GitMerge size={13} />}
                    合并
                  </button>
                  <button
                    onClick={() => reviewPull(pr, 'close')}
                    disabled={prBusy === pr.number}
                    className="btn-danger h-8 !px-3 text-xs"
                    title="关闭（拒绝）此 PR"
                  >
                    {prBusy === pr.number ? <Loader2 size={13} className="animate-spin" /> : <XCircle size={13} />}
                    关闭
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* --------------------- 我的投稿（投稿人视角，issue #15） --------------------- */}
      {submissions.length > 0 && (
        <section className="card mt-8 animate-fade-up overflow-hidden" style={{ animationDelay: '40ms' }}>
          <div className="flex items-center gap-2 border-b border-ink-200/60 px-4 py-3 dark:border-white/[0.07]">
            <Hourglass size={15} className="text-brand-500" />
            <h2 className="text-sm font-medium text-ink-900 dark:text-white">
              我的投稿
              <span className="ml-2 rounded-full bg-ink-900/[.06] px-2 py-0.5 font-mono text-[11px] text-ink-500 dark:bg-white/10 dark:text-ink-400">
                {submissions.length}
              </span>
            </h2>
            <button
              onClick={() => void refreshSubStates()}
              disabled={subRefreshing}
              className="btn-ghost ml-auto h-7 w-7 !px-0"
              title="刷新处理状态"
              aria-label="刷新处理状态"
            >
              <RefreshCw size={13} className={subRefreshing ? 'animate-spin' : ''} />
            </button>
          </div>
          <ul className="divide-y divide-ink-200/60 dark:divide-white/[0.07]">
            {submissions.map((sub) => {
              const state = subStates.get(sub.prNumber)
              const localPost = posts.find((p) => p.slug === sub.slug && p.source === 'local')
              return (
                <li key={`${sub.prNumber}`} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <a href={sub.prUrl} target="_blank" rel="noreferrer" className="truncate text-sm font-medium text-ink-900 hover:text-brand-600 dark:text-white dark:hover:text-brand-300">
                      {sub.title}
                      <span className="ml-1.5 font-mono text-xs text-ink-400">PR #{sub.prNumber}</span>
                    </a>
                    <p className="mt-0.5 truncate font-mono text-xs text-ink-400">
                      /{sub.slug} · 提交于 {relativeTime(sub.submittedAt)}
                    </p>
                  </div>
                  {state === 'open' || state === undefined ? (
                    <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-brand-500/10 px-2.5 py-1 text-[11px] font-medium text-brand-600 dark:text-brand-300">
                      {state === undefined ? <Loader2 size={11} className="animate-spin" /> : <Hourglass size={11} />}
                      {state === undefined ? '查询中…' : '等待审核'}
                    </span>
                  ) : state === 'merged' ? (
                    <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-1 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                      <GitMerge size={11} />
                      已合并发表
                    </span>
                  ) : (
                    <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-rose-500/10 px-2.5 py-1 text-[11px] font-medium text-rose-600 dark:text-rose-400">
                      <XCircle size={11} />
                      已被关闭
                    </span>
                  )}
                  {state === 'merged' && localPost && (
                    <button
                      onClick={() => {
                        if (confirm(`投稿已合并，删除本地草稿「${localPost.title}」？`)) {
                          deleteLocalPost(localPost.slug)
                          refresh()
                          toast('本地草稿已删除', 'info')
                        }
                      }}
                      className="btn-ghost h-8 shrink-0 !px-2.5 text-xs"
                      title="投稿已发表，清理本地草稿"
                    >
                      <Trash2 size={13} />
                      删除本地草稿
                    </button>
                  )}
                  {state === 'closed' && localPost && (
                    <button
                      onClick={() => resubmit(sub)}
                      disabled={subBusy === sub.prUrl}
                      className="btn-outline h-8 shrink-0 !px-2.5 text-xs"
                    >
                      {subBusy === sub.prUrl ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
                      重新提交
                    </button>
                  )}
                </li>
              )
            })}
          </ul>
        </section>
      )}

      {/* 筛选 */}
      <div className="mt-8 flex animate-fade-up flex-wrap items-center gap-3" style={{ animationDelay: '60ms' }}>
        <div className="relative min-w-[12rem] flex-1">
          <Search size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索文章…"
            className="input !py-2 !pl-10"
          />
        </div>
        <div className="flex gap-0.5 rounded-xl bg-ink-100/80 p-1 dark:bg-white/5">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                filter === f.id
                  ? 'bg-white text-ink-900 shadow-sm dark:bg-white/10 dark:text-white'
                  : 'text-ink-500 hover:text-ink-800 dark:hover:text-ink-200'
              }`}
            >
              {f.label}
              <span className="ml-1.5 text-ink-400">{counts[f.id]}</span>
            </button>
          ))}
        </div>
      </div>

      {/* 列表 */}
      <div className="card mt-5 animate-fade-up divide-y divide-ink-200/60 overflow-hidden dark:divide-white/[0.07]" style={{ animationDelay: '120ms' }}>
        {filtered.length === 0 && (
          <div className="flex flex-col items-center gap-3 px-6 py-20 text-center">
            <FileText size={26} className="text-ink-300" />
            <p className="text-sm text-ink-500">没有符合条件的文章</p>
            <Link to="/admin/new" className="btn-primary mt-1">
              <Plus size={15} />
              写一篇
            </Link>
          </div>
        )}

        {filtered.map((post) => {
          const status = statusOf(post)
          const sources = slugSources.get(post.slug)
          const hasTwin = sources && sources.size > 1
          const publishedAt = post.path ? commitTimes[post.path] : undefined
          return (
            <div
              key={rowId(post)}
              className="group flex flex-wrap items-center gap-3 px-4 py-3.5 transition hover:bg-ink-50/70 dark:hover:bg-white/[.03]"
            >
              <span
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                  post.source === 'local'
                    ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                    : 'bg-brand-500/10 text-brand-600 dark:text-brand-300'
                }`}
                title={post.source === 'local' ? '浏览器本地草稿' : '仓库文件'}
              >
                {post.source === 'local' ? <HardDrive size={16} /> : <Github size={16} />}
              </span>

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    to={`/admin/edit/${post.slug}`}
                    className="truncate text-sm font-medium text-ink-900 hover:text-brand-600 dark:text-white dark:hover:text-brand-300"
                  >
                    {post.title}
                  </Link>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${status.className}`}>
                    {status.label}
                  </span>
                  {post.pinned && (
                    <span className="shrink-0 rounded-full bg-brand-500/10 px-2 py-0.5 text-[11px] text-brand-600 dark:text-brand-300">
                      置顶
                    </span>
                  )}
                  {hasTwin && (
                    <span
                      className="shrink-0 rounded-full bg-ink-900/[.06] px-2 py-0.5 text-[11px] text-ink-500 dark:bg-white/10 dark:text-ink-400"
                      title={
                        post.source === 'local'
                          ? '仓库里已有一篇同名文章，发布后会覆盖它'
                          : '本浏览器里有一份同名草稿'
                      }
                    >
                      {post.source === 'local' ? '与仓库同名' : '本地有同名草稿'}
                    </span>
                  )}
                </div>
                <p className="mt-0.5 truncate font-mono text-xs text-ink-400">
                  {formatDate(post.date, 'short')} · /{post.slug} · {post.wordCount} 字
                  {post.updated && ` · 更新于 ${formatDate(post.updated, 'short')}`}
                  {post.savedAt ? ` · 本地保存于 ${relativeTime(post.savedAt)}` : ''}
                </p>
                {/* 上次发布到 GitHub 的时间（issue #8） */}
                {post.source === 'repo' && (
                  <p className="mt-0.5 flex items-center gap-1 font-mono text-xs text-ink-400" title="上次发布（提交）到 GitHub 的时间">
                    <History size={11} className="shrink-0" />
                    {!canPublish ? (
                      <span>连接 GitHub 后显示上次发布时间</span>
                    ) : publishedAt === undefined ? (
                      <span className="flex items-center gap-1">
                        <Loader2 size={11} className="animate-spin" />
                        正在获取发布时间…
                      </span>
                    ) : publishedAt > 0 ? (
                      <span>
                        上次发布于 {relativeTime(publishedAt)}（{formatDate(new Date(publishedAt).toISOString())}）
                      </span>
                    ) : (
                      <span>发布时间未知</span>
                    )}
                  </p>
                )}
              </div>

              <div className="flex shrink-0 items-center gap-1">
                <Link to={`/posts/${post.slug}`} className="btn-ghost h-8 w-8 !px-0" title="查看">
                  <Eye size={15} />
                </Link>
                <Link to={`/admin/edit/${post.slug}`} className="btn-ghost h-8 w-8 !px-0" title="编辑">
                  <PenLine size={15} />
                </Link>
                {post.source === 'local' && (
                  <button
                    onClick={() => publishOne(post)}
                    disabled={busy === rowId(post)}
                    className="btn-ghost h-8 w-8 !px-0 text-brand-600 dark:text-brand-300"
                    title="发布到 GitHub"
                  >
                    {busy === rowId(post) ? <Loader2 size={15} className="animate-spin" /> : <CloudUpload size={15} />}
                  </button>
                )}
                <button
                  onClick={() => removePost(post)}
                  disabled={busy === rowId(post)}
                  className="btn-ghost h-8 w-8 !px-0 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-500/10"
                  title={post.source === 'local' ? '删除本地草稿' : '从仓库删除'}
                >
                  {busy === rowId(post) ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
                </button>
              </div>
            </div>
          )
        })}
      </div>

      <p className="mb-16 mt-4 text-xs leading-relaxed text-ink-400">
        「仓库」文章来自 <code className="rounded bg-ink-100 px-1 dark:bg-white/10">{target.postsDir}/</code>{' '}
        目录，会在构建时打包进站点；「本地」文章只存在于当前浏览器，点击{' '}
        <CloudUpload size={12} className="inline" /> 即可提交到 GitHub 并触发自动部署。
        同一名称的仓库文章与本地草稿会分两条显示，互不干扰。
      </p>
    </div>
  )
}
