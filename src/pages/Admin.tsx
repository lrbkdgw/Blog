import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Clock,
  CloudUpload,
  Eye,
  FileText,
  GitMerge,
  GitPullRequest,
  Github,
  HardDrive,
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
import { useToast } from '../components/Toast'
import {
  deleteLocalPost,
  formatDate,
  getAllAdminPosts,
  getPublishTime,
  recordPublishTime,
  relativeTime,
  searchPosts,
  serializePost,
} from '../lib/posts'
import {
  checkUserRepoPermissions,
  closePublicationPR,
  commitPost,
  deleteRemotePost,
  getRepoTarget,
  listPublicationPRs,
  mergePublicationPR,
} from '../lib/github'
import type { PublicationPR } from '../lib/github'
import type { Post } from '../lib/types'

type MainTab = 'posts' | 'prs'
type Filter = 'all' | 'repo' | 'local' | 'draft'

export default function Admin() {
  const { canPublish, ghUser } = useAuth()
  const toast = useToast()

  const [posts, setPosts] = useState<Post[]>(getAllAdminPosts)
  const [prs, setPrs] = useState<PublicationPR[]>([])
  const [loadingPrs, setLoadingPrs] = useState(false)
  const [isRepoAdmin, setIsRepoAdmin] = useState(false)

  const [mainTab, setMainTab] = useState<MainTab>('posts')
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [busy, setBusy] = useState<string | null>(null)

  const target = getRepoTarget()

  const reloadPosts = () => {
    setPosts(getAllAdminPosts())
  }

  useEffect(() => {
    reloadPosts()
    const handler = () => reloadPosts()
    window.addEventListener('starlog:posts-changed', handler)
    window.addEventListener('storage', handler)
    return () => {
      window.removeEventListener('starlog:posts-changed', handler)
      window.removeEventListener('storage', handler)
    }
  }, [])

  // 检查当前用户是否有目标仓库的管理权限
  useEffect(() => {
    if (!ghUser) {
      setIsRepoAdmin(false)
      return
    }
    checkUserRepoPermissions(ghUser.login, target).then((res) => {
      setIsRepoAdmin(res.canPush || res.canAdmin)
    })
  }, [ghUser, target])

  // 加载 PR 列表
  const fetchPRs = async () => {
    setLoadingPrs(true)
    try {
      const list = await listPublicationPRs(target)
      setPrs(list)
    } finally {
      setLoadingPrs(false)
    }
  }

  useEffect(() => {
    fetchPRs()
    const handler = () => fetchPRs()
    window.addEventListener('starlog:prs-changed', handler)
    return () => window.removeEventListener('starlog:prs-changed', handler)
  }, [])

  const filtered = useMemo(() => {
    let list = searchPosts(posts, query)
    if (filter === 'local') list = list.filter((p) => p.source === 'local')
    if (filter === 'repo') list = list.filter((p) => p.source === 'repo')
    if (filter === 'draft') list = list.filter((p) => p.draft)
    return list
  }, [posts, query, filter])

  const counts = useMemo(
    () => ({
      all: posts.length,
      repo: posts.filter((p) => p.source === 'repo').length,
      local: posts.filter((p) => p.source === 'local').length,
      draft: posts.filter((p) => p.draft).length,
    }),
    [posts],
  )

  const publishOne = async (post: Post) => {
    if (!canPublish) {
      toast('请先在「设置」中连接 GitHub', 'warning')
      return
    }
    const busyKey = `${post.source}-${post.slug}`
    setBusy(busyKey)
    try {
      const res = await commitPost(post.slug, serializePost(post), `post(blog): ${post.title}`)
      recordPublishTime(post.slug, Date.now())
      reloadPosts()
      toast(`已提交 ${res.path}，GitHub Actions 部署中…`, 'success', {
        label: '查看提交',
        href: res.commitUrl,
      })
    } catch (err) {
      toast(err instanceof Error ? err.message : '提交失败', 'error')
    } finally {
      setBusy(null)
    }
  }

  const removePost = async (post: Post) => {
    if (post.source === 'local') {
      if (!confirm(`删除本地草稿「${post.title}」？`)) return
      deleteLocalPost(post.slug)
      reloadPosts()
      toast('本地草稿已删除', 'info')
      return
    }
    if (!canPublish) {
      toast('删除仓库文章需要先连接 GitHub', 'warning')
      return
    }
    if (!confirm(`将从 GitHub 仓库中删除「${post.title}」，确定吗？`)) return
    const busyKey = `${post.source}-${post.slug}`
    setBusy(busyKey)
    try {
      await deleteRemotePost(post.slug)
      reloadPosts()
      toast('已从仓库删除，重新部署后生效', 'success')
    } catch (err) {
      toast(err instanceof Error ? err.message : '删除失败', 'error')
    } finally {
      setBusy(null)
    }
  }

  const handleMergePR = async (prNumber: number) => {
    if (!confirm(`确定要通过并合并 PR #${prNumber} 吗？`)) return
    setBusy(`pr-${prNumber}`)
    try {
      await mergePublicationPR(prNumber, target)
      toast(`PR #${prNumber} 已合并，文章将自动触发部署！`, 'success')
      await fetchPRs()
    } catch (err) {
      toast(err instanceof Error ? err.message : '合并 PR 失败', 'error')
    } finally {
      setBusy(null)
    }
  }

  const handleClosePR = async (prNumber: number) => {
    if (!confirm(`确定要关闭 PR #${prNumber} 吗？`)) return
    setBusy(`pr-${prNumber}`)
    try {
      await closePublicationPR(prNumber, target)
      toast(`已关闭 PR #${prNumber}`, 'info')
      await fetchPRs()
    } catch (err) {
      toast(err instanceof Error ? err.message : '关闭 PR 失败', 'error')
    } finally {
      setBusy(null)
    }
  }

  const openPRsCount = prs.filter((p) => p.state === 'open').length

  return (
    <div className="container-page max-w-5xl pt-12">
      {/* 头部 */}
      <header className="flex animate-fade-up flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-serif text-3xl font-bold tracking-tight text-ink-900 dark:text-white">
            文章与内容管理
          </h1>
          <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-500">
            <span>共 {posts.length} 篇管理条目</span>
            <span className="text-ink-300 dark:text-ink-700">|</span>
            {canPublish ? (
              <span className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
                <Github size={14} />
                已连接 @{ghUser?.login} → {target.owner}/{target.repo}
                {isRepoAdmin && (
                  <span className="rounded-full bg-emerald-500/10 px-2 py-0.2 text-[10px] font-bold">
                    仓库管理者
                  </span>
                )}
              </span>
            ) : (
              <Link
                to="/settings"
                className="flex items-center gap-1.5 text-brand-600 hover:underline dark:text-brand-300"
              >
                <Github size={14} />
                未连接 GitHub，点此连接
              </Link>
            )}
          </p>
        </div>
        <div className="flex gap-2">
          <Link to="/settings" className="btn-outline h-9">
            <Settings size={15} />
            设置
          </Link>
          <Link to="/admin/new" className="btn-primary h-9">
            <Plus size={15} />
            写新文章
          </Link>
        </div>
      </header>

      {/* 大标签切换：文章列表 vs 发表申请 (PR 审批) */}
      <div className="mt-8 flex gap-2 border-b border-ink-200/70 pb-px dark:border-white/10">
        <button
          type="button"
          onClick={() => setMainTab('posts')}
          className={`flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-semibold transition ${
            mainTab === 'posts'
              ? 'border-brand-500 text-brand-600 dark:text-brand-300'
              : 'border-transparent text-ink-500 hover:text-ink-800 dark:hover:text-ink-200'
          }`}
        >
          <FileText size={16} />
          文章列表
          <span className="rounded-full bg-ink-100 px-2 py-0.5 text-xs text-ink-600 dark:bg-white/10 dark:text-ink-300">
            {posts.length}
          </span>
        </button>
        <button
          type="button"
          onClick={() => setMainTab('prs')}
          className={`flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-semibold transition ${
            mainTab === 'prs'
              ? 'border-brand-500 text-brand-600 dark:text-brand-300'
              : 'border-transparent text-ink-500 hover:text-ink-800 dark:hover:text-ink-200'
          }`}
        >
          <GitPullRequest size={16} />
          发表申请 (PR 审核)
          {openPRsCount > 0 && (
            <span className="rounded-full bg-brand-500 px-2 py-0.5 text-xs font-bold text-white">
              {openPRsCount} 待审核
            </span>
          )}
        </button>
      </div>

      {mainTab === 'posts' ? (
        <>
          {/* 筛选 */}
          <div
            className="mt-6 flex animate-fade-up flex-wrap items-center gap-3"
            style={{ animationDelay: '60ms' }}
          >
            <div className="relative min-w-[12rem] flex-1">
              <Search
                size={15}
                className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-400"
              />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="搜索文章标题、路径、标签…"
                className="input !py-2 !pl-10"
              />
            </div>
            <div className="flex gap-0.5 rounded-xl bg-ink-100/80 p-1 dark:bg-white/5">
              {(
                [
                  { id: 'all', label: '全部' },
                  { id: 'repo', label: '已发布到仓库' },
                  { id: 'local', label: '本地草稿' },
                  { id: 'draft', label: '草稿' },
                ] as const
              ).map((f) => (
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

          {/* 文章列表 */}
          <div
            className="card mt-5 animate-fade-up divide-y divide-ink-200/60 overflow-hidden dark:divide-white/[0.07]"
            style={{ animationDelay: '120ms' }}
          >
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
              const itemKey = `${post.source}-${post.slug}`
              const isLocalDraft = post.source === 'local'
              const publishedTime = getPublishTime(post)

              return (
                <div
                  key={itemKey}
                  className="group flex flex-wrap items-center gap-3 px-4 py-3.5 transition hover:bg-ink-50/70 dark:hover:bg-white/[.03]"
                >
                  <span
                    className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                      isLocalDraft
                        ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                        : 'bg-brand-500/10 text-brand-600 dark:text-brand-300'
                    }`}
                    title={isLocalDraft ? '浏览器本地草稿' : '已发布到 GitHub 仓库'}
                  >
                    {isLocalDraft ? <HardDrive size={16} /> : <Github size={16} />}
                  </span>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        to={`/admin/edit/${post.slug}?source=${post.source}`}
                        className="truncate text-sm font-semibold text-ink-900 hover:text-brand-600 dark:text-white dark:hover:text-brand-300"
                      >
                        {post.title}
                      </Link>
                      {isLocalDraft ? (
                        <span className="shrink-0 rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-600 dark:text-amber-400">
                          本地草稿
                        </span>
                      ) : (
                        <span className="shrink-0 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                          已发布到 GitHub
                        </span>
                      )}
                      {post.draft && (
                        <span className="shrink-0 rounded-full bg-rose-500/10 px-2 py-0.5 text-[11px] font-medium text-rose-600 dark:text-rose-400">
                          隐藏草稿
                        </span>
                      )}
                      {post.pinned && (
                        <span className="shrink-0 rounded-full bg-brand-500/10 px-2 py-0.5 text-[11px] text-brand-600 dark:text-brand-300">
                          置顶
                        </span>
                      )}
                    </div>

                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-xs text-ink-400">
                      <span>/{post.slug}</span>
                      <span>·</span>
                      <span>{post.wordCount} 字</span>
                      <span>·</span>
                      {/* 上次发布到 Github 的时间 */}
                      {publishedTime ? (
                        <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                          <CloudUpload size={12} />
                          上次发布到 GitHub：{formatDate(new Date(publishedTime).toISOString().slice(0, 10))}（
                          {relativeTime(publishedTime)}）
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400">
                          <Clock size={12} />
                          未发布到 GitHub（仅本地草稿）
                          {post.savedAt && ` · 本地修改于 ${relativeTime(post.savedAt)}`}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-1">
                    <Link
                      to={`/posts/${post.slug}`}
                      className="btn-ghost h-8 w-8 !px-0"
                      title="在站内查看"
                    >
                      <Eye size={15} />
                    </Link>
                    <Link
                      to={`/admin/edit/${post.slug}?source=${post.source}`}
                      className="btn-ghost h-8 w-8 !px-0"
                      title="编辑文章"
                    >
                      <PenLine size={15} />
                    </Link>
                    {isLocalDraft && (
                      <button
                        onClick={() => publishOne(post)}
                        disabled={busy === itemKey}
                        className="btn-ghost h-8 w-8 !px-0 text-brand-600 dark:text-brand-300"
                        title="发布到 GitHub"
                      >
                        {busy === itemKey ? (
                          <Loader2 size={15} className="animate-spin" />
                        ) : (
                          <CloudUpload size={15} />
                        )}
                      </button>
                    )}
                    <button
                      onClick={() => removePost(post)}
                      disabled={busy === itemKey}
                      className="btn-ghost h-8 w-8 !px-0 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-500/10"
                      title={isLocalDraft ? '删除本地草稿' : '从 GitHub 仓库删除'}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>

          <p className="mb-16 mt-4 text-xs leading-relaxed text-ink-400">
            当同一文章存在已发布的仓库版本与本地编辑的草稿时，列表中会同时显示为两条记录，方便分别查看与管理。
          </p>
        </>
      ) : (
        /* -------------------------- 发表申请 (PR 审批) -------------------------- */
        <div className="mt-6 space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-xs text-ink-500">
              已登录用户即使无仓库权限也可申请发表文章（自动创建 PR）；仓库管理者可在此一键审核合并或关闭。
            </p>
            <button
              type="button"
              onClick={fetchPRs}
              disabled={loadingPrs}
              className="btn-outline h-8 px-2.5 text-xs"
            >
              <RefreshCw size={12} className={loadingPrs ? 'animate-spin' : ''} />
              刷新申请
            </button>
          </div>

          <div className="card divide-y divide-ink-200/60 overflow-hidden dark:divide-white/[0.07]">
            {prs.length === 0 ? (
              <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
                <GitPullRequest size={28} className="text-ink-300" />
                <p className="text-sm text-ink-500">暂无文章发表申请 PR</p>
              </div>
            ) : (
              prs.map((pr) => {
                const isBusy = busy === `pr-${pr.number}`
                return (
                  <div
                    key={pr.number}
                    className="flex flex-wrap items-center justify-between gap-4 px-4 py-3.5 transition hover:bg-ink-50/70 dark:hover:bg-white/[.03]"
                  >
                    <div className="flex items-start gap-3 min-w-0 flex-1">
                      {pr.author.avatar_url ? (
                        <img
                          src={pr.author.avatar_url}
                          alt=""
                          className="mt-0.5 h-8 w-8 rounded-full object-cover"
                        />
                      ) : (
                        <div className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-full bg-brand-500/10 text-xs font-bold text-brand-600">
                          {pr.author.login[0]?.toUpperCase() || 'U'}
                        </div>
                      )}

                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold text-sm text-ink-900 dark:text-white">
                            《{pr.articleTitle}》
                          </span>
                          <span className="font-mono text-xs text-ink-400">#{pr.number}</span>
                          {pr.state === 'open' && (
                            <span className="rounded-full bg-brand-500/10 px-2 py-0.5 text-[11px] font-bold text-brand-600 dark:text-brand-300">
                              🟢 待审核
                            </span>
                          )}
                          {pr.state === 'merged' && (
                            <span className="rounded-full bg-purple-500/10 px-2 py-0.5 text-[11px] font-bold text-purple-600 dark:text-purple-300">
                              🟣 已合并发布
                            </span>
                          )}
                          {pr.state === 'closed' && (
                            <span className="rounded-full bg-rose-500/10 px-2 py-0.5 text-[11px] font-bold text-rose-600 dark:text-rose-400">
                              🔴 已关闭
                            </span>
                          )}
                        </div>

                        <p className="mt-1 text-xs text-ink-400">
                          由 <span className="font-medium text-ink-700 dark:text-ink-200">@{pr.author.login}</span>{' '}
                          申请发表 · 提交于 {formatDate(pr.created_at.slice(0, 10))}
                          {pr.merged_at ? ` · 于 ${formatDate(pr.merged_at.slice(0, 10))} 合并` : ''}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <a
                        href={pr.html_url}
                        target="_blank"
                        rel="noreferrer"
                        className="btn-outline h-8 px-2.5 text-xs"
                      >
                        <Github size={13} />
                        查看 PR
                      </a>

                      {/* 仓库管理者操作按钮 */}
                      {isRepoAdmin && pr.state === 'open' && (
                        <>
                          <button
                            type="button"
                            onClick={() => handleMergePR(pr.number)}
                            disabled={isBusy}
                            className="btn-primary h-8 px-3 text-xs"
                          >
                            {isBusy ? (
                              <Loader2 size={13} className="animate-spin" />
                            ) : (
                              <GitMerge size={13} />
                            )}
                            审批并合并
                          </button>
                          <button
                            type="button"
                            onClick={() => handleClosePR(pr.number)}
                            disabled={isBusy}
                            className="btn-danger h-8 px-2.5 text-xs"
                          >
                            <XCircle size={13} />
                            关闭
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </div>
      )}
    </div>
  )
}
