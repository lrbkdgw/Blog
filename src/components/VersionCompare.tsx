import { useEffect, useMemo, useState } from 'react'
import { ArrowLeftRight, GitCompareArrows, Loader2, X } from 'lucide-react'
import { fetchPostHistoryMarkdown, getRepoTarget } from '../lib/github'
import type { PostHistoryVersion } from '../lib/github'
import { collapseContext, diffLines, diffStats } from '../lib/diff'
import type { DiffLine } from '../lib/diff'

function versionLabel(version: PostHistoryVersion, index: number, total: number) {
  const when = version.committedAt ? new Date(version.committedAt).toLocaleString('zh-CN') : '时间未知'
  const tag = index === 0 ? '最新' : `#${total - index}`
  return `${tag} · ${version.sha.slice(0, 7)} · ${when} · ${version.message}`
}

export function VersionCompare({
  versions,
  slug,
  path,
  onClose,
}: {
  versions: PostHistoryVersion[]
  slug: string
  path?: string
  onClose: () => void
}) {
  // 默认对比「上一版 → 最新版」，这是最常见的诉求。
  const [baseSha, setBaseSha] = useState(() => versions[Math.min(1, versions.length - 1)]?.sha ?? '')
  const [targetSha, setTargetSha] = useState(() => versions[0]?.sha ?? '')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [texts, setTexts] = useState<{ base: string; target: string } | null>(null)
  const [onlyChanges, setOnlyChanges] = useState(true)

  useEffect(() => {
    if (!baseSha || !targetSha) return
    let cancelled = false
    setLoading(true)
    setError('')
    const target = getRepoTarget()
    Promise.all([
      fetchPostHistoryMarkdown(slug, baseSha, target, path),
      fetchPostHistoryMarkdown(slug, targetSha, target, path),
    ])
      .then(([base, next]) => {
        if (!cancelled) setTexts({ base, target: next })
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setTexts(null)
          setError(err instanceof Error ? err.message : '无法读取这两个版本的内容')
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [slug, path, baseSha, targetSha])

  const lines = useMemo(
    () => (texts ? diffLines(texts.base, texts.target) : []),
    [texts],
  )
  const stats = useMemo(() => diffStats(lines), [lines])
  const rows = useMemo(
    () => (onlyChanges ? collapseContext(lines, 3) : lines),
    [lines, onlyChanges],
  )
  const identical = texts !== null && stats.added === 0 && stats.removed === 0

  const swap = () => {
    setBaseSha(targetSha)
    setTargetSha(baseSha)
  }

  return (
    <div
      className="no-print fixed inset-0 z-[95] flex items-center justify-center bg-ink-950/50 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="版本对比"
    >
      <div className="card flex max-h-[min(48rem,calc(100vh-2rem))] w-full max-w-4xl flex-col overflow-hidden">
        <div className="flex items-start justify-between gap-3 border-b border-ink-200/70 px-5 py-4 dark:border-white/10">
          <div>
            <h2 className="flex items-center gap-2 font-serif text-lg font-bold text-ink-900 dark:text-white">
              <GitCompareArrows size={18} className="text-brand-500" />
              版本对比
            </h2>
            <p className="mt-1 text-xs text-ink-400">选择原始版本与新版本，逐行查看 Markdown 源码的差异。</p>
          </div>
          <button type="button" onClick={onClose} className="btn-ghost h-8 w-8 !px-0" aria-label="关闭版本对比">
            <X size={16} />
          </button>
        </div>

        <div className="grid gap-3 border-b border-ink-200/70 px-5 py-4 dark:border-white/10 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:items-end">
          <label className="block min-w-0">
            <span className="mb-1.5 block text-xs font-medium text-ink-500">原始版本</span>
            <select
              value={baseSha}
              onChange={(event) => setBaseSha(event.target.value)}
              className="input truncate !py-2 text-xs"
            >
              {versions.map((version, index) => (
                <option key={version.sha} value={version.sha}>
                  {versionLabel(version, index, versions.length)}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={swap}
            className="btn-ghost h-9 w-9 shrink-0 self-end !px-0"
            aria-label="交换两个版本"
            title="交换两个版本"
          >
            <ArrowLeftRight size={15} />
          </button>
          <label className="block min-w-0">
            <span className="mb-1.5 block text-xs font-medium text-ink-500">新版本</span>
            <select
              value={targetSha}
              onChange={(event) => setTargetSha(event.target.value)}
              className="input truncate !py-2 text-xs"
            >
              {versions.map((version, index) => (
                <option key={version.sha} value={version.sha}>
                  {versionLabel(version, index, versions.length)}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-3 border-b border-ink-200/70 px-5 py-2.5 text-xs dark:border-white/10">
          <span className="font-mono font-semibold text-emerald-600 dark:text-emerald-400">+{stats.added}</span>
          <span className="font-mono font-semibold text-rose-600 dark:text-rose-400">−{stats.removed}</span>
          <label className="ml-auto flex cursor-pointer items-center gap-2 text-ink-500">
            <input
              type="checkbox"
              checked={onlyChanges}
              onChange={(event) => setOnlyChanges(event.target.checked)}
              className="h-3.5 w-3.5 rounded accent-brand-500"
            />
            仅显示差异附近的内容
          </label>
        </div>

        <div className="min-h-32 flex-1 overflow-auto bg-ink-50/50 dark:bg-black/20">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-16 text-sm text-ink-500">
              <Loader2 size={16} className="animate-spin" /> 正在读取两个版本…
            </div>
          ) : error ? (
            <p className="p-5 text-sm text-rose-600 dark:text-rose-400">{error}</p>
          ) : baseSha === targetSha ? (
            <p className="p-10 text-center text-sm text-ink-500">请选择两个不同的版本进行对比。</p>
          ) : identical ? (
            <p className="p-10 text-center text-sm text-ink-500">这两个版本的内容完全相同。</p>
          ) : (
            <table className="w-full border-collapse font-mono text-[12.5px] leading-relaxed">
              <tbody>
                {rows.map((row, index) =>
                  row.type === 'skip' ? (
                    <tr key={`skip-${index}`}>
                      <td colSpan={3} className="bg-ink-100/70 px-3 py-1 text-center text-[11px] text-ink-400 dark:bg-white/[0.04]">
                        … 省略 {row.count} 行未改动内容 …
                      </td>
                    </tr>
                  ) : (
                    <DiffRow key={`line-${index}`} line={row} />
                  ),
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}

function DiffRow({ line }: { line: DiffLine }) {
  const tone =
    line.type === 'insert'
      ? 'bg-emerald-500/[0.12] text-emerald-900 dark:text-emerald-200'
      : line.type === 'delete'
        ? 'bg-rose-500/[0.12] text-rose-900 dark:text-rose-200'
        : 'text-ink-600 dark:text-ink-300'
  const sign = line.type === 'insert' ? '+' : line.type === 'delete' ? '−' : ' '
  return (
    <tr className={tone}>
      <td className="w-10 select-none border-r border-ink-200/60 px-2 text-right align-top text-[11px] text-ink-400 dark:border-white/10">
        {line.oldNumber ?? ''}
      </td>
      <td className="w-10 select-none border-r border-ink-200/60 px-2 text-right align-top text-[11px] text-ink-400 dark:border-white/10">
        {line.newNumber ?? ''}
      </td>
      <td className="whitespace-pre-wrap break-words px-3 align-top">
        <span className="select-none pr-2 opacity-70">{sign}</span>
        {line.text || '\u00a0'}
      </td>
    </tr>
  )
}
