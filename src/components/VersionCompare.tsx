import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeftRight,
  ChevronDown,
  ChevronUp,
  Columns2,
  FileText,
  GitCompareArrows,
  Loader2,
  X,
} from 'lucide-react'
import { loadPostHistoryMarkdown } from '../lib/postHistory'
import type { PostHistoryVersion } from '../lib/github'
import {
  diffLines,
  diffStats,
  filterRenderGroups,
  groupRenderedDiffChunks,
  renderedDiffBlocks,
  summarizeRenderDiff,
} from '../lib/diff'
import type { RenderedDiffChunk, RenderDiffGroup } from '../lib/diff'
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
  // 渲染对比的展示开关：默认完整展示（含已删除内容），需要时再收敛到「只看改动」。
  const [onlyRenderChanges, setOnlyRenderChanges] = useState(false)
  const [showRemoved, setShowRemoved] = useState(true)
  const [activeChange, setActiveChange] = useState(0)
  const changeRefs = useRef<Record<number, HTMLDivElement | null>>({})
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
  // 渲染对比：把相邻的删除 / 新增块合成一张改动卡片，并给出「几处改动」摘要。
  const renderGroups = useMemo(() => groupRenderedDiffChunks(renderedChunks), [renderedChunks])
  const renderSummary = useMemo(() => summarizeRenderDiff(renderGroups), [renderGroups])
  const visibleRenderGroups = useMemo(
    () => filterRenderGroups(renderGroups, { onlyChanges: onlyRenderChanges, showRemoved }),
    [renderGroups, onlyRenderChanges, showRemoved],
  )
  const navigableChanges = useMemo(
    () => visibleRenderGroups.filter((group): group is Extract<RenderDiffGroup, { kind: 'change' }> => group.kind === 'change'),
    [visibleRenderGroups],
  )
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

  useEffect(() => {
    setActiveChange(0)
  }, [baseSha, targetSha])

  /** 跳到上一处 / 下一处改动（在可见的改动卡片之间循环）。 */
  const jumpToChange = (step: 1 | -1) => {
    if (navigableChanges.length === 0) return
    const next = (activeChange + step + navigableChanges.length) % navigableChanges.length
    setActiveChange(next)
    const node = changeRefs.current[navigableChanges[next].id]
    // jsdom / 老浏览器可能没有 scrollIntoView，不影响状态切换。
    node?.scrollIntoView?.({ behavior: 'smooth', block: 'center' })
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
              <section className="overflow-hidden rounded-2xl border border-ink-200/70 bg-white shadow-[0_1px_2px_rgba(16,24,40,.04),0_16px_40px_-28px_rgba(16,24,40,.35)] dark:border-white/10 dark:bg-ink-900/60">
                <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-ink-200/70 bg-gradient-to-r from-brand-500/[0.07] via-transparent to-transparent px-4 py-2.5 dark:border-white/10">
                  <span className="rounded-full bg-brand-500/10 px-2 py-0.5 text-[11px] font-semibold text-brand-600 dark:bg-brand-400/15 dark:text-brand-300">
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
                  <div className="ml-auto flex items-center gap-1.5 font-mono text-[11px]">
                    <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-emerald-700 dark:bg-emerald-400/15 dark:text-emerald-300">
                      +{renderSummary.addedBlocks} 段
                    </span>
                    <span className="rounded-full bg-rose-500/10 px-2 py-0.5 text-rose-700 dark:bg-rose-400/15 dark:text-rose-300">
                      −{renderSummary.removedBlocks} 段
                    </span>
                  </div>
                </header>

                {renderSummary.changes > 0 && (
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-ink-200/70 bg-ink-50/50 px-4 py-2 text-[11px] dark:border-white/10 dark:bg-white/[0.02]">
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => jumpToChange(-1)}
                        disabled={navigableChanges.length <= 1}
                        className="rounded-md p-1 text-ink-500 transition hover:bg-white hover:text-ink-800 disabled:opacity-30 dark:hover:bg-white/10 dark:hover:text-white"
                        aria-label="上一处改动"
                        title="上一处改动"
                      >
                        <ChevronUp size={13} />
                      </button>
                      <span className="min-w-[4.5rem] text-center font-mono text-ink-500">
                        第 {Math.min(activeChange + 1, Math.max(navigableChanges.length, 1))} /{' '}
                        {navigableChanges.length} 处
                      </span>
                      <button
                        type="button"
                        onClick={() => jumpToChange(1)}
                        disabled={navigableChanges.length <= 1}
                        className="rounded-md p-1 text-ink-500 transition hover:bg-white hover:text-ink-800 disabled:opacity-30 dark:hover:bg-white/10 dark:hover:text-white"
                        aria-label="下一处改动"
                        title="下一处改动"
                      >
                        <ChevronDown size={13} />
                      </button>
                    </div>
                    <span className="h-3 w-px bg-ink-200 dark:bg-white/15" />
                    <label className="flex cursor-pointer items-center gap-1.5 text-ink-500">
                      <input
                        type="checkbox"
                        checked={onlyRenderChanges}
                        onChange={(event) => setOnlyRenderChanges(event.target.checked)}
                        className="h-3.5 w-3.5 rounded accent-brand-500"
                      />
                      仅显示改动
                    </label>
                    <label className="flex cursor-pointer items-center gap-1.5 text-ink-500">
                      <input
                        type="checkbox"
                        checked={showRemoved}
                        onChange={(event) => setShowRemoved(event.target.checked)}
                        className="h-3.5 w-3.5 rounded accent-brand-500"
                      />
                      显示已删除
                    </label>
                    <span className="ml-auto flex items-center gap-2 text-ink-400">
                      <span className="flex items-center gap-1">
                        <span className="h-2 w-2 rounded-full bg-emerald-500/70" /> 新增
                      </span>
                      <span className="flex items-center gap-1">
                        <span className="h-2 w-2 rounded-full bg-rose-500/70" /> 已删除
                      </span>
                    </span>
                  </div>
                )}

                <div className="max-h-[60vh] overflow-y-auto overscroll-contain px-4 py-4 sm:px-6">
                  {visibleRenderGroups.length === 0 ? (
                    <p className="p-8 text-center text-sm text-ink-500">
                      没有可显示的改动。
                    </p>
                  ) : (
                    visibleRenderGroups.map((group, index) =>
                      group.kind === 'equal' ? (
                        <div
                          key={`equal-${index}`}
                          className="render-diff-stack text-ink-700 dark:text-ink-200"
                        >
                          <Markdown content={group.text} compact />
                        </div>
                      ) : (
                        <div
                          key={`change-${group.id}`}
                          ref={(node) => {
                            changeRefs.current[group.id] = node
                          }}
                          className={`relative my-4 overflow-hidden rounded-xl border transition-shadow hover:shadow-[0_10px_30px_-24px_rgba(16,24,40,.6)] ${
                            group.added.length > 0
                              ? 'border-emerald-300/70 dark:border-emerald-400/25'
                              : 'border-rose-300/70 dark:border-rose-400/25'
                          }`}
                        >
                          <div
                            className={`flex items-center gap-2 border-b px-3 py-1.5 text-[11px] font-semibold ${
                              group.added.length > 0 && group.removed.length > 0
                                ? 'border-ink-200/60 bg-ink-50/80 text-ink-500 dark:border-white/10 dark:bg-white/[0.03] dark:text-ink-400'
                                : group.added.length > 0
                                  ? 'border-emerald-300/50 bg-emerald-500/[0.07] text-emerald-700 dark:border-emerald-400/20 dark:bg-emerald-400/10 dark:text-emerald-300'
                                  : 'border-rose-300/50 bg-rose-500/[0.07] text-rose-700 dark:border-rose-400/20 dark:bg-rose-400/10 dark:text-rose-300'
                            }`}
                          >
                            <GitCompareArrows size={12} className="opacity-70" />
                            {group.added.length > 0 && group.removed.length > 0
                              ? '已修改'
                              : group.added.length > 0
                                ? '新增'
                                : '已删除'}
                            <span className="ml-auto font-mono text-[10px] font-normal opacity-60">
                              改动 {Math.max(0, navigableChanges.findIndex((item) => item.id === group.id)) + 1}
                            </span>
                          </div>

                          {group.removed.length > 0 && showRemoved && (
                            <div className="relative border-l-2 border-rose-400/70 px-3 py-2 sm:px-4">
                              {group.added.length > 0 && (
                                <span className="mb-1.5 inline-flex items-center gap-1 rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-semibold text-rose-700 dark:bg-rose-500/15 dark:text-rose-300">
                                  <span className="h-1.5 w-1.5 rounded-full bg-rose-500" />
                                  旧版本
                                </span>
                              )}
                              <div className="render-diff-deleted render-diff-stack rounded-lg px-2 py-1">
                                {group.removed.map((text, i) => (
                                  <Markdown key={`removed-${i}`} content={text} compact />
                                ))}
                              </div>
                            </div>
                          )}

                          {group.added.length > 0 && (
                            <div className="relative border-l-2 border-emerald-400/70 px-3 py-2 sm:px-4">
                              {group.removed.length > 0 && showRemoved && (
                                <span className="mb-1.5 inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
                                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                                  新版本
                                </span>
                              )}
                              <div className="render-diff-added render-diff-stack rounded-lg px-2 py-1">
                                {group.added.map((text, i) => (
                                  <Markdown key={`added-${i}`} content={text} compact />
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      ),
                    )
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
