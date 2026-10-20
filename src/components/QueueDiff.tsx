import { useEffect, useMemo, useState } from 'react'
import { Clock, FileText, GitPullRequest, Image as ImageIcon, Loader2, Trash2, UploadCloud, X } from 'lucide-react'
import { fetchRemoteFile, getRepoTarget } from '../lib/github'
import type { QueueItem } from '../lib/updateQueue'
import { diffLines, diffStats } from '../lib/diff'
import { normalizeVersionNames } from '../lib/versionNames'
import { DiffTable } from './DiffView'

const KIND_LABEL: Record<QueueItem['kind'], string> = {
  'post-publish': '更新文章',
  'post-delete': '删除文章',
  'post-pr': '发表申请',
  'image-upload': '上传图片',
  'settings-sync': '账号偏好',
  'version-name': '版本名称',
}

function isNotFound(error: unknown) {
  return (
    error instanceof Error &&
    ((error as Error & { status?: number }).status === 404 || /找不到资源/.test(error.message))
  )
}

/** 队列条目对应的仓库文件路径。 */
export function queueItemPath(item: QueueItem): string {
  if (item.kind === 'settings-sync' || item.kind === 'image-upload') return item.target
  const postsDir = getRepoTarget().postsDir
  if (item.kind === 'version-name') return `${postsDir}/${item.target}.versions.json`
  return `${postsDir}/${item.target}.md`
}

/** 根据队列条目计算「更新后」的文本；无法用文本表示时返回 null（如图片）。 */
export function queueItemNextText(item: QueueItem, currentText: string): string | null {
  switch (item.kind) {
    case 'post-publish':
    case 'post-pr':
      return item.markdown ?? ''
    case 'post-delete':
      return ''
    case 'settings-sync':
      return item.text ?? ''
    case 'version-name': {
      let current: Record<string, string> = {}
      try {
        current = normalizeVersionNames(JSON.parse(currentText || '{}'))
      } catch {
        current = {}
      }
      const next = { ...current }
      for (const [sha, name] of Object.entries(item.renames ?? {})) {
        const trimmed = name?.trim()
        if (trimmed) next[sha] = trimmed
        else delete next[sha]
      }
      // 没有实际变化（例如只是恢复成仓库里已有的名称）时不制造一整片「删除」。
      if (JSON.stringify(next) === JSON.stringify(current)) return currentText
      return Object.keys(next).length > 0 ? `${JSON.stringify(next, null, 2)}\n` : ''
    }
    case 'image-upload':
      return null
  }
}

/**
 * 「待更新队列」条目详情：把队列里的本地内容与仓库当前文件做一次行级对比。
 *
 * 队列保存的是「尚未提交的意图」，因此这里只读取远端文件作为原始版本，
 * 不会写入仓库；图片条目直接显示待上传的本地预览。
 */
export function QueueDiffDialog({ item, onClose }: { item: QueueItem; onClose: () => void }) {
  const path = queueItemPath(item)
  const [remoteText, setRemoteText] = useState('')
  const [loading, setLoading] = useState(item.kind !== 'image-upload')
  const [error, setError] = useState('')
  const [missing, setMissing] = useState(false)
  const [onlyChanges, setOnlyChanges] = useState(true)

  useEffect(() => {
    if (item.kind === 'image-upload') return
    let cancelled = false
    setLoading(true)
    setError('')
    setMissing(false)

    const load = async () => {
      try {
        const { text } = await fetchRemoteFile(path)
        if (!cancelled) setRemoteText(text)
      } catch (err) {
        if (cancelled) return
        if (isNotFound(err)) {
          setRemoteText('')
          setMissing(true)
        } else {
          setError(err instanceof Error ? err.message : '无法读取仓库中的原始文件')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [item.kind, path])

  const nextText = useMemo(
    () => (item.kind === 'image-upload' ? null : queueItemNextText(item, remoteText)),
    [item, remoteText],
  )
  const lines = useMemo(
    () => (nextText === null ? [] : diffLines(remoteText, nextText)),
    [remoteText, nextText],
  )
  const stats = useMemo(() => diffStats(lines), [lines])

  const fileSize = item.dataUrl ? Math.round(((item.dataUrl.split(',')[1] || '').length * 3) / 4) : 0

  return (
    <div
      className="no-print fixed inset-0 z-[97] flex items-center justify-center bg-ink-950/55 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="待更新内容差异"
      data-yield-ignore
      onClick={onClose}
    >
      <div
        className="card flex max-h-[min(46rem,calc(100vh-2rem))] w-full max-w-4xl flex-col overflow-hidden"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-ink-200/70 px-5 py-4 dark:border-white/10">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 font-serif text-lg font-bold text-ink-900 dark:text-white">
              <FileText size={18} className="text-brand-500" />
              待更新内容差异
              <span className="rounded-full bg-brand-500/10 px-2 py-0.5 text-[11px] font-medium text-brand-600 dark:text-brand-300">
                {KIND_LABEL[item.kind]}
              </span>
            </h2>
            <p className="mt-1 truncate font-mono text-xs text-ink-400" title={path}>
              {path}
            </p>
          </div>
          <button type="button" onClick={onClose} className="btn-ghost h-8 w-8 shrink-0 !px-0" aria-label="关闭差异预览">
            <X size={16} />
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-3 border-b border-ink-200/70 px-5 py-2.5 text-xs dark:border-white/10">
          {item.kind === 'image-upload' ? (
            <span className="flex items-center gap-1.5 text-ink-500">
              <ImageIcon size={13} /> 图片将在统一更新时上传到仓库，这里是本地暂存预览
            </span>
          ) : (
            <>
              <span className="font-mono font-semibold text-emerald-600 dark:text-emerald-400">+{stats.added}</span>
              <span className="font-mono font-semibold text-rose-600 dark:text-rose-400">−{stats.removed}</span>
              {missing && (
                <span className="rounded-full bg-amber-500/10 px-2 py-0.5 font-medium text-amber-700 dark:text-amber-300">
                  仓库中尚无此文件（将新建）
                </span>
              )}
              <label className="ml-auto flex cursor-pointer items-center gap-2 text-ink-500">
                <input
                  type="checkbox"
                  checked={onlyChanges}
                  onChange={(event) => setOnlyChanges(event.target.checked)}
                  className="h-3.5 w-3.5 rounded accent-brand-500"
                />
                仅显示差异附近的内容
              </label>
            </>
          )}
        </div>

        <div className="min-h-32 flex-1 overflow-auto bg-ink-50/50 dark:bg-black/20">
          {item.kind === 'image-upload' ? (
            <div className="space-y-4 p-5">
              {item.dataUrl ? (
                <div className="flex items-center justify-center rounded-xl border border-ink-200/70 bg-white/70 p-4 dark:border-white/10 dark:bg-white/[0.03]">
                  <img
                    src={item.dataUrl}
                    alt={item.title}
                    className="max-h-[min(28rem,55vh)] max-w-full rounded-lg object-contain shadow-sm"
                  />
                </div>
              ) : (
                <p className="text-sm text-ink-500">这条队列记录没有可预览的本地图片数据。</p>
              )}
              <div className="grid gap-2 text-xs text-ink-500 sm:grid-cols-2">
                <p>
                  文件名：<span className="font-mono text-ink-800 dark:text-ink-100">{item.title}</span>
                </p>
                <p>
                  暂存大小：<span className="font-mono text-ink-800 dark:text-ink-100">
                    {fileSize > 0 ? `${Math.max(1, Math.round(fileSize / 1024))} KB` : '未知'}
                  </span>
                </p>
                <p className="sm:col-span-2">
                  上传后地址：<span className="break-all font-mono text-ink-800 dark:text-ink-100">{item.url || path}</span>
                </p>
              </div>
              <p className="flex items-center gap-1.5 text-xs text-ink-400">
                <Clock size={12} /> 加入于 {new Date(item.createdAt).toLocaleString('zh-CN')}
              </p>
            </div>
          ) : loading ? (
            <div className="flex items-center justify-center gap-2 py-16 text-sm text-ink-500">
              <Loader2 size={16} className="animate-spin" /> 正在读取仓库中的原始文件…
            </div>
          ) : error ? (
            <p className="p-5 text-sm text-rose-600 dark:text-rose-400">{error}</p>
          ) : (
            <DiffTable lines={lines} onlyChanges={onlyChanges} />
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-ink-200/70 px-5 py-3 text-xs text-ink-400 dark:border-white/10">
          {item.kind === 'post-pr' && item.renamedFrom && (
            <span className="flex items-center gap-1.5 text-rose-600 dark:text-rose-400">
              <Trash2 size={12} /> 发表申请会同时删除旧文件 /{item.renamedFrom}
            </span>
          )}
          {item.kind === 'post-pr' && (
            <span className="flex items-center gap-1.5">
              <GitPullRequest size={12} /> 此项会创建 Pull Request，不会直接写入默认分支
            </span>
          )}
          {item.kind === 'post-publish' && (
            <span className="flex items-center gap-1.5">
              <UploadCloud size={12} /> 统一更新时写入仓库默认分支
            </span>
          )}
          <span className="ml-auto">加入于 {new Date(item.createdAt).toLocaleString('zh-CN')}</span>
        </div>
      </div>
    </div>
  )
}
