import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  AlertTriangle,
  ClipboardCopy,
  Database,
  Download,
  HardDrive,
  Server,
  Upload,
} from 'lucide-react'
import { useToast } from './Toast'
import { offlineConfig } from '../lib/config'
import { collectBundle, downloadBundle, formatBytes } from '../lib/offlineBundle'
import {
  describeBackend,
  exportLocalRecords,
  flushStorage,
  importLocalRecords,
  storageStatus,
} from '../lib/offlineStorage'
import { getOAuthRelayUrl, getSiteBaseUrl } from '../lib/runtime'
import { readPersonalSetting, writePersonalSetting } from '../lib/settingsStore'

/**
 * 离线单文件版的设置面板：存储状态、线上站点地址、OAuth 中转与本地档案备份。
 * 只在离线版渲染，线上站点看不到这个卡片。
 */
export function OfflineSettingsCard() {
  const toast = useToast()
  const fileRef = useRef<HTMLInputElement>(null)
  const [siteBase, setSiteBase] = useState(getSiteBaseUrl)
  const [relay, setRelay] = useState(getOAuthRelayUrl)
  const [, setTick] = useState(0)
  const refresh = useCallback(() => setTick((value) => value + 1), [])

  useEffect(() => {
    const handler = () => refresh()
    window.addEventListener('starlog:storage-error', handler)
    return () => window.removeEventListener('starlog:storage-error', handler)
  }, [refresh])

  const save = () => {
    writePersonalSetting('offlineSiteBase', siteBase.trim())
    writePersonalSetting('offlineOAuthRelayUrl', relay.trim())
    refresh()
    toast('已保存。站点地址用于显示文章里的站内图片，OAuth 中转用于「同步到线上」授权', 'success')
  }

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
    toast(`已导出 ${keys.length} 项本地数据（文章、偏好、待同步图片）`, 'success')
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
      const bundle = collectBundle({ includeDrafts: true, includeImages: true, includeSettings: true })
      downloadBundle(bundle)
      toast(`已导出 ${bundle.posts.length} 篇文章${bundle.images.length ? ` 与 ${bundle.images.length} 张图片` : ''}`, 'success')
    } catch (err) {
      toast(err instanceof Error ? err.message : '导出失败', 'error')
    }
  }

  return (
    <section className="card animate-fade-up p-6">
      <div className="mb-5 flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-500/10 text-brand-600 dark:text-brand-300">
          <HardDrive size={17} />
        </span>
        <div>
          <h2 className="font-medium text-ink-900 dark:text-white">离线版</h2>
          <p className="mt-0.5 text-xs leading-relaxed text-ink-400">
            这个 HTML 就是完整站点：写作、排版、主题、公式与搜索都在本机完成；
            同步到线上时复用站点的 GitHub 授权与待更新队列。
          </p>
        </div>
      </div>

      {/* 存储状态 */}
      <div className="mb-4 rounded-xl bg-ink-50 p-4 dark:bg-white/[0.03]">
        <p className="flex items-center gap-2 text-sm font-medium text-ink-800 dark:text-ink-100">
          <Database size={15} className="text-brand-500" />
          {describeBackend()}
          <span className="text-xs font-normal text-ink-400">
            · 已用 {formatBytes(storageStatus.bytes)}
            {storageStatus.dirty ? ' · 有改动待落盘' : ''}
          </span>
        </p>
        {storageStatus.error ? (
          <p className="mt-2 flex items-start gap-2 text-xs leading-relaxed text-amber-700 dark:text-amber-300">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" />
            {storageStatus.error}
          </p>
        ) : (
          <p className="mt-1.5 text-xs leading-relaxed text-ink-500">
            文章、图片与偏好都写在这里；浏览器清理站点数据会一并清掉，请定期「导出离线档案」备份。
          </p>
        )}
        {storageStatus.issues.length > 1 && (
          <ul className="mt-2 list-disc space-y-1 pl-5 text-[11px] leading-relaxed text-ink-400">
            {storageStatus.issues.slice(1).map((issue, index) => (
              <li key={index}>{issue}</li>
            ))}
          </ul>
        )}
      </div>

      {/* 地址配置 */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-1.5 block text-xs font-medium text-ink-500">线上站点地址</label>
          <input
            value={siteBase}
            onChange={(event) => setSiteBase(event.target.value)}
            placeholder={offlineConfig.assetBaseUrl}
            className="input font-mono text-xs"
          />
          <p className="mt-1 text-[11px] leading-relaxed text-ink-400">
            文章里的 <code className="font-mono">/uploads/…</code> 等站内路径联网时从这里取图。
          </p>
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-medium text-ink-500">
            <Server size={12} className="mr-1 inline" />
            OAuth 中转地址
          </label>
          <input
            value={relay}
            onChange={(event) => setRelay(event.target.value)}
            placeholder={offlineConfig.oauthRelayUrl}
            className="input font-mono text-xs"
          />
          <p className="mt-1 text-[11px] leading-relaxed text-ink-400">
            必须指向带 CORS 头的中转：<code className="font-mono">functions/login</code>（Cloudflare Pages）或
            <code className="font-mono"> oauth-relay/</code> Worker。
          </p>
        </div>
      </div>
      <button type="button" onClick={save} className="btn-primary mt-4 h-9">
        <Server size={15} />
        保存地址设置
      </button>

      {/* 备份与导出 */}
      <div className="mt-5 flex flex-wrap gap-2 border-t border-ink-200/70 pt-4 dark:border-white/10">
        <button type="button" onClick={exportArchive} className="btn-outline h-9">
          <Download size={15} />
          导出离线档案（全部本地数据）
        </button>
        <button type="button" onClick={() => fileRef.current?.click()} className="btn-outline h-9">
          <Upload size={15} />
          导入离线档案
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0]
            event.target.value = ''
            if (!file) return
            const replace = window.confirm(
              '「确定」= 先清空本机数据再导入（与备份完全一致）\n「取消」= 只叠加导入，同名条目按最新内容覆盖',
            )
            void importArchive(file, replace)
          }}
        />
        <button type="button" onClick={exportPosts} className="btn-outline h-9">
          <ClipboardCopy size={15} />
          导出文章包（可分享的 .json）
        </button>
        <Link to="/admin?tab=sync" className="btn-primary ml-auto h-9">
          <Upload size={15} />
          同步到线上
        </Link>
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-ink-400">
        提示：档案导出是纯本地备份，换设备时用「导入离线档案」即可整站还原（含文章、图片、主题与偏好）。
        {readPersonalSetting<string>('offlineSiteBase') ? '' : ' 首次使用建议先保存上面的线上站点地址。'}
      </p>
      <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-ink-400">
        <button
          type="button"
          className="btn-ghost h-7 text-[11px]"
          onClick={() => {
            void flushStorage()
              .then(() => toast('已把在途改动写入本地存储', 'success'))
              .catch((err: unknown) =>
                toast(err instanceof Error ? err.message : '落盘失败', 'error'),
              )
          }}
        >
          立即落盘
        </button>
        <button
          type="button"
          className="btn-ghost h-7 text-[11px]"
          onClick={() => {
            refresh()
            toast('已刷新存储状态', 'info')
          }}
        >
          刷新存储状态
        </button>
      </div>
    </section>
  )
}
