import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  CheckSquare,
  Clock,
  CloudUpload,
  Eye,
  FileText,
  GitMerge,
  FileJson,
  GitPullRequest,
  Github,
  Archive,
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
  listPublicationPRs,
  mergePublicationPR,
} from '../lib/github'
import type { PublicationPR } from '../lib/github'
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
import { QueueDiffDialog } from '../components/QueueDiff'
import OfflineExportPanel from '../components/OfflineExportPanel'
import BundleImportDialog from '../components/BundleImportDialog'
import { hiddenSeedSlugs, hideSeedPost, resetSeedHidden } from '../lib/offlineLibrary'
import { countLocalContent } from '../lib/offlineBundle'
import { OFFLINE } from '../lib/runtime'
import type { Post } from '../lib/types'

type MainTab = 'posts' | 'prs' | 'queue' | 'export'
type Filter = 'all' | 'repo' | 'local' | 'draft'

/** 列表筛选项：离线版里 source=repo 是「打包进 HTML 的内置文章」，source=local 是本机文章库 */
const FILTER_OPTIONS: { id: Filter; label: string }[] = OFFLINE
  ? [
      { id: 'all', label: '全部' },
      { id: 'repo', label: '文件内置' },
      { id: 'local', label: '离线文章库' },
      { id: 'draft', label: '草稿' },
    ]
  : [
      { id: 'all', label: '全部' },
      { id: 'repo', label: '已发布到仓库' },
      { id: 'local', label: '本地草稿' },
      { id: 'draft', label: '草稿' },
    ]

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
  const [diffItem, setDiffItem] = useState<QueueItem | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [flushing, setFlushing] = useState(false)
  const [flushErrors, setFlushErrors] = useState<Record<string, string>>({})

  const [mainTab, setMainTab] = useState<MainTab>('posts')
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [busy, setBusy] = useState<string | null>(null)

  const target = useRepoTarget()

  const [localCount, setLocalCount] = useState(() => (OFFLINE ? countLocalContent().posts + countLocalContent().drafts : 0))
  const [hiddenCount, setHiddenCount] = useState(() => (OFFLINE ? hiddenSeedSlugs().length : 0))

  const reloadPosts = () => {
    setPosts(getAllAdminPosts())
    if (OFFLINE) {
      setLocalCount(countLocalContent().posts + countLocalContent().drafts)
      setHiddenCount(hiddenSeedSlugs().length)
    }
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
    if (tab === 'posts' || tab === 'prs' || tab === 'queue' || tab === 'export') setMainTab(tab)
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
    // 离线版：PR 审核依赖 GitHub API，没有网络/令牌可用时不做无谓请求；
    // 需要审批流程时直接到线上站点处理。
    if (OFFLINE) return
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
    if (OFFLINE) {
      // 单文件里的内置文章无法真的从文件里删除：只能本机隐藏（墓碑），不影响仓库。
      if (!confirm(`「${post.title}」是打包进这个 HTML 的内置文章，无法真正删除。改为在本机隐藏它？（只影响这台设备上的这个文件）`)) return
      try {
        hideSeedPost(post.slug)
        reloadPosts()
        toast('已在本机隐藏这篇文章', 'success', {
          label: '查看隐藏记录',
          href: '/admin?tab=export',
        })
      } catch (err) {
        toast(err instanceof Error ? err.message : '删除失败', 'error')
      }
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
    <div className="container-page max-w-5xl pt-12" data-yield-list>
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
            ) : OFFLINE ? (
              <span className="flex items-center gap-1.5 text-ink-500">
                <HardDrive size={14} />
                内容保存在这台设备的浏览器里（离线版不联网）
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

      {/* 访客提示（离线版：文章本来就存在本机，不需要登录即可写与发布到文章库） */}
      {!canPublish && !OFFLINE && (
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

      {OFFLINE && hiddenCount > 0 && (
        <div className="card mt-6 flex flex-wrap items-center justify-between gap-3 border-amber-200/70 bg-amber-50/60 p-4 text-sm dark:border-amber-500/20 dark:!bg-amber-500/[0.06]">
          <span className="flex items-center gap-2 text-ink-700 dark:text-ink-200">
            <HardDrive size={17} className="text-amber-600" />
            有 <strong>{hiddenCount}</strong> 篇内置文章在本机被隐藏。内置内容写死在 HTML 里，这里只能本机隐藏；要真的从仓库删除，请到线上站点操作。
          </span>
          <button
            type="button"
            onClick={() => {
              resetSeedHidden()
              reloadPosts()
              toast('已恢复全部被隐藏的内置文章', 'info')
            }}
            className="btn-outline h-8 text-xs"
          >
            全部恢复显示
          </button>
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
        {!OFFLINE && (
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
        )}
        {/* 「离线文章包」两种构建都显示：离线版用来导出，线上站点用来导入到本地文章列表 */}
        <button
          type="button"
          onClick={() => setMainTab('export')}
          className={`flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-semibold transition ${
            mainTab === 'export'
              ? 'border-brand-500 text-brand-600 dark:text-brand-300'
              : 'border-transparent text-ink-500 hover:text-ink-800 dark:hover:text-ink-200'
          }`}
        >
          <Archive size={16} />
          离线文章包
          {OFFLINE && localCount > 0 && (
            <span className="rounded-full bg-amber-500 px-2 py-0.5 text-xs font-bold text-white">
              本机 {localCount} 篇
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
              {FILTER_OPTIONS.map((f) => (
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
            data-yield-list
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
      ) : mainTab === 'export' ? (
        /* ------------------- 离线文章包（离线版导出 / 线上站点导入） ------------------- */
        <div className="mt-6 animate-fade-up" data-yield-list>
          {OFFLINE ? (
            <OfflineExportPanel />
          ) : (
            <OnlineBundleImport
              onImported={() => {
                reloadPosts()
                reloadQueue()
              }}
            />
          )}
        </div>
      ) : mainTab === 'prs' ? (
        /* -------------------------- 发表申请 (PR 审批) -------------------------- */
        <div className="mt-6 space-y-4" data-yield-list>
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

          <div className="card divide-y divide-ink-200/60 overflow-hidden dark:divide-white/[0.07]" data-yield-list>
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
        <div className="mt-6 space-y-4" data-yield-list>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-ink-500">
              {OFFLINE
                ? '离线版不提交仓库：这里只列出本机暂存的图片等待导出内容，它们会随「导出文章包」一起带走。'
                : '所有需要更新仓库的操作（发布/删除文章、上传图片、发表申请、账号偏好同步）都会先保存在本机，勾选后可一次批量更新，也可以全部更新。'}
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
              {!OFFLINE && (
                <>
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
                </>
              )}
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

          <div className="card divide-y divide-ink-200/60 overflow-hidden dark:divide-white/[0.07]" data-yield-list>
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
                    role="button"
                    tabIndex={0}
                    title="点击查看这条更新请求的 diff"
                    onClick={(event) => {
                      if ((event.target as HTMLElement).closest('button, input, label, a')) return
                      setDiffItem(item)
                    }}
                    onKeyDown={(event) => {
                      if (event.key !== 'Enter' && event.key !== ' ') return
                      if ((event.target as HTMLElement).closest('button, input, label, a')) return
                      event.preventDefault()
                      setDiffItem(item)
                    }}
                    className={`flex cursor-pointer flex-wrap items-center gap-3 px-4 py-3.5 transition hover:bg-ink-50/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500/40 dark:hover:bg-white/[.03] ${
                      isSelected ? 'bg-brand-50/40 dark:bg-brand-500/[0.06]' : ''
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => toggleSelected(item.id)}
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
                        onClick={() => setDiffItem(item)}
                        disabled={flushing}
                        className="btn-ghost h-8 px-2 text-xs"
                        title="查看这条更新请求的 diff"
                      >
                        <Eye size={14} />
                        diff
                      </button>
                      <button
                        onClick={() =>
                          OFFLINE
                            ? toast('离线版不提交仓库：这项内容会随文章包导出，或到线上站点再统一更新', 'info')
                            : runFlush([item])
                        }
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
                        onClick={() => {
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
            点击任意一条更新请求（或右侧的「diff」）可查看它相对仓库当前文件的差异。
          </p>
        </div>
      )}

      {diffItem && <QueueDiffDialog item={diffItem} onClose={() => setDiffItem(null)} />}
    </div>
  )
}

/** 线上站点端的「导入离线文章包」入口：写入本站点的本地文章列表，再由待更新队列提交仓库。 */
function OnlineBundleImport({ onImported }: { onImported: () => void }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="space-y-4" data-yield-list>
      <section className="card p-5">
        <h2 className="flex items-center gap-2 font-serif text-lg font-bold">
          <Archive size={17} />
          导入离线文章包
        </h2>
        <p className="mt-1.5 max-w-3xl text-sm leading-relaxed text-ink-500">
          离线单文件版（那个可以直接带走的 HTML）不会联网，也不能替你提交仓库：它只能导出一个
          <code className="mx-1 rounded bg-ink-100 px-1 text-[13px] dark:bg-white/10">.starlog-import.json</code>
          文章包。在这里选择它，文章会写进<strong>本站点的本地文章列表</strong>，
          然后照常走「待更新队列 → 统一更新」：一次提交、一次部署，线上文章列表里就有了。
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" onClick={() => setOpen(true)} className="btn-primary h-9">
            <FileJson size={15} />
            选择文件并导入
          </button>
          <Link to="/admin?tab=queue" className="btn-outline h-9">
            查看待更新队列
          </Link>
        </div>
      </section>
      <BundleImportDialog open={open} onClose={() => setOpen(false)} onImported={onImported} />
    </div>
  )
}
