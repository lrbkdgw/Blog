import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowDown,
  ArrowLeftRight,
  ArrowUp,
  Columns2,
  Eye,
  FileCode2,
  FoldVertical,
  GitCompareArrows,
  Loader2,
  Rows2,
  UnfoldVertical,
  X,
} from 'lucide-react'
import { loadPostHistoryMarkdown } from '../lib/postHistory'
import type { PostHistoryVersion } from '../lib/github'
import {
  diffLines,
  diffMarkdownHunks,
  diffStats,
  renderedDiffSummary,
} from '../lib/diff'
import type { RenderedDiffHunk, SourceBlock } from '../lib/diff'
import { parseFrontmatter } from '../lib/frontmatter'
import { Markdown } from './Markdown'
import { DiffTable } from './DiffView'
import { resolveVersionName, VERSION_NAMES_CHANGED_EVENT } from '../lib/versionNames'

type CompareMode = 'render' | 'source'
type RenderLayout = 'split' | 'unified'

function formatLineRange(prefix: string, start: number, end: number) {
  return start === end ? `${prefix}${start}` : `${prefix}${start}–${end}`
}

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

function UnchangedSection({
  blocks,
  collapsed,
  onExpand,
}: {
  blocks: SourceBlock[]
  collapsed: boolean
  onExpand: () => void
}) {
  if (!collapsed || blocks.length <= 1) {
    return (
      <div className="my-2 px-1 opacity-85 transition-opacity hover:opacity-100">
        <Markdown content={blocks.map((b) => b.text).join('\n\n')} />
      </div>
    )
  }

  return (
    <div className="my-3 flex items-center gap-3 py-1">
      <div className="h-px flex-1 bg-gradient-to-r from-transparent via-ink-200 to-ink-200/70 dark:via-white/12 dark:to-white/10" />
      <button
        type="button"
        onClick={onExpand}
        className="inline-flex items-center gap-1.5 rounded-full border border-ink-200/80 bg-white px-3 py-1 text-xs text-ink-500 shadow-2xs transition hover:border-brand-400/50 hover:text-brand-600 dark:border-white/10 dark:bg-ink-900 dark:text-ink-400 dark:hover:border-brand-400/40 dark:hover:text-brand-300"
      >
        <UnfoldVertical size={12} />
        展开此处未变更的 {blocks.length} 段内容
      </button>
      <div className="h-px flex-1 bg-gradient-to-l from-transparent via-ink-200 to-ink-200/70 dark:via-white/12 dark:to-white/10" />
    </div>
  )
}

export function VersionCompare({
  versions,
  slug,
  path,
  initialBaseSha,
  initialTargetSha,
  onClose,
}: {
  versions: PostHistoryVersion[]
  slug: string
  path?: string
  initialBaseSha?: string
  initialTargetSha?: string
  onClose: () => void
}) {
  // 默认对比「上一版 → 最新版」，这是最常见的诉求。
  const [baseSha, setBaseSha] = useState(
    () => initialBaseSha ?? versions[Math.min(1, versions.length - 1)]?.sha ?? '',
  )
  const [targetSha, setTargetSha] = useState(() => initialTargetSha ?? versions[0]?.sha ?? '')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [texts, setTexts] = useState<{ base: string; target: string } | null>(null)
  const [onlyChanges, setOnlyChanges] = useState(true)
  const [mode, setMode] = useState<CompareMode>('render')
  const [renderLayout, setRenderLayout] = useState<RenderLayout>('split')
  const [collapseUnchanged, setCollapseUnchanged] = useState(true)
  const [expandedGaps, setExpandedGaps] = useState<Record<number, boolean>>({})
  const [activeChange, setActiveChange] = useState(0)
  const scrollContainerRef = useRef<HTMLDivElement>(null)

  // 版本名称在历史列表中被修改后，这里同步刷新
  const [namesVersion, setNamesVersion] = useState(0)
  useEffect(() => {
    const handler = () => setNamesVersion((value) => value + 1)
    window.addEventListener(VERSION_NAMES_CHANGED_EVENT, handler)
    return () => window.removeEventListener(VERSION_NAMES_CHANGED_EVENT, handler)
  }, [])

  // 按 Esc 快捷关闭版本对比弹层
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.isComposing) {
        event.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    if (!baseSha || !targetSha) return
    let cancelled = false
    setLoading(true)
    setError('')
    setExpandedGaps({})
    setActiveChange(0)
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

  const hunks = useMemo<RenderedDiffHunk[]>(() => {
    if (!texts) return []
    return diffMarkdownHunks(
      parseFrontmatter(texts.base).content,
      parseFrontmatter(texts.target).content,
    )
  }, [texts])

  const summary = useMemo(() => renderedDiffSummary(hunks), [hunks])

  const frontmatterChanged = useMemo(() => {
    if (!texts) return false
    const a = parseFrontmatter(texts.base).data
    const b = parseFrontmatter(texts.target).data
    return JSON.stringify(a) !== JSON.stringify(b)
  }, [texts])

  const identical = texts !== null && stats.added === 0 && stats.removed === 0

  const nameOf = (sha: string) => {
    void namesVersion
    return resolveVersionName(sha, slug)
  }
  const baseIndex = versions.findIndex((v) => v.sha === baseSha)
  const targetIndex = versions.findIndex((v) => v.sha === targetSha)

  const swap = () => {
    setBaseSha(targetSha)
    setTargetSha(baseSha)
  }

  const jumpToChange = (nextIndex: number) => {
    if (summary.totalChanges <= 0) return
    const clamped =
      ((nextIndex % summary.totalChanges) + summary.totalChanges) % summary.totalChanges
    setActiveChange(clamped)
    const targetEl = scrollContainerRef.current?.querySelector<HTMLElement>(
      `[data-diff-change="${clamped}"]`,
    )
    targetEl?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  let changeCursor = -1

  return (
    <div
      className="no-print fixed inset-0 z-[95] flex items-center justify-center bg-ink-950/55 p-3 backdrop-blur-sm sm:p-5"
      role="dialog"
      aria-modal="true"
      aria-label="版本对比"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="card flex max-h-[min(54rem,calc(100dvh-1.5rem))] w-full max-w-6xl flex-col overflow-hidden shadow-2xl">
        {/* 顶栏 */}
        <div className="flex items-start justify-between gap-3 border-b border-ink-200/70 px-5 py-3.5 dark:border-white/10">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 font-serif text-lg font-bold text-ink-900 dark:text-white">
              <GitCompareArrows size={18} className="shrink-0 text-brand-500" />
              历史版本对比
            </h2>
            <p className="mt-0.5 text-xs text-ink-400">
              支持完整的公式、折叠提示框、表格与代码块渲染对照，也可随时切换到逐行 Markdown 源码差异。
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="btn-ghost h-8 w-8 shrink-0 !px-0"
            aria-label="关闭版本对比"
            title="关闭 (Esc)"
          >
            <X size={16} />
          </button>
        </div>

        {/* 版本选择栏 */}
        <div className="grid gap-2.5 border-b border-ink-200/70 bg-ink-50/40 px-5 py-3 dark:border-white/10 dark:bg-white/[0.02] sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:items-end">
          <label className="block min-w-0">
            <span className="mb-1 flex items-center gap-1.5 text-[11px] font-medium text-ink-500">
              <span className="h-2 w-2 rounded-full bg-rose-400/80" />
              基准版本（旧）
            </span>
            <select
              value={baseSha}
              onChange={(event) => setBaseSha(event.target.value)}
              className="input truncate !py-1.5 text-xs"
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
            className="btn-ghost h-8 w-8 shrink-0 self-end !px-0"
            aria-label="交换两个版本"
            title="交换基准版本与目标版本"
          >
            <ArrowLeftRight size={15} />
          </button>
          <label className="block min-w-0">
            <span className="mb-1 flex items-center gap-1.5 text-[11px] font-medium text-ink-500">
              <span className="h-2 w-2 rounded-full bg-emerald-400/80" />
              目标版本（新）
            </span>
            <select
              value={targetSha}
              onChange={(event) => setTargetSha(event.target.value)}
              className="input truncate !py-1.5 text-xs"
            >
              {versions.map((version, index) => (
                <option key={version.sha} value={version.sha}>
                  {versionLabel(version, index, versions.length, nameOf(version.sha))}
                </option>
              ))}
            </select>
          </label>
        </div>

        {/* 模式与视图工具栏 */}
        <div className="flex flex-wrap items-center gap-2.5 border-b border-ink-200/70 px-5 py-2.5 text-xs dark:border-white/10">
          <div className="flex gap-0.5 rounded-lg bg-ink-100/80 p-0.5 dark:bg-white/8">
            <button
              type="button"
              onClick={() => setMode('render')}
              className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 font-medium transition ${
                mode === 'render'
                  ? 'bg-white text-ink-900 shadow-sm dark:bg-ink-800 dark:text-white'
                  : 'text-ink-500 hover:text-ink-800 dark:hover:text-ink-200'
              }`}
            >
              <Eye size={13} />
              渲染对比
            </button>
            <button
              type="button"
              onClick={() => setMode('source')}
              className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 font-medium transition ${
                mode === 'source'
                  ? 'bg-white text-ink-900 shadow-sm dark:bg-ink-800 dark:text-white'
                  : 'text-ink-500 hover:text-ink-800 dark:hover:text-ink-200'
              }`}
            >
              <FileCode2 size={13} />
              源码对比
            </button>
          </div>

          {!loading && !error && texts && baseSha !== targetSha && !identical && (
            <>
              <div className="flex flex-wrap items-center gap-1.5">
                {mode === 'render' ? (
                  <>
                    {summary.modified > 0 && (
                      <span className="rounded-full bg-amber-500/12 px-2 py-0.5 font-medium text-amber-700 dark:text-amber-300">
                        ~{summary.modified} 处修改
                      </span>
                    )}
                    {summary.inserted > 0 && (
                      <span className="rounded-full bg-emerald-500/12 px-2 py-0.5 font-medium text-emerald-700 dark:text-emerald-300">
                        +{summary.inserted} 处新增
                      </span>
                    )}
                    {summary.deleted > 0 && (
                      <span className="rounded-full bg-rose-500/12 px-2 py-0.5 font-medium text-rose-700 dark:text-rose-300">
                        −{summary.deleted} 处删除
                      </span>
                    )}
                  </>
                ) : (
                  <>
                    <span className="rounded-full bg-emerald-500/12 px-2 py-0.5 font-mono font-semibold text-emerald-700 dark:text-emerald-300">
                      +{stats.added}
                    </span>
                    <span className="rounded-full bg-rose-500/12 px-2 py-0.5 font-mono font-semibold text-rose-700 dark:text-rose-300">
                      −{stats.removed}
                    </span>
                  </>
                )}
              </div>

              {mode === 'render' ? (
                <div className="ml-auto flex flex-wrap items-center gap-2">
                  {/* 分栏 / 上下布局切换 */}
                  <div className="flex gap-0.5 rounded-lg bg-ink-100/80 p-0.5 dark:bg-white/8">
                    <button
                      type="button"
                      onClick={() => setRenderLayout('split')}
                      className={`flex items-center gap-1 rounded-md px-2 py-1 transition ${
                        renderLayout === 'split'
                          ? 'bg-white font-medium text-ink-900 shadow-2xs dark:bg-ink-800 dark:text-white'
                          : 'text-ink-500 hover:text-ink-800 dark:hover:text-ink-200'
                      }`}
                      title="修改段落左右并排对照（旧版在左，新版在右）"
                    >
                      <Columns2 size={12} />
                      分栏对照
                    </button>
                    <button
                      type="button"
                      onClick={() => setRenderLayout('unified')}
                      className={`flex items-center gap-1 rounded-md px-2 py-1 transition ${
                        renderLayout === 'unified'
                          ? 'bg-white font-medium text-ink-900 shadow-2xs dark:bg-ink-800 dark:text-white'
                          : 'text-ink-500 hover:text-ink-800 dark:hover:text-ink-200'
                      }`}
                      title="单栏按阅读顺序上下展示修改前后"
                    >
                      <Rows2 size={12} />
                      上下融合
                    </button>
                  </div>

                  {/* 折叠 / 展开未变更上下文 */}
                  {summary.unchangedBlocks > 1 && (
                    <button
                      type="button"
                      onClick={() => {
                        setCollapseUnchanged((prev) => !prev)
                        setExpandedGaps({})
                      }}
                      className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 transition ${
                        collapseUnchanged
                          ? 'border-brand-400/40 bg-brand-500/8 text-brand-700 dark:text-brand-300'
                          : 'border-ink-200/80 bg-white text-ink-600 hover:text-ink-900 dark:border-white/10 dark:bg-white/5 dark:text-ink-300'
                      }`}
                    >
                      {collapseUnchanged ? <UnfoldVertical size={12} /> : <FoldVertical size={12} />}
                      {collapseUnchanged ? '展开全文' : '折叠未改段落'}
                    </button>
                  )}

                  {/* 上一处 / 下一处变更快速定位 */}
                  {summary.totalChanges > 1 && (
                    <div className="flex items-center rounded-lg border border-ink-200/80 bg-white dark:border-white/10 dark:bg-white/5">
                      <button
                        type="button"
                        onClick={() => jumpToChange(activeChange - 1)}
                        className="px-2 py-1 text-ink-500 transition hover:text-brand-600 dark:text-ink-300 dark:hover:text-brand-300"
                        aria-label="上一处变更"
                        title="上一处变更"
                      >
                        <ArrowUp size={13} />
                      </button>
                      <span className="border-x border-ink-200/70 px-2 py-0.5 font-mono text-[11px] text-ink-500 dark:border-white/10 dark:text-ink-300">
                        {activeChange + 1} / {summary.totalChanges}
                      </span>
                      <button
                        type="button"
                        onClick={() => jumpToChange(activeChange + 1)}
                        className="px-2 py-1 text-ink-500 transition hover:text-brand-600 dark:text-ink-300 dark:hover:text-brand-300"
                        aria-label="下一处变更"
                        title="下一处变更"
                      >
                        <ArrowDown size={13} />
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <label className="ml-auto flex cursor-pointer items-center gap-2 text-ink-500">
                  <input
                    type="checkbox"
                    checked={onlyChanges}
                    onChange={(event) => setOnlyChanges(event.target.checked)}
                    className="h-3.5 w-3.5 rounded accent-brand-500"
                  />
                  仅显示差异附近的内容
                </label>
              )}
            </>
          )}
        </div>

        {/* 主体滚动区（单一滚动容器，彻底消除嵌套双滚动条） */}
        <div
          ref={scrollContainerRef}
          className="min-h-32 flex-1 overflow-y-auto bg-ink-50/50 dark:bg-black/20"
        >
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
            <div className="mx-auto max-w-5xl space-y-4 p-4 sm:p-6">
              {/* 版本头部信息条 */}
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-ink-200/70 bg-white/90 px-4 py-2.5 text-xs dark:border-white/10 dark:bg-ink-900/70">
                <div className="flex min-w-0 flex-wrap items-center gap-2 text-ink-500 dark:text-ink-300">
                  <span className="truncate font-mono text-[11px] text-rose-600/90 dark:text-rose-300">
                    {baseIndex >= 0
                      ? shortVersionName(versions[baseIndex], baseIndex, versions.length, nameOf(baseSha))
                      : baseSha.slice(0, 7)}
                  </span>
                  <span className="text-ink-300 dark:text-ink-600">→</span>
                  <span className="truncate font-mono text-[11px] text-emerald-700 dark:text-emerald-300">
                    {targetIndex >= 0
                      ? shortVersionName(versions[targetIndex], targetIndex, versions.length, nameOf(targetSha))
                      : targetSha.slice(0, 7)}
                  </span>
                </div>
                <span className="font-mono text-[11px] text-ink-400">
                  源码行差异{' '}
                  <span className="font-semibold text-emerald-600 dark:text-emerald-400">+{stats.added}</span>{' '}
                  <span className="font-semibold text-rose-600 dark:text-rose-400">−{stats.removed}</span>
                </span>
              </div>

              {frontmatterChanged && summary.totalChanges === 0 && (
                <div className="rounded-xl border border-amber-300/70 bg-amber-50/80 px-4 py-3 text-xs text-amber-900 dark:border-amber-400/25 dark:bg-amber-950/40 dark:text-amber-200">
                  正文内容未发生变化，本次提交仅更新了文章元信息（Frontmatter），可切换至「源码对比」查看具体字段差异。
                </div>
              )}

              {/* 渲染差异主体 */}
              <div className="space-y-4">
                {hunks.map((hunk, hunkIdx) => {
                  if (hunk.type === 'equal') {
                    return (
                      <UnchangedSection
                        key={`equal-${hunkIdx}`}
                        blocks={hunk.blocks}
                        collapsed={collapseUnchanged && !expandedGaps[hunkIdx]}
                        onExpand={() =>
                          setExpandedGaps((prev) => ({ ...prev, [hunkIdx]: true }))
                        }
                      />
                    )
                  }

                  changeCursor += 1
                  const currentChangeIndex = changeCursor

                  if (hunk.type === 'modify') {
                    return (
                      <section
                        key={`modify-${hunkIdx}`}
                        data-diff-change={currentChangeIndex}
                        className="scroll-mt-4 overflow-hidden rounded-xl border border-amber-300/75 border-l-[3px] border-l-amber-500 bg-white shadow-2xs dark:border-white/12 dark:border-l-amber-400 dark:bg-ink-900/75"
                      >
                        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-200/70 bg-amber-500/[0.06] px-4 py-2 text-xs dark:border-white/10 dark:bg-amber-400/[0.06]">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-[11px] font-semibold text-ink-400">
                              #{currentChangeIndex + 1}
                            </span>
                            <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-semibold text-amber-800 dark:text-amber-300">
                              修改段落
                            </span>
                          </div>
                          <span className="font-mono text-[11px] text-ink-400">
                            {formatLineRange('旧 L', hunk.oldStart, hunk.oldEnd)} →{' '}
                            {formatLineRange('新 L', hunk.newStart, hunk.newEnd)}
                          </span>
                        </header>

                        <div
                          className={
                            renderLayout === 'split'
                              ? 'grid grid-cols-1 divide-y divide-ink-200/70 lg:grid-cols-2 lg:divide-x lg:divide-y-0 dark:divide-white/10'
                              : 'divide-y divide-ink-200/70 dark:divide-white/10'
                          }
                        >
                          {/* 修改前（旧版） */}
                          <div className="min-w-0 bg-rose-500/[0.035] dark:bg-rose-500/[0.045]">
                            <div className="flex items-center justify-between border-b border-rose-200/50 bg-rose-500/[0.05] px-4 py-1.5 text-[11px] font-medium text-rose-700 dark:border-rose-400/15 dark:bg-rose-500/[0.08] dark:text-rose-300">
                              <span>− 修改前（基准版本）</span>
                              <span className="font-mono opacity-75">
                                {formatLineRange('L', hunk.oldStart, hunk.oldEnd)}
                              </span>
                            </div>
                            <div className="overflow-x-auto px-4 py-3 opacity-90">
                              <Markdown content={hunk.beforeText} />
                            </div>
                          </div>

                          {/* 修改后（新版） */}
                          <div className="min-w-0 bg-emerald-500/[0.035] dark:bg-emerald-500/[0.045]">
                            <div className="flex items-center justify-between border-b border-emerald-200/50 bg-emerald-500/[0.05] px-4 py-1.5 text-[11px] font-medium text-emerald-700 dark:border-emerald-400/15 dark:bg-emerald-500/[0.08] dark:text-emerald-300">
                              <span>+ 修改后（目标版本）</span>
                              <span className="font-mono opacity-75">
                                {formatLineRange('L', hunk.newStart, hunk.newEnd)}
                              </span>
                            </div>
                            <div className="overflow-x-auto px-4 py-3">
                              <Markdown content={hunk.afterText} />
                            </div>
                          </div>
                        </div>
                      </section>
                    )
                  }

                  if (hunk.type === 'insert') {
                    return (
                      <section
                        key={`insert-${hunkIdx}`}
                        data-diff-change={currentChangeIndex}
                        className="scroll-mt-4 overflow-hidden rounded-xl border border-emerald-300/75 border-l-[3px] border-l-emerald-500 bg-white shadow-2xs dark:border-emerald-400/25 dark:border-l-emerald-400 dark:bg-ink-900/75"
                      >
                        <header className="flex items-center justify-between gap-2 border-b border-emerald-200/60 bg-emerald-500/[0.07] px-4 py-2 text-xs dark:border-emerald-400/15 dark:bg-emerald-500/[0.09]">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-[11px] font-semibold text-ink-400">
                              #{currentChangeIndex + 1}
                            </span>
                            <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-semibold text-emerald-800 dark:text-emerald-300">
                              + 新增内容
                            </span>
                          </div>
                          <span className="font-mono text-[11px] text-emerald-700/80 dark:text-emerald-300/80">
                            {formatLineRange('新 L', hunk.newStart, hunk.newEnd)}
                          </span>
                        </header>
                        <div className="overflow-x-auto bg-emerald-500/[0.03] px-4 py-3 dark:bg-emerald-500/[0.04]">
                          <Markdown content={hunk.text} />
                        </div>
                      </section>
                    )
                  }

                  return (
                    <section
                      key={`delete-${hunkIdx}`}
                      data-diff-change={currentChangeIndex}
                      className="scroll-mt-4 overflow-hidden rounded-xl border border-rose-300/75 border-l-[3px] border-l-rose-500 bg-white shadow-2xs dark:border-rose-400/25 dark:border-l-rose-400 dark:bg-ink-900/75"
                    >
                      <header className="flex items-center justify-between gap-2 border-b border-rose-200/60 bg-rose-500/[0.07] px-4 py-2 text-xs dark:border-rose-400/15 dark:bg-rose-500/[0.09]">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-[11px] font-semibold text-ink-400">
                            #{currentChangeIndex + 1}
                          </span>
                          <span className="rounded-full bg-rose-500/15 px-2 py-0.5 text-[11px] font-semibold text-rose-800 dark:text-rose-300">
                            − 已删除内容
                          </span>
                        </div>
                        <span className="font-mono text-[11px] text-rose-700/80 dark:text-rose-300/80">
                          {formatLineRange('旧 L', hunk.oldStart, hunk.oldEnd)}
                        </span>
                      </header>
                      <div className="overflow-x-auto bg-rose-500/[0.03] px-4 py-3 opacity-85 dark:bg-rose-500/[0.04]">
                        <Markdown content={hunk.text} />
                      </div>
                    </section>
                  )
                })}
              </div>
            </div>
          ) : (
            <DiffTable lines={lines} onlyChanges={onlyChanges} />
          )}
        </div>
      </div>
    </div>
  )
}
