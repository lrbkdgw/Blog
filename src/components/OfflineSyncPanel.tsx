import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  AlertTriangle,
  CheckCircle2,
  CloudUpload,
  Database,
  History,
  ListTodo,
  Loader2,
  Network,
  RefreshCw,
  RotateCcw,
  Trash2,
  WifiOff,
} from 'lucide-react'
import GithubConnect from './GithubConnect'
import { useAuth } from '../lib/auth'
import { useToast } from './Toast'
import { offlineConfig } from '../lib/config'
import { relativeTime } from '../lib/posts'
import {
  describeSyncState,
  planOfflineSync,
  resetSyncState,
  runOfflineSync,
  stageOfflineSync,
  type SyncPlan,
} from '../lib/offlineSync'
import { describeBackend, flushStorage, storageStatus } from '../lib/offlineStorage'
import { getOAuthRelayUrl } from '../lib/runtime'
import { useOnlineStatus } from '../lib/useOnlineStatus'
import { getUpdateQueue } from '../lib/updateQueue'

/**
 * 离线版的「同步到线上」面板。
 *
 * 走的就是站点原有的那套：GitHub Device Flow 授权 → 待更新队列 → Git Data API 批量提交。
 * 这里只多做一件事：把本机文章库与离线文件内置版本的差异自动整理成一份提交计划，
 * 免得手动逐篇加入队列。未联网 / 未授权都会直接说明原因，不会静默跳过。
 */
export function OfflineSyncPanel() {
  const { canPublish, ghUser, loginWithGithub } = useAuth()
  const toast = useToast()
  const online = useOnlineStatus()
  const [plan, setPlan] = useState<SyncPlan>(() => planOfflineSync())
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState<'sync' | 'stage' | null>(null)
  const [error, setError] = useState('')
  const [queueCount, setQueueCount] = useState(() => getUpdateQueue().length)
  const [lastSync, setLastSync] = useState(() => describeSyncState())

  const reload = useCallback(() => {
    setPlan(planOfflineSync())
    setQueueCount(getUpdateQueue().length)
    setLastSync(describeSyncState())
  }, [])

  useEffect(() => {
    const handler = () => reload()
    window.addEventListener('starlog:posts-changed', handler)
    window.addEventListener('starlog:queue-changed', handler)
    window.addEventListener('storage', handler)
    return () => {
      window.removeEventListener('starlog:posts-changed', handler)
      window.removeEventListener('starlog:queue-changed', handler)
      window.removeEventListener('storage', handler)
    }
  }, [reload])

  // 计划条目变化后默认全选（保留仍存在的勾选）
  useEffect(() => {
    setSelected((prev) => {
      const available = new Set(plan.items.map((item) => item.slug))
      const next = new Set([...prev].filter((slug) => available.has(slug)))
      if (next.size === 0) return available
      return next
    })
  }, [plan.items])

  const relay = getOAuthRelayUrl()
  const blocked = useMemo(() => {
    if (!online) return '当前浏览器报告处于离线状态：同步需要联网调用 GitHub API。'
    if (!canPublish) return '尚未连接 GitHub 账号：先在下方完成 Device Flow 授权（离线文件需要通过 OAuth 中转）。'
    if (plan.items.length === 0) return ''
    return ''
  }, [online, canPublish, plan.items.length])

  const syncNow = async () => {
    setError('')
    setBusy('sync')
    try {
      const result = await runOfflineSync({ only: [...selected] })
      await flushStorage().catch(() => undefined)
      reload()
      if (result.succeeded.length === 0 && result.staged === 0) {
        toast('本机内容与仓库一致，没有需要同步的更改', 'info')
      } else {
        toast(
          `已提交 ${result.succeeded.length} 项更改${result.commitUrl ? '（一次提交）' : ''}，GitHub Actions / Pages 正在重新部署`,
          'success',
          result.commitUrl ? { label: '查看提交', href: result.commitUrl } : undefined,
        )
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : '同步失败'
      setError(message)
      toast(message, 'error')
    } finally {
      setBusy(null)
    }
  }

  const stageOnly = () => {
    setError('')
    try {
      const staged = stageOfflineSync({ ...plan, items: plan.items.filter((item) => selected.has(item.slug)) })
      reload()
      toast(
        `${staged.length} 项已加入待更新队列。可在「待更新队列」中勾选后统一更新，或点「提交所选」直接提交`,
        'success',
        { label: '查看队列', href: '/admin?tab=queue' },
      )
    } catch (err) {
      const message = err instanceof Error ? err.message : '加入队列失败'
      setError(message)
      toast(message, 'error')
    }
  }

  const toggle = (slug: string) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(slug)) next.delete(slug)
      else next.add(slug)
      return next
    })

  return (
    <div className="space-y-4">
      {/* ------------------------------ 状态一览 ------------------------------ */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="card flex items-start gap-3 p-4">
          <span
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
              online ? 'bg-emerald-500/10 text-emerald-600' : 'bg-rose-500/10 text-rose-600'
            }`}
          >
            {online ? <Network size={17} /> : <WifiOff size={17} />}
          </span>
          <div className="min-w-0">
            <p className="text-sm font-medium text-ink-900 dark:text-white">
              {online ? '网络可用' : '当前离线'}
            </p>
            <p className="mt-0.5 text-xs leading-relaxed text-ink-500">
              {online ? '可以调用 GitHub API 提交更改' : '离线也能继续写作；同步需要联网'}
            </p>
          </div>
        </div>

        <div className="card flex items-start gap-3 p-4">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-500/10 text-brand-600 dark:text-brand-300">
            <CloudUpload size={17} />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-medium text-ink-900 dark:text-white">
              {canPublish ? `已连接 @${ghUser?.login}` : '未连接 GitHub'}
            </p>
            <p className="mt-0.5 truncate text-xs leading-relaxed text-ink-500" title={relay}>
              OAuth 中转：{relay || '未配置（离线版必须配置，见 README）'}
            </p>
          </div>
        </div>

        <div className="card flex items-start gap-3 p-4">
          <span
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
              storageStatus.error ? 'bg-amber-500/10 text-amber-600' : 'bg-ink-100 dark:bg-white/10'
            }`}
          >
            <Database size={17} />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-medium text-ink-900 dark:text-white">{describeBackend()}</p>
            <p className="mt-0.5 text-xs leading-relaxed text-ink-500">
              已用 {(storageStatus.bytes / 1024).toFixed(0)} KB
              {storageStatus.error ? ' · 有存储告警' : ''}
            </p>
          </div>
        </div>

        <div className="card flex items-start gap-3 p-4">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-ink-100 dark:bg-white/10">
            <History size={17} />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-medium text-ink-900 dark:text-white">
              {lastSync.latest ? relativeTime(lastSync.latest) : '尚未同步'}
            </p>
            <p className="mt-0.5 text-xs leading-relaxed text-ink-500">
              已记录 {lastSync.total} 篇的同步指纹
            </p>
          </div>
        </div>
      </div>

      {/* ------------------------------ 未授权时 ------------------------------ */}
      {!canPublish && (
        <div className="card space-y-3 p-4">
          <p className="text-sm font-medium text-ink-900 dark:text-white">连接 GitHub 账号</p>
          <p className="text-xs leading-relaxed text-ink-500">
            离线文件用与站点相同的 Device Flow 授权（令牌只保存在这台浏览器里）。
            OAuth 中转地址来自
            <code className="mx-1 rounded bg-ink-100 px-1 font-mono text-[11px] dark:bg-white/10">
              offlineConfig.oauthRelayUrl
            </code>
            ，也可在「设置 → 离线版」覆盖。
          </p>
          <GithubConnect
            size="sm"
            label="连接 GitHub"
            onToken={async (token) => {
              await loginWithGithub(token)
              toast('已连接 GitHub，可以同步了', 'success')
              reload()
            }}
          />
        </div>
      )}

      {/* -------------------------------- 计划 -------------------------------- */}
      <div className="card overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 border-b border-ink-200/70 px-4 py-3 dark:border-white/10">
          <p className="text-sm font-medium text-ink-900 dark:text-white">
            待提交 {plan.items.length} 项
            <span className="ml-2 text-xs font-normal text-ink-500">
              内容一致 {plan.upToDate} 篇 · 已同步过 {plan.skipped} 篇 · 暂存图片 {plan.stagedImages} 张 · 队列中{' '}
              {queueCount} 项
            </span>
          </p>
          <div className="ml-auto flex flex-wrap gap-2">
            <button type="button" onClick={reload} className="btn-ghost h-8 text-xs">
              <RefreshCw size={13} />
              重新计算
            </button>
            <button
              type="button"
              onClick={() => {
                resetSyncState()
                reload()
                toast('已清除同步指纹：下次同步会重新提交全部本机文章', 'info')
              }}
              className="btn-ghost h-8 text-xs"
              title="离线文件内置版本是构建时的快照，若你发现某篇明明改了却没被列出来，可以清除指纹后重算"
            >
              <RotateCcw size={13} />
              清除同步记录
            </button>
          </div>
        </div>

        {plan.items.length === 0 ? (
          <div className="px-4 py-8 text-center">
            <CheckCircle2 size={22} className="mx-auto text-emerald-500" />
            <p className="mt-2 text-sm text-ink-600 dark:text-ink-300">
              本机文章库与仓库内容一致，无需同步。
            </p>
            <p className="mt-1 text-xs text-ink-400">
              写新文章、改内容或在离线版里删除内置文章后，这里会列出差异。
            </p>
          </div>
        ) : (
          <ul className="max-h-[22rem] divide-y divide-ink-100 overflow-auto dark:divide-white/5">
            {plan.items.map((item) => (
              <li key={`${item.kind}:${item.slug}`} className="flex items-start gap-3 px-4 py-2.5">
                <button
                  type="button"
                  onClick={() => toggle(item.slug)}
                  className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border border-ink-300 text-brand-600 transition dark:border-white/20"
                  aria-label={selected.has(item.slug) ? '取消选择' : '选择'}
                >
                  {selected.has(item.slug) && <CheckCircle2 size={14} />}
                </button>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-ink-800 dark:text-ink-100">
                    <span
                      className={`mr-2 rounded px-1.5 py-0.5 text-[11px] ${
                        item.kind === 'delete'
                          ? 'bg-rose-500/10 text-rose-600 dark:text-rose-400'
                          : 'bg-brand-500/10 text-brand-600 dark:text-brand-300'
                      }`}
                    >
                      {item.kind === 'delete' ? '删除' : '提交'}
                    </span>
                    {item.title}
                    <code className="ml-2 font-mono text-[11px] text-ink-400">{item.slug}.md</code>
                  </p>
                  <p className="mt-0.5 text-xs text-ink-400">{item.reason}</p>
                </div>
              </li>
            ))}
          </ul>
        )}

        {error && (
          <div className="flex items-start gap-2 border-t border-rose-500/20 bg-rose-500/5 px-4 py-3 text-xs leading-relaxed text-rose-700 dark:text-rose-300">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" />
            <span className="min-w-0 flex-1 break-words">{error}</span>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 border-t border-ink-200/70 px-4 py-3 dark:border-white/10">
          <button
            type="button"
            onClick={syncNow}
            disabled={busy !== null || plan.items.length === 0 || Boolean(blocked)}
            className="btn-primary h-9"
            title={blocked || '把所有勾选条目加入待更新队列，并合并为一次 Git 提交推到仓库'}
          >
            {busy === 'sync' ? <Loader2 size={15} className="animate-spin" /> : <CloudUpload size={15} />}
            提交所选 {selected.size} 项（一次提交）
          </button>
          <button
            type="button"
            onClick={stageOnly}
            disabled={busy !== null || plan.items.length === 0}
            className="btn-outline h-9"
            title="只加入待更新队列，稍后在队列里勾选后再更新"
          >
            <ListTodo size={15} />
            仅加入待更新队列
          </button>
          <Link to="/admin?tab=queue" className="btn-ghost h-9 text-xs">
            <Trash2 size={13} />
            管理队列（当前 {queueCount} 项）
          </Link>
          {blocked && <p className="text-xs text-ink-400">{blocked}</p>}
        </div>
      </div>

      <p className="text-xs leading-relaxed text-ink-400">
        提交目标：仓库
        <code className="mx-1 font-mono">content/posts/*.md</code>
        （分支 main）。部署完成后，
        <a
          href={offlineConfig.importTargets[0]?.url}
          target="_blank"
          rel="noreferrer"
          className="mx-1 text-brand-600 hover:underline dark:text-brand-300"
        >
          {offlineConfig.importTargets[0]?.label}
        </a>
        与
        <a
          href={offlineConfig.importTargets[1]?.url}
          target="_blank"
          rel="noreferrer"
          className="mx-1 text-brand-600 hover:underline dark:text-brand-300"
        >
          {offlineConfig.importTargets[1]?.label}
        </a>
        的文章列表都会更新。加密文章提交的是密文信封，不会外泄明文。
      </p>
    </div>
  )
}
