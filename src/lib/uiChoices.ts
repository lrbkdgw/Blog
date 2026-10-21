export type UiWidgetKind = 'choose' | 'select' | 'if'

export type UiStateValue = number | number[] | boolean[] | string

export interface UiChoiceOption {
  /** `choose` options use a separate bracketed label; other widgets use their content. */
  label: string
  content: string
}

export interface UiChoiceConfig {
  kind: UiWidgetKind
  id: string
  title: string
  extra: string
  options: UiChoiceOption[]
  minCount: number
  maxCount: number
  search: boolean
  lined: boolean
  errors: string[]
}

function clampCount(value: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback
  return Math.min(999, Math.max(0, Math.floor(value)))
}

function parseMore(extra: string): { minCount: number; maxCount: number } {
  const match = extra.match(/(?:^|\s)more\s+(\d+)\s+(\d+)(?=\s|$)/i)
  if (!match) return { minCount: 1, maxCount: 1 }
  let minCount = clampCount(Number(match[1]), 1)
  let maxCount = clampCount(Number(match[2]), 1)
  // `more <down> <up>` is a lower / upper count pair. Be forgiving if the
  // author reverses them rather than producing an impossible range.
  if (minCount > maxCount) [minCount, maxCount] = [maxCount, minCount]
  return { minCount, maxCount }
}

function parseLabeledOptions(body: string): UiChoiceOption[] {
  const lines = body.replace(/\r\n?/g, '\n').split('\n')
  const options: UiChoiceOption[] = []
  let label: string | null = null
  let content: string[] = []
  let fence: { marker: string; length: number } | null = null
  const flush = () => {
    if (label === null) return
    options.push({ label, content: content.join('\n').trim() })
  }

  for (const line of lines) {
    const marker = line.match(/^\s*(`{3,}|~{3,})/)
    if (marker) {
      if (!fence) fence = { marker: marker[1][0], length: marker[1].length }
      else if (fence.marker === marker[1][0] && marker[1].length >= fence.length) fence = null
      if (label !== null) content.push(line)
      continue
    }
    if (fence) {
      if (label !== null) content.push(line)
      continue
    }
    const heading = line.match(/^\s*\[([^\]\r\n]+)\]\s*$/)
    if (heading) {
      flush()
      label = heading[1].trim()
      content = []
    } else if (label !== null) {
      content.push(line)
    }
  }
  flush()
  return options
}

function parseLineOptions(body: string): UiChoiceOption[] {
  return body
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((content) => ({ label: content, content }))
}

function parseIfOptions(body: string): UiChoiceOption[] {
  const lines = body.replace(/\r\n?/g, '\n').split('\n')
  const sections: string[][] = [[]]
  let fence: { marker: string; length: number } | null = null
  for (const line of lines) {
    const marker = line.match(/^\s*(`{3,}|~{3,})/)
    if (marker) {
      if (!fence) fence = { marker: marker[1][0], length: marker[1].length }
      else if (fence.marker === marker[1][0] && marker[1].length >= fence.length) fence = null
      sections[sections.length - 1].push(line)
      continue
    }
    if (!fence && /^\s*::nex\s*$/i.test(line)) {
      sections.push([])
    } else {
      sections[sections.length - 1].push(line)
    }
  }
  return sections
    .map((linesForOption) => linesForOption.join('\n').trim())
    .filter(Boolean)
    .map((content) => ({ label: '', content }))
}

export function isValidUiId(id: string): boolean {
  return /^[\p{L}\p{N}_][\p{L}\p{N}_.-]*$/u.test(id)
}

/** Parse one `choose`, `select`, or checkbox (`if`) widget body. */
export function parseUiChoiceConfig(
  kind: UiWidgetKind,
  id: string,
  title: string,
  extra: string,
  body: string,
): UiChoiceConfig {
  const options =
    kind === 'choose'
      ? parseLabeledOptions(body)
      : kind === 'select'
        ? parseLineOptions(body)
        : parseIfOptions(body)
  const { minCount: rawMin, maxCount: rawMax } = parseMore(extra)
  const minCount = Math.min(rawMin, options.length)
  const maxCount = Math.max(minCount, Math.min(rawMax, options.length))
  const errors: string[] = []

  if (!isValidUiId(id)) errors.push('控件 id 不能为空，且只能包含字母、数字、下划线、点或连字符。')
  if (options.length === 0) {
    errors.push(kind === 'choose' ? '未找到 `[选项名]` 选项。' : '至少需要一个选项。')
  }
  if (rawMin !== 1 || rawMax !== 1) {
    if (rawMin > options.length || rawMax > options.length) {
      errors.push(`选项数量不足：当前有 ${options.length} 项，已自动缩小选择范围。`)
    }
  }

  return {
    kind,
    id,
    title,
    extra,
    options,
    minCount,
    maxCount,
    search: /(?:^|\s)search(?:\s|$)/i.test(extra),
    lined: kind === 'if' && /(?:^|\s)lined(?:\s|$)/i.test(extra),
    errors,
  }
}

export function initialUiChoiceValue(config: Pick<UiChoiceConfig, 'kind' | 'minCount' | 'options'>): UiStateValue {
  if (config.kind === 'if') return config.options.map(() => false)
  return Array.from({ length: config.minCount }, (_, index) => index + 1)
}

export function normalizeSelectedIndexes(
  value: UiStateValue | undefined,
  optionCount: number,
  fallback: number[],
): number[] {
  const source = Array.isArray(value) && value.every((item) => typeof item === 'number') ? value : fallback
  return [...new Set(source)]
    .filter((index) => Number.isInteger(index) && index >= 1 && index <= optionCount)
    .sort((a, b) => a - b)
}

function numericReferenceValue(reference: string, values: Record<string, UiStateValue>): number | undefined {
  const direct = values[reference]
  if (typeof direct === 'number' && Number.isFinite(direct)) return direct
  if (typeof direct === 'string' && direct.trim() !== '') {
    const numeric = Number(direct)
    if (Number.isFinite(numeric)) return numeric
  }
  if (Array.isArray(direct)) {
    if (direct.every((item) => typeof item === 'number')) return direct[0] as number | undefined
    if (direct.every((item) => typeof item === 'boolean')) {
      return direct.filter(Boolean).length
    }
  }

  // `ui-if` exposes each checkbox as `<<id-1>>`, `<<id-2>>`, … (1-indexed).
  const indexed = reference.match(/^(.+)-(\d+)$/)
  if (indexed) {
    const parent = values[indexed[1]]
    const index = Number(indexed[2]) - 1
    if (Array.isArray(parent) && index >= 0 && index < parent.length) {
      if (parent.every((item) => typeof item === 'boolean')) return parent[index] ? 1 : 0
      if (parent.every((item) => typeof item === 'number')) return parent.includes(Number(indexed[2])) ? 1 : 0
    }
  }
  return undefined
}

/** Resolve a visible `<<id>>` value. Unset references remain empty. */
export function formatUiReference(reference: string, values: Record<string, UiStateValue>): string {
  const direct = values[reference]
  if (typeof direct === 'number') return Number.isInteger(direct) ? String(direct) : String(Number(direct.toFixed(8)))
  if (typeof direct === 'string') return direct
  if (Array.isArray(direct)) {
    if (direct.every((item) => typeof item === 'number')) return direct.join(', ')
    if (direct.every((item) => typeof item === 'boolean')) {
      return direct.map((selected, index) => (selected ? index + 1 : null)).filter(Boolean).join(', ')
    }
  }
  const indexed = numericReferenceValue(reference, values)
  return indexed === undefined ? '' : String(indexed)
}

function normalizeConditionSource(source: string): string {
  return source
    .replace(/\$/g, '')
    .replace(/\\(?:left|right)\b/g, '')
    .replace(/\\(?:,|;|!)/g, ' ')
    .replace(/\\(?:quad|qquad)\b/g, ' ')
    .replace(/\\(?:leq|le)\b/g, '<=')
    .replace(/\\(?:geq|ge)\b/g, '>=')
    .replace(/\\(?:neq|ne)\b/g, '!=')
    .replace(/\\(?:lt)\b/g, '<')
    .replace(/\\(?:gt)\b/g, '>')
    .replace(/\\(?:times|cdot)\b/g, '*')
    .replace(/\\div\b/g, '/')
    .replace(/\\(?:land|wedge)\b/g, '&&')
    .replace(/\\(?:lor|vee)\b/g, '||')
    .replace(/\\oplus\b/g, '^')
    .replace(/\\(?:neg|lnot)\b/g, '!')
    .replace(/\\pi\b/g, 'pi')
    .replace(/\\mathrm\{([^}]*)\}/g, '$1')
    .replace(/\\text\{([^}]*)\}/g, '$1')
    .replace(/\\\{/g, '(')
    .replace(/\\\}/g, ')')
    .replace(/\\&/g, '&')
}

interface ConditionToken {
  kind: 'number' | 'identifier' | 'operator'
  value: string
}

function tokenizeCondition(source: string): ConditionToken[] | null {
  const tokens: ConditionToken[] = []
  let index = 0
  const operators = ['===', '!==', '>>>', '**', '<<', '>>', '<=', '>=', '==', '!=', '&&', '||']

  while (index < source.length) {
    if (/\s/.test(source[index])) {
      index += 1
      continue
    }
    const remainder = source.slice(index)
    const number = remainder.match(/^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/)
    if (number) {
      tokens.push({ kind: 'number', value: number[0] })
      index += number[0].length
      continue
    }
    const identifier = remainder.match(/^[\p{L}_][\p{L}\p{N}_]*/u)
    if (identifier) {
      tokens.push({ kind: 'identifier', value: identifier[0] })
      index += identifier[0].length
      continue
    }
    const operator = operators.find((candidate) => remainder.startsWith(candidate))
    if (operator) {
      tokens.push({ kind: 'operator', value: operator })
      index += operator.length
      continue
    }
    if ('+-*/%<>&|^!~(),'.includes(source[index])) {
      tokens.push({ kind: 'operator', value: source[index] })
      index += 1
      continue
    }
    return null
  }
  return tokens
}

type ConditionValue = number | boolean

const BINARY_PRECEDENCE: Record<string, number> = {
  '||': 1,
  '&&': 2,
  '|': 3,
  '^': 4,
  '&': 5,
  '==': 6,
  '===': 6,
  '!=': 6,
  '!==': 6,
  '<': 7,
  '<=': 7,
  '>': 7,
  '>=': 7,
  '<<': 8,
  '>>': 8,
  '>>>': 8,
  '+': 9,
  '-': 9,
  '*': 10,
  '/': 10,
  '%': 10,
  '**': 11,
}

function asNumber(value: ConditionValue): number {
  return typeof value === 'boolean' ? (value ? 1 : 0) : value
}

function applyBinary(operator: string, left: ConditionValue, right: ConditionValue): ConditionValue | null {
  const a = asNumber(left)
  const b = asNumber(right)
  switch (operator) {
    case '||': return Boolean(left) || Boolean(right)
    case '&&': return Boolean(left) && Boolean(right)
    case '|': return (Math.trunc(a) | Math.trunc(b))
    case '^': return (Math.trunc(a) ^ Math.trunc(b))
    case '&': return (Math.trunc(a) & Math.trunc(b))
    case '==':
    case '===': return a === b
    case '!=':
    case '!==': return a !== b
    case '<': return a < b
    case '<=': return a <= b
    case '>': return a > b
    case '>=': return a >= b
    case '<<': return Math.trunc(a) << (Math.trunc(b) & 31)
    case '>>': return Math.trunc(a) >> (Math.trunc(b) & 31)
    case '>>>': return Math.trunc(a) >>> (Math.trunc(b) & 31)
    case '+': return a + b
    case '-': return a - b
    case '*': return a * b
    case '/': return b === 0 ? null : a / b
    case '%': return b === 0 ? null : a % b
    case '**': return a ** b
    default: return null
  }
}

function applyFunction(name: string, args: ConditionValue[]): ConditionValue | null {
  const numbers = args.map(asNumber)
  let result: number
  switch (name.toLowerCase()) {
    case 'abs': if (numbers.length !== 1) return null; result = Math.abs(numbers[0]); break
    case 'sqrt': if (numbers.length !== 1) return null; result = Math.sqrt(numbers[0]); break
    case 'floor': if (numbers.length !== 1) return null; result = Math.floor(numbers[0]); break
    case 'ceil': if (numbers.length !== 1) return null; result = Math.ceil(numbers[0]); break
    case 'round': if (numbers.length !== 1) return null; result = Math.round(numbers[0]); break
    case 'sin': if (numbers.length !== 1) return null; result = Math.sin(numbers[0]); break
    case 'cos': if (numbers.length !== 1) return null; result = Math.cos(numbers[0]); break
    case 'tan': if (numbers.length !== 1) return null; result = Math.tan(numbers[0]); break
    case 'min': if (!numbers.length) return null; result = Math.min(...numbers); break
    case 'max': if (!numbers.length) return null; result = Math.max(...numbers); break
    default: return null
  }
  return Number.isFinite(result) ? result : null
}

function evaluateTokens(tokens: ConditionToken[]): ConditionValue | null {
  let cursor = 0
  const peek = () => tokens[cursor]
  const take = () => tokens[cursor++]

  const parsePrefix = (): ConditionValue | null => {
    const token = take()
    if (!token) return null

    if (token.kind === 'operator' && ['+', '-', '!', '~'].includes(token.value)) {
      const value = parseExpression(12)
      if (value === null) return null
      if (token.value === '+') return asNumber(value)
      if (token.value === '-') return -asNumber(value)
      if (token.value === '!') return !Boolean(value)
      return ~Math.trunc(asNumber(value))
    }

    if (token.kind === 'operator' && token.value === '(') {
      const value = parseExpression(1)
      if (value === null || peek()?.value !== ')') return null
      take()
      return value
    }

    if (token.kind === 'number') {
      const value = Number(token.value)
      return Number.isFinite(value) ? value : null
    }

    if (token.kind === 'identifier') {
      const name = token.value.toLowerCase()
      if (name === 'true') return true
      if (name === 'false') return false
      if (name === 'pi') return Math.PI
      if (name === 'e') return Math.E
      if (peek()?.value !== '(') return null
      take()
      const args: ConditionValue[] = []
      if (peek()?.value !== ')') {
        while (true) {
          const arg = parseExpression(1)
          if (arg === null) return null
          args.push(arg)
          if (peek()?.value !== ',') break
          take()
        }
      }
      if (peek()?.value !== ')') return null
      take()
      return applyFunction(name, args)
    }
    return null
  }

  const parseExpression = (minimumPrecedence: number): ConditionValue | null => {
    let left = parsePrefix()
    if (left === null) return null

    while (true) {
      const operator = peek()
      const precedence = operator?.kind === 'operator' ? BINARY_PRECEDENCE[operator.value] : undefined
      if (precedence === undefined || precedence < minimumPrecedence) break
      take()
      const rightAssociative = operator!.value === '**'
      const right = parseExpression(precedence + (rightAssociative ? 0 : 1))
      if (right === null) return null
      left = applyBinary(operator!.value, left, right)
      if (left === null || (typeof left === 'number' && !Number.isFinite(left))) return null
    }
    return left
  }

  const result = parseExpression(1)
  return result !== null && cursor === tokens.length ? result : null
}

function replaceConditionReferences(source: string, values: Record<string, UiStateValue>): string {
  return source.replace(
    /<<([\p{L}\p{N}_.-]+)>>|<([\p{L}_][\p{L}\p{N}_.-]*)>/gu,
    (token, doubleId: string | undefined, singleId: string | undefined) => {
      const value = numericReferenceValue(doubleId ?? singleId ?? '', values)
      return value === undefined ? token : String(value)
    },
  )
}

/** Safe arithmetic / comparison evaluator for `<IF:…>` and `::IF[…]`. */
export function evaluateUiCondition(source: string, values: Record<string, UiStateValue>): boolean {
  const normalized = normalizeConditionSource(replaceConditionReferences(source, values))
  const tokens = tokenizeCondition(normalized)
  if (!tokens || tokens.length === 0) return false
  const result = evaluateTokens(tokens)
  if (result === null) return false
  return typeof result === 'boolean' ? result : Number.isFinite(result) && result !== 0
}

/** Replace live variable references inside TeX, using the current choice values. */
export function resolveUiMathReferences(source: string, values: Record<string, UiStateValue>): string {
  return source.replace(
    /<<([\p{L}\p{N}_.-]+)>>|<([\p{L}_][\p{L}\p{N}_.-]*)>/gu,
    (_token, doubleId: string | undefined, singleId: string | undefined) => {
      const value = numericReferenceValue(doubleId ?? singleId ?? '', values)
      return value === undefined ? '0' : String(value)
    },
  )
}
