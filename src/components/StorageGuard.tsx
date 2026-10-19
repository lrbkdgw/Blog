import { useCallback, useEffect, useState } from 'react'
import { AlertOctagon, Database, Download, RefreshCw, X } from 'lucide-react'
import { useToast } from './Toast'
import {
  exportLocalRecords,
  flushStorage,
  onStorageError,
  storageStatus,
} from '../lib/offlineStorage'
import { OFFLINE } from '../lib/runtime'

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/**
 * 离线版本地存储的健康监视。
 *
 * - 完全不可用（IndexedDB 与 localStorage 都写不了）：显示**阻断式错误页**，
 *   并允许把当前内存中的内容另存为档案，避免直接丢弃；
 * - 降级或单次写入失败：顶部横幅常驻 + 错误 toast，明确告诉用户「可能没有保存成功」。
 *
 * 线上站点不安装存储镜像，本组件直接返回 null，不影响线上行为。
 */
export function StorageGuard({ children }: { children: React.ReactNode }) {
  const toast = useToast()
  const [, setTick] = useState(0)
  const [dismissed, setDismissed] = useState(false)
  const refresh = useCallback(() => setTick((value) => value + 1), [])

  useEffect(() => {
    if (!OFFLINE) return
    return onStorageError((message) => {
      setDismissed(false)
      refresh()
      toast(`本地存储异常：${message}`, 'error')
    })
  }, [refresh, toast])

  useEffect(() => {
    if (!OFFLINE) return
    // 在途写入落盘后更新 dirty 标记
    const timer = window.setInterval(() => {
      if (storageStatus.dirty) void flushStorage().catch(() => undefined)
      refresh()
    }, 4000)
    return () => window.clearInterval(timer)
  }, [refresh])

  if (!OFFLINE) return <>{children}</>

  if (!storageStatus.ready) return null

  if (storageStatus.backend === 'none') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-ink-50 px-5 py-10 dark:bg-ink-950">
        <div className="card w-full max-w-2xl space-y-4 p-7">
          <p className="flex items-center gap-2 text-lg font-semibold text-rose-600 dark:text-rose-400">
            <AlertOctagon size={20} />
            本地存储不可用，无法安全保存离线文章
          </p>
          <p className="whitespace-pre-line text-sm leading-relaxed text-ink-600 dark:text-ink-300">
            {storageStatus.error ||
              'IndexedDB 与 localStorage 都无法写入。为避免你以为「已经保存」而实际丢失内容，本站已拒绝一切写入。'}
          </p>
          <div className="rounded-xl bg-ink-100/70 p-4 text-xs leading-relaxed text-ink-600 dark:bg-white/5 dark:text-ink-300">
            <p className="mb-1 font-medium text-ink-800 dark:text-ink-100">常见原因与解决办法</p>
            <ul className="list-disc space-y-1 pl-4">
              <li>浏览器开启了「阻止站点保存数据」或处于无痕窗口 → 关掉限制后重试。</li>
              <li>
                通过 <code className="font-mono">file://</code> 打开时部分浏览器禁用 IndexedDB → 用 Chrome / Edge /
                Firefox 正常窗口重试，或在本文件所在目录执行 <code className="font-mono">npx serve .</code> 后用
                <code className="font-mono"> http://localhost:3000</code> 打开。
              </li>
              <li>磁盘已满或该来源的站点数据被清理 → 清理空间后点「重试」。在此之前请先点「下载当前内容」把数据带走。</li>
            </ul>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                const records = exportLocalRecords()
                const blob = new Blob([JSON.stringify(records, null, 2)], {
                  type: 'application/json;charset=utf-8',
                })
                const url = URL.createObjectURL(blob)
                const anchor = document.createElement('a')
                anchor.href = url
                anchor.download = `starlog-offline-内存快照-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '')}.json`
                document.body.append(anchor)
                anchor.click()
                anchor.remove()
                setTimeout(() => URL.revokeObjectURL(url), 4000)
              }}
              className="btn-outline h-9"
            >
              <Download size={15} />
              下载当前内容（避免丢失）
            </button>
            <button type="button" onClick={() => window.location.reload()} className="btn-primary h-9">
              <RefreshCw size={15} />
              重试
            </button>
          </div>
        </div>
      </div>
    )
  }

  const showBanner = !dismissed && (Boolean(storageStatus.error) || storageStatus.dirty)

  return (
    <>
      {showBanner && (
        <div
          role="alert"
          className="fixed inset-x-0 top-0 z-[110] border-b border-amber-500/30 bg-amber-50/95 px-4 py-2 text-xs text-amber-900 backdrop-blur dark:bg-amber-950/80 dark:text-amber-100"
        >
          <div className="container-page flex items-start gap-3">
            <AlertOctagon size={15} className="mt-0.5 shrink-0" />
            <p className="flex-1 leading-relaxed">
              {storageStatus.error
                ? `本地存储提醒：${storageStatus.error}`
                : '有改动尚未确认写入磁盘；稍等片刻或手动导出档案备份。'}
              <span className="ml-2 text-amber-700/80 dark:text-amber-200/70">
                <Database size={12} className="mr-1 inline" />
                {storageStatus.backend === 'indexeddb' ? 'IndexedDB' : 'localStorage'} ·{' '}
                {formatBytes(storageStatus.bytes)}
              </span>
            </p>
            <button
              type="button"
              onClick={() => {
                setDismissed(true)
                refresh()
              }}
              className="shrink-0 rounded p-1 transition hover:bg-amber-500/15"
              aria-label="关闭提示"
            >
              <X size={14} />
            </button>
          </div>
        </div>
      )}
      {children}
    </>
  )
}
