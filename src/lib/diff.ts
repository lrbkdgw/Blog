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
