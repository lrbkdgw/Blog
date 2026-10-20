import { useEffect, useMemo, useState } from 'react'
import { ArrowLeftRight, Columns2, FileText, GitCompareArrows, Loader2, X } from 'lucide-react'
import { loadPostHistoryMarkdown } from '../lib/postHistory'
import type { PostHistoryVersion } from '../lib/github'
import { diffLines, diffStats, renderedDiffBlocks } from '../lib/diff'
import type { RenderedDiffChunk } from '../lib/diff'
import { parseFrontmatter } from '../lib/frontmatter'
import { Markdown } from './Markdown'
import { DiffTable } from './DiffView'
import { resolveVersionName, VERSION_NAMES_CHANGED_EVENT } from '../lib/versionNames'

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
    Promise.all([
      loadPostHistoryMarkdown(slug, baseSha, path),
      loadPostHistoryMarkdown(slug, targetSha, path),
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
  // 渲染对比只展示较新版本：正文按块着色，绿色 = 新增，红色 = 已删除。
  // frontmatter 不参与正文渲染（与文章页一致），只比较正文内容。
  const renderedChunks = useMemo<RenderedDiffChunk[]>(() => {
    if (!texts) return []
    return renderedDiffBlocks(parseFrontmatter(texts.base).content, parseFrontmatter(texts.target).content)
  }, [texts])
  const identical = texts !== null && stats.added === 0 && stats.removed === 0

  const nameOf = (sha: string) => {
    void namesVersion
    return resolveVersionName(sha, slug)
  }
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
      data-yield-ignore
    >
      <div className="card flex max-h-[min(48rem,calc(100vh-2rem))] w-full max-w-5xl flex-col overflow-hidden">
        <div className="flex items-start justify-between gap-3 border-b border-ink-200/70 px-5 py-4 dark:border-white/10">
          <div>
            <h2 className="flex items-center gap-2 font-serif text-lg font-bold text-ink-900 dark:text-white">
              <GitCompareArrows size={18} className="text-brand-500" />
              版本对比
            </h2>
            <p className="mt-1 text-xs text-ink-400">
              选择原始版本与新版本，查看 Markdown 源码差异，或在较新版本的渲染结果中查看新增 / 删除内容。
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
            <>
              <span className="ml-auto text-ink-400">仅显示较新版本</span>
              <span className="flex items-center gap-1">
                <span className="h-2.5 w-2.5 rounded-sm bg-emerald-500/40" /> 新增
              </span>
              <span className="flex items-center gap-1">
                <span className="h-2.5 w-2.5 rounded-sm bg-rose-500/40" /> 已删除
              </span>
            </>
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
          ) : identical ? (
            <p className="p-10 text-center text-sm text-ink-500">这两个版本的内容完全相同。</p>
          ) : mode === 'render' ? (
            <div className="mx-auto max-w-3xl p-4">
              <section className="overflow-hidden rounded-xl border border-ink-200/70 bg-white dark:border-white/10 dark:bg-ink-900/60">
                <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-ink-200/70 px-4 py-2.5 dark:border-white/10">
                  <span className="rounded-full bg-brand-500/10 px-2 py-0.5 text-[11px] font-semibold text-brand-600 dark:text-brand-300">
                    较新版本
                  </span>
                  <span className="min-w-0 truncate font-mono text-[11px] text-ink-400">
                    {targetIndex >= 0
                      ? shortVersionName(
                          versions[targetIndex],
                          targetIndex,
                          versions.length,
                          nameOf(targetSha),
                        )
                      : targetSha.slice(0, 7)}
                  </span>
                  <span className="ml-auto font-mono text-[11px] text-ink-400">
                    <span className="text-emerald-600 dark:text-emerald-400">+{stats.added}</span>{' '}
                    <span className="text-rose-600 dark:text-rose-400">−{stats.removed}</span>
                  </span>
                </header>
                <div className="max-h-[60vh] overflow-y-auto px-4 py-3">
                  {renderedChunks.map((chunk, index) =>
                    chunk.type === 'equal' ? (
                      <Markdown key={`equal-${index}`} content={chunk.text} />
                    ) : (
                      <div
                        key={`${chunk.type}-${index}`}
                        className={`relative my-3 rounded-lg border px-3 py-1 ${
                          chunk.type === 'insert'
                            ? 'border-emerald-300/70 bg-emerald-500/[0.08] dark:border-emerald-400/25'
                            : 'border-rose-300/70 bg-rose-500/[0.08] dark:border-rose-400/25'
                        }`}
                      >
                        <span
                          className={`absolute -top-2 left-3 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                            chunk.type === 'insert'
                              ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300'
                              : 'bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300'
                          }`}
                        >
                          {chunk.type === 'insert' ? '新增' : '已删除'}
                        </span>
                        <div
                          className={
                            chunk.type === 'delete'
                              ? 'opacity-80 [&_.prose]:line-through [&_.prose]:decoration-rose-400/50 [&_.prose]:decoration-1'
                              : ''
                          }
                        >
                          <Markdown content={chunk.text} />
                        </div>
                      </div>
                    ),
                  )}
                </div>
              </section>
            </div>
          ) : (
            <DiffTable lines={lines} onlyChanges={onlyChanges} />
          )}
        </div>
      </div>
    </div>
  )
}
