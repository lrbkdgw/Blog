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
    const lineStart = value.lastIndexOf('\n', start - 1) + 1
    const lineEndIndex = value.indexOf('\n', end)
    const lineEnd = lineEndIndex === -1 ? value.length : lineEndIndex
    const currentLine = value.slice(lineStart, lineEnd)

    // 在列表项后面的空白行按 Tab，创建真正的嵌套列表项，而不是只插入空格。
    // 这使得继续输入时 Markdown 能识别为二级列表，且编号列表也能正常续写。
    if (start === end && !e.shiftKey && lineStart > 0 && /^\s*$/.test(currentLine)) {
      const previousLineEnd = lineStart - 1
      const previousLineStart = value.lastIndexOf('\n', previousLineEnd - 1) + 1
      const previousLine = value.slice(previousLineStart, previousLineEnd)
      const parent = previousLine.match(/^(\s*)([-*+]\s(?:\[[ x]\]\s)?|\d+\.\s).+$/)
      if (parent) {
        const marker = /^\d+\./.test(parent[2]) ? '1. ' : parent[2].includes('[') ? '- [ ] ' : '- '
        const indent = `${parent[1]}  `
        const replacement = `${indent}${marker}`
        const next = value.slice(0, lineStart) + replacement + value.slice(lineEnd)
        const cursor = lineStart + replacement.length
        return { value: next, selectionStart: cursor, selectionEnd: cursor }
      }
    }

    // Tab 缩进当前行/选区；Shift+Tab 只撤销缩进，不能在未缩进时反向缩进。
    const firstLine = value.lastIndexOf('\n', start - 1) + 1
    const lastLineIndex = value.indexOf('\n', end)
    const lastLine = lastLineIndex === -1 ? value.length : lastLineIndex
    const block = value.slice(firstLine, lastLine)
    const lines = block.split('\n')
    const nextLines = lines.map((line) => {
      if (!e.shiftKey) return `  ${line}`
      return line.startsWith('  ') ? line.slice(2) : line.startsWith('\t') ? line.slice(1) : line
    })
    const nextBlock = nextLines.join('\n')
    const next = value.slice(0, firstLine) + nextBlock + value.slice(lastLine)
    const selectionStart = Math.min(next.length, start + (e.shiftKey ? -Math.min(2, value.slice(firstLine, start).match(/^ {0,2}/)?.[0].length ?? 0) : 2))
    const selectionEnd = Math.max(selectionStart, end + nextBlock.length - block.length)
    return { value: next, selectionStart, selectionEnd }
  }

  if (e.key === 'Enter' && !e.shiftKey && start === end) {
    const lineStart = value.lastIndexOf('\n', start - 1) + 1
    const line = value.slice(lineStart, start)
    const m = line.match(/^(\s*)([-*+]\s\[[ x]\]\s|[-*+]\s|(\d+)\.\s)/)
    if (m) {
      const [, indent, marker, num] = m
      // 空列表项 → 结束列表
      if (line.trim() === marker.trim()) {
        e.preventDefault()
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

    // 引用块续行；空引用行再次回车则退出引用。
    const quote = line.match(/^(\s*(?:>\s*)+)/)
    if (quote) {
      const prefix = quote[1]
      if (line.slice(prefix.length).trim() === '') {
        e.preventDefault()
        const next = value.slice(0, lineStart) + value.slice(start)
        return { value: next, selectionStart: lineStart, selectionEnd: lineStart }
      }
      e.preventDefault()
      const insert = `\n${prefix}`
      const next = value.slice(0, start) + insert + value.slice(end)
      const cursor = start + insert.length
      return { value: next, selectionStart: cursor, selectionEnd: cursor }
    }
  }

  return null
}
