import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  CheckSquare,
  Clock,
  CloudUpload,
  Eye,
  FileText,
  GitMerge,
  GitPullRequest,
  Github,
  HardDrive,
  Image as ImageIcon,
  ListTodo,
  Loader2,
  PenLine,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Square,
  Trash2,
  UploadCloud,
  XCircle,
} from 'lucide-react'
import { useAuth } from '../lib/auth'
import { useToast } from '../components/Toast'
import {
  deleteLocalPost,
  formatDate,
  getAllAdminPosts,
  getPublishTime,
  relativeTime,
  searchPosts,
  serializePost,
} from '../lib/posts'
import {
  checkUserRepoPermissions,
  closePublicationPR,
  fetchRemoteFile,
  getRepoTarget,
  listPublicationPRs,
  mergePublicationPR,
} from '../lib/github'
import type { PublicationPR } from '../lib/github'
import { collapseContext, diffLines, diffStats } from '../lib/diff'
import type { DiffLine } from '../lib/diff'
import { Markdown } from '../components/Markdown'
import {
  clearUpdateQueue,
  enqueuePostDelete,
  enqueuePostPublish,
  flushUpdateQueue,
  getUpdateQueue,
  removeQueueItem,
} from '../lib/updateQueue'
import type { QueueItem, QueueItemKind } from '../lib/updateQueue'
import { useRepoTarget } from '../lib/useRepoTarget'
import type { Post } from '../lib/types'

type MainTab = 'posts' | 'prs' | 'queue'
type Filter = 'all' | 'repo' | 'local' | 'draft'

const QUEUE_KIND_META: Record<
  QueueItemKind,
  { label: string; icon: typeof CloudUpload; tone: string }
> = {
  'post-publish': {
    label: '更新文章',
    icon: CloudUpload,
    tone: 'bg-brand-500/10 text-brand-600 dark:text-brand-300',
  },
  'post-delete': {
    label: '删除文章',
    icon: Trash2,
    tone: 'bg-rose-500/10 text-rose-600 dark:text-rose-400',
  },
  'post-pr': {
    label: '发表申请',
    icon: GitPullRequest,
    tone: 'bg-purple-500/10 text-purple-600 dark:text-purple-300',
  },
  'image-upload': {
    label: '上传图片',
    icon: ImageIcon,
    tone: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  },
  'settings-sync': {
    label: '账号偏好',
    icon: Settings,
    tone: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  },
  'version-name': {
    label: '版本名称',
    icon: PenLine,
    tone: 'bg-sky-500/10 text-sky-600 dark:text-sky-300',
  },
}

export default function Admin() {
  const { canPublish, ghUser } = useAuth()
  const toast = useToast()
  const [searchParams] = useSearchParams()

  const [posts, setPosts] = useState<Post[]>(getAllAdminPosts)
  const [prs, setPrs] = useState<PublicationPR[]>([])
  const [loadingPrs, setLoadingPrs] = useState(false)
  const [isRepoAdmin, setIsRepoAdmin] = useState(false)

  const [queue, setQueue] = useState<QueueItem[]>(getUpdateQueue)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [flushing, setFlushing] = useState(false)
  const [flushErrors, setFlushErrors] = useState<Record<string, string>>({})
  const [queueDiffItem, setQueueDiffItem] = useState<QueueItem | null>(null)

  const [mainTab, setMainTab] = useState<MainTab>('posts')
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [busy, setBusy] = useState<string | null>(null)

  const target = useRepoTarget()

  const reloadPosts = () => {
    setPosts(getAllAdminPosts())
  }

  const reloadQueue = () => {
    setQueue(getUpdateQueue())
    setSelectedIds((prev) => {
      const alive = new Set(getUpdateQueue().map((item) => item.id))
      const next = new Set<string>()
      prev.forEach((id) => {
        if (alive.has(id)) next.add(id)
      })
      return next.size === prev.size ? prev : next
    })
  }

  // 仓库中加密文章的 slug 集合：这些文章的明文本地草稿不能从列表直推发布。
  const encryptedRepoSlugs = useMemo(
    () => new Set(posts.filter((p) => p.source === 'repo' && p.encryption).map((p) => p.slug)),
    [posts],
  )

  useEffect(() => {
    reloadPosts()
    reloadQueue()
    const handler = () => {
      reloadPosts()
      reloadQueue()
    }
    window.addEventListener('starlog:posts-changed', handler)
    window.addEventListener('starlog:queue-changed', handler)
    window.addEventListener('storage', handler)
    return () => {
      window.removeEventListener('starlog:posts-changed', handler)
      window.removeEventListener('starlog:queue-changed', handler)
      window.removeEventListener('storage', handler)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 检查当前用户是否有目标仓库的管理权限（target 引用稳定，仅在用户/仓库变化时重查）
  useEffect(() => {
    if (!ghUser) {
      setIsRepoAdmin(false)
      return
    }
    checkUserRepoPermissions(ghUser.login, target).then((res) => {
      setIsRepoAdmin(res.canPush || res.canAdmin)
    })
  }, [ghUser, target])

  // 支持 /admin?tab=queue 等入口直达指定标签页
  useEffect(() => {
    const tab = searchParams.get('tab')
    if (tab === 'posts' || tab === 'prs' || tab === 'queue') setMainTab(tab)
  }, [searchParams])

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  const pendingSlugs = useMemo(
    () =>
      new Set(
        queue
          .filter(
            (item) =>
              item.kind === 'post-publish' ||
              item.kind === 'post-pr' ||
              item.kind === 'post-delete' ||
              item.kind === 'version-name',
          )
          .map((item) => item.target),
      ),
    [queue],
  )

  /* --------------------------- 待更新队列操作 --------------------------- */

  const toggleSelected = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleSelectAll = () => {
    setSelectedIds((prev) =>
      prev.size === queue.length && queue.length > 0
        ? new Set()
        : new Set(queue.map((item) => item.id)),
    )
  }

  const runFlush = async (items: QueueItem[]) => {
    if (items.length === 0) {
      toast('请先选择要更新的更改', 'info')
      return
    }
    if (!canPublish) {
      toast('更新仓库需要先连接 GitHub 账号', 'warning')
      return
    }
    setFlushing(true)
    setFlushErrors({})
    try {
      const result = await flushUpdateQueue(items)
      reloadQueue()
      if (result.failed.length === 0) {
        const action = result.commitUrl
          ? { label: '查看提交', href: result.commitUrl }
          : result.prUrls[0]
            ? { label: '查看 PR', href: result.prUrls[0] }
            : undefined
        const detail = result.commitUrl
          ? '，GitHub Actions 部署中'
          : result.prUrls.length > 0
            ? '，发表申请已提交'
            : ''
        toast(`已更新 ${result.succeeded.length} 项更改${detail}`, 'success', action)
      } else {
        const errs: Record<string, string> = {}
        for (const failure of result.failed) errs[failure.item.id] = failure.message
        setFlushErrors(errs)
        toast(
          `更新完成：成功 ${result.succeeded.length} 项，失败 ${result.failed.length} 项（${result.failed[0].message}）`,
          result.succeeded.length > 0 ? 'warning' : 'error',
        )
      }
    } catch (err) {
      toast(err instanceof Error ? err.message : '更新失败', 'error')
    } finally {
      setFlushing(false)
    }
  }

  /* ------------------------------ 文章操作 ------------------------------ */

  const queueOne = (post: Post) => {
    if (!canPublish) {
      toast('请先在「设置」中连接 GitHub', 'warning')
      return
    }
    // 加密文章的明文草稿不能从这里直推：那会用明文覆盖仓库中的加密版本。
    // 需要进入编辑器勾选加密并输入密码后发布。
    if (encryptedRepoSlugs.has(post.slug)) {
      toast('这篇文章在仓库中是加密文章，请在编辑器中以加密方式重新发布', 'warning')
      return
    }
    try {
      enqueuePostPublish(post, serializePost(post))
      reloadQueue()
      toast('已加入待更新队列，统一更新后才会提交到 GitHub', 'success', {
        label: '查看队列',
        href: '/admin?tab=queue',
      })
    } catch (err) {
      toast(err instanceof Error ? err.message : '加入队列失败', 'error')
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
    if (!confirm(`将「${post.title}」加入待更新队列，统一更新后从 GitHub 仓库中删除。确定吗？`)) return
    try {
      enqueuePostDelete(post.slug, post.title)
      reloadQueue()
      toast('删除操作已加入待更新队列，统一更新后生效', 'success', {
        label: '查看队列',
        href: '/admin?tab=queue',
      })
    } catch (err) {
      toast(err instanceof Error ? err.message : '加入队列失败', 'error')
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
  const allSelected = queue.length > 0 && selectedIds.size === queue.length

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

      {/* 访客提示 */}
      {!canPublish && (
        <div className="card mt-6 flex flex-wrap items-center justify-between gap-3 border-brand-200/60 bg-brand-50/50 p-4 text-sm dark:border-brand-500/20 dark:bg-brand-500/10">
          <div className="flex items-center gap-2.5 text-brand-900 dark:text-brand-200">
            <HardDrive size={18} className="shrink-0 text-brand-500" />
            <span>您当前处于<strong>未登录访客模式</strong>，可以创作并管理保存在本机的本地草稿。登录 GitHub 账号后可发布到远程仓库或提交审核申请。</span>
          </div>
          <Link to="/login" className="btn-primary h-8 !px-3 text-xs">
            登录 GitHub
          </Link>
        </div>
      )}

      {/* 大标签切换：文章列表 vs 发表申请 (PR 审批) vs 待更新队列 */}
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
        <button
          type="button"
          onClick={() => setMainTab('queue')}
          className={`flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-semibold transition ${
            mainTab === 'queue'
              ? 'border-brand-500 text-brand-600 dark:text-brand-300'
              : 'border-transparent text-ink-500 hover:text-ink-800 dark:hover:text-ink-200'
          }`}
        >
          <ListTodo size={16} />
          待更新队列
          {queue.length > 0 && (
            <span className="rounded-full bg-amber-500 px-2 py-0.5 text-xs font-bold text-white">
              {queue.length} 待更新
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
              const hasPending = pendingSlugs.has(post.slug)

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
                      {hasPending && (
                        <span
                          className="shrink-0 rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-600 dark:text-amber-400"
                          title="该文章在待更新队列中有尚未提交到仓库的更改"
                        >
                          待更新
                        </span>
                      )}
                      {isLocalDraft && encryptedRepoSlugs.has(post.slug) && (
                        <span
                          className="shrink-0 rounded-full bg-brand-500/10 px-2 py-0.5 text-[11px] font-medium text-brand-600 dark:text-brand-300"
                          title="仓库中同名文章为加密文章；发布时会在编辑器中重新加密"
                        >
                          加密文章草稿
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
                        onClick={() => queueOne(post)}
                        className="btn-ghost h-8 w-8 !px-0 text-brand-600 dark:text-brand-300"
                        title="加入待更新队列（更新后发布到 GitHub）"
                      >
                        <CloudUpload size={15} />
                      </button>
                    )}
                    <button
                      onClick={() => removePost(post)}
                      className="btn-ghost h-8 w-8 !px-0 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-500/10"
                      title={isLocalDraft ? '删除本地草稿' : '加入待更新队列（更新后从 GitHub 仓库删除）'}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>

          <p className="mb-16 mt-4 text-xs leading-relaxed text-ink-400">
            当同一文章存在已发布的仓库版本与本地编辑的草稿时，列表中会同时显示为两条记录，方便分别查看与管理。发布与删除等仓库操作会先进入「待更新队列」，统一更新后才会真正提交到 GitHub。
          </p>
        </>
      ) : mainTab === 'prs' ? (
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
      ) : (
        /* ---------------------------- 待更新队列 ---------------------------- */
        <div className="mt-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-ink-500">
              所有需要更新仓库的操作（发布/删除文章、上传图片、发表申请、账号偏好同步）都会先保存在本机，勾选后可一次批量更新，也可以全部更新。
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={toggleSelectAll}
                disabled={queue.length === 0 || flushing}
                className="btn-ghost h-8 px-2.5 text-xs"
              >
                {allSelected ? <Square size={13} /> : <CheckSquare size={13} />}
                {allSelected ? '取消全选' : '全选'}
              </button>
              <button
                type="button"
                onClick={() => runFlush(queue.filter((item) => selectedIds.has(item.id)))}
                disabled={flushing || selectedIds.size === 0}
                className="btn-outline h-8 px-2.5 text-xs"
                title={selectedIds.size === 0 ? '勾选要更新的更改' : `更新所选 ${selectedIds.size} 项`}
              >
                {flushing ? <Loader2 size={12} className="animate-spin" /> : <UploadCloud size={12} />}
                更新所选{selectedIds.size > 0 ? ` (${selectedIds.size})` : ''}
              </button>
              <button
                type="button"
                onClick={() => runFlush(queue)}
                disabled={flushing || queue.length === 0}
                className="btn-primary h-8 px-3 text-xs"
              >
                {flushing ? <Loader2 size={13} className="animate-spin" /> : <CloudUpload size={13} />}
                全部更新
              </button>
              <button
                type="button"
                onClick={() => {
                  if (queue.length === 0) return
                  if (!confirm(`确定清空待更新队列中的 ${queue.length} 项更改吗？`)) return
                  clearUpdateQueue()
                  setFlushErrors({})
                  toast('待更新队列已清空', 'info')
                }}
                disabled={queue.length === 0 || flushing}
                className="btn-danger h-8 px-2.5 text-xs"
              >
                <Trash2 size={12} />
                清空
              </button>
            </div>
          </div>

          {!canPublish && (
            <div className="rounded-xl border border-amber-200/70 bg-amber-50/50 px-4 py-3 text-xs text-amber-700 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300">
              更新仓库需要先 <Link to="/login" className="font-medium underline underline-offset-2">登录 GitHub</Link>；队列中的更改已保存在本机，不会丢失。
            </div>
          )}

          <div className="card divide-y divide-ink-200/60 overflow-hidden dark:divide-white/[0.07]">
            {queue.length === 0 ? (
              <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
                <ListTodo size={28} className="text-ink-300" />
                <p className="text-sm text-ink-500">待更新队列为空</p>
                <p className="max-w-sm text-xs leading-relaxed text-ink-400">
                  在编辑器或文章列表中发布、删除文章，或上传图片后，更改会先出现在这里，等待统一更新到 GitHub。
                </p>
              </div>
            ) : (
              queue.map((item) => {
                const meta = QUEUE_KIND_META[item.kind] ?? QUEUE_KIND_META['post-publish']
                const Icon = meta.icon
                const isSelected = selectedIds.has(item.id)
                const itemError = flushErrors[item.id]
                return (
                  <div
                    key={item.id}
                    onClick={() => setQueueDiffItem(item)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') setQueueDiffItem(item)
                    }}
                    title="点击查看 diff"
                    className={`flex cursor-pointer flex-wrap items-center gap-3 px-4 py-3.5 transition hover:bg-ink-50/70 dark:hover:bg-white/[.03] ${
                      isSelected ? 'bg-brand-50/40 dark:bg-brand-500/[0.06]' : ''
                    }`}
                  >
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        toggleSelected(item.id)
                      }}
                      disabled={flushing}
                      className="flex h-5 w-5 shrink-0 items-center justify-center rounded border border-ink-300 text-brand-600 transition hover:border-brand-400 dark:border-white/20 dark:text-brand-300"
                      aria-label={isSelected ? '取消选择' : '选择'}
                    >
                      {isSelected && <CheckSquare size={14} />}
                    </button>

                    {item.kind === 'image-upload' && item.dataUrl ? (
                      <img
                        src={item.dataUrl}
                        alt=""
                        className="h-10 w-10 shrink-0 rounded-lg border border-ink-200/60 object-cover dark:border-white/10"
                      />
                    ) : (
                      <span
                        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${meta.tone}`}
                      >
                        <Icon size={16} />
                      </span>
                    )}

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate text-sm font-semibold text-ink-900 dark:text-white">
                          {item.title}
                        </span>
                        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${meta.tone}`}>
                          {meta.label}
                        </span>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-xs text-ink-400">
                        <span className="truncate">
                          {item.kind === 'post-publish' || item.kind === 'post-delete' || item.kind === 'post-pr' || item.kind === 'version-name'
                            ? `/${item.target}`
                            : item.target}
                        </span>
                        <span>·</span>
                        <span className="flex items-center gap-1">
                          <Clock size={11} />
                          加入于 {relativeTime(item.createdAt)}
                        </span>
                      </div>
                      {itemError && (
                        <p className="mt-1 text-xs text-rose-600 dark:text-rose-400">
                          上次更新失败：{itemError}
                        </p>
                      )}
                    </div>

                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          setQueueDiffItem(item)
                        }}
                        className="btn-ghost h-8 w-8 !px-0 text-ink-500 hover:text-brand-600 dark:text-ink-400"
                        title="查看 diff"
                      >
                        <Eye size={14} />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          runFlush([item])
                        }}
                        disabled={flushing}
                        className="btn-ghost h-8 px-2 text-xs text-brand-600 dark:text-brand-300"
                        title="立即更新这一项"
                      >
                        {flushing ? (
                          <Loader2 size={14} className="animate-spin" />
                        ) : (
                          <UploadCloud size={14} />
                        )}
                        更新
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          removeQueueItem(item.id)
                          reloadQueue()
                        }}
                        disabled={flushing}
                        className="btn-ghost h-8 w-8 !px-0 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-500/10"
                        title="从队列中移除"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                )
              })
            )}
          </div>

          <p className="mb-16 text-xs leading-relaxed text-ink-400">
            更新时文件类更改（文章、图片、账号偏好、版本名称）会合并为一次 Git 提交并触发一次部署；发表申请会逐个创建 PR。失败的条目会保留在队列中，可稍后重试。
          </p>
        </div>
      )}
      {queueDiffItem && (
        <QueueItemDiffDialog item={queueDiffItem} onClose={() => setQueueDiffItem(null)} />
      )}
    </div>
  )
}

function QueueItemDiffDialog({ item, onClose }: { item: QueueItem; onClose: () => void }) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [oldText, setOldText] = useState<string | null>(null)
  const [newText, setNewText] = useState<string | null>(null)
  const [mode, setMode] = useState<'source' | 'render'>('source')
  const [onlyChanges, setOnlyChanges] = useState(true)

  const meta = QUEUE_KIND_META[item.kind] ?? QUEUE_KIND_META['post-publish']

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    setOldText(null)
    setNewText(null)

    const load = async () => {
      try {
        const repo = getRepoTarget()
        let oldContent = ''
        let newContent: string | null = null
        let isImage = false

        if (item.kind === 'post-publish' || item.kind === 'post-pr' || item.kind === 'post-delete') {
          const path = `${repo.postsDir}/${item.target}.md`
          try {
            const { text } = await fetchRemoteFile(path)
            oldContent = text
          } catch (err) {
            if ((err as { status?: number }).status === 404 || (err instanceof Error && /找不到资源/.test(err.message))) {
              oldContent = ''
            } else throw err
          }
          if (item.kind === 'post-delete') newContent = ''
          else newContent = item.markdown ?? ''
        } else if (item.kind === 'image-upload') {
          isImage = true
          // 图片：尝试获取远程（若不存在则为空）
          try {
            // 图片是二进制，这里仅尝试获取文本占位，实际不用于 diff
            const { text } = await fetchRemoteFile(item.target)
            oldContent = text
          } catch {
            oldContent = ''
          }
          newContent = item.dataUrl ?? ''
          // 对于图片 diff，oldText/newText 用于特殊渲染
          if (isImage) {
            if (!cancelled) {
              setOldText(oldContent)
              setNewText(newContent)
              setLoading(false)
            }
            return
          }
        } else if (item.kind === 'settings-sync') {
          const path = item.target
          try {
            const { text } = await fetchRemoteFile(path)
            oldContent = text
          } catch (err) {
            if ((err as { status?: number }).status === 404 || (err instanceof Error && /找不到资源/.test(err.message))) oldContent = ''
            else throw err
          }
          newContent = item.text ?? ''
        } else if (item.kind === 'version-name') {
          const slug = item.target
          const path = `${repo.postsDir}/${slug}.versions.json`
          let currentNames: Record<string, string> = {}
          try {
            const { text } = await fetchRemoteFile(path)
            oldContent = text
            try {
              currentNames = JSON.parse(text)
              if (!currentNames || typeof currentNames !== 'object') currentNames = {}
            } catch {
              currentNames = {}
            }
          } catch (err) {
            if ((err as { status?: number }).status === 404 || (err instanceof Error && /找不到资源/.test(err.message))) {
              oldContent = ''
              currentNames = {}
            } else throw err
          }
          const nextNames: Record<string, string> = { ...currentNames }
          for (const [sha, name] of Object.entries(item.renames ?? {})) {
            const k = sha.trim()
            if (!k) continue
            const v = name?.trim()
            if (v) nextNames[k] = v
            else delete nextNames[k]
          }
          newContent = Object.keys(nextNames).length === 0 ? '' : JSON.stringify(nextNames, null, 2) + '\n'
          // 如果 old 为空且 new 有内容，old 应视为空 JSON
          if (!oldContent) oldContent = Object.keys(currentNames).length === 0 ? '' : JSON.stringify(currentNames, null, 2) + '\n'
        }

        if (!cancelled) {
          setOldText(oldContent)
          setNewText(newContent ?? '')
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : '无法读取差异内容')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [item])

  const lines = useMemo(() => {
    if (oldText === null || newText === null) return []
    return diffLines(oldText, newText)
  }, [oldText, newText])
  const stats = useMemo(() => diffStats(lines), [lines])
  const rows = useMemo(() => (onlyChanges ? collapseContext(lines, 3) : lines), [lines, onlyChanges])
  const identical = oldText !== null && newText !== null && stats.added === 0 && stats.removed === 0

  const isMarkdown = item.kind === 'post-publish' || item.kind === 'post-pr' || item.kind === 'post-delete'
  const isImage = item.kind === 'image-upload'

  // 渲染模式使用新版本的 Markdown 分组（与 VersionCompare 一致）
  const renderBlocks = useMemo(() => {
    type Block = { type: DiffLine['type'] | 'skip'; text: string; count?: number }
    const blocks: Block[] = []
    let cur: Block | null = null
    for (const row of rows) {
      if (row.type === 'skip') {
        if (cur) {
          blocks.push(cur)
          cur = null
        }
        blocks.push({ type: 'skip', text: '', count: row.count })
        continue
      }
      if (!cur || cur.type !== row.type) {
        if (cur) blocks.push(cur)
        cur = { type: row.type, text: row.text }
      } else {
        cur.text += '\n' + row.text
      }
    }
    if (cur) blocks.push(cur)
    return blocks
  }, [rows])

  return (
    <div
      className="no-print fixed inset-0 z-[95] flex items-center justify-center bg-ink-950/50 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="更新队列差异"
      onClick={onClose}
    >
      <div
        className="card flex max-h-[min(48rem,calc(100vh-2rem))] w-full max-w-5xl flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-ink-200/70 px-5 py-4 dark:border-white/10">
          <div className="min-w-0 flex-1">
            <h2 className="flex items-center gap-2 font-serif text-lg font-bold text-ink-900 dark:text-white">
              <span className={`flex h-7 w-7 items-center justify-center rounded-lg ${meta.tone}`}>
                <meta.icon size={14} />
              </span>
              {item.title}
              <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${meta.tone}`}>{meta.label}</span>
            </h2>
            <p className="mt-1 truncate font-mono text-xs text-ink-400">{item.target} · 加入于 {relativeTime(item.createdAt)}</p>
          </div>
          <button type="button" onClick={onClose} className="btn-ghost h-8 w-8 shrink-0 !px-0" aria-label="关闭">
            <XCircle size={16} />
          </button>
        </div>

        {isImage ? (
          <div className="flex-1 overflow-auto bg-ink-50/50 p-4 dark:bg-black/20">
            {loading ? (
              <div className="flex items-center justify-center gap-2 py-12 text-sm text-ink-500">
                <Loader2 size={16} className="animate-spin" /> 正在读取…
              </div>
            ) : error ? (
              <p className="p-4 text-sm text-rose-600 dark:text-rose-400">{error}</p>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="rounded-xl border border-ink-200/70 bg-white p-3 dark:border-white/10 dark:bg-ink-900/60">
                  <p className="mb-2 text-xs font-medium text-ink-500">新图片（本地暂存）</p>
                  {newText ? (
                    <img src={newText} alt="" className="max-h-80 w-full rounded-lg border border-ink-200/60 object-contain dark:border-white/10" />
                  ) : (
                    <p className="text-xs text-ink-400">无图片数据</p>
                  )}
                  <p className="mt-2 break-all font-mono text-[11px] text-ink-400">{item.url ?? item.target}</p>
                </div>
                <div className="rounded-xl border border-ink-200/70 bg-white p-3 dark:border-white/10 dark:bg-ink-900/60">
                  <p className="mb-2 text-xs font-medium text-ink-500">仓库状态</p>
                  {oldText ? (
                    <p className="text-xs text-ink-500">该路径在仓库中已存在（图片为二进制，无法文本对比）</p>
                  ) : (
                    <p className="text-xs text-ink-500">仓库中尚无该图片（新文件）</p>
                  )}
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-3 inline-flex items-center gap-1 text-xs text-brand-600 hover:underline"
                  >
                    尝试访问远程地址 <Github size={12} />
                  </a>
                </div>
              </div>
            )}
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-3 border-b border-ink-200/70 px-5 py-2.5 text-xs dark:border-white/10">
              <span className="font-mono font-semibold text-emerald-600 dark:text-emerald-400">+{stats.added}</span>
              <span className="font-mono font-semibold text-rose-600 dark:text-rose-400">−{stats.removed}</span>
              <label className="ml-auto flex cursor-pointer items-center gap-2 text-ink-500">
                <input
                  type="checkbox"
                  checked={onlyChanges}
                  onChange={(e) => setOnlyChanges(e.target.checked)}
                  className="h-3.5 w-3.5 rounded accent-brand-500"
                />
                仅显示差异附近
              </label>
              {isMarkdown && (
                <div className="flex gap-0.5 rounded-lg bg-ink-100/80 p-0.5 dark:bg-white/5">
                  <button
                    type="button"
                    onClick={() => setMode('source')}
                    className={`rounded-md px-2.5 py-1 font-medium ${mode === 'source' ? 'bg-white shadow-sm dark:bg-white/10' : 'text-ink-500'}`}
                  >
                    源码
                  </button>
                  <button
                    type="button"
                    onClick={() => setMode('render')}
                    className={`rounded-md px-2.5 py-1 font-medium ${mode === 'render' ? 'bg-white shadow-sm dark:bg-white/10' : 'text-ink-500'}`}
                  >
                    渲染
                  </button>
                </div>
              )}
            </div>
            <div className="min-h-32 flex-1 overflow-auto bg-ink-50/50 dark:bg-black/20">
              {loading ? (
                <div className="flex items-center justify-center gap-2 py-16 text-sm text-ink-500">
                  <Loader2 size={16} className="animate-spin" /> 正在读取差异…
                </div>
              ) : error ? (
                <p className="p-5 text-sm text-rose-600 dark:text-rose-400">{error}</p>
              ) : identical ? (
                <p className="p-10 text-center text-sm text-ink-500">
                  {oldText === '' ? '这是新建文件，仓库中尚无该内容' : '该文件内容与仓库中一致，无差异'}
                </p>
              ) : mode === 'render' && isMarkdown ? (
                <div className="space-y-2 p-4">
                  {renderBlocks.map((block, idx) => {
                    if (block.type === 'skip') {
                      return (
                        <div key={`skip-${idx}`} className="rounded-lg bg-ink-100/70 px-3 py-1 text-center text-[11px] text-ink-400 dark:bg-white/[0.04]">
                          … 省略 {block.count} 行未改动内容 …
                        </div>
                      )
                    }
                    const tone =
                      block.type === 'insert'
                        ? 'border-emerald-200 bg-emerald-50/80 dark:border-emerald-500/20 dark:bg-emerald-500/[0.08]'
                        : block.type === 'delete'
                          ? 'border-rose-200 bg-rose-50/80 dark:border-rose-500/20 dark:bg-rose-500/[0.08]'
                          : 'border-ink-200/60 bg-white dark:border-white/10 dark:bg-ink-900/40'
                    const label = block.type === 'insert' ? '新增' : block.type === 'delete' ? '删除' : '未改动'
                    const labelTone =
                      block.type === 'insert'
                        ? 'bg-emerald-500 text-white'
                        : block.type === 'delete'
                          ? 'bg-rose-500 text-white'
                          : 'bg-ink-200 text-ink-600 dark:bg-white/10 dark:text-ink-300'
                    return (
                      <div key={`block-${idx}`} className={`overflow-hidden rounded-xl border ${tone}`}>
                        <div
                          className={`flex items-center gap-2 px-3 py-1 text-[11px] ${block.type === 'equal' ? 'bg-ink-50/50 border-b border-ink-200/60 dark:bg-white/[0.02] dark:border-white/10' : block.type === 'insert' ? 'bg-emerald-500/10 border-b border-emerald-200/50' : 'bg-rose-500/10 border-b border-rose-200/50'}`}
                        >
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${labelTone}`}>{label}</span>
                        </div>
                        <div className="prose prose-sm dark:prose-invert max-w-none px-4 py-3">
                          {block.text.trim() ? <Markdown content={block.text} /> : <span className="text-xs text-ink-400">（空行）</span>}
                        </div>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <table className="w-full border-collapse font-mono text-[12.5px] leading-relaxed">
                  <tbody>
                    {rows.map((row, idx) =>
                      row.type === 'skip' ? (
                        <tr key={`skip-${idx}`}>
                          <td colSpan={3} className="bg-ink-100/70 px-3 py-1 text-center text-[11px] text-ink-400 dark:bg-white/[0.04]">
                            … 省略 {row.count} 行未改动内容 …
                          </td>
                        </tr>
                      ) : (
                        <tr
                          key={`l-${idx}`}
                          className={
                            row.type === 'insert'
                              ? 'bg-emerald-500/[0.12] text-emerald-900 dark:text-emerald-200'
                              : row.type === 'delete'
                                ? 'bg-rose-500/[0.12] text-rose-900 dark:text-rose-200'
                                : 'text-ink-600 dark:text-ink-300'
                          }
                        >
                          <td className="w-10 select-none border-r border-ink-200/60 px-2 text-right align-top text-[11px] text-ink-400 dark:border-white/10">
                            {row.oldNumber ?? ''}
                          </td>
                          <td className="w-10 select-none border-r border-ink-200/60 px-2 text-right align-top text-[11px] text-ink-400 dark:border-white/10">
                            {row.newNumber ?? ''}
                          </td>
                          <td className="whitespace-pre-wrap break-words px-3 align-top">
                            <span className="select-none pr-2 opacity-70">{row.type === 'insert' ? '+' : row.type === 'delete' ? '−' : ' '}</span>
                            {row.text || '\u00a0'}
                          </td>
                        </tr>
                      ),
                    )}
                  </tbody>
                </table>
              )}
            </div>
          </>
        )}
        <div className="flex justify-end gap-2 border-t border-ink-200/70 px-5 py-3 dark:border-white/10">
          <button onClick={onClose} className="btn-outline h-8 px-3 text-xs">
            关闭
          </button>
        </div>
      </div>
    </div>
  )
}
