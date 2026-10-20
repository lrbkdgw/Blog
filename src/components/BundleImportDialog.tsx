import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { CheckCircle2, FileJson, Inbox, Loader2, X } from 'lucide-react'
import { useAuth } from '../lib/auth'
import { OFFLINE } from '../lib/runtime'
import { flushStorage } from '../lib/offlineStorage'
import {
  applyImport,
  formatBytes,
  parseBundle,
  planImport,
  type ImportPlan,
  type ImportPolicy,
  type OfflineBundle,
} from '../lib/offlineBundle'
import { useToast } from './Toast'

/**
 * 「导入离线文章包」对话框。
 *
 * 这是离线版与线上站点之间唯一的搬运入口：离线文件里导出的 `*.starlog-import.json`
 * 在这里被写进**本站点的本地文章列表**，再由站点原有的「待更新队列 → 统一更新」提交到仓库。
 *
 * 设计要点：
 *   - 只处理本地文件，不发任何网络请求（离线版与线上版都一样，仓库现状由站点自己的读取逻辑负责）；
 *   - 先给出「新增 / 覆盖 / 跳过」的逐篇计划，确认后才写入——不做「一键静默覆盖」；
 *   - 任何解析失败都明说原因（格式不对、版本不认识、文件被截断），不回退成「按纯文本导入」。
 */

const POLICY_OPTIONS: { id: ImportPolicy; label: string; hint: string }[] = [
  { id: 'overwrite', label: '覆盖同名文章', hint: '同 slug 已存在且内容不同 → 用导入包的内容覆盖' },
  { id: 'skip', label: '跳过同名文章', hint: '保住本机 / 仓库里的现有内容，只导入本站点还没有的文章' },
  { id: 'duplicate', label: '另存为新文章', hint: '同 slug 已存在时加日期后缀另存，绝不覆盖' },
]

export default function BundleImportDialog({
  open,
  onClose,
  onImported,
}: {
  open: boolean
  onClose: () => void
  onImported?: () => void
}) {
  const toast = useToast()
  const { canPublish } = useAuth()
  const fileInput = useRef<HTMLInputElement>(null)
  const [fileName, setFileName] = useState('')
  const [fileSize, setFileSize] = useState(0)
  const [bundle, setBundle] = useState<OfflineBundle | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<string>('')
  const [policy, setPolicy] = useState<ImportPolicy>('overwrite')
  const [excluded, setExcluded] = useState<string[]>([])
  const [importImages, setImportImages] = useState(true)
  const [importSettings, setImportSettings] = useState(false)
  const [alsoQueue, setAlsoQueue] = useState(true)

  const reset = useCallback(() => {
    setFileName('')
    setFileSize(0)
    setBundle(null)
    setError('')
    setDone('')
    setExcluded([])
    setBusy(false)
  }, [])

  useEffect(() => {
    if (open) reset()
  }, [open, reset])

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const plan: ImportPlan | null = useMemo(
    () => (bundle ? planImport(bundle, policy) : null),
    [bundle, policy],
  )
  const selectedItems = useMemo(() => {
    if (!plan) return []
    return plan.items.filter((item) => !excluded.includes(item.slug))
  }, [plan, excluded])

  const pickFile = async (file: File | undefined | null) => {
    if (!file) return
    setError('')
    setDone('')
    setBundle(null)
    setFileName(file.name)
    setFileSize(file.size)
    if (file.size > 64 * 1024 * 1024) {
      setError(`文件 ${formatBytes(file.size)} 过大（上限 64 MB）。请分批导出，或去掉文章里内联的大图片。`)
      return
    }
    let text = ''
    try {
      text = await file.text()
    } catch (err) {
      setError(`读取文件失败：${err instanceof Error ? err.message : '未知原因'}`)
      return
    }
    const parsed = parseBundle(text)
    if (!parsed.ok) {
      setError(parsed.error)
      return
    }
    setBundle(parsed.bundle)
    setImportImages(parsed.bundle.images.length > 0)
  }

  const run = async () => {
    if (!bundle || selectedItems.length === 0) return
    setBusy(true)
    setError('')
    try {
      const result = await applyImport({
        items: selectedItems,
        bundle,
        importImages,
        importSettings,
        // 离线版本没有可提交的 GitHub 队列；线上站点导入时默认顺带入队
        alsoQueue: !OFFLINE && canPublish && alsoQueue,
      })
      await flushAndNotify()
      const parts = [
        `新增 ${result.created}`,
        `覆盖 ${result.overwrote}`,
        `跳过 ${result.skipped}`,
        result.images ? `图片 ${result.images}` : '',
        result.queued ? `已入队 ${result.queued}` : '',
        result.failed.length ? `失败 ${result.failed.length}` : '',
      ].filter(Boolean)
      const summary = `导入完成：${parts.join('，')}`
      setDone(summary)
      if (result.failed.length > 0) {
        setError(`${result.failed.length} 篇没有成功：${result.failed.slice(0, 3).map((f) => `${f.slug}（${f.message}）`).join('；')}`)
        toast(summary, 'warning')
      } else {
        toast(
          OFFLINE
            ? `${summary}。内容已写入本机的离线文章库`
            : `${summary}。${result.queued ? '已加入待更新队列，统一更新后提交仓库' : '可在「待更新队列」逐篇加入后统一更新'}`,
          'success',
        )
      }
      onImported?.()
    } catch (err) {
      const message = err instanceof Error ? err.message : '导入失败'
      setError(message)
      toast(`导入失败：${message}`, 'error')
    } finally {
      setBusy(false)
    }
  }

  if (!open) return null

  const dialog = (
    <div
      className="no-print fixed inset-0 z-[95] flex items-start justify-center overflow-y-auto bg-ink-950/45 p-4 pt-[8vh] backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="导入离线文章包"
      onClick={onClose}
    >
      <div
        className="card w-full max-w-2xl p-6 sm:p-7"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="flex items-center gap-2 font-serif text-xl font-bold">
              <FileJson size={18} />
              导入离线文章包
            </h3>
            <p className="mt-1 text-sm leading-relaxed text-ink-500">
              {OFFLINE
                ? '选择另一台设备导出的文章包，内容会写入本机的离线文章库。'
                : '选择离线单文件版导出的文章包，内容写入本站点的本地文章列表，再由「待更新队列」提交到仓库。'}
            </p>
          </div>
          <button type="button" onClick={onClose} className="btn-ghost h-8 w-8 shrink-0" aria-label="关闭">
            <X size={16} />
          </button>
        </div>

        {/* --------------------------- 1) 选文件 --------------------------- */}
        <label
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault()
            void pickFile(event.dataTransfer.files?.[0])
          }}
          className="mt-5 flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-ink-300/70 bg-ink-50/50 px-5 py-7 text-center transition hover:border-brand-400 dark:border-white/15 dark:bg-white/[0.02]"
        >
          <Inbox size={20} className="text-ink-400" />
          <span className="text-sm text-ink-600 dark:text-ink-300">
            {fileName ? `${fileName}（${formatBytes(fileSize)}）` : '把 .starlog-import.json 拖到这里，或点击选择文件'}
          </span>
          <input
            ref={fileInput}
            type="file"
            accept=".json,application/json"
            className="sr-only"
            onChange={(event) => void pickFile(event.target.files?.[0])}
          />
        </label>

        {error && (
          <p className="mt-3 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs leading-relaxed text-rose-700 dark:text-rose-200">
            {error}
          </p>
        )}
        {done && (
          <p className="mt-3 flex items-start gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs leading-relaxed text-emerald-700 dark:text-emerald-200">
            <CheckCircle2 size={14} className="mt-0.5 shrink-0" />
            {done}
          </p>
        )}

        {/* --------------------------- 2) 导入计划 --------------------------- */}
        {bundle && plan && (
          <div className="mt-5 space-y-4">
            <div className="grid gap-2 text-xs text-ink-500 sm:grid-cols-2">
              <p>来源站点：{plan.source.title || '（未填写）'}</p>
              <p>来源仓库：{plan.source.repo || '（未填写）'}</p>
              <p>导出时间：{plan.source.createdAt || '（未知）'}</p>
              <p>
                包内：{plan.items.length} 篇 · 图片 {plan.images} 张
                {plan.hasSettings ? ' · 含外观偏好' : ''}
              </p>
            </div>

            <div>
              <p className="mb-1.5 text-xs font-medium text-ink-500">同名文章的处理方式</p>
              <div className="flex flex-wrap gap-2">
                {POLICY_OPTIONS.map((option) => (
                  <label
                    key={option.id}
                    title={option.hint}
                    className={`flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition ${
                      policy === option.id
                        ? 'border-brand-500/60 bg-brand-500/12 text-brand-700 dark:text-brand-200'
                        : 'border-ink-200/70 text-ink-500 hover:border-brand-400/60 dark:border-white/10'
                    }`}
                  >
                    <input
                      type="radio"
                      name="bundle-import-policy"
                      className="sr-only"
                      checked={policy === option.id}
                      onChange={() => setPolicy(option.id)}
                    />
                    {option.label}
                  </label>
                ))}
              </div>
            </div>

            <ul className="max-h-64 divide-y divide-ink-200/60 overflow-y-auto rounded-xl border border-ink-200/70 dark:divide-white/10 dark:border-white/10">
              {plan.items.map((item) => {
                const off = excluded.includes(item.slug)
                return (
                  <li key={item.slug} className="flex items-start gap-2 px-3 py-2 text-xs">
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      checked={!off && item.action !== 'skip'}
                      disabled={item.action === 'skip'}
                      onChange={() =>
                        setExcluded((current) =>
                          current.includes(item.slug)
                            ? current.filter((slug) => slug !== item.slug)
                            : [...current, item.slug],
                        )
                      }
                      aria-label={`选择 ${item.title}`}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium text-ink-700 dark:text-ink-200">
                        {item.title || item.slug}
                        {item.draft ? <span className="ml-1.5 text-ink-400">草稿</span> : null}
                      </p>
                      <p className="text-[11px] text-ink-400">
                        {item.targetSlug !== item.slug ? `${item.slug} → ${item.targetSlug} · ` : ''}
                        {item.chars} 字 · {item.reason || '将写入本地文章库'}
                      </p>
                    </div>
                    <span
                      className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] ${
                        item.action === 'create'
                          ? 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-200'
                          : item.action === 'overwrite'
                            ? 'bg-amber-500/12 text-amber-700 dark:text-amber-200'
                            : 'bg-ink-500/10 text-ink-500'
                      }`}
                    >
                      {item.action === 'create' ? '新增' : item.action === 'overwrite' ? '覆盖' : '跳过'}
                    </span>
                  </li>
                )
              })}
            </ul>

            <div className="space-y-1.5 text-xs text-ink-500">
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  checked={importImages}
                  onChange={(event) => setImportImages(event.target.checked)}
                />
                导入包内图片（{plan.images} 张）
                <span className="text-ink-400">
                  {OFFLINE ? '写入本机，随文章一起显示' : '进入待更新队列，统一更新时上传到仓库'}
                </span>
              </label>
              {plan.hasSettings && (
                <label className="flex cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    checked={importSettings}
                    onChange={(event) => setImportSettings(event.target.checked)}
                  />
                  套用包内的外观偏好（主题、字体、背景）
                </label>
              )}
              {!OFFLINE && canPublish && (
                <label className="flex cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    checked={alsoQueue}
                    onChange={(event) => setAlsoQueue(event.target.checked)}
                  />
                  同时加入待更新队列（少一次逐篇点击）
                </label>
              )}
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
              <button type="button" onClick={onClose} className="btn-ghost h-9">
                关闭
              </button>
              <button
                type="button"
                onClick={() => void run()}
                disabled={busy || selectedItems.length === 0}
                className="btn-primary flex h-9 items-center gap-1.5 disabled:opacity-60"
              >
                {busy ? <Loader2 size={15} className="animate-spin" /> : <FileJson size={15} />}
                导入 {selectedItems.filter((item) => item.action !== 'skip').length} 篇
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
  return typeof document !== 'undefined' ? createPortal(dialog, document.body) : dialog
}

/**
 * 确认落盘后通知其他视图刷新。
 *
 * 离线版的写入必须等 `flushStorage()` 真正确认落盘才算成功——否则用户看到「导入完成」
 * 但浏览器里其实还没有数据（存储被拒 / 配额满）。失败时异常向上传播，由调用方显示错误。
 */
async function flushAndNotify() {
  if (OFFLINE) await flushStorage()
  window.dispatchEvent(new CustomEvent('starlog:posts-changed'))
  window.dispatchEvent(new CustomEvent('starlog:queue-changed'))
}
