import { GitCompareArrows, Minus, Plus } from 'lucide-react'
import type { RenderedDiffChunk } from '../lib/diff'
import { Markdown } from './Markdown'

/**
 * 历史版本的单栏渲染对比。
 *
 * 保留「只展示对比目标版本」的阅读方式：未修改正文保持纸张式排版，
 * 新增 / 删除块则变成带文字标签、左侧色条和轻柔底色的独立卡片。
 */
export function RenderedDiff({
  chunks,
  targetLabel,
  bodyIdentical,
}: {
  chunks: RenderedDiffChunk[]
  targetLabel: string
  /** 源码有差异（例如 frontmatter），但正文渲染完全一致 */
  bodyIdentical: boolean
}) {
  const added = chunks.filter((chunk) => chunk.type === 'insert').length
  const removed = chunks.filter((chunk) => chunk.type === 'delete').length

  return (
    <div className="min-h-full bg-ink-100/35 px-3 py-4 dark:bg-black/10 sm:px-6 sm:py-7">
      <section
        className="relative mx-auto max-w-3xl overflow-hidden rounded-2xl border border-ink-200/80 bg-white shadow-[0_18px_60px_-32px_rgba(15,23,42,0.35)] dark:border-white/10 dark:bg-ink-900/75 dark:shadow-black/30"
        data-rendered-diff
      >
        <div className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-brand-400/70 via-violet-400/60 to-emerald-400/70" />

        <header className="border-b border-ink-200/70 bg-gradient-to-br from-brand-500/[0.055] via-transparent to-violet-500/[0.045] px-4 py-4 dark:border-white/10 sm:px-6">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-500/10 text-brand-600 ring-1 ring-brand-500/10 dark:text-brand-300">
              <GitCompareArrows size={17} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium tracking-wide text-ink-400">较新版本 · 正文渲染</p>
              <p className="mt-0.5 truncate text-sm font-semibold text-ink-800 dark:text-ink-100" title={targetLabel}>
                {targetLabel}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1.5 font-mono text-[11px] font-semibold">
              <span className="rounded-full bg-emerald-500/10 px-2 py-1 text-emerald-700 dark:text-emerald-300">
                +{added} 段
              </span>
              <span className="rounded-full bg-rose-500/10 px-2 py-1 text-rose-700 dark:text-rose-300">
                −{removed} 段
              </span>
            </div>
          </div>
        </header>

        {bodyIdentical && (
          <div className="border-b border-ink-200/60 bg-brand-500/[0.035] px-5 py-3 text-center text-xs leading-relaxed text-ink-500 dark:border-white/10 dark:text-ink-400">
            正文渲染完全一致；差异只存在于标题、标签或其他文章信息中。
          </div>
        )}

        <div className="px-3 py-4 sm:px-6 sm:py-6">
          {chunks.map((chunk, index) => {
            if (chunk.type === 'equal') {
              return (
                <div key={`equal-${index}`} className="py-1" data-render-diff="equal">
                  <Markdown content={chunk.text} />
                </div>
              )
            }

            const inserted = chunk.type === 'insert'
            return (
              <section
                key={`${chunk.type}-${index}`}
                data-render-diff={chunk.type}
                className={`relative my-5 overflow-hidden rounded-xl border first:mt-0 last:mb-0 ${
                  inserted
                    ? 'border-emerald-300/65 bg-emerald-500/[0.055] dark:border-emerald-400/25 dark:bg-emerald-400/[0.045]'
                    : 'border-rose-300/65 bg-rose-500/[0.045] dark:border-rose-400/25 dark:bg-rose-400/[0.04]'
                }`}
              >
                <span
                  aria-hidden="true"
                  className={`absolute inset-y-0 left-0 w-1 ${inserted ? 'bg-emerald-400/80' : 'bg-rose-400/80'}`}
                />
                <header
                  className={`flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-4 py-2 ${
                    inserted
                      ? 'border-emerald-300/45 dark:border-emerald-400/15'
                      : 'border-rose-300/45 dark:border-rose-400/15'
                  }`}
                >
                  <span
                    className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                      inserted
                        ? 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300'
                        : 'bg-rose-500/12 text-rose-700 dark:text-rose-300'
                    }`}
                  >
                    {inserted ? <Plus size={12} /> : <Minus size={12} />}
                    {inserted ? '新增内容' : '删除内容'}
                  </span>
                  <span className="text-[11px] text-ink-400">
                    {inserted ? '已加入较新版本' : '较新版本中已移除'}
                  </span>
                </header>
                <div className={`px-3 py-1 sm:px-5 ${inserted ? '' : 'opacity-70'}`}>
                  <Markdown content={chunk.text} />
                </div>
              </section>
            )
          })}
        </div>

        <footer className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 border-t border-ink-200/60 bg-ink-50/55 px-4 py-3 text-[11px] text-ink-400 dark:border-white/10 dark:bg-white/[0.025]">
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-emerald-400" /> 绿色块为新增
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-rose-400" /> 红色块为已删除
          </span>
          <span>未着色正文保持不变</span>
        </footer>
      </section>
    </div>
  )
}
