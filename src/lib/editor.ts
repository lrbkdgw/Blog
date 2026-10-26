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

/** 行首的列表 / 任务项标记（含缩进）：`- `、`1. `、`- [ ] ` */
function listMarker(line: string): { indent: string; marker: string; number?: string } | null {
  const m = line.match(/^(\s*)([-*+]\s\[[ x]\]\s|[-*+]\s|(\d+)\.\s)/)
  if (!m) return null
  return { indent: m[1], marker: m[2], number: m[3] }
}

/**
 * 列表块的缩进 / 反缩进（issue #111）：Tab 缩进一个层级，Shift+Tab 反缩进。
 *
 * 只调整「列表标记前的缩进」，于是 `- a` 与 `  - b` 会形成真正的嵌套层级，
 * 而不是像整块加两个空格那样只改变视觉留白；选区里夹着的非列表行原样保留。
 * 整块都没有列表标记时返回 null，由调用方退回其它缩进方式。
 */
export function indentListBlock(
  value: string,
  start: number,
  end: number,
  delta: number,
): EditAction | null {
  const lineStart = value.lastIndexOf('\n', start - 1) + 1
  const lineEndIdx = value.indexOf('\n', end)
  const lineEnd = lineEndIdx === -1 ? value.length : lineEndIdx
  const block = value.slice(lineStart, lineEnd)
  const lines = block.split('\n')
  const nextLines = lines.map((line) => {
    const marker = listMarker(line)
    if (!marker) return line
    const indent = Math.max(0, marker.indent.length + delta)
    return ' '.repeat(indent) + line.slice(marker.indent.length)
  })
  if (nextLines.every((line, index) => line === lines[index])) return null
  const nextBlock = nextLines.join('\n')
  const next = value.slice(0, lineStart) + nextBlock + value.slice(lineEnd)

  // 把原选区映射到缩进之后的位置：行首缩进变了，行内相对位置要保住，
  // 否则光标会「跳回行首」，多行选区也会错位。
  const oldLineStarts: number[] = []
  let oldCursor = lineStart
  for (const line of lines) {
    oldLineStarts.push(oldCursor)
    oldCursor += line.length + 1
  }
  const newLineStarts: number[] = []
  let newCursor = lineStart
  for (const line of nextLines) {
    newLineStarts.push(newCursor)
    newCursor += line.length + 1
  }
  const mapOffset = (offset: number): number => {
    const bounded = Math.max(lineStart, Math.min(lineEnd, offset))
    let index = 0
    while (index < lines.length - 1 && oldLineStarts[index + 1] <= bounded) index += 1
    const shift = nextLines[index].length - lines[index].length
    const local = Math.min(lines[index].length, bounded - oldLineStarts[index]) + shift
    return newLineStarts[index] + Math.max(0, Math.min(nextLines[index].length, local))
  }
  return { value: next, selectionStart: mapOffset(start), selectionEnd: mapOffset(end) }
}

/**
 * 光标停在列表里的空行上时按 Tab：把这一空行续成上一层列表项。
 *
 * 这是「在空白行的无序列表 / 有序列表中按 Tab」的常见手感：空行本身没有标记，
 * 但只要它夹在列表里，Tab 就应该把它变成这一层的列表项，而不是只加两个空格。
 */
function continueListOnBlankLine(value: string, start: number): EditAction | null {
  const lineStart = value.lastIndexOf('\n', start - 1) + 1
  if (value.slice(lineStart, start).trim() !== '') return null
  const prevStart = value.lastIndexOf('\n', lineStart - 2) + 1
  const marker = listMarker(value.slice(prevStart, lineStart))
  if (!marker) return null
  const insert = `${marker.indent}  ${marker.marker}`
  const next = value.slice(0, lineStart) + insert + value.slice(start)
  return { value: next, selectionStart: lineStart + insert.length, selectionEnd: lineStart + insert.length }
}

/** 编辑器内的 Tab / 列表自动续行等按键处理 */
export function handleEditorKey(
  e: React.KeyboardEvent<HTMLTextAreaElement>,
): EditAction | null {
  const ta = e.currentTarget
  const { value, selectionStart: start, selectionEnd: end } = ta

  if (e.key === 'Tab') {
    e.preventDefault()
    if (e.shiftKey) {
      // Shift+Tab：列表块按层级反缩进，其余情况整块减两个空格
      const list = indentListBlock(value, start, end, -2)
      if (list) return list
      return toggleLinePrefix(value, start, end, '  ')
    }
    // Tab：光标在列表里就按列表层级缩进，在列表的空行上则续成列表项
    const list = indentListBlock(value, start, end, 2)
    if (list) return list
    if (start === end) {
      const blank = continueListOnBlankLine(value, start)
      if (blank) return blank
    } else if (start !== end) {
      return toggleLinePrefix(value, start, end, '  ')
    }
    return { value: value.slice(0, start) + '  ' + value.slice(end), selectionStart: start + 2, selectionEnd: start + 2 }
  }

  if (e.key === 'Enter' && !e.shiftKey && start === end) {
    const lineStart = value.lastIndexOf('\n', start - 1) + 1
    const line = value.slice(lineStart, start)
    const marker = listMarker(line)
    if (marker) {
      // 空列表项 → 结束列表
      if (line.trim() === marker.marker.trim()) {
        const next = value.slice(0, lineStart) + value.slice(start)
        return { value: next, selectionStart: lineStart, selectionEnd: lineStart }
      }
      e.preventDefault()
      const nextMarker = marker.number ? `${Number(marker.number) + 1}. ` : marker.marker.replace('[x]', '[ ]')
      const insert = `\n${marker.indent}${nextMarker}`
      const next = value.slice(0, start) + insert + value.slice(end)
      const pos = start + insert.length
      return { value: next, selectionStart: pos, selectionEnd: pos }
    }

    // 引用：在引用块内换行自动续上引用标记（issue #111），
    // 引用里还套着列表时，列表的自动续行同样照常工作。
    const quote = line.match(/^(\s*(?:>\s*)+)(.*)$/)
    if (quote) {
      const [, quotePrefix, body] = quote
      const innerMarker = listMarker(quotePrefix.length ? line.slice(quotePrefix.length) : '')
      if (innerMarker && body.trim() !== innerMarker.marker.trim()) {
        e.preventDefault()
        const nextMarker = innerMarker.number
          ? `${Number(innerMarker.number) + 1}. `
          : innerMarker.marker.replace('[x]', '[ ]')
        const insert = `\n${quotePrefix}${nextMarker}`
        const next = value.slice(0, start) + insert + value.slice(end)
        const pos = start + insert.length
        return { value: next, selectionStart: pos, selectionEnd: pos }
      }
      if (body.trim() !== '') {
        e.preventDefault()
        const insert = `\n${quotePrefix}`
        const next = value.slice(0, start) + insert + value.slice(end)
        const pos = start + insert.length
        return { value: next, selectionStart: pos, selectionEnd: pos }
      }
    }
  }

  return null
}
