/**
 * 极简行级 diff（Myers 的 LCS 动态规划版本）与 Markdown 语法块级结构化 diff。
 * 仅用于在浏览器里对比两个历史版本的 Markdown 源码与渲染效果，不需要依赖额外的库。
 */

export type DiffType = 'equal' | 'insert' | 'delete'

export interface DiffLine {
  type: DiffType
  /** 原始版本中的行号（1 开始），新增行为 undefined */
  oldNumber?: number
  /** 新版本中的行号（1 开始），删除行为 undefined */
  newNumber?: number
  text: string
}

export interface DiffStats {
  added: number
  removed: number
}

/** 超过该规模时放弃 O(nm) 的 LCS，退化为按行顺序对齐，避免卡死浏览器。 */
const MAX_CELLS = 4_000_000

function fallbackDiff(a: string[], b: string[]): DiffLine[] {
  const lines: DiffLine[] = []
  const max = Math.max(a.length, b.length)
  for (let i = 0; i < max; i += 1) {
    const left = a[i]
    const right = b[i]
    if (left !== undefined && right !== undefined && left === right) {
      lines.push({ type: 'equal', oldNumber: i + 1, newNumber: i + 1, text: left })
      continue
    }
    if (left !== undefined) lines.push({ type: 'delete', oldNumber: i + 1, text: left })
    if (right !== undefined) lines.push({ type: 'insert', newNumber: i + 1, text: right })
  }
  return lines
}

export function diffLines(oldText: string, newText: string): DiffLine[] {
  const a = oldText.replace(/\r\n/g, '\n').split('\n')
  const b = newText.replace(/\r\n/g, '\n').split('\n')

  // 去掉公共前后缀，大幅缩小需要做 LCS 的区间。
  let head = 0
  while (head < a.length && head < b.length && a[head] === b[head]) head += 1
  let tail = 0
  while (
    tail < a.length - head &&
    tail < b.length - head &&
    a[a.length - 1 - tail] === b[b.length - 1 - tail]
  ) {
    tail += 1
  }

  const midA = a.slice(head, a.length - tail)
  const midB = b.slice(head, b.length - tail)

  const result: DiffLine[] = []
  for (let i = 0; i < head; i += 1) {
    result.push({ type: 'equal', oldNumber: i + 1, newNumber: i + 1, text: a[i] })
  }

  const middle =
    midA.length * midB.length > MAX_CELLS ? fallbackDiff(midA, midB) : lcsDiff(midA, midB)
  for (const line of middle) {
    result.push({
      ...line,
      oldNumber: line.oldNumber === undefined ? undefined : line.oldNumber + head,
      newNumber: line.newNumber === undefined ? undefined : line.newNumber + head,
    })
  }

  for (let i = 0; i < tail; i += 1) {
    result.push({
      type: 'equal',
      oldNumber: a.length - tail + i + 1,
      newNumber: b.length - tail + i + 1,
      text: a[a.length - tail + i],
    })
  }
  return result
}

function lcsDiff(a: string[], b: string[]): DiffLine[] {
  const n = a.length
  const m = b.length
  if (n === 0 && m === 0) return []
  // table[i][j] = a[i..] 与 b[j..] 的最长公共子序列长度
  const width = m + 1
  const table = new Uint32Array((n + 1) * width)
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      table[i * width + j] =
        a[i] === b[j]
          ? table[(i + 1) * width + j + 1] + 1
          : Math.max(table[(i + 1) * width + j], table[i * width + j + 1])
    }
  }

  const lines: DiffLine[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      lines.push({ type: 'equal', oldNumber: i + 1, newNumber: j + 1, text: a[i] })
      i += 1
      j += 1
    } else if (table[(i + 1) * width + j] >= table[i * width + j + 1]) {
      lines.push({ type: 'delete', oldNumber: i + 1, text: a[i] })
      i += 1
    } else {
      lines.push({ type: 'insert', newNumber: j + 1, text: b[j] })
      j += 1
    }
  }
  while (i < n) {
    lines.push({ type: 'delete', oldNumber: i + 1, text: a[i] })
    i += 1
  }
  while (j < m) {
    lines.push({ type: 'insert', newNumber: j + 1, text: b[j] })
    j += 1
  }
  return lines
}

export function diffStats(lines: DiffLine[]): DiffStats {
  let added = 0
  let removed = 0
  for (const line of lines) {
    if (line.type === 'insert') added += 1
    if (line.type === 'delete') removed += 1
  }
  return { added, removed }
}

/** 折叠连续的未修改行，只保留差异附近的上下文。 */
export function collapseContext(lines: DiffLine[], context = 3): (DiffLine | { type: 'skip'; count: number })[] {
  const keep = new Array<boolean>(lines.length).fill(false)
  lines.forEach((line, index) => {
    if (line.type === 'equal') return
    for (let k = Math.max(0, index - context); k <= Math.min(lines.length - 1, index + context); k += 1) {
      keep[k] = true
    }
  })
  const output: (DiffLine | { type: 'skip'; count: number })[] = []
  let skipped = 0
  lines.forEach((line, index) => {
    if (keep[index]) {
      if (skipped > 0) {
        output.push({ type: 'skip', count: skipped })
        skipped = 0
      }
      output.push(line)
    } else {
      skipped += 1
    }
  })
  if (skipped > 0) output.push({ type: 'skip', count: skipped })
  return output
}

/* -------------------------------------------------------------------------- */
/*                       渲染对比：语法块级切分与语义化 Hunk                   */
/* -------------------------------------------------------------------------- */

export interface RenderedDiffChunk {
  type: 'equal' | 'insert' | 'delete'
  /** 可直接交给 Markdown 渲染的源码片段 */
  text: string
}

export interface SourceBlock {
  /** 1 开始的行号（相对传入正文） */
  start: number
  end: number
  lines: string[]
  text: string
}

export type RenderedDiffHunk =
  | {
      type: 'equal'
      blocks: SourceBlock[]
      text: string
      oldStart: number
      oldEnd: number
      newStart: number
      newEnd: number
    }
  | {
      type: 'insert'
      text: string
      blockCount: number
      newStart: number
      newEnd: number
    }
  | {
      type: 'delete'
      text: string
      blockCount: number
      oldStart: number
      oldEnd: number
    }
  | {
      type: 'modify'
      beforeText: string
      afterText: string
      beforeCount: number
      afterCount: number
      oldStart: number
      oldEnd: number
      newStart: number
      newEnd: number
    }

export interface RenderedDiffSummary {
  totalChanges: number
  modified: number
  inserted: number
  deleted: number
  unchangedBlocks: number
}

/**
 * 把 Markdown 正文切成完整、可独立交给 `<Markdown />` 渲染的语法块：
 *   - 围栏代码块（``` / ~~~）内部的空行不切；
 *   - 折叠/提示容器（`:::info` / 嵌套 `::::info` … `:::`）内部的空行不切；
 *   - `::show_begin` … `::show_end`、`::begin_ui-*` … `::end_ui-*` 内部的空行不切；
 *   - 多行 `$$ … $$` 公式块内部的空行不切；
 *   - `::cute-table{tuack}` 与紧随其后的管道表格（哪怕中间隔一空行）合并为同一块。
 */
export function splitMarkdownBlocks(text: string): SourceBlock[] {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const blocks: SourceBlock[] = []
  let current: { start: number; lines: string[] } | null = null

  let inFence = false
  let fenceChar = ''
  let fenceLen = 0
  let inMathBlock = false
  const directiveStack: number[] = []
  let showDepth = 0
  let uiBlockDepth = 0
  let pendingTableAttr = false

  const flush = (end: number) => {
    if (!current) return
    while (current.lines.length > 0 && current.lines[current.lines.length - 1].trim() === '') {
      current.lines.pop()
      end -= 1
    }
    if (current.lines.length > 0) {
      blocks.push({
        start: current.start,
        end: Math.max(current.start, end),
        lines: current.lines,
        text: current.lines.join('\n'),
      })
    }
    current = null
  }

  lines.forEach((line, index) => {
    const lineNumber = index + 1
    const trimmed = line.trim()

    // 1. 代码围栏（最优先：围栏内部的一切 `:::`、`$$` 都只是普通代码文本）
    const fence = line.match(/^\s*(`{3,}|~{3,})/)
    if (fence) {
      const marker = fence[1]
      if (!inFence) {
        inFence = true
        fenceChar = marker[0]
        fenceLen = marker.length
      } else if (marker[0] === fenceChar && marker.length >= fenceLen && /^\s*(`{3,}|~{3,})\s*$/.test(line)) {
        inFence = false
        fenceChar = ''
        fenceLen = 0
      }
      if (!current) current = { start: lineNumber, lines: [] }
      current.lines.push(line)
      return
    }

    if (inFence) {
      if (!current) current = { start: lineNumber, lines: [] }
      current.lines.push(line)
      return
    }

    // 2. 多行展示公式块 `$$ ... $$`
    if (trimmed === '$$') {
      inMathBlock = !inMathBlock
      if (!current) current = { start: lineNumber, lines: [] }
      current.lines.push(line)
      return
    }

    // 3. Starlog / 洛谷风格容器块：`:::info[标题]{open}` 与嵌套 `::::info` … `:::`
    const openDirective = line.match(/^\s*(:{3,})\s*([a-zA-Z][\w-]*)/)
    const closeDirective = !openDirective ? line.match(/^\s*(:{3,})\s*$/) : null
    if (openDirective) {
      directiveStack.push(openDirective[1].length)
      if (!current) current = { start: lineNumber, lines: [] }
      current.lines.push(line)
      return
    }
    if (closeDirective && directiveStack.length > 0) {
      const colons = closeDirective[1].length
      let matchIdx = -1
      for (let k = directiveStack.length - 1; k >= 0; k -= 1) {
        if (directiveStack[k] === colons) {
          matchIdx = k
          break
        }
      }
      directiveStack.length = matchIdx >= 0 ? matchIdx : directiveStack.length - 1
      if (!current) current = { start: lineNumber, lines: [] }
      current.lines.push(line)
      return
    }

    // 4. `::show_begin` … `::show_end` 与 `::begin_ui-*` … `::end_ui-*`
    if (/^\s*::show_begin\b/.test(line)) {
      showDepth += 1
      if (!current) current = { start: lineNumber, lines: [] }
      current.lines.push(line)
      return
    }
    if (/^\s*::show_end\b/.test(line) && showDepth > 0) {
      showDepth -= 1
      if (!current) current = { start: lineNumber, lines: [] }
      current.lines.push(line)
      return
    }
    if (/^\s*::begin_ui-[\w-]+/.test(line)) {
      uiBlockDepth += 1
      if (!current) current = { start: lineNumber, lines: [] }
      current.lines.push(line)
      return
    }
    if (/^\s*::end_ui-[\w-]+/.test(line) && uiBlockDepth > 0) {
      uiBlockDepth -= 1
      if (!current) current = { start: lineNumber, lines: [] }
      current.lines.push(line)
      return
    }

    const insideContainer =
      inMathBlock || directiveStack.length > 0 || showDepth > 0 || uiBlockDepth > 0

    // 5. 空行：容器内保留在当前块中；顶层空行结束当前块（`::cute-table` 等待紧邻表格时暂不切开）
    if (trimmed === '') {
      if (insideContainer || pendingTableAttr) {
        if (current) current.lines.push(line)
      } else {
        flush(lineNumber - 1)
      }
      return
    }

    // 6. `::cute-table{tuack}` 属性头与其下方紧邻的管道表格归为同一块
    if (/^\s*::cute-table\b/.test(line)) {
      if (current && !insideContainer) flush(lineNumber - 1)
      pendingTableAttr = true
      current = { start: lineNumber, lines: [line] }
      return
    }
    if (pendingTableAttr) {
      pendingTableAttr = false
      if (!/^\s*\|/.test(line)) {
        flush(lineNumber - 1)
      }
    }

    if (!current) current = { start: lineNumber, lines: [] }
    current.lines.push(line)
  })

  flush(lines.length)
  return blocks
}

interface RawBlockDiffOp {
  type: 'equal' | 'delete' | 'insert'
  oldBlock?: SourceBlock
  newBlock?: SourceBlock
}

function computeRawBlockOps(oldText: string, newText: string): RawBlockDiffOp[] {
  const oldBlocks = splitMarkdownBlocks(oldText.replace(/\r\n/g, '\n'))
  const newBlocks = splitMarkdownBlocks(newText.replace(/\r\n/g, '\n'))
  if (oldBlocks.length === 0 && newBlocks.length === 0) return []

  const encode = (block: SourceBlock) => block.lines.join('\u0000')
  const rows = diffLines(
    oldBlocks.map(encode).join('\n'),
    newBlocks.map(encode).join('\n'),
  )

  const ops: RawBlockDiffOp[] = []
  for (const row of rows) {
    if (row.type === 'equal') {
      const oldBlock = oldBlocks[(row.oldNumber ?? 1) - 1]
      const newBlock = newBlocks[(row.newNumber ?? 1) - 1]
      if (oldBlock && newBlock) ops.push({ type: 'equal', oldBlock, newBlock })
    } else if (row.type === 'delete') {
      const oldBlock = oldBlocks[(row.oldNumber ?? 1) - 1]
      if (oldBlock) ops.push({ type: 'delete', oldBlock })
    } else {
      const newBlock = newBlocks[(row.newNumber ?? 1) - 1]
      if (newBlock) ops.push({ type: 'insert', newBlock })
    }
  }
  return ops
}

/**
 * 将两个版本的 Markdown 正文对比为语义化 Hunk 列表：
 *   - `equal`：未变更块序列（保留逐块数组，支持按需折叠/展开长上下文）；
 *   - `modify`：同一位置上的「旧版块 → 新版块」配对修改（支持分栏对照或上下融合展示）；
 *   - `insert`：纯新增块；
 *   - `delete`：纯删除块。
 */
export function diffMarkdownHunks(oldText: string, newText: string): RenderedDiffHunk[] {
  const ops = computeRawBlockOps(oldText, newText)
  if (ops.length === 0) return []

  const hunks: RenderedDiffHunk[] = []
  let index = 0

  while (index < ops.length) {
    const current = ops[index]
    if (current.type === 'equal') {
      const equalOld: SourceBlock[] = []
      const equalNew: SourceBlock[] = []
      while (index < ops.length && ops[index].type === 'equal') {
        equalOld.push(ops[index].oldBlock!)
        equalNew.push(ops[index].newBlock!)
        index += 1
      }
      hunks.push({
        type: 'equal',
        blocks: equalNew,
        text: equalNew.map((b) => b.text).join('\n\n'),
        oldStart: equalOld[0].start,
        oldEnd: equalOld[equalOld.length - 1].end,
        newStart: equalNew[0].start,
        newEnd: equalNew[equalNew.length - 1].end,
      })
      continue
    }

    const deletedBlocks: SourceBlock[] = []
    const insertedBlocks: SourceBlock[] = []
    while (index < ops.length && ops[index].type !== 'equal') {
      if (ops[index].type === 'delete' && ops[index].oldBlock) {
        deletedBlocks.push(ops[index].oldBlock!)
      } else if (ops[index].type === 'insert' && ops[index].newBlock) {
        insertedBlocks.push(ops[index].newBlock!)
      }
      index += 1
    }

    if (deletedBlocks.length > 0 && insertedBlocks.length > 0) {
      hunks.push({
        type: 'modify',
        beforeText: deletedBlocks.map((b) => b.text).join('\n\n'),
        afterText: insertedBlocks.map((b) => b.text).join('\n\n'),
        beforeCount: deletedBlocks.length,
        afterCount: insertedBlocks.length,
        oldStart: deletedBlocks[0].start,
        oldEnd: deletedBlocks[deletedBlocks.length - 1].end,
        newStart: insertedBlocks[0].start,
        newEnd: insertedBlocks[insertedBlocks.length - 1].end,
      })
    } else if (insertedBlocks.length > 0) {
      hunks.push({
        type: 'insert',
        text: insertedBlocks.map((b) => b.text).join('\n\n'),
        blockCount: insertedBlocks.length,
        newStart: insertedBlocks[0].start,
        newEnd: insertedBlocks[insertedBlocks.length - 1].end,
      })
    } else if (deletedBlocks.length > 0) {
      hunks.push({
        type: 'delete',
        text: deletedBlocks.map((b) => b.text).join('\n\n'),
        blockCount: deletedBlocks.length,
        oldStart: deletedBlocks[0].start,
        oldEnd: deletedBlocks[deletedBlocks.length - 1].end,
      })
    }
  }

  return hunks
}

export function renderedDiffSummary(hunks: RenderedDiffHunk[]): RenderedDiffSummary {
  let modified = 0
  let inserted = 0
  let deleted = 0
  let unchangedBlocks = 0
  for (const hunk of hunks) {
    if (hunk.type === 'modify') modified += 1
    else if (hunk.type === 'insert') inserted += 1
    else if (hunk.type === 'delete') deleted += 1
    else unchangedBlocks += hunk.blocks.length
  }
  return {
    totalChanges: modified + inserted + deleted,
    modified,
    inserted,
    deleted,
    unchangedBlocks,
  }
}

/**
 * 扁平块级 diff 片段接口（保留向后兼容）。
 */
export function renderedDiffBlocks(oldText: string, newText: string): RenderedDiffChunk[] {
  const ops = computeRawBlockOps(oldText, newText)
  const chunks: RenderedDiffChunk[] = []
  const push = (type: RenderedDiffChunk['type'], text: string) => {
    if (!text.trim()) return
    const last = chunks[chunks.length - 1]
    if (last && last.type === type) {
      last.text = `${last.text.replace(/\s+$/, '')}\n\n${text}`
    } else {
      chunks.push({ type, text })
    }
  }
  for (const op of ops) {
    if (op.type === 'equal' && op.newBlock) push('equal', op.newBlock.text)
    else if (op.type === 'delete' && op.oldBlock) push('delete', op.oldBlock.text)
    else if (op.type === 'insert' && op.newBlock) push('insert', op.newBlock.text)
  }
  return chunks
}
