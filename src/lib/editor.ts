export interface EditAction {
  value: string
  selectionStart: number
  selectionEnd: number
}

/** 在选区两侧插入标记（已存在则取消） */
export function toggleWrap(
  value: string,
  start: number,
  end: number,
  before: string,
  after = before,
  placeholder = '',
): EditAction {
  const selected = value.slice(start, end) || placeholder
  const hasWrap =
    value.slice(Math.max(0, start - before.length), start) === before &&
    value.slice(end, end + after.length) === after

  if (hasWrap) {
    const next = value.slice(0, start - before.length) + selected + value.slice(end + after.length)
    return { value: next, selectionStart: start - before.length, selectionEnd: end - before.length }
  }

  const next = value.slice(0, start) + before + selected + after + value.slice(end)
  return {
    value: next,
    selectionStart: start + before.length,
    selectionEnd: start + before.length + selected.length,
  }
}

/** 给选中的每一行加上前缀（已存在则移除） */
export function toggleLinePrefix(value: string, start: number, end: number, prefix: string): EditAction {
  const lineStart = value.lastIndexOf('\n', start - 1) + 1
  const lineEndIdx = value.indexOf('\n', end)
  const lineEnd = lineEndIdx === -1 ? value.length : lineEndIdx
  const block = value.slice(lineStart, lineEnd)
  const lines = block.split('\n')
  const allPrefixed = lines.every((l) => l.startsWith(prefix))
  const nextLines = lines.map((l) => (allPrefixed ? l.slice(prefix.length) : prefix + l))
  const nextBlock = nextLines.join('\n')
  const next = value.slice(0, lineStart) + nextBlock + value.slice(lineEnd)
  const delta = nextBlock.length - block.length
  return { value: next, selectionStart: lineStart, selectionEnd: lineEnd + delta }
}

/** 在光标处插入文本块 */
export function insertBlock(value: string, start: number, end: number, text: string): EditAction {
  const needsNlBefore = start > 0 && value[start - 1] !== '\n'
  const prefix = needsNlBefore ? '\n\n' : ''
  const body = prefix + text
  const next = value.slice(0, start) + body + value.slice(end)
  return { value: next, selectionStart: start + body.length, selectionEnd: start + body.length }
}

/** 匹配整行是否为列表项（无序 / 有序 / 任务列表） */
const LIST_LINE_RE = /^\s*(?:[-*+]\s(?:\[[ x]\]\s)?|\d+\.\s)/

/** 编辑器内的 Tab / 列表自动续行 / 引用续行等按键处理 */
export function handleEditorKey(
  e: React.KeyboardEvent<HTMLTextAreaElement>,
): EditAction | null {
  const ta = e.currentTarget
  const { value, selectionStart: start, selectionEnd: end } = ta

  if (e.key === 'Tab') {
    e.preventDefault()
    // 有选区：对选中的每一行整体加 / 减缩进，保持原行为
    if (start !== end) {
      return toggleLinePrefix(value, start, end, '  ')
    }

    const lineStart = value.lastIndexOf('\n', start - 1) + 1
    const lineEndIdx = value.indexOf('\n', start)
    const lineEnd = lineEndIdx === -1 ? value.length : lineEndIdx
    const line = value.slice(lineStart, lineEnd)

    // 光标位于列表项（包括没有正文的空列表项）：Tab 缩进 / Shift+Tab 反缩进。
    // 整项移动，空列表项也能正确降级为子列表，而不是在标记后插入空格（issue #111）。
    if (LIST_LINE_RE.test(line)) {
      if (e.shiftKey) {
        const leading = line.match(/^\s*/)?.[0].length ?? 0
        const remove = Math.min(2, leading)
        if (remove === 0) return null
        const next = value.slice(0, lineStart) + value.slice(lineStart + remove)
        const pos = Math.max(lineStart, start - remove)
        return { value: next, selectionStart: pos, selectionEnd: pos }
      }
      const next = value.slice(0, lineStart) + '  ' + value.slice(lineStart)
      return { value: next, selectionStart: start + 2, selectionEnd: start + 2 }
    }

    // 普通行 Shift+Tab：沿用整行前缀切换；Tab：在光标处插入两个空格
    if (e.shiftKey) {
      return toggleLinePrefix(value, start, end, '  ')
    }
    return { value: value.slice(0, start) + '  ' + value.slice(end), selectionStart: start + 2, selectionEnd: start + 2 }
  }

  if (e.key === 'Enter' && !e.shiftKey && start === end) {
    const lineStart = value.lastIndexOf('\n', start - 1) + 1
    const lineEndIdx = value.indexOf('\n', start)
    const lineEnd = lineEndIdx === -1 ? value.length : lineEndIdx
    const fullLine = value.slice(lineStart, lineEnd)
    const line = value.slice(lineStart, start)

    // —— 引用内列表（`> - foo` / `> 1. foo` / `> - [ ] foo`，含嵌套引用 `> > - foo`）——
    // 先于纯列表与纯引用处理：回车要同时续上引用前缀与列表标记。
    const quoteList = line.match(/^(\s*(?:>\s?)+)(\s*)([-*+]\s\[[ x]\]\s|[-*+]\s|(\d+)\.\s)/)
    if (quoteList) {
      const [, rawQuotePrefix, indent, marker, num] = quoteList
      const quotePrefix = rawQuotePrefix.endsWith(' ') ? rawQuotePrefix : `${rawQuotePrefix} `
      // 空的引用列表项：先退出列表、保留引用（`> - ` → `> `），下一步再退出引用
      if (fullLine.trim() === `${rawQuotePrefix}${indent}${marker}`.trim()) {
        const next = value.slice(0, lineStart) + quotePrefix + value.slice(lineEnd)
        const pos = lineStart + quotePrefix.length
        return { value: next, selectionStart: pos, selectionEnd: pos }
      }
      e.preventDefault()
      const nextMarker = num ? `${Number(num) + 1}. ` : marker.replace('[x]', '[ ]')
      const insert = `\n${quotePrefix}${indent}${nextMarker}`
      const next = value.slice(0, start) + insert + value.slice(end)
      const pos = start + insert.length
      return { value: next, selectionStart: pos, selectionEnd: pos }
    }

    const m = line.match(/^(\s*)([-*+]\s\[[ x]\]\s|[-*+]\s|(\d+)\.\s)/)
    if (m) {
      const [, indent, marker, num] = m
      // 空列表项 → 结束列表（按整行判断：行中回车只拆分，不误退出）
      if (fullLine.trim() === marker.trim()) {
        const next = value.slice(0, lineStart) + value.slice(lineEnd)
        return { value: next, selectionStart: lineStart, selectionEnd: lineStart }
      }
      e.preventDefault()
      const nextMarker = num ? `${Number(num) + 1}. ` : marker.replace('[x]', '[ ]')
      const insert = `\n${indent}${nextMarker}`
      const next = value.slice(0, start) + insert + value.slice(end)
      const pos = start + insert.length
      return { value: next, selectionStart: pos, selectionEnd: pos }
    }

    // 引用块内回车：自动补上引用前缀续行；空引用行回车则逐级退出（issue #111）
    // 支持嵌套引用（`> > foo`）：续行保留全部层级，空行只退一层。
    const quote = line.match(/^(\s*(?:>\s?)+)(.*)$/)
    if (quote) {
      const [, rawPrefix] = quote
      // 续行前缀统一以空格结尾（`>foo` 也续成 `> `，避免无空格的引用）
      const quotePrefix = rawPrefix.endsWith(' ') ? rawPrefix : `${rawPrefix} `
      if (fullLine.trim() === rawPrefix.trim()) {
        // 空引用行：退一层（`> > ` → `> `，`> ` → ``）
        const levels = rawPrefix.match(/>/g)?.length ?? 1
        if (levels <= 1) {
          const next = value.slice(0, lineStart) + value.slice(lineEnd)
          return { value: next, selectionStart: lineStart, selectionEnd: lineStart }
        }
        const nextPrefix = rawPrefix.replace(/>\s?$/, '')
        const next = value.slice(0, lineStart) + nextPrefix + value.slice(lineEnd)
        const pos = lineStart + nextPrefix.length
        return { value: next, selectionStart: pos, selectionEnd: pos }
      }
      e.preventDefault()
      const insert = `\n${quotePrefix}`
      const next = value.slice(0, start) + insert + value.slice(end)
      const pos = start + insert.length
      return { value: next, selectionStart: pos, selectionEnd: pos }
    }
  }

  return null
}
