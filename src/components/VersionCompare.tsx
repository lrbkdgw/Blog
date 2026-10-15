import { useEffect, useMemo, useState } from 'react'
import { ArrowLeftRight, Columns2, FileText, GitCompareArrows, Loader2, X } from 'lucide-react'
import { fetchPostHistoryMarkdown, getRepoTarget } from '../lib/github'
import type { PostHistoryVersion } from '../lib/github'
import { parseFrontmatter } from '../lib/frontmatter'
import { collapseContext, diffLines, diffStats } from '../lib/diff'
import type { DiffLine } from '../lib/diff'
import { Markdown } from './Markdown'
import { getVersionName, VERSION_NAMES_CHANGED_EVENT } from '../lib/versionNames'

type CompareMode = 'source' | 'render'

function versionLabel(
  version: PostHistoryVersion,
  index: number,
  total: number,
  customName?: string | null,
) {
  const when = version.committedAt ? new Date(version.committedAt).toLocaleString('zh-CN') : '时间未知'
  const tag = index === 0 ? '最新' : `#${total - index}`
  const name = customName || version.message
  return `${tag} · ${version.sha.slice(0, 7)} · ${when} · ${name}`
}

function shortVersionName(version: PostHistoryVersion, index: number, total: number, customName?: string | null) {
  const tag = index === 0 ? '最新' : `#${total - index}`
  return `${tag} · ${version.sha.slice(0, 7)} · ${customName || version.message}`
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
  const [mode, setMode] = useState<CompareMode>('source')
  // 版本名称在历史列表中被修改后，这里同步刷新
  const [namesVersion, setNamesVersion] = useState(0)
  useEffect(() => {
    const handler = () => setNamesVersion((value) => value + 1)
    window.addEventListener(VERSION_NAMES_CHANGED_EVENT, handler)
    return () => window.removeEventListener(VERSION_NAMES_CHANGED_EVENT, handler)
  }, [])

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

  const nameOf = (sha: string) => {
    void namesVersion
    return getVersionName(sha)
  }
  const baseIndex = versions.findIndex((v) => v.sha === baseSha)
  const targetIndex = versions.findIndex((v) => v.sha === targetSha)

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
      <div className="card flex max-h-[min(48rem,calc(100vh-2rem))] w-full max-w-5xl flex-col overflow-hidden">
        <div className="flex items-start justify-between gap-3 border-b border-ink-200/70 px-5 py-4 dark:border-white/10">
          <div>
            <h2 className="flex items-center gap-2 font-serif text-lg font-bold text-ink-900 dark:text-white">
              <GitCompareArrows size={18} className="text-brand-500" />
              版本对比
            </h2>
            <p className="mt-1 text-xs text-ink-400">
              选择原始版本与新版本，查看 Markdown 源码差异或并排的渲染效果。
            </p>
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
                  {versionLabel(version, index, versions.length, nameOf(version.sha))}
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
                  {versionLabel(version, index, versions.length, nameOf(version.sha))}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-3 border-b border-ink-200/70 px-5 py-2.5 text-xs dark:border-white/10">
          <div className="flex gap-0.5 rounded-lg bg-ink-100/80 p-0.5 dark:bg-white/5">
            <button
              type="button"
              onClick={() => setMode('source')}
              className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 font-medium transition ${
                mode === 'source'
                  ? 'bg-white text-ink-900 shadow-sm dark:bg-white/10 dark:text-white'
                  : 'text-ink-500 hover:text-ink-800 dark:hover:text-ink-200'
              }`}
            >
              <FileText size={13} />
              源码对比
            </button>
            <button
              type="button"
              onClick={() => setMode('render')}
              className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 font-medium transition ${
                mode === 'render'
                  ? 'bg-white text-ink-900 shadow-sm dark:bg-white/10 dark:text-white'
                  : 'text-ink-500 hover:text-ink-800 dark:hover:text-ink-200'
              }`}
            >
              <Columns2 size={13} />
              渲染对比
            </button>
          </div>
          {mode === 'source' && (
            <>
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
            </>
          )}
          {mode === 'render' && (
            <span className="ml-auto text-ink-400">左右并排渲染两个版本，可分别滚动查看</span>
          )}
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
          ) : mode === 'render' ? (
            <div className="grid gap-4 p-4 lg:grid-cols-2">
              {[
                {
                  label: '原始版本',
                  text: texts?.base ?? '',
                  index: baseIndex,
                  sha: baseSha,
                },
                {
                  label: '新版本',
                  text: texts?.target ?? '',
                  index: targetIndex,
                  sha: targetSha,
                },
              ].map((pane) => (
                <section
                  key={pane.label}
                  className="flex max-h-[60vh] min-w-0 flex-col overflow-hidden rounded-xl border border-ink-200/70 bg-white dark:border-white/10 dark:bg-ink-900/60"
                >
                  <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-ink-200/70 px-4 py-2.5 dark:border-white/10">
                    <span className="rounded-full bg-brand-500/10 px-2 py-0.5 text-[11px] font-semibold text-brand-600 dark:text-brand-300">
                      {pane.label}
                    </span>
                    <span className="min-w-0 truncate font-mono text-[11px] text-ink-400">
                      {pane.index >= 0
                        ? shortVersionName(
                            versions[pane.index],
                            pane.index,
                            versions.length,
                            nameOf(pane.sha),
                          )
                        : pane.sha.slice(0, 7)}
                    </span>
                  </header>
                  <div className="prose prose-sm dark:prose-invert max-w-none flex-1 overflow-y-auto px-4 py-3">
                    {/* 历史版本拉到的是完整文件源码：渲染对比要先剥离 frontmatter，否则 YAML 元数据会被当成正文渲染。 */}
                    <Markdown content={parseFrontmatter(pane.text).content} />
                  </div>
                </section>
              ))}
            </div>
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
