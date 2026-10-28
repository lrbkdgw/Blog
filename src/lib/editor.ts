import type React from 'react'

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
  const rawSelected = value.slice(start, end)
  const hasOuterWrap =
    start >= before.length &&
    value.slice(start - before.length, start) === before &&
    value.slice(end, end + after.length) === after

  if (hasOuterWrap) {
    const next = value.slice(0, start - before.length) + rawSelected + value.slice(end + after.length)
    return {
      value: next,
      selectionStart: start - before.length,
      selectionEnd: end - before.length,
    }
  }

  if (
    start !== end &&
    rawSelected.length >= before.length + after.length &&
    rawSelected.startsWith(before) &&
    rawSelected.endsWith(after)
  ) {
    const inner = rawSelected.slice(before.length, rawSelected.length - after.length)
    const next = value.slice(0, start) + inner + value.slice(end)
    return {
      value: next,
      selectionStart: start,
      selectionEnd: start + inner.length,
    }
  }

  const selected = rawSelected || placeholder
  const next = value.slice(0, start) + before + selected + after + value.slice(end)
  return {
    value: next,
    selectionStart: start + before.length,
    selectionEnd: start + before.length + selected.length,
  }
}

/** 给选中的每一行加上前缀（已存在则移除；单光标时保持光标折叠不选中前缀） */
export function toggleLinePrefix(value: string, start: number, end: number, prefix: string): EditAction {
  const lineStart = start === 0 ? 0 : value.lastIndexOf('\n', start - 1) + 1
  const effectiveEnd = end > start && value[end - 1] === '\n' ? end - 1 : end
  const lineEndIdx = value.indexOf('\n', effectiveEnd)
  const lineEnd = lineEndIdx === -1 ? value.length : lineEndIdx
  const block = value.slice(lineStart, lineEnd)
  const lines = block.split('\n')
  const allPrefixed = lines.every((l) => l.startsWith(prefix))
  const nextLines = lines.map((l) => (allPrefixed ? l.slice(prefix.length) : prefix + l))
  const nextBlock = nextLines.join('\n')
  const next = value.slice(0, lineStart) + nextBlock + value.slice(lineEnd)
  const delta = nextBlock.length - block.length

  if (start === end) {
    const singleDelta = allPrefixed ? -prefix.length : prefix.length
    const caret = Math.max(lineStart, Math.min(lineStart + nextBlock.length, start + singleDelta))
    return { value: next, selectionStart: caret, selectionEnd: caret }
  }

  const trailingNewlineOffset = end > effectiveEnd ? 1 : 0
  return {
    value: next,
    selectionStart: lineStart,
    selectionEnd: lineEnd + delta + trailingNewlineOffset,
  }
}

/** 在光标处插入文本块（空代码块自动将光标置于围栏内部） */
export function insertBlock(value: string, start: number, end: number, text: string): EditAction {
  const needsNlBefore = start > 0 && value[start - 1] !== '\n'
  const prefix = needsNlBefore ? '\n\n' : ''
  const body = prefix + text
  const next = value.slice(0, start) + body + value.slice(end)

  const emptyFenceMatch = text.match(/^(```[^\n]*\n)\n(```\n?)$/)
  if (emptyFenceMatch) {
    const caret = start + prefix.length + emptyFenceMatch[1].length
    return { value: next, selectionStart: caret, selectionEnd: caret }
  }

  const pos = start + body.length
  return { value: next, selectionStart: pos, selectionEnd: pos }
}

const LIST_LINE_RE = /^((?:\s*>\s*)*)(\s*)([-*+]\s+\[[ xX]\]\s+|[-*+]\s+|(\d+)\.\s+)(.*)$/

interface ParsedListLine {
  quotePrefix: string
  indent: string
  marker: string
  orderedNum: number | null
  rest: string
}

function parseListLine(line: string): ParsedListLine | null {
  const m = line.match(LIST_LINE_RE)
  if (!m) return null
  return {
    quotePrefix: m[1],
    indent: m[2].replace(/\t/g, '  '),
    marker: m[3],
    orderedNum: m[4] !== undefined ? Number(m[4]) : null,
    rest: m[5],
  }
}

function normalizeQuoteContinuation(rawQuote: string): string {
  return rawQuote.endsWith(' ') ? rawQuote : `${rawQuote} `
}

function dropOneQuoteLevel(rawQuote: string): string {
  const trimmedRight = rawQuote.replace(/\s+$/, '')
  const lastGt = trimmedRight.lastIndexOf('>')
  if (lastGt <= 0) return ''
  const outer = trimmedRight.slice(0, lastGt).replace(/\s+$/, '')
  if (!outer.includes('>')) return ''
  return `${outer} `
}

/** 向上查找同一引用层级内的列表行，用于推导缩进宽度与有序列表续号 */
function scanPrecedingListItems(allLines: string[], lineIdx: number, quoteKey: string): ParsedListLine[] {
  const items: ParsedListLine[] = []
  for (let i = lineIdx - 1; i >= 0; i--) {
    const raw = allLines[i]
    if (!raw.trim()) continue
    const parsed = parseListLine(raw)
    if (!parsed) break
    if (parsed.quotePrefix.replace(/\s+/g, '') !== quoteKey) break
    items.push(parsed)
  }
  return items
}

function computeIndentStep(current: ParsedListLine, preceding: ParsedListLine[]): number {
  const parent = preceding.find((p) => p.indent.length <= current.indent.length)
  if (parent && parent.orderedNum !== null) {
    return Math.max(3, parent.marker.length)
  }
  if (current.orderedNum !== null) {
    return Math.max(3, current.marker.length)
  }
  return 2
}

function computeOutdentTargetLen(current: ParsedListLine, preceding: ParsedListLine[]): number {
  const parent = preceding.find((p) => p.indent.length < current.indent.length)
  if (parent) return parent.indent.length
  const fallbackStep = current.orderedNum !== null ? 3 : 2
  return Math.max(0, current.indent.length - fallbackStep)
}

function resolveOrderedMarkerForIndent(
  current: ParsedListLine,
  targetIndentLen: number,
  preceding: ParsedListLine[],
): string {
  if (current.orderedNum === null) return current.marker

  for (const prev of preceding) {
    if (prev.indent.length < targetIndentLen) {
      break
    }
    if (prev.indent.length === targetIndentLen && prev.orderedNum !== null) {
      return `${prev.orderedNum + 1}. `
    }
  }
  return '1. '
}

function indentOrOutdentSingleLine(
  value: string,
  lineStart: number,
  lineEnd: number,
  start: number,
  end: number,
  outdent: boolean,
): EditAction {
  const line = value.slice(lineStart, lineEnd)
  const beforeLines = lineStart > 0 ? value.slice(0, lineStart - 1).split('\n') : []
  const parsed = parseListLine(line)

  if (parsed) {
    const rawIndentLen = line.match(/^((?:\s*>\s*)*)(\s*)/)?.[2].length ?? parsed.indent.length
    const quoteKey = parsed.quotePrefix.replace(/\s+/g, '')
    const preceding = scanPrecedingListItems([...beforeLines, line], beforeLines.length, quoteKey)

    if (outdent) {
      if (parsed.indent.length === 0 && rawIndentLen === 0) {
        return { value, selectionStart: start, selectionEnd: end }
      }
      const targetIndentLen = computeOutdentTargetLen(parsed, preceding)
      const nextIndent = ' '.repeat(targetIndentLen)
      const nextMarker = resolveOrderedMarkerForIndent(parsed, targetIndentLen, preceding)
      const nextLine = `${parsed.quotePrefix}${nextIndent}${nextMarker}${parsed.rest}`
      const next = value.slice(0, lineStart) + nextLine + value.slice(lineEnd)
      const prefixBeforeLen = parsed.quotePrefix.length + rawIndentLen + parsed.marker.length
      const prefixAfterLen = parsed.quotePrefix.length + nextIndent.length + nextMarker.length
      const delta = nextLine.length - line.length
      const mapPos = (pos: number) => {
        const col = pos - lineStart
        if (col >= prefixBeforeLen) return pos + delta
        return Math.max(lineStart + parsed.quotePrefix.length, Math.min(lineStart + prefixAfterLen, pos + delta))
      }
      return { value: next, selectionStart: mapPos(start), selectionEnd: mapPos(end) }
    }

    const step = computeIndentStep(parsed, preceding)
    const targetIndentLen = parsed.indent.length + step
    const nextIndent = ' '.repeat(targetIndentLen)
    const nextMarker = resolveOrderedMarkerForIndent(parsed, targetIndentLen, preceding)
    const nextLine = `${parsed.quotePrefix}${nextIndent}${nextMarker}${parsed.rest}`
    const next = value.slice(0, lineStart) + nextLine + value.slice(lineEnd)
    const prefixBeforeLen = parsed.quotePrefix.length + rawIndentLen + parsed.marker.length
    const prefixAfterLen = parsed.quotePrefix.length + nextIndent.length + nextMarker.length
    const delta = nextLine.length - line.length
    const mapPos = (pos: number) => {
      const col = pos - lineStart
      if (col >= prefixBeforeLen) return pos + delta
      return lineStart + prefixAfterLen
    }
    return { value: next, selectionStart: mapPos(start), selectionEnd: mapPos(end) }
  }

  if (outdent) {
    const stripMatch = line.match(/^(?:\t| {1,2})/)
    if (!stripMatch) return { value, selectionStart: start, selectionEnd: end }
    const removed = stripMatch[0].length
    const nextLine = line.slice(removed)
    const next = value.slice(0, lineStart) + nextLine + value.slice(lineEnd)
    return {
      value: next,
      selectionStart: Math.max(lineStart, start - removed),
      selectionEnd: Math.max(lineStart, end - removed),
    }
  }

  if (start === end) {
    const next = value.slice(0, start) + '  ' + value.slice(end)
    return { value: next, selectionStart: start + 2, selectionEnd: start + 2 }
  }

  const nextLine = `  ${line}`
  const next = value.slice(0, lineStart) + nextLine + value.slice(lineEnd)
  return { value: next, selectionStart: start + 2, selectionEnd: end + 2 }
}

function indentOrOutdentMultiLine(
  value: string,
  start: number,
  end: number,
  outdent: boolean,
): EditAction {
  const lineStart = start === 0 ? 0 : value.lastIndexOf('\n', start - 1) + 1
  const effectiveEnd = end > start && value[end - 1] === '\n' ? end - 1 : end
  const lineEndIdx = value.indexOf('\n', effectiveEnd)
  const lineEnd = lineEndIdx === -1 ? value.length : lineEndIdx

  const allLines = value.split('\n')
  const firstLineIdx = lineStart === 0 ? 0 : value.slice(0, lineStart).split('\n').length - 1
  const selectedLines = value.slice(lineStart, lineEnd).split('\n')

  let firstLineDelta = 0
  let totalDelta = 0
  const updatedLines: string[] = []

  for (let offset = 0; offset < selectedLines.length; offset++) {
    const lineIdx = firstLineIdx + offset
    const orig = selectedLines[offset]
    const parsed = parseListLine(orig)
    let replaced = orig

    if (parsed) {
      const quoteKey = parsed.quotePrefix.replace(/\s+/g, '')
      const preceding = scanPrecedingListItems(allLines, lineIdx, quoteKey)
      if (outdent) {
        const targetLen = computeOutdentTargetLen(parsed, preceding)
        const nextIndent = ' '.repeat(targetLen)
        replaced = `${parsed.quotePrefix}${nextIndent}${parsed.marker}${parsed.rest}`
      } else {
        const step = computeIndentStep(parsed, preceding)
        const nextIndent = ' '.repeat(parsed.indent.length + step)
        replaced = `${parsed.quotePrefix}${nextIndent}${parsed.marker}${parsed.rest}`
      }
    } else if (outdent) {
      const stripMatch = orig.match(/^(?:\t| {1,2})/)
      if (stripMatch) replaced = orig.slice(stripMatch[0].length)
    } else if (orig.length > 0 || selectedLines.length === 1) {
      replaced = `  ${orig}`
    }

    allLines[lineIdx] = replaced
    updatedLines.push(replaced)
    const d = replaced.length - orig.length
    if (offset === 0) firstLineDelta = d
    totalDelta += d
  }

  const nextBlock = updatedLines.join('\n')
  const next = value.slice(0, lineStart) + nextBlock + value.slice(lineEnd)
  const nextStart = Math.max(lineStart, start + firstLineDelta)
  const nextEnd = Math.max(nextStart, end + totalDelta)
  return { value: next, selectionStart: nextStart, selectionEnd: nextEnd }
}

function nextListMarker(marker: string, orderedNum: number | null): string {
  if (orderedNum !== null) return `${orderedNum + 1}. `
  return marker.replace(/\[[xX]\]/, '[ ]')
}

/** 编辑器内的 Tab / Shift+Tab 缩进与列表、引用框自动续行等按键处理 */
export function handleEditorKey(
  e: React.KeyboardEvent<HTMLTextAreaElement>,
): EditAction | null {
  if (e.nativeEvent?.isComposing) return null

  const ta = e.currentTarget
  const { value, selectionStart: start, selectionEnd: end } = ta

  if (e.key === 'Tab' && !e.ctrlKey && !e.metaKey && !e.altKey) {
    e.preventDefault()
    const lineStart = start === 0 ? 0 : value.lastIndexOf('\n', start - 1) + 1
    const effectiveEnd = end > start && value[end - 1] === '\n' ? end - 1 : end
    const lineEndIdx = value.indexOf('\n', effectiveEnd)
    const lineEnd = lineEndIdx === -1 ? value.length : lineEndIdx
    const spansMultipleLines = value.slice(lineStart, lineEnd).includes('\n')

    if (spansMultipleLines) {
      return indentOrOutdentMultiLine(value, start, end, e.shiftKey)
    }
    return indentOrOutdentSingleLine(value, lineStart, lineEnd, start, end, e.shiftKey)
  }

  if (
    e.key === 'Enter' &&
    !e.shiftKey &&
    !e.ctrlKey &&
    !e.metaKey &&
    !e.altKey &&
    start === end
  ) {
    const lineStart = start === 0 ? 0 : value.lastIndexOf('\n', start - 1) + 1
    const lineEndIdx = value.indexOf('\n', start)
    const lineEnd = lineEndIdx === -1 ? value.length : lineEndIdx
    const beforeCursor = value.slice(lineStart, start)
    const afterCursor = value.slice(start, lineEnd)

    // 1. 引用框（含嵌套引用 `> > ` 与引用内列表 `> - `）
    const quoteMatch = beforeCursor.match(/^(\s*(?:>\s*)+)(.*)$/)
    if (quoteMatch) {
      const [, rawQuotePrefix, quoteBodyBefore] = quoteMatch
      const contQuote = normalizeQuoteContinuation(rawQuotePrefix)

      const innerList = parseListLine(quoteBodyBefore)
      if (innerList && !innerList.quotePrefix) {
        e.preventDefault()
        if (!innerList.rest.trim() && !afterCursor.trim()) {
          if (innerList.indent.length > 0) {
            const beforeLines = lineStart > 0 ? value.slice(0, lineStart - 1).split('\n') : []
            const fullCurrent = `${contQuote}${quoteBodyBefore}`
            const quoteKey = contQuote.replace(/\s+/g, '')
            const currentParsed = parseListLine(fullCurrent)!
            const preceding = scanPrecedingListItems([...beforeLines, fullCurrent], beforeLines.length, quoteKey)
            const targetLen = computeOutdentTargetLen(currentParsed, preceding)
            const nextIndent = ' '.repeat(targetLen)
            const nextMarker = resolveOrderedMarkerForIndent(currentParsed, targetLen, preceding)
            const replacement = `${contQuote}${nextIndent}${nextMarker}`
            const next = value.slice(0, lineStart) + replacement + value.slice(lineEnd)
            const pos = lineStart + replacement.length
            return { value: next, selectionStart: pos, selectionEnd: pos }
          }
          const next = value.slice(0, lineStart) + contQuote + value.slice(lineEnd)
          const pos = lineStart + contQuote.length
          return { value: next, selectionStart: pos, selectionEnd: pos }
        }

        const insert = `\n${contQuote}${innerList.indent}${nextListMarker(innerList.marker, innerList.orderedNum)}`
        const next = value.slice(0, start) + insert + value.slice(end)
        const pos = start + insert.length
        return { value: next, selectionStart: pos, selectionEnd: pos }
      }

      e.preventDefault()
      if (!quoteBodyBefore.trim() && !afterCursor.trim()) {
        const reduced = dropOneQuoteLevel(rawQuotePrefix)
        const next = value.slice(0, lineStart) + reduced + value.slice(lineEnd)
        const pos = lineStart + reduced.length
        return { value: next, selectionStart: pos, selectionEnd: pos }
      }

      const insert = `\n${contQuote}`
      const next = value.slice(0, start) + insert + value.slice(end)
      const pos = start + insert.length
      return { value: next, selectionStart: pos, selectionEnd: pos }
    }

    // 2. 普通无序列表、任务列表、有序列表
    const listParsed = parseListLine(beforeCursor)
    if (listParsed && !listParsed.quotePrefix) {
      e.preventDefault()
      if (!listParsed.rest.trim() && !afterCursor.trim()) {
        if (listParsed.indent.length > 0) {
          const beforeLines = lineStart > 0 ? value.slice(0, lineStart - 1).split('\n') : []
          const preceding = scanPrecedingListItems([...beforeLines, beforeCursor], beforeLines.length, '')
          const targetLen = computeOutdentTargetLen(listParsed, preceding)
          const nextIndent = ' '.repeat(targetLen)
          const nextMarker = resolveOrderedMarkerForIndent(listParsed, targetLen, preceding)
          const replacement = `${nextIndent}${nextMarker}`
          const next = value.slice(0, lineStart) + replacement + value.slice(lineEnd)
          const pos = lineStart + replacement.length
          return { value: next, selectionStart: pos, selectionEnd: pos }
        }
        const next = value.slice(0, lineStart) + value.slice(lineEnd)
        return { value: next, selectionStart: lineStart, selectionEnd: lineStart }
      }

      const insert = `\n${listParsed.indent}${nextListMarker(listParsed.marker, listParsed.orderedNum)}`
      const next = value.slice(0, start) + insert + value.slice(end)
      const pos = start + insert.length
      return { value: next, selectionStart: pos, selectionEnd: pos }
    }
  }

  return null
}
