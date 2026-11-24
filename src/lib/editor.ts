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

const QUOTE_PREFIX = /^(?:[ \t]{0,3}>[ \t]?)+/
const LIST_MARKER = /^([ \t]*)([-+*]|\d{1,9}[.)])(?:([ \t]+)(\[[ xX]\](?=[ \t]|$)[ \t]*)?|$)/

function readListItem(line: string) {
  const match = LIST_MARKER.exec(line)
  if (!match) return null
  const [prefix, indent, marker, gap = '', task] = match
  // 子项对齐父项正文；任务复选框不计入标记宽度。
  const contentOffset = marker.length + (gap.length >= 1 && gap.length <= 4 ? gap.length : 1)
  return { prefix, indent, marker, task, contentOffset }
}

function listIndentChange(
  value: string,
  lineStart: number,
  quote: string,
  item: NonNullable<ReturnType<typeof readListItem>>,
  outdent: boolean,
) {
  const deeper = new Map<number, string>()
  const depth = quote.split('>').length
  for (let end = lineStart - 1; end >= 0;) {
    const start = end === 0 ? 0 : value.lastIndexOf('\n', end - 1) + 1
    const line = value.slice(start, end)
    const prefix = QUOTE_PREFIX.exec(line)?.[0] ?? ''
    if (prefix.split('>').length !== depth) break
    const body = line.slice(prefix.length)
    const previous = readListItem(body)
    const indent = (previous?.indent ?? /^[ \t]*/.exec(body)![0]).length
    if (previous && indent > item.indent.length && !deeper.has(indent)) deeper.set(indent, previous.marker)
    if (body.trim() && indent <= item.indent.length) {
      if (outdent ? indent < item.indent.length : indent === item.indent.length) {
        if (previous) return outdent
          ? { size: item.indent.length - indent, previousMarker: previous.marker }
          : { size: previous.contentOffset, previousMarker: deeper.get(indent + previous.contentOffset) ?? '' }
        break
      }
      if (!outdent || !previous) break
    }
    end = start - 1
  }
  return { size: outdent ? Math.min(item.indent.length, item.contentOffset) : item.contentOffset }
}

function nextListMarker(marker: string, previous: string): string {
  const number = /^(\d+)([.)])$/.exec(marker)
  if (!number) return marker
  const preceding = /^(\d+)([.)])$/.exec(previous)
  const next = preceding?.[2] === number[2] ? Math.min(Number(preceding[1]) + 1, 999999999) : 1
  return String(next) + number[2]
}

/** 编辑器内的 Tab、列表与引用续行 */
export function handleEditorKey(
  e: React.KeyboardEvent<HTMLTextAreaElement>,
): EditAction | null {
  if (e.nativeEvent?.isComposing || e.altKey || e.ctrlKey || e.metaKey) return null
  const { value, selectionStart: start, selectionEnd: end } = e.currentTarget
  if (e.key !== 'Tab' && !(e.key === 'Enter' && !e.shiftKey && start === end)) return null

  const lineStart = start === 0 ? 0 : value.lastIndexOf('\n', start - 1) + 1
  const nextNewline = value.indexOf('\n', start)
  const lineEnd = nextNewline === -1 ? value.length : nextNewline
  const line = value.slice(lineStart, lineEnd)
  const quote = QUOTE_PREFIX.exec(line)?.[0] ?? ''
  const itemStart = lineStart + quote.length
  const body = line.slice(quote.length)
  const item = readListItem(body)

  function replace(from: number, to: number, text: string, cursor = from + text.length): EditAction {
    e.preventDefault()
    return { value: value.slice(0, from) + text + value.slice(to), selectionStart: cursor, selectionEnd: cursor }
  }

  if (e.key === 'Tab') {
    if (start === end && item) {
      const { size, previousMarker } = listIndentChange(value, lineStart, quote, item, e.shiftKey)
      if (!size) {
        e.preventDefault()
        return null
      }
      const indent = e.shiftKey ? item.indent.slice(size) : item.indent + ' '.repeat(size)
      // 新有序子列表从 1 开始，才能直接接在父项正文后面。
      const marker = previousMarker === undefined ? item.marker : nextListMarker(item.marker, previousMarker)
      const oldMarkerEnd = itemStart + item.indent.length + item.marker.length
      const newMarkerEnd = itemStart + indent.length + marker.length
      const cursor = start < itemStart ? start : Math.max(itemStart, newMarkerEnd + start - oldMarkerEnd)
      return replace(itemStart, oldMarkerEnd, indent + marker, cursor)
    }
    if (start !== end || e.shiftKey) {
      e.preventDefault()
      return toggleLinePrefix(value, start, end, '  ')
    }
    return replace(start, end, '  ')
  }

  const quotePrefix = quote && !/[ \t]$/.test(quote) ? quote + ' ' : quote
  if (item && start >= itemStart + item.prefix.trimEnd().length) {
    if (!body.slice(item.prefix.length).trim()) return replace(lineStart, lineEnd, quotePrefix)
    if (start < itemStart + item.prefix.length) return null
    const marker = nextListMarker(item.marker, item.marker)
    return replace(start, end, '\n' + quotePrefix + item.indent + marker + (item.task ? ' [ ] ' : ' '))
  }

  if (quote && start >= lineStart + quote.trimEnd().length) {
    if (!body.trim()) {
      const outer = quote.slice(0, quote.lastIndexOf('>'))
      return replace(lineStart, lineEnd, outer.includes('>') ? outer : '')
    }
    if (start >= itemStart) return replace(start, end, '\n' + quotePrefix)
  }

  return null
}
