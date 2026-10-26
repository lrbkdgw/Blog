import type { KeyboardEvent } from 'react'

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

function removeIndent(line: string): string {
  if (line.startsWith('\t')) return line.slice(1)
  return line.replace(/^ {1,2}/, '')
}

/**
 * 对选区覆盖的整行缩进 / 反缩进。
 *
 * 光标在列表项中时也从行首调整缩进，而不是把两个空格插到 `- ` / `1. ` 后面；
 * 后者不会形成 Markdown 子列表，正是空白列表项按 Tab 无效的原因。
 */
function changeLineIndent(value: string, start: number, end: number, outdent: boolean): EditAction | null {
  const lineStart = value.lastIndexOf('\n', start - 1) + 1
  // 选区恰好结束在下一行行首时，不额外修改下一行。
  const effectiveEnd = end > start && value[end - 1] === '\n' ? end - 1 : end
  const lineEndIdx = value.indexOf('\n', effectiveEnd)
  const lineEnd = lineEndIdx === -1 ? value.length : lineEndIdx
  const block = value.slice(lineStart, lineEnd)
  const lines = block.split('\n')
  const nextLines = lines.map((line) => (outdent ? removeIndent(line) : `  ${line}`))
  const nextBlock = nextLines.join('\n')
  if (nextBlock === block) return null

  const next = value.slice(0, lineStart) + nextBlock + value.slice(lineEnd)
  if (start !== end) {
    return {
      value: next,
      selectionStart: lineStart,
      selectionEnd: lineEnd + nextBlock.length - block.length,
    }
  }

  const delta = nextLines[0].length - lines[0].length
  const caret = Math.max(lineStart, Math.min(lineStart + nextLines[0].length, start + delta))
  return { value: next, selectionStart: caret, selectionEnd: caret }
}

function lineBounds(value: string, caret: number): { start: number; end: number } {
  const start = value.lastIndexOf('\n', caret - 1) + 1
  const newline = value.indexOf('\n', caret)
  return { start, end: newline === -1 ? value.length : newline }
}

/** 编辑器内的 Tab / 引用与列表自动续行等按键处理 */
export function handleEditorKey(
  e: KeyboardEvent<HTMLTextAreaElement>,
): EditAction | null {
  const ta = e.currentTarget
  const { value, selectionStart: start, selectionEnd: end } = ta
  if (e.nativeEvent.isComposing) return null

  if (e.key === 'Tab') {
    e.preventDefault()
    const bounds = lineBounds(value, start)
    const currentLine = value.slice(bounds.start, bounds.end)
    const inList = /^\s*(?:[-*+]|\d+\.)\s+(?:\[[ xX]\]\s+)?/.test(currentLine)

    if (start !== end || e.shiftKey || inList) {
      return changeLineIndent(value, start, end, e.shiftKey)
    }
    return {
      value: value.slice(0, start) + '  ' + value.slice(end),
      selectionStart: start + 2,
      selectionEnd: start + 2,
    }
  }

  if (e.key === 'Enter' && !e.shiftKey && start === end) {
    const lineStart = value.lastIndexOf('\n', start - 1) + 1
    const line = value.slice(lineStart, start)

    // 引用可包含列表。保留用户已有的嵌套引用写法（>、>>、> > 等）及列表缩进。
    const quote = line.match(/^\s*(?:>\s?)+/)?.[0] ?? ''
    const afterQuote = line.slice(quote.length)
    const list = afterQuote.match(/^(\s*)([-*+]\s+\[[ xX]\]\s+|[-*+]\s+|(\d+)\.\s+)/)
    if (!quote && !list) return null

    e.preventDefault()
    if (list) {
      const [, indent, marker, num] = list
      const itemContent = afterQuote.slice(list[0].length)
      // 空列表项 → 结束列表；引用中的空列表项先退回普通引用行。
      if (itemContent.trim() === '') {
        const kept = quote
        const next = value.slice(0, lineStart) + kept + value.slice(start)
        const pos = lineStart + kept.length
        return { value: next, selectionStart: pos, selectionEnd: pos }
      }
      const nextMarker = num ? `${Number(num) + 1}. ` : marker.replace(/\[[xX]\]/, '[ ]')
      const insert = `\n${quote}${indent}${nextMarker}`
      const next = value.slice(0, start) + insert + value.slice(end)
      const pos = start + insert.length
      return { value: next, selectionStart: pos, selectionEnd: pos }
    }

    // 空引用行 → 结束引用；普通引用行 → 新行自动延续相同引用层级。
    if (afterQuote.trim() === '') {
      const next = value.slice(0, lineStart) + value.slice(start)
      return { value: next, selectionStart: lineStart, selectionEnd: lineStart }
    }
    const insert = `\n${quote}`
    const next = value.slice(0, start) + insert + value.slice(end)
    const pos = start + insert.length
    return { value: next, selectionStart: pos, selectionEnd: pos }
  }

  return null
}
