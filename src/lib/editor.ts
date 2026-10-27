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

/** 编辑器内的 Tab / 列表自动续行等按键处理 */
export function handleEditorKey(
  e: React.KeyboardEvent<HTMLTextAreaElement>,
): EditAction | null {
  const ta = e.currentTarget
  const { value, selectionStart: start, selectionEnd: end } = ta

  if (e.key === 'Tab') {
    e.preventDefault()
    if (start !== end || e.shiftKey) {
      return toggleLinePrefix(value, start, end, '  ')
    }
    return { value: value.slice(0, start) + '  ' + value.slice(end), selectionStart: start + 2, selectionEnd: start + 2 }
  }

  if (e.key === 'Enter' && !e.shiftKey && start === end) {
    const lineStart = value.lastIndexOf('\n', start - 1) + 1
    const line = value.slice(lineStart, start)
    const m = line.match(/^(\s*)([-*+]\s\[[ x]\]\s|[-*+]\s|(\d+)\.\s)/)
    if (m) {
      const [, indent, marker, num] = m
      // 空列表项 → 结束列表
      if (line.trim() === marker.trim()) {
        const next = value.slice(0, lineStart) + value.slice(start)
        return { value: next, selectionStart: lineStart, selectionEnd: lineStart }
      }
      e.preventDefault()
      const nextMarker = num ? `${Number(num) + 1}. ` : marker.replace('[x]', '[ ]')
      const insert = `\n${indent}${nextMarker}`
      const next = value.slice(0, start) + insert + value.slice(end)
      const pos = start + insert.length
      return { value: next, selectionStart: pos, selectionEnd: pos }
    }
  }

  return null
}
