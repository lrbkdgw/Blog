import { useMemo } from 'react'
import { collapseContext } from '../lib/diff'
import type { DiffLine } from '../lib/diff'

/**
 * 行级差异表格：历史版本对比与「待更新队列」的 diff 预览共用。
 *
 * 同一份渲染逻辑放在这里，避免两个入口的增删配色、行号与上下文折叠行为不一致。
 */
export function DiffTable({
  lines,
  onlyChanges,
  context = 3,
}: {
  lines: DiffLine[]
  /** 只显示差异附近的内容（默认 true，与历史对比的默认行为一致） */
  onlyChanges?: boolean
  context?: number
}) {
  const rows = useMemo(
    () => (onlyChanges === false ? lines : collapseContext(lines, context)),
    [lines, onlyChanges, context],
  )

  return (
    <table className="w-full border-collapse font-mono text-[12.5px] leading-relaxed">
      <tbody>
        {rows.map((row, index) =>
          row.type === 'skip' ? (
            <tr key={`skip-${index}`}>
              <td
                colSpan={3}
                className="bg-ink-100/70 px-3 py-1 text-center text-[11px] text-ink-400 dark:bg-white/[0.04]"
              >
                … 省略 {row.count} 行未改动内容 …
              </td>
            </tr>
          ) : (
            <DiffRow key={`line-${index}`} line={row} />
          ),
        )}
      </tbody>
    </table>
  )
}

export function DiffRow({ line }: { line: DiffLine }) {
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
