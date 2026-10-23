/**
 * 极简行级 diff（Myers 的 LCS 动态规划版本）。
 * 仅用于在浏览器里对比两个历史版本的 Markdown 源码，不需要依赖额外的库。
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
/*                      渲染对比：仅显示较新版本的结构化差异                     */
/* -------------------------------------------------------------------------- */

export interface RenderedDiffChunk {
  type: 'equal' | 'insert' | 'delete'
  /** 可直接交给 Markdown 渲染的源码片段 */
  text: string
}

interface SourceBlock {
  /** 1 开始的行号（相对传入的文本） */
  start: number
  end: number
  lines: string[]
}

/**
 * 把 Markdown 按空行切成块，围栏代码块内部的空行不切。
 * 渲染对比以「块」为单位着色：整块新增标绿、整块删除标红，
 * 这样不会把标题、列表或代码围栏从中间截断。
 */
function splitMarkdownBlocks(text: string): SourceBlock[] {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const blocks: SourceBlock[] = []
  let current: { start: number; lines: string[] } | null = null
  let inFence = false
  let fenceChar = ''

  const flush = (end: number) => {
    if (!current || current.lines.length === 0) {
      current = null
      return
    }
    blocks.push({ start: current.start, end, lines: current.lines })
    current = null
  }

  lines.forEach((line, index) => {
    const lineNumber = index + 1
    const fence = line.match(/^\s*(`{3,}|~{3,})/)
    if (fence) {
      const marker = fence[1]
      if (!inFence) {
        inFence = true
        fenceChar = marker[0]
      } else if (marker[0] === fenceChar) {
        inFence = false
      }
    }

    if (!inFence && line.trim() === '') {
      flush(lineNumber - 1)
      return
    }

    if (!current) current = { start: lineNumber, lines: [] }
    current.lines.push(line)
  })
  flush(lines.length)
  return blocks
}

/**
 * 生成「只显示较新版本」的渲染对比片段：
 *   - equal：未改动的内容，正常渲染；
 *   - insert：新增的块，调用方用绿色标出；
 *   - delete：被删除的旧内容，调用方用红色标出（没有对应新内容可显示）。
 *
 * 以 Markdown 块（空行分隔，围栏代码块内部的空行不切）为最小单位，
 * 整块新增标绿、整块删除标红，避免把代码围栏、列表或表格从中间截断。
 */
export function renderedDiffBlocks(oldText: string, newText: string): RenderedDiffChunk[] {
  const oldBlocks = splitMarkdownBlocks(oldText.replace(/\r\n/g, '\n'))
  const newBlocks = splitMarkdownBlocks(newText.replace(/\r\n/g, '\n'))
  if (oldBlocks.length === 0 && newBlocks.length === 0) return []

  // 每个块编码成一行再复用行级 LCS：块内部的换行用 NUL 占位，
  // 因此 diff 的行号可以直接映射回块下标，代码围栏也不会被拆开。
  const encode = (block: SourceBlock) => block.lines.join('\u0000')
  const rows = diffLines(
    oldBlocks.map(encode).join('\n'),
    newBlocks.map(encode).join('\n'),
  )

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

  for (const row of rows) {
    if (row.type === 'equal') {
      const block = oldBlocks[(row.oldNumber ?? 1) - 1]
      if (block) push('equal', block.lines.join('\n'))
    } else if (row.type === 'delete') {
      const block = oldBlocks[(row.oldNumber ?? 1) - 1]
      if (block) push('delete', block.lines.join('\n'))
    } else {
      const block = newBlocks[(row.newNumber ?? 1) - 1]
      if (block) push('insert', block.lines.join('\n'))
    }
  }

  return chunks
}

/* -------------------------------------------------------------------------- */
/*                      渲染对比：把块差异组织成「改动卡片」                     */
/* -------------------------------------------------------------------------- */

/**
 * 渲染对比的展示单元：
 *   - `equal`  ：未改动的原文块，按原样渲染；
 *   - `change` ：连续的删除 / 新增块合成一张卡片（删除在前、新增在后），
 *               旧实现把它们拆成一堆彼此独立的红/绿方块，读到一半很难对应哪段变成了哪段。
 */
export type RenderDiffGroup =
  | { kind: 'equal'; text: string }
  | { kind: 'change'; id: number; removed: string[]; added: string[] }

export interface RenderDiffSummary {
  /** 改动处数（change 卡片数） */
  changes: number
  /** 新增的 Markdown 块数 */
  addedBlocks: number
  /** 被删除的 Markdown 块数 */
  removedBlocks: number
}

/** 数一段（可能由多个块用空行拼接的）Markdown 里有几个块。 */
export function countRenderBlocks(texts: string[]): number {
  return texts.reduce((total, text) => {
    const blocks = text.split(/\n{2,}/).filter((part) => part.trim().length > 0)
    return total + blocks.length
  }, 0)
}

/** 把 renderedDiffBlocks 的扁平 chunk 列表合并成「等宽」的展示分组。 */
export function groupRenderedDiffChunks(chunks: RenderedDiffChunk[]): RenderDiffGroup[] {
  const groups: RenderDiffGroup[] = []
  let changeId = 0

  for (const chunk of chunks) {
    if (chunk.type === 'equal') {
      groups.push({ kind: 'equal', text: chunk.text })
      continue
    }
    const last = groups[groups.length - 1]
    if (last && last.kind === 'change') {
      if (chunk.type === 'insert') last.added.push(chunk.text)
      else last.removed.push(chunk.text)
      continue
    }
    groups.push({
      kind: 'change',
      id: changeId++,
      removed: chunk.type === 'delete' ? [chunk.text] : [],
      added: chunk.type === 'insert' ? [chunk.text] : [],
    })
  }

  return groups
}

/** 统计改动处数与新增 / 删除的块数，用于渲染对比顶部的摘要。 */
export function summarizeRenderDiff(groups: RenderDiffGroup[]): RenderDiffSummary {
  let changes = 0
  let addedBlocks = 0
  let removedBlocks = 0
  for (const group of groups) {
    if (group.kind !== 'change') continue
    changes += 1
    addedBlocks += countRenderBlocks(group.added)
    removedBlocks += countRenderBlocks(group.removed)
  }
  return { changes, addedBlocks, removedBlocks }
}

/**
 * 按界面开关过滤分组：
 *   - `onlyChanges`：隐藏未改动的原文块（长文只想看改了什么）；
 *   - `showRemoved`：关闭时隐藏「只有删除」的卡片，并让「修改」卡片只显示新内容。
 */
export function filterRenderGroups(
  groups: RenderDiffGroup[],
  options: { onlyChanges?: boolean; showRemoved?: boolean } = {},
): RenderDiffGroup[] {
  const { onlyChanges = false, showRemoved = true } = options
  return groups.filter((group) => {
    if (group.kind === 'equal') return !onlyChanges
    // 只有删除、且用户选择不看删除内容 → 整张卡片都没有可展示的内容
    if (!showRemoved && group.removed.length > 0 && group.added.length === 0) return false
    return true
  })
}
