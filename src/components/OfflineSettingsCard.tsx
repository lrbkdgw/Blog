import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, Database, Download, HardDrive, Upload, WifiOff } from 'lucide-react'
import { useToast } from './Toast'
import { countLocalContent, exportBundleFile, formatBytes } from '../lib/offlineBundle'
import {
  describeBackend,
  exportLocalRecords,
  flushStorage,
  importLocalRecords,
  storageStatus,
} from '../lib/offlineStorage'

/**
 * 离线单文件版的设置面板：本机存储状态 + 本地档案备份 + 文章包导出。
 *
 * 只有这两类内容，是刻意的：离线版**不联网**，所以这里没有「线上站点地址」「OAuth 中转」
 * 之类的在线配置——没有可配置的在线行为，就不放一个填了也没用的输入框。
 * 只在离线版渲染，线上站点看不到这个卡片。
 */
export function OfflineSettingsCard() {
  const toast = useToast()
  const fileRef = useRef<HTMLInputElement>(null)
  const [, setTick] = useState(0)
  const refresh = useCallback(() => setTick((value) => value + 1), [])

  useEffect(() => {
    const handler = () => refresh()
    window.addEventListener('starlog:storage-error', handler)
    window.addEventListener('starlog:posts-changed', handler)
    return () => {
      window.removeEventListener('starlog:storage-error', handler)
      window.removeEventListener('starlog:posts-changed', handler)
    }
  }, [refresh])

  const exportArchive = () => {
    const records = exportLocalRecords()
    const keys = Object.keys(records)
    if (keys.length === 0) {
      toast('本机还没有任何可导出的数据', 'info')
      return
    }
    const blob = new Blob([JSON.stringify({ format: 'starlog-offline-archive', records }, null, 2)], {
      type: 'application/json;charset=utf-8',
    })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `starlog-offline-archive-${new Date().toISOString().slice(0, 10)}.json`
    document.body.append(anchor)
    anchor.click()
    anchor.remove()
    setTimeout(() => URL.revokeObjectURL(url), 4000)
    toast(`已导出 ${keys.length} 项本地数据（文章、草稿、偏好、暂存图片）`, 'success')
  }

  const importArchive = async (file: File, replace: boolean) => {
    try {
      const text = await file.text()
      const parsed = JSON.parse(text) as { format?: string; records?: Record<string, string> }
      if (parsed.format !== 'starlog-offline-archive' || !parsed.records || typeof parsed.records !== 'object') {
        throw new Error('这不是「离线档案」文件（缺少 starlog-offline-archive 标识）')
      }
      const count = await importLocalRecords(parsed.records, replace)
      refresh()
      toast(`已导入 ${count} 项本地数据${replace ? '（并已覆盖原有数据）' : ''}`, 'success', {
        label: '查看文章',
        href: '/admin',
      })
    } catch (err) {
      toast(err instanceof Error ? err.message : '导入失败', 'error')
    }
  }

  const exportPosts = () => {
    try {
      const result = exportBundleFile()
      toast(`已导出文章包 ${result.file}（${result.posts} 篇，${(result.bytes / 1024).toFixed(0)} KB）`, 'success', {
        label: '怎么导入线上站点',
        href: '/admin?tab=export',
      })
    } catch (err) {
      toast(err instanceof Error ? err.message : '导出失败', 'error')
    }
  }

  const local = countLocalContent()

  return (
    <section className="card animate-fade-up p-6">
      <div className="mb-5 flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-500/10 text-brand-600 dark:text-brand-300">
          <HardDrive size={17} />
        </span>
        <div>
          <h2 className="font-medium text-ink-900 dark:text-white">离线版</h2>
          <p className="mt-0.5 text-xs leading-relaxed text-ink-400">
            这个 HTML 就是完整站点：阅读、写作、排版、公式、搜索、加密与版本历史都在本机完成，
            <strong className="font-medium text-ink-600 dark:text-ink-200">不会发起任何网络请求</strong>
            ——没有在线登录、在线评论、远端历史版本，也不请求云端字体与远程图片。
          </p>
        </div>
      </div>

      {/* 存储状态 */}
      <div className="rounded-xl bg-ink-50 p-4 dark:bg-white/[0.03]">
        <p className="flex items-center gap-2 text-sm font-medium text-ink-800 dark:text-ink-100">
          <Database size={15} className="text-brand-500" />
          {describeBackend()}
          <span className="text-xs font-normal text-ink-400">
            · 已用 {formatBytes(storageStatus.bytes)} · 本机 {local.posts + local.drafts} 篇
            {local.images > 0 ? ` · 暂存图片 ${local.images} 张` : ''}
          </span>
        </p>
        {storageStatus.error ? (
          <p className="mt-2 flex items-start gap-1.5 text-xs leading-relaxed text-rose-600 dark:text-rose-300">
            <AlertTriangle size={13} className="mt-0.5 shrink-0" />
            {storageStatus.error}
          </p>
        ) : (
          <p className="mt-2 flex items-start gap-1.5 text-xs leading-relaxed text-ink-400">
            <WifiOff size={13} className="mt-0.5 shrink-0" />
            清除浏览器数据会一并删掉这里的文章，重要内容请定期「导出离线档案」。
          </p>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={async () => {
              try {
                await flushStorage()
                refresh()
                toast('本机数据已全部落盘', 'success')
              } catch (err) {
                toast(err instanceof Error ? err.message : '落盘失败', 'error')
              }
            }}
            className="btn-outline h-8 text-xs"
          >
            立即落盘
          </button>
          <button type="button" onClick={refresh} className="btn-outline h-8 text-xs">
            刷新存储状态
          </button>
        </div>
      </div>

      {/* 备份与迁移 */}
      <div className="mt-4 space-y-2">
        <p className="text-xs font-medium text-ink-500">本机数据</p>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={exportArchive} className="btn-outline h-9">
            <Download size={15} />
            导出离线档案（备份）
          </button>
          <button type="button" onClick={() => fileRef.current?.click()} className="btn-outline h-9">
            <Upload size={15} />
            导入离线档案
          </button>
          <button type="button" onClick={exportPosts} className="btn-outline h-9">
            <Download size={15} />
            导出文章包（给线上站点）
          </button>
          <Link to="/admin?tab=export" className="btn-primary ml-auto h-9">
            <HardDrive size={15} />
            带到线上站点
          </Link>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json"
          className="sr-only"
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (file) void importArchive(file, false)
            event.target.value = ''
          }}
        />
        <p className="text-[11px] leading-relaxed text-ink-400">
          「离线档案」是本机全部数据（含偏好与暂存图片），用于备份或换设备；
          「文章包」只含文章与图片，用于在线上站点的「管理 → 导入离线文章包」写入它的本地文章列表。
        </p>
      </div>
    </section>
  )
}
