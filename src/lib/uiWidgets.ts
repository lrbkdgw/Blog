/**
 * 文章级交互控件、值替换与条件渲染引擎（issue #82）：
 *
 * 1. 选择框：`::begin_ui-choose[<id>][<name>][<附加项>] ... ::end_ui-choose`
 * 2. 下拉框：`::begin_ui-select[<id>][<附加项>] ... ::end_ui-select`（行内紧跟上一行文本后）
 * 3. 是否框：`::begin_ui-if[<id>][<附加项>] ... ::nex ... ::end_ui-if`
 * 4. 填空框：`::ui-write[<id>][<附加项>]`（支持 `set`、`R`、`len`、`new`、`name`、`faster`、`merge`）
 * 5. 值映射：`<<id>>` / `<id>`、`<<id-number>>` / `<id-number>`（优先级最高）
 * 6. 条件渲染：`<IF:<a>,<b>>` 与 `::IF[<a>] ... ::IF_END`（支持 KaTeX 四则、位运算、比较与逻辑运算）
 */

export interface UiChooseOption {
  /** 1-indexed 选项编号（1, 2, ...） */
  index: number
  /** 方括号内的选项名（如 `A`、`$\sum$`） */
  label: string
  /** 选项正文 Markdown */
  content: string
}

export interface UiChooseWidgetDef {
  kind: 'choose'
  id: string
  name: string
  minSelect: number
  maxSelect: number
  hasExplicitRange: boolean
  options: UiChooseOption[]
}

export interface UiSelectOption {
  /** 1-indexed 选项编号（1, 2, ...） */
  index: number
  /** 选项内容文本 / 行内公式 */
  content: string
}

export interface UiSelectWidgetDef {
  kind: 'select'
  id: string
  minSelect: number
  maxSelect: number
  hasExplicitRange: boolean
  search: boolean
  options: UiSelectOption[]
}

export interface UiIfItem {
  /** 1-indexed 条目编号（1, 2, ...） */
  index: number
  /** 条目正文 Markdown */
  content: string
}

export interface UiIfWidgetDef {
  kind: 'if'
  id: string
  lined: boolean
  items: UiIfItem[]
}

export interface UiWriteRealRule {
  bit: number
  down: number
  up: number
}

export interface UiWriteLenRule {
  down: number
  up: number
}

export interface UiWriteWidgetDef {
  kind: 'write'
  id: string
  initialValue?: string
  real?: UiWriteRealRule
  len?: UiWriteLenRule
  isNew: boolean
  name?: string
  faster: boolean
  merge: boolean
}

export type UiWidgetDef =
  | UiChooseWidgetDef
  | UiSelectWidgetDef
  | UiIfWidgetDef
  | UiWriteWidgetDef

export type UiWidgetState =
  | { kind: 'choose'; selected: number[] }
  | { kind: 'select'; selected: number[] }
  | { kind: 'if'; checked: boolean[] }
  | { kind: 'write'; value: string }

export type UiStateMap = Record<string, UiWidgetState>

/* -------------------------------------------------------------------------- */
/*                               方括号修饰符解析                               */
/* -------------------------------------------------------------------------- */

export interface BracketParseResult {
  groups: string[]
  consumedLength: number
}

/**
 * 解析形如 `[arg1][arg2]...` 的连续方括号组（支持内部嵌套 `[...]` 与 `\` 转义）。
 * @param allowInterBracketSpace 是否允许相邻方括号之间出现空白字符（块级头部允许，行内紧接时不跨越空白以免吞并后续 Markdown 链接）
 */
export function parseLeadingBracketGroups(
  input: string,
  allowInterBracketSpace = false,
): BracketParseResult {
  const groups: string[] = []
  let pos = 0

  while (pos < input.length) {
    let scan = pos
    if (allowInterBracketSpace || groups.length === 0) {
      if (groups.length > 0) {
        while (scan < input.length && /[ \t]/.test(input[scan])) scan += 1
      }
    }
    if (input[scan] !== '[') break

    let depth = 0
    let closeIdx = -1
    for (let i = scan; i < input.length; i += 1) {
      const ch = input[i]
      if (ch === '\\' && i + 1 < input.length) {
        i += 1
        continue
      }
      if (ch === '[') depth += 1
      else if (ch === ']') {
        depth -= 1
        if (depth === 0) {
          closeIdx = i
          break
        }
      }
    }
    if (closeIdx < 0) break
    groups.push(input.slice(scan + 1, closeIdx))
    pos = closeIdx + 1
  }

  return { groups, consumedLength: pos }
}

/** 判断整行是否为独立的 `[<选项名>]`（排除 `[文字](链接)` 等行内元素）。 */
function parseStandaloneOptionHeader(line: string): string | null {
  const trimmed = line.trim()
  if (!trimmed.startsWith('[') || !trimmed.endsWith(']')) return null
  const { groups, consumedLength } = parseLeadingBracketGroups(trimmed, false)
  if (groups.length !== 1 || consumedLength !== trimmed.length) return null
  return groups[0].trim()
}

function clampNum(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}

export function formatRealValue(num: number, bit: number): string {
  if (!Number.isFinite(num)) return '0'
  const rounded = Number(num.toFixed(Math.max(0, Math.min(12, bit))))
  const normalized = Object.is(rounded, -0) ? 0 : rounded
  return String(normalized)
}

export function normalizeWriteInitialValue(def: Pick<UiWriteWidgetDef, 'initialValue' | 'real' | 'len'>): string {
  if (def.real) {
    const fallback = clampNum(0, def.real.down, def.real.up)
    if (def.initialValue !== undefined && def.initialValue.trim() !== '') {
      const parsed = Number(def.initialValue.trim())
      if (Number.isFinite(parsed)) {
        return formatRealValue(clampNum(parsed, def.real.down, def.real.up), def.real.bit)
      }
    }
    return formatRealValue(fallback, def.real.bit)
  }

  let text = def.initialValue ?? ''
  if (def.len && text.length > def.len.up) {
    text = text.slice(0, def.len.up)
  }
  return text
}

/**
 * 校验并规范化实数输入文本（用于 `::ui-write` 的 `R <bit> <down> <up>`）：
 * 返回可供 `<id>` 实时参与公式计算的合法实数字符串，以及当前输入状态提示。
 */
export function resolveEffectiveRealString(rawInput: string, rule: UiWriteRealRule): {
  effective: string
  valid: boolean
  hint?: string
} {
  const trimmed = rawInput.trim()
  if (!trimmed || trimmed === '-' || trimmed === '+' || trimmed === '.' || trimmed === '-.') {
    const fallback = formatRealValue(clampNum(0, rule.down, rule.up), rule.bit)
    return { effective: fallback, valid: false, hint: `请输入 ${rule.down} ~ ${rule.up} 的实数` }
  }
  const num = Number(trimmed)
  if (!Number.isFinite(num)) {
    const fallback = formatRealValue(clampNum(0, rule.down, rule.up), rule.bit)
    return { effective: fallback, valid: false, hint: '仅接受实数' }
  }
  const dotIdx = trimmed.indexOf('.')
  const fracLen = dotIdx >= 0 ? trimmed.length - dotIdx - 1 : 0
  if (fracLen > rule.bit) {
    const clamped = clampNum(num, rule.down, rule.up)
    return {
      effective: formatRealValue(clamped, rule.bit),
      valid: false,
      hint: rule.bit === 0 ? '仅允许整数' : `小数不超过 ${rule.bit} 位`,
    }
  }
  if (num < rule.down || num > rule.up) {
    return {
      effective: formatRealValue(clampNum(num, rule.down, rule.up), rule.bit),
      valid: false,
      hint: `范围 ${rule.down} ~ ${rule.up}`,
    }
  }
  return { effective: formatRealValue(num, rule.bit), valid: true }
}

function parseMoreModifier(mod: string): { down: number; up: number } | null {
  const m = mod.trim().match(/^more\s+(-?\d+)\s+(-?\d+)$/i)
  if (!m) return null
  const d = Math.max(0, Number.parseInt(m[1], 10))
  const u = Math.max(d, Number.parseInt(m[2], 10))
  return { down: d, up: u }
}

export function parseUiChooseBlock(headerRest: string, bodyLines: string[]): UiChooseWidgetDef | null {
  const { groups } = parseLeadingBracketGroups(headerRest.trim(), true)
  if (groups.length === 0 || !groups[0].trim()) return null

  const id = groups[0].trim()
  let name = ''
  let modStart = 1
  if (groups.length >= 2) {
    // 兼容省略标题直接写 [more d u] 与标准 [id][name][more d u]
    if (groups.length === 2 && parseMoreModifier(groups[1])) {
      modStart = 1
    } else {
      name = groups[1].trim()
      modStart = 2
    }
  }

  let minSelect = 1
  let maxSelect = 1
  let hasExplicitRange = false
  for (let i = modStart; i < groups.length; i += 1) {
    for (const part of groups[i].split(/[;,]/)) {
      const more = parseMoreModifier(part)
      if (more) {
        minSelect = more.down
        maxSelect = more.up
        hasExplicitRange = true
      }
    }
  }

  const options: UiChooseOption[] = []
  let currentLabel: string | null = null
  let currentBuffer: string[] = []

  const flushOption = () => {
    if (currentLabel !== null) {
      options.push({
        index: options.length + 1,
        label: currentLabel,
        content: currentBuffer.join('\n').trim(),
      })
    }
    currentBuffer = []
  }

  for (const line of bodyLines) {
    const header = parseStandaloneOptionHeader(line)
    if (header !== null) {
      flushOption()
      currentLabel = header
    } else if (currentLabel !== null) {
      currentBuffer.push(line)
    }
  }
  flushOption()

  return {
    kind: 'choose',
    id,
    name,
    minSelect,
    maxSelect,
    hasExplicitRange,
    options,
  }
}

export function parseUiSelectBlock(headerRest: string, bodyLines: string[]): UiSelectWidgetDef | null {
  const { groups } = parseLeadingBracketGroups(headerRest.trim(), true)
  if (groups.length === 0 || !groups[0].trim()) return null

  const id = groups[0].trim()
  let minSelect = 1
  let maxSelect = 1
  let hasExplicitRange = false
  let search = false

  for (let i = 1; i < groups.length; i += 1) {
    for (const rawPart of groups[i].split(/[;,]/)) {
      const part = rawPart.trim()
      if (!part) continue
      const more = parseMoreModifier(part)
      if (more) {
        minSelect = more.down
        maxSelect = more.up
        hasExplicitRange = true
      } else if (/^search$/i.test(part)) {
        search = true
      }
    }
  }

  const hasNexSeparator = bodyLines.some((line) => /^\s*::nex\s*$/i.test(line))
  const rawOptions: string[] = []
  if (hasNexSeparator) {
    let buf: string[] = []
    for (const line of bodyLines) {
      if (/^\s*::nex\s*$/i.test(line)) {
        if (buf.join('\n').trim()) rawOptions.push(buf.join(' ').trim())
        buf = []
      } else {
        buf.push(line)
      }
    }
    if (buf.join('\n').trim()) rawOptions.push(buf.join(' ').trim())
  } else {
    for (const line of bodyLines) {
      const t = line.trim()
      if (t) rawOptions.push(t)
    }
  }

  return {
    kind: 'select',
    id,
    minSelect,
    maxSelect,
    hasExplicitRange,
    search,
    options: rawOptions.map((content, idx) => ({ index: idx + 1, content })),
  }
}

export function parseUiIfBlock(headerRest: string, bodyLines: string[]): UiIfWidgetDef | null {
  const { groups } = parseLeadingBracketGroups(headerRest.trim(), true)
  if (groups.length === 0 || !groups[0].trim()) return null

  const id = groups[0].trim()
  let lined = false
  for (let i = 1; i < groups.length; i += 1) {
    for (const rawPart of groups[i].split(/[;,]/)) {
      if (/^lined$/i.test(rawPart.trim())) lined = true
    }
  }

  const items: UiIfItem[] = []
  let buf: string[] = []
  const flush = () => {
    const content = buf.join('\n').trim()
    if (content || items.length > 0) {
      items.push({ index: items.length + 1, content })
    }
    buf = []
  }

  for (const line of bodyLines) {
    if (/^\s*::nex\s*$/i.test(line)) {
      flush()
    } else {
      buf.push(line)
    }
  }
  if (buf.join('\n').trim() || items.length > 0) {
    items.push({ index: items.length + 1, content: buf.join('\n').trim() })
  }

  return {
    kind: 'if',
    id,
    lined,
    items,
  }
}

export function parseUiWriteToken(afterDirective: string): {
  def: UiWriteWidgetDef
  consumedLength: number
} | null {
  const { groups, consumedLength } = parseLeadingBracketGroups(afterDirective, false)
  if (groups.length === 0 || !groups[0].trim()) return null

  const id = groups[0].trim()
  let initialValue: string | undefined
  let real: UiWriteRealRule | undefined
  let len: UiWriteLenRule | undefined
  let isNew = false
  let rawName: string | undefined
  let rawFaster = false
  let rawMerge = false

  for (let i = 1; i < groups.length; i += 1) {
    const mod = groups[i].trim()
    if (!mod) continue
    if (/^new$/i.test(mod)) {
      isNew = true
      continue
    }
    if (/^faster$/i.test(mod)) {
      rawFaster = true
      continue
    }
    if (/^merge$/i.test(mod)) {
      rawMerge = true
      continue
    }
    const setMatch = mod.match(/^set\s+([\s\S]+)$/i)
    if (setMatch) {
      initialValue = setMatch[1].trim()
      continue
    }
    const realMatch = mod.match(/^R\s+(\d+)\s+([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)\s+([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)$/i)
    if (realMatch) {
      const bit = Math.max(0, Number.parseInt(realMatch[1], 10))
      const a = Number(realMatch[2])
      const b = Number(realMatch[3])
      if (Number.isFinite(a) && Number.isFinite(b)) {
        real = { bit, down: Math.min(a, b), up: Math.max(a, b) }
      }
      continue
    }
    const lenMatch = mod.match(/^len\s+(\d+)\s+(\d+)$/i)
    if (lenMatch) {
      const a = Number.parseInt(lenMatch[1], 10)
      const b = Number.parseInt(lenMatch[2], 10)
      len = { down: Math.min(a, b), up: Math.max(a, b) }
      continue
    }
    const nameMatch = mod.match(/^name\s+([\s\S]+)$/i)
    if (nameMatch) {
      rawName = nameMatch[1].trim()
    }
  }

  return {
    def: {
      kind: 'write',
      id,
      initialValue,
      real,
      len,
      isNew,
      name: isNew ? rawName : undefined,
      faster: Boolean(isNew && real && rawFaster),
      merge: Boolean(isNew && rawMerge),
    },
    consumedLength,
  }
}

/** 创建控件初始状态。 */
export function createInitialWidgetState(def: UiWidgetDef): UiWidgetState {
  if (def.kind === 'choose') {
    return { kind: 'choose', selected: [] }
  }
  if (def.kind === 'select') {
    if (!def.hasExplicitRange && def.options.length > 0) {
      return { kind: 'select', selected: [1] }
    }
    return { kind: 'select', selected: [] }
  }
  if (def.kind === 'if') {
    return { kind: 'if', checked: def.items.map(() => false) }
  }
  return {
    kind: 'write',
    value: normalizeWriteInitialValue(def),
  }
}

/**
 * 扫描整篇 Markdown（自动跳过代码围栏 ` ``` ` / ` ~~~ `）提取全部 UI 控件定义。
 */
export function extractUiWidgetDefs(markdown: string): UiWidgetDef[] {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n')
  const defs: UiWidgetDef[] = []
  let inFence = false
  let fenceChar = ''
  let fenceLen = 0

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    const fenceMatch = line.match(/^\s*(`{3,}|~{3,})/)
    if (fenceMatch) {
      const ch = fenceMatch[1][0]
      const len = fenceMatch[1].length
      if (!inFence) {
        inFence = true
        fenceChar = ch
        fenceLen = len
      } else if (ch === fenceChar && len >= fenceLen) {
        inFence = false
      }
      continue
    }
    if (inFence) continue

    const chooseOpen = line.match(/^\s*::begin_ui-choose([\s\S]*)$/)
    if (chooseOpen) {
      const body: string[] = []
      let j = i + 1
      while (j < lines.length && !/^\s*::end_ui-choose\s*$/.test(lines[j])) {
        body.push(lines[j])
        j += 1
      }
      if (j < lines.length) {
        const parsed = parseUiChooseBlock(chooseOpen[1], body)
        if (parsed) defs.push(parsed)
        i = j
        continue
      }
    }

    const selectOpen = line.match(/^\s*::begin_ui-select([\s\S]*)$/)
    if (selectOpen) {
      const body: string[] = []
      let j = i + 1
      while (j < lines.length && !/^\s*::end_ui-select\s*$/.test(lines[j])) {
        body.push(lines[j])
        j += 1
      }
      if (j < lines.length) {
        const parsed = parseUiSelectBlock(selectOpen[1], body)
        if (parsed) defs.push(parsed)
        i = j
        continue
      }
    }

    const ifOpen = line.match(/^\s*::begin_ui-if([\s\S]*)$/)
    if (ifOpen) {
      const body: string[] = []
      let j = i + 1
      while (j < lines.length && !/^\s*::end_ui-if\s*$/.test(lines[j])) {
        body.push(lines[j])
        j += 1
      }
      if (j < lines.length) {
        const parsed = parseUiIfBlock(ifOpen[1], body)
        if (parsed) defs.push(parsed)
        i = j
        continue
      }
    }

    // 扫描当前行内的全部 ::ui-write[...] 指令（跳过反引号行内代码）
    let inInlineCode = false
    for (let pos = 0; pos < line.length; pos += 1) {
      if (line[pos] === '`') {
        inInlineCode = !inInlineCode
        continue
      }
      if (!inInlineCode && line.startsWith('::ui-write[', pos)) {
        const parsed = parseUiWriteToken(line.slice(pos + '::ui-write'.length))
        if (parsed) {
          defs.push(parsed.def)
          pos += '::ui-write'.length + parsed.consumedLength - 1
        }
      }
    }
  }

  return defs
}

/** 合并并归一化当前文档的控件状态映射（保留编辑文章过程中读者已操作的值）。 */
export function buildUiValueLookup(
  defs: UiWidgetDef[],
  states: UiStateMap,
): { exact: Map<string, string>; lower: Map<string, string> } {
  const exact = new Map<string, string>()
  const lower = new Map<string, string>()

  const register = (key: string, val: string) => {
    exact.set(key, val)
    const lk = key.toLowerCase()
    if (!lower.has(lk)) lower.set(lk, val)
  }

  for (const def of defs) {
    const state = states[def.id] ?? createInitialWidgetState(def)
    if (def.kind === 'choose' && state.kind === 'choose') {
      const sorted = [...state.selected].sort((a, b) => a - b)
      register(def.id, sorted.length === 0 ? '0' : sorted.join(', '))
    } else if (def.kind === 'select' && state.kind === 'select') {
      const sorted = [...state.selected].sort((a, b) => a - b)
      register(def.id, sorted.length === 0 ? '0' : sorted.join(', '))
    } else if (def.kind === 'if' && state.kind === 'if') {
      let count = 0
      def.items.forEach((item, idx) => {
        const on = Boolean(state.checked[idx])
        if (on) count += 1
        register(`${def.id}-${item.index}`, on ? '1' : '0')
      })
      register(def.id, String(count))
    } else if (def.kind === 'write' && state.kind === 'write') {
      if (def.real) {
        register(def.id, resolveEffectiveRealString(state.value, def.real).effective)
      } else {
        register(def.id, state.value)
      }
    }
  }

  return { exact, lower }
}

function resolveWidgetRef(
  rawKey: string,
  lookup: { exact: Map<string, string>; lower: Map<string, string> },
): string | undefined {
  const trimmed = rawKey.trim()
  if (!trimmed) return undefined
  return lookup.exact.get(trimmed) ?? lookup.lower.get(trimmed.toLowerCase())
}

/**
 * 最高优先级替换 `<<id>>` / `<id>` 与 `<<id-number>>` / `<id-number>`（仅作用于已声明的 UI 控件 ID）。
 */
export function substituteUiPlaceholdersInLine(
  line: string,
  lookup: { exact: Map<string, string>; lower: Map<string, string> },
): string {
  if (lookup.exact.size === 0 || !line.includes('<')) return line

  // 1) 先替换双尖括号 <<id>> / <<id-number>>
  let out = line.replace(/<<([A-Za-z0-9_\u4e00-\u9fa5-]+)>>/g, (full, key: string) => {
    const val = resolveWidgetRef(key, lookup)
    return val !== undefined ? val : full
  })

  // 2) 再替换单尖括号 <id> / <id-number>（仅匹配本文已声明的控件 ID，绝不误伤 <div> 等普通 HTML 标签）
  out = out.replace(/<([A-Za-z0-9_\u4e00-\u9fa5-]+)>/g, (full, key: string) => {
    const val = resolveWidgetRef(key, lookup)
    return val !== undefined ? val : full
  })

  return out
}

/* -------------------------------------------------------------------------- */
/*                     KaTeX 公式条件编译器（四则 / 位运算 / 比较 / 逻辑）          */
/* -------------------------------------------------------------------------- */

type CondVal = number | string | boolean

function toBool(v: CondVal): boolean {
  if (typeof v === 'boolean') return v
  if (typeof v === 'number') return Number.isFinite(v) && v !== 0
  const s = v.trim()
  if (!s || s === '0' || s === 'false') return false
  return true
}

function toNum(v: CondVal): number {
  if (typeof v === 'number') return v
  if (typeof v === 'boolean') return v ? 1 : 0
  const t = v.trim()
  if (!t) return Number.NaN
  return Number(t)
}

/** 拆解形如 `\cmd{arg1}{arg2}` 的平衡花括号参数。 */
function expandLatexConstructs(input: string): string {
  let s = input
  const extractBrace = (str: string, start: number): { content: string; end: number } | null => {
    let i = start
    while (i < str.length && /\s/.test(str[i])) i += 1
    if (str[i] !== '{') return null
    let depth = 0
    for (let k = i; k < str.length; k += 1) {
      if (str[k] === '\\' && k + 1 < str.length) {
        k += 1
        continue
      }
      if (str[k] === '{') depth += 1
      else if (str[k] === '}') {
        depth -= 1
        if (depth === 0) return { content: str.slice(i + 1, k), end: k + 1 }
      }
    }
    return null
  }

  for (let pass = 0; pass < 8; pass += 1) {
    let changed = false
    // \frac{A}{B} / \dfrac{A}{B} / \tfrac{A}{B}
    const fracMatch = /\\(?:d|t)?frac\b/.exec(s)
    if (fracMatch) {
      const a1 = extractBrace(s, fracMatch.index + fracMatch[0].length)
      const a2 = a1 ? extractBrace(s, a1.end) : null
      if (a1 && a2) {
        s = `${s.slice(0, fracMatch.index)}((${a1.content})/(${a2.content}))${s.slice(a2.end)}`
        changed = true
        continue
      }
    }
    // \sqrt[n]{A} 或 \sqrt{A}
    const sqrtMatch = /\\sqrt\b/.exec(s)
    if (sqrtMatch) {
      let after = sqrtMatch.index + sqrtMatch[0].length
      while (after < s.length && /\s/.test(s[after])) after += 1
      if (s[after] === '[') {
        const closeB = s.indexOf(']', after + 1)
        const a1 = closeB > after ? extractBrace(s, closeB + 1) : null
        if (closeB > after && a1) {
          const deg = s.slice(after + 1, closeB)
          s = `${s.slice(0, sqrtMatch.index)}((${a1.content})^(1/(${deg})))${s.slice(a1.end)}`
          changed = true
          continue
        }
      } else {
        const a1 = extractBrace(s, after)
        if (a1) {
          s = `${s.slice(0, sqrtMatch.index)}sqrt(${a1.content})${s.slice(a1.end)}`
          changed = true
          continue
        }
      }
    }
    // \text{...} / \texttt{...} / \mathrm{...} / \operatorname{...}
    const textMatch = /\\(?:text|texttt|textbf|mathrm|operatorname)\b/.exec(s)
    if (textMatch) {
      const a1 = extractBrace(s, textMatch.index + textMatch[0].length)
      if (a1) {
        const inner = a1.content.trim()
        const mapped =
          inner === 'xor'
            ? ' xor '
            : inner === 'and'
              ? ' & '
              : inner === 'or'
                ? ' | '
                : inner === 'mod'
                  ? ' % '
                  : ` "${inner.replace(/"/g, '\\"')}" `
        s = `${s.slice(0, textMatch.index)}${mapped}${s.slice(a1.end)}`
        changed = true
        continue
      }
    }
    // \pmod{b} -> % (b)
    const pmodMatch = /\\pmod\b/.exec(s)
    if (pmodMatch) {
      const a1 = extractBrace(s, pmodMatch.index + pmodMatch[0].length)
      if (a1) {
        s = `${s.slice(0, pmodMatch.index)} % (${a1.content})${s.slice(a1.end)}`
        changed = true
        continue
      }
    }
    if (!changed) break
  }

  return s
}

interface CondToken {
  type: 'num' | 'str' | 'op' | 'lparen' | 'rparen' | 'comma' | 'fn'
  value: string
  num?: number
}

function tokenizeCondition(rawFormula: string): CondToken[] | null {
  let s = rawFormula.trim()
  // 去除外层与内联 KaTeX `$ ... $` 标记
  s = s.replace(/\$/g, ' ')
  s = expandLatexConstructs(s)
  s = s
    .replace(/\\left\s*\(/g, '(')
    .replace(/\\right\s*\)/g, ')')
    .replace(/\\lfloor\b/g, 'floor(')
    .replace(/\\rfloor\b/g, ')')
    .replace(/\\lceil\b/g, 'ceil(')
    .replace(/\\rceil\b/g, ')')
    .replace(/\\(?:leq|le|leqslant)\b|≤/g, '<=')
    .replace(/\\(?:geq|ge|geqslant)\b|≥/g, '>=')
    .replace(/\\(?:neq|ne)\b|≠/g, '!=')
    .replace(/\\lt\b/g, '<')
    .replace(/\\gt\b/g, '>')
    .replace(/\\(?:times|cdot|ast)\b/g, '*')
    .replace(/\\div\b/g, '/')
    .replace(/\\bmod\b/g, '%')
    .replace(/\\oplus\b/g, ' xor ')
    .replace(/\\ll\b/g, '<<')
    .replace(/\\gg\b/g, '>>')
    .replace(/\\&\b|\\&/g, '&')
    .replace(/\\mid\b/g, '|')
    .replace(/\\(?:land|wedge)\b/g, '&&')
    .replace(/\\(?:lor|vee)\b/g, '||')
    .replace(/\\(?:lnot|neg)\b/g, '!')
    .replace(/\\sim\b/g, '~')
    .replace(/\\(?:,|;|!|quad|qquad)\b/g, ' ')
    .replace(/[{}]/g, (ch) => (ch === '{' ? '(' : ')'))

  const tokens: CondToken[] = []
  let i = 0
  while (i < s.length) {
    if (/\s/.test(s[i])) {
      i += 1
      continue
    }
    const twoThree = s.slice(i, i + 3)
    if (twoThree === '===' || twoThree === '!==' || twoThree === '>>>') {
      tokens.push({ type: 'op', value: twoThree === '===' ? '==' : twoThree === '!==' ? '!=' : '>>>' })
      i += 3
      continue
    }
    const two = s.slice(i, i + 2)
    if (
      two === '<=' ||
      two === '>=' ||
      two === '!=' ||
      two === '==' ||
      two === '<>' ||
      two === '&&' ||
      two === '||' ||
      two === '<<' ||
      two === '>>' ||
      two === '**'
    ) {
      tokens.push({ type: 'op', value: two === '<>' ? '!=' : two === '**' ? '^' : two })
      i += 2
      continue
    }
    const ch = s[i]
    if (ch === '(') {
      tokens.push({ type: 'lparen', value: '(' })
      i += 1
      continue
    }
    if (ch === ')') {
      tokens.push({ type: 'rparen', value: ')' })
      i += 1
      continue
    }
    if (ch === ',') {
      tokens.push({ type: 'comma', value: ',' })
      i += 1
      continue
    }
    if ('+-*/%^~&|=<>!'.includes(ch)) {
      tokens.push({ type: 'op', value: ch === '=' ? '==' : ch })
      i += 1
      continue
    }
    if (ch === '"' || ch === "'") {
      let end = i + 1
      let buf = ''
      while (end < s.length && s[end] !== ch) {
        if (s[end] === '\\' && end + 1 < s.length) {
          buf += s[end + 1]
          end += 2
        } else {
          buf += s[end]
          end += 1
        }
      }
      tokens.push({ type: 'str', value: buf })
      i = end + 1
      continue
    }
    const rest = s.slice(i)
    const hexBinMatch = rest.match(/^(?:0x[0-9a-fA-F]+|0b[01]+|0o[0-7]+)/i)
    if (hexBinMatch) {
      tokens.push({ type: 'num', value: hexBinMatch[0], num: Number(hexBinMatch[0]) })
      i += hexBinMatch[0].length
      continue
    }
    const numMatch = rest.match(/^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?/i)
    if (numMatch) {
      tokens.push({ type: 'num', value: numMatch[0], num: Number(numMatch[0]) })
      i += numMatch[0].length
      continue
    }
    const wordMatch = rest.match(/^\\?[A-Za-z_\u4e00-\u9fa5][A-Za-z0-9_\u4e00-\u9fa5-]*/)
    if (wordMatch) {
      const rawWord = wordMatch[0].replace(/^\\/, '')
      const lw = rawWord.toLowerCase()
      i += wordMatch[0].length
      let look = i
      while (look < s.length && /\s/.test(s[look])) look += 1
      if (lw === 'xor') {
        tokens.push({ type: 'op', value: 'xor' })
      } else if (lw === 'true') {
        tokens.push({ type: 'num', value: '1', num: 1 })
      } else if (lw === 'false') {
        tokens.push({ type: 'num', value: '0', num: 0 })
      } else if (lw === 'pi') {
        tokens.push({ type: 'num', value: 'pi', num: Math.PI })
      } else if (
        s[look] === '(' &&
        ['abs', 'sqrt', 'min', 'max', 'floor', 'ceil', 'round', 'gcd', 'lcm', 'popcount', 'len'].includes(lw)
      ) {
        tokens.push({ type: 'fn', value: lw })
      } else {
        tokens.push({ type: 'str', value: rawWord })
      }
      continue
    }
    return null
  }
  return tokens
}

function gcdInt(a: number, b: number): number {
  let x = Math.abs(Math.trunc(a))
  let y = Math.abs(Math.trunc(b))
  while (y !== 0) {
    const t = x % y
    x = y
    y = t
  }
  return x
}

function popcount32(x: number): number {
  let n = x >>> 0
  let c = 0
  while (n) {
    n &= n - 1
    c += 1
  }
  return c
}

function compareValues(op: string, a: CondVal, b: CondVal): boolean {
  const na = toNum(a)
  const nb = toNum(b)
  if (Number.isFinite(na) && Number.isFinite(nb)) {
    const eps = 1e-11
    switch (op) {
      case '==':
        return Math.abs(na - nb) <= eps
      case '!=':
        return Math.abs(na - nb) > eps
      case '<':
        return na < nb
      case '<=':
        return na <= nb + eps
      case '>':
        return na > nb
      case '>=':
        return na >= nb - eps
      default:
        return false
    }
  }
  const sa = String(a).trim()
  const sb = String(b).trim()
  if (op === '==') return sa === sb
  if (op === '!=') return sa !== sb
  if (op === '<') return sa < sb
  if (op === '<=') return sa <= sb
  if (op === '>') return sa > sb
  if (op === '>=') return sa >= sb
  return false
}

/**
 * 求值 KaTeX 条件表达式 `<a>`：
 * 支持四则运算（`+ - * / % ^`、`\frac`、`\sqrt`、`\times`、`\div`、`\bmod`）、
 * 位运算（`& | ~ << >> >>>`、`\oplus`、`\&`、`\mid`、`\ll`、`\gg`）、
 * 比较运算（`< <= > >= = == !=`、`\le`、`\leq`、`\ge`、`\geq`、`\ne`、`\neq` 及链式不等式 `1 \le x \le 5`）
 * 以及逻辑组合（`&& || !`、`\land`、`\lor`、`\lnot`）。
 */
export function evaluateUiCondition(rawFormula: string): boolean {
  const tokens = tokenizeCondition(rawFormula)
  if (!tokens || tokens.length === 0) return false

  let pos = 0
  const peek = () => tokens[pos]
  const consume = () => tokens[pos++]

  const parseOr = (): CondVal | null => {
    let left = parseAnd()
    if (left === null) return null
    while (peek()?.type === 'op' && peek()?.value === '||') {
      consume()
      const right = parseAnd()
      if (right === null) return null
      left = toBool(left) || toBool(right)
    }
    return left
  }

  const parseAnd = (): CondVal | null => {
    let left = parseComparison()
    if (left === null) return null
    while (peek()?.type === 'op' && peek()?.value === '&&') {
      consume()
      const right = parseComparison()
      if (right === null) return null
      left = toBool(left) && toBool(right)
    }
    return left
  }

  // 支持数学链式不等式：`1 <= x <= 5` 求值为 `(1 <= x) && (x <= 5)`；允许空操作数如 `!=`（判断非空字符串）
  const parseComparison = (): CondVal | null => {
    const first = parseBitOr(true)
    if (first === null) return null
    const cmpOps = new Set(['==', '!=', '<', '<=', '>', '>='])
    if (!peek() || peek()!.type !== 'op' || !cmpOps.has(peek()!.value)) {
      return first
    }
    let result = true
    let prev: CondVal = first
    while (peek()?.type === 'op' && cmpOps.has(peek()!.value)) {
      const op = consume().value
      const next = parseBitOr(true)
      if (next === null) return null
      if (!compareValues(op, prev, next)) result = false
      prev = next
    }
    return result
  }

  const parseBitOr = (allowEmptyOperand = false): CondVal | null => {
    const tok = peek()
    if (
      allowEmptyOperand &&
      (!tok || tok.type === 'rparen' || (tok.type === 'op' && ['==', '!=', '<', '<=', '>', '>=', '&&', '||'].includes(tok.value)))
    ) {
      return ''
    }
    let left = parseBitXor()
    if (left === null) return null
    while (peek()?.type === 'op' && peek()?.value === '|') {
      consume()
      const right = parseBitXor()
      if (right === null) return null
      left = Math.trunc(toNum(left)) | Math.trunc(toNum(right))
    }
    return left
  }

  const parseBitXor = (): CondVal | null => {
    let left = parseBitAnd()
    if (left === null) return null
    while (peek()?.type === 'op' && peek()?.value === 'xor') {
      consume()
      const right = parseBitAnd()
      if (right === null) return null
      left = Math.trunc(toNum(left)) ^ Math.trunc(toNum(right))
    }
    return left
  }

  const parseBitAnd = (): CondVal | null => {
    let left = parseShift()
    if (left === null) return null
    while (peek()?.type === 'op' && peek()?.value === '&') {
      consume()
      const right = parseShift()
      if (right === null) return null
      left = Math.trunc(toNum(left)) & Math.trunc(toNum(right))
    }
    return left
  }

  const parseShift = (): CondVal | null => {
    let left = parseAdd()
    if (left === null) return null
    while (peek()?.type === 'op' && (peek()!.value === '<<' || peek()!.value === '>>' || peek()!.value === '>>>')) {
      const op = consume().value
      const right = parseAdd()
      if (right === null) return null
      const a = Math.trunc(toNum(left))
      const b = Math.trunc(toNum(right))
      left = op === '<<' ? a << b : op === '>>' ? a >> b : a >>> b
    }
    return left
  }

  const parseAdd = (): CondVal | null => {
    let left = parseMul()
    if (left === null) return null
    while (peek()?.type === 'op' && (peek()!.value === '+' || peek()!.value === '-')) {
      const op = consume().value
      const right = parseMul()
      if (right === null) return null
      left = op === '+' ? toNum(left) + toNum(right) : toNum(left) - toNum(right)
    }
    return left
  }

  const parseMul = (): CondVal | null => {
    let left = parseUnary()
    if (left === null) return null
    while (true) {
      const nx = peek()
      if (nx?.type === 'op' && (nx.value === '*' || nx.value === '/' || nx.value === '%')) {
        consume()
        const right = parseUnary()
        if (right === null) return null
        const a = toNum(left)
        const b = toNum(right)
        left = nx.value === '*' ? a * b : nx.value === '/' ? (b === 0 ? Number.NaN : a / b) : b === 0 ? Number.NaN : a % b
      } else if (nx?.type === 'lparen' || nx?.type === 'fn') {
        const right = parsePower()
        if (right === null) return null
        left = toNum(left) * toNum(right)
      } else {
        break
      }
    }
    return left
  }

  const parseUnary = (): CondVal | null => {
    const nx = peek()
    if (nx?.type === 'op') {
      if (nx.value === '+') {
        consume()
        const v = parseUnary()
        return v === null ? null : +toNum(v)
      }
      if (nx.value === '-') {
        consume()
        const v = parseUnary()
        return v === null ? null : -toNum(v)
      }
      if (nx.value === '~') {
        consume()
        const v = parseUnary()
        return v === null ? null : ~Math.trunc(toNum(v))
      }
      if (nx.value === '!') {
        consume()
        const v = parseUnary()
        return v === null ? null : !toBool(v)
      }
    }
    return parsePower()
  }

  const parsePower = (): CondVal | null => {
    const base = parsePrimary()
    if (base === null) return null
    if (peek()?.type === 'op' && peek()!.value === '^') {
      consume()
      const exp = parseUnary()
      if (exp === null) return null
      return Math.pow(toNum(base), toNum(exp))
    }
    return base
  }

  const parsePrimary = (): CondVal | null => {
    const tok = peek()
    if (!tok) return null
    if (tok.type === 'lparen') {
      consume()
      const inner = parseOr()
      if (inner === null || peek()?.type !== 'rparen') return null
      consume()
      return inner
    }
    if (tok.type === 'num') {
      consume()
      return tok.num ?? 0
    }
    if (tok.type === 'str') {
      consume()
      return tok.value
    }
    if (tok.type === 'fn') {
      const fnName = consume().value
      if (peek()?.type !== 'lparen') return null
      consume()
      const args: CondVal[] = []
      if (peek()?.type !== 'rparen') {
        while (true) {
          const arg = parseOr()
          if (arg === null) return null
          args.push(arg)
          if (peek()?.type === 'comma') {
            consume()
            continue
          }
          break
        }
      }
      if (peek()?.type !== 'rparen') return null
      consume()
      if (fnName === 'len' && args.length === 1) return String(args[0]).length
      const nums = args.map(toNum)
      if (fnName === 'abs' && nums.length === 1) return Math.abs(nums[0])
      if (fnName === 'sqrt' && nums.length === 1) return Math.sqrt(nums[0])
      if (fnName === 'floor' && nums.length === 1) return Math.floor(nums[0])
      if (fnName === 'ceil' && nums.length === 1) return Math.ceil(nums[0])
      if (fnName === 'round' && nums.length === 1) return Math.round(nums[0])
      if (fnName === 'popcount' && nums.length === 1) return popcount32(nums[0])
      if (fnName === 'min' && nums.length >= 1) return Math.min(...nums)
      if (fnName === 'max' && nums.length >= 1) return Math.max(...nums)
      if (fnName === 'gcd' && nums.length === 2) return gcdInt(nums[0], nums[1])
      if (fnName === 'lcm' && nums.length === 2) {
        const g = gcdInt(nums[0], nums[1])
        return g === 0 ? 0 : Math.abs(Math.trunc(nums[0] / g) * Math.trunc(nums[1]))
      }
      return null
    }
    return null
  }

  const value = parseOr()
  if (value === null || pos !== tokens.length) return false
  return toBool(value)
}

/* -------------------------------------------------------------------------- */
/*                    `<IF:<a>,<b>>` 行内条件扫描与替换                          */
/* -------------------------------------------------------------------------- */

/**
 * 在一行文本中展开所有 `<IF:<a>,<b>>`（支持连续多个 `<IF:...><IF:...>`、`$...$` 内含 `<` / `>` 及嵌套 `<IF:...>`）。
 */
export function expandInlineIfDirectives(line: string): string {
  if (!line.includes('<IF:')) return line

  const expandPass = (input: string): { text: string; changed: boolean } => {
    let out = ''
    let changed = false
    let i = 0

    while (i < input.length) {
      if (!input.startsWith('<IF:', i)) {
        out += input[i]
        i += 1
        continue
      }

      const startCond = i + 4
      let inMath = false
      let parenDepth = 0
      let braceDepth = 0
      let nestedIfDepth = 0
      let commaIdx = -1
      let closeIdx = -1

      for (let k = startCond; k < input.length; k += 1) {
        const ch = input[k]
        if (ch === '\\' && k + 1 < input.length) {
          k += 1
          continue
        }
        if (ch === '$') {
          inMath = !inMath
          continue
        }
        if (input.startsWith('<IF:', k)) {
          nestedIfDepth += 1
          k += 3
          continue
        }
        if (nestedIfDepth > 0 && !inMath && ch === '>') {
          nestedIfDepth -= 1
          continue
        }
        if (nestedIfDepth > 0) continue

        if (commaIdx < 0) {
          if (ch === '(') parenDepth += 1
          else if (ch === ')' && parenDepth > 0) parenDepth -= 1
          else if (ch === '{') braceDepth += 1
          else if (ch === '}' && braceDepth > 0) braceDepth -= 1
          else if (ch === ',' && !inMath && parenDepth === 0 && braceDepth === 0) {
            commaIdx = k
          }
        } else if (ch === '>' && !inMath) {
          closeIdx = k
          break
        }
      }

      if (commaIdx > 0 && closeIdx > commaIdx) {
        const condExpr = input.slice(startCond, commaIdx)
        const rawBody = input.slice(commaIdx + 1, closeIdx)
        if (evaluateUiCondition(condExpr)) {
          out += expandInlineIfDirectives(rawBody)
        }
        changed = true
        i = closeIdx + 1
      } else {
        out += input[i]
        i += 1
      }
    }

    return { text: out, changed }
  }

  let current = line
  for (let pass = 0; pass < 8; pass += 1) {
    const res = expandPass(current)
    current = res.text
    if (!res.changed || !current.includes('<IF:')) break
  }
  return current
}

/** 编码/解码 HTML data 属性 payload。 */
export function encodeUiPayload(value: unknown): string {
  return encodeURIComponent(JSON.stringify(value))
}

export function decodeUiPayload<T>(encoded: string | undefined): T | null {
  if (!encoded) return null
  try {
    return JSON.parse(decodeURIComponent(encoded)) as T
  } catch {
    return null
  }
}

/**
 * 将文章中的所有 UI 交互控件、`<id>`、`::IF[...]`、`<IF:...>` 降级为可读的静态 Markdown（用于复制洛谷源码 / 复制基本源码）。
 */
export function renderStaticUiMarkdown(markdown: string): string {
  const defs = extractUiWidgetDefs(markdown)
  const initialStates: UiStateMap = {}
  for (const def of defs) initialStates[def.id] = createInitialWidgetState(def)
  const lookup = buildUiValueLookup(defs, initialStates)

  const lines = markdown.replace(/\r\n/g, '\n').split('\n')
  const out: string[] = []
  let inFence = false
  let fenceChar = ''
  let fenceLen = 0
  const ifStack: boolean[] = []

  const isActive = () => ifStack.every(Boolean)

  for (let i = 0; i < lines.length; i += 1) {
    const rawLine = lines[i]
    const fenceMatch = rawLine.match(/^\s*(`{3,}|~{3,})/)
    if (fenceMatch) {
      const ch = fenceMatch[1][0]
      const len = fenceMatch[1].length
      if (!inFence) {
        inFence = true
        fenceChar = ch
        fenceLen = len
      } else if (ch === fenceChar && len >= fenceLen) {
        inFence = false
      }
      if (isActive()) out.push(rawLine)
      continue
    }
    if (inFence) {
      if (isActive()) out.push(rawLine)
      continue
    }

    const subLine = substituteUiPlaceholdersInLine(rawLine, lookup)

    const blockIfMatch = subLine.match(/^\s*::IF\[([\s\S]*)\]\s*$/)
    if (blockIfMatch) {
      ifStack.push(isActive() && evaluateUiCondition(blockIfMatch[1]))
      continue
    }
    if (/^\s*::IF_END\s*$/.test(subLine)) {
      if (ifStack.length > 0) ifStack.pop()
      continue
    }
    if (!isActive()) continue

    const chooseOpen = subLine.match(/^\s*::begin_ui-choose([\s\S]*)$/)
    if (chooseOpen) {
      const body: string[] = []
      let j = i + 1
      while (j < lines.length && !/^\s*::end_ui-choose\s*$/.test(lines[j])) {
        body.push(expandInlineIfDirectives(substituteUiPlaceholdersInLine(lines[j], lookup)))
        j += 1
      }
      if (j < lines.length) {
        const parsed = parseUiChooseBlock(chooseOpen[1], body)
        if (parsed) {
          out.push('')
          if (parsed.name) out.push(`> **${parsed.name}**`)
          for (const opt of parsed.options) {
            out.push(`> - **[${opt.label}]** ${opt.content.replace(/\n+/g, ' ')}`)
          }
          out.push('')
        }
        i = j
        continue
      }
    }

    const selectOpen = subLine.match(/^\s*::begin_ui-select([\s\S]*)$/)
    if (selectOpen) {
      const body: string[] = []
      let j = i + 1
      while (j < lines.length && !/^\s*::end_ui-select\s*$/.test(lines[j])) {
        body.push(expandInlineIfDirectives(substituteUiPlaceholdersInLine(lines[j], lookup)))
        j += 1
      }
      if (j < lines.length) {
        const parsed = parseUiSelectBlock(selectOpen[1], body)
        const repr = parsed?.options[0]?.content ? `【${parsed.options[0].content}】` : ''
        if (repr) {
          if (out.length > 0 && out[out.length - 1].trim() !== '') {
            out[out.length - 1] = `${out[out.length - 1]}${repr}`
          } else {
            out.push(repr)
          }
        }
        i = j
        continue
      }
    }

    const ifOpen = subLine.match(/^\s*::begin_ui-if([\s\S]*)$/)
    if (ifOpen) {
      const body: string[] = []
      let j = i + 1
      while (j < lines.length && !/^\s*::end_ui-if\s*$/.test(lines[j])) {
        body.push(expandInlineIfDirectives(substituteUiPlaceholdersInLine(lines[j], lookup)))
        j += 1
      }
      if (j < lines.length) {
        const parsed = parseUiIfBlock(ifOpen[1], body)
        if (parsed) {
          out.push('')
          for (const item of parsed.items) {
            out.push(`- [ ] ${item.content.replace(/\n+/g, ' ')}`)
          }
          out.push('')
        }
        i = j
        continue
      }
    }

    // 替换行内与块级 ::ui-write[...] 为默认值的可读静态占位
    let expanded = expandInlineIfDirectives(subLine)
    let built = ''
    let pos = 0
    while (pos < expanded.length) {
      if (expanded.startsWith('::ui-write[', pos)) {
        const parsed = parseUiWriteToken(expanded.slice(pos + '::ui-write'.length))
        if (parsed) {
          const val = normalizeWriteInitialValue(parsed.def) || '___'
          built += parsed.def.name ? `**${parsed.def.name}**：\`${val}\`` : `\`${val}\``
          pos += '::ui-write'.length + parsed.consumedLength
          continue
        }
      }
      built += expanded[pos]
      pos += 1
    }
    expanded = built
    out.push(expanded)
  }

  return out.join('\n')
}
