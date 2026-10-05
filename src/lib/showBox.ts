export type ShowValue = number | string
export type ShowVariableType = 'integer' | 'rational' | 'string'

export interface ShowVariable {
  name: string
  type: ShowVariableType
  min?: number
  max?: number
  step?: number
  minLength?: number
  maxLength?: number
  /** 有理数需显式声明 {faster_set} 才会显示滑动条。 */
  fastSet?: boolean
  initial: ShowValue
}

export interface ShowMapping {
  name: string
  values: Map<string, string>
}

/** 按顶层分隔符切分，忽略圆括号、方括号与花括号内的分隔符。 */
export function splitTopLevel(input: string, separators = ',;'): string[] {
  const output: string[] = []
  let start = 0
  let depth = 0
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index]
    if ('([{'.includes(char)) depth += 1
    if (')]}'.includes(char)) depth = Math.max(0, depth - 1)
    if (depth === 0 && separators.includes(char)) {
      const piece = input.slice(start, index).trim()
      if (piece) output.push(piece)
      start = index + 1
    }
  }
  const rest = input.slice(start).trim()
  if (rest) output.push(rest)
  return output
}

function numberOr(value: string | undefined, fallback: number): number {
  if (value === undefined || !value.trim()) return fallback
  const parsed = Number(value.trim())
  return Number.isFinite(parsed) ? parsed : fallback
}

function parseVariable(raw: string): ShowVariable | null {
  const match = raw.trim().match(/^([^\s:=\[\](){}]+)([\s\S]*)$/)
  if (!match) return null
  const name = match[1]
  let remainder = match[2].trim()
  let type: ShowVariableType = 'integer'

  // Z / Q / S are the preferred short forms for integer, rational and string.
  const typeMatch = remainder.match(
    /^:\s*(integer|int|z|整数|rational|number|float|q|有理数|string|text|s|字符串)/i,
  )
  if (typeMatch) {
    const normalized = typeMatch[1].toLowerCase()
    type = ['string', 'text', 's', '字符串'].includes(normalized)
      ? 'string'
      : ['rational', 'number', 'float', 'q', '有理数'].includes(normalized)
        ? 'rational'
        : 'integer'
    remainder = remainder.slice(typeMatch[0].length).trim()
  }

  // {faster_set} is intentionally opt-in for Q variables, so long ranges do
  // not unexpectedly turn into an imprecise slider. It is accepted anywhere
  // after the variable type, including `x:Q{faster_set}=…[…]`.
  const fastSet = /\{faster_set\}/i.test(remainder)
  remainder = remainder.replace(/\{faster_set\}/gi, '').trim()

  let defaultText: string | undefined
  const defaultMatch = remainder.match(/^=\s*([^\[\]()]+?)(?=\s*(?:\[|\(|$))/)
  if (defaultMatch) {
    defaultText = defaultMatch[1].trim()
    remainder = remainder.slice(defaultMatch[0].length).trim()
  }

  const rangeMatch = remainder.match(/^[\[(]\s*([\s\S]*?)\s*[\])]$/)
  const limits = rangeMatch ? splitTopLevel(rangeMatch[1]) : []

  if (type === 'string') {
    const minLength = Math.max(0, Math.floor(numberOr(limits[0], 0)))
    const maxLength = Math.max(minLength, Math.floor(numberOr(limits[1], 100)))
    const initial = (defaultText ?? '').slice(0, maxLength)
    return { name, type, minLength, maxLength, initial }
  }

  const min = numberOr(limits[0], type === 'integer' ? 0 : -100)
  const max = Math.max(min, numberOr(limits[1], type === 'integer' ? 100 : 100))
  const defaultStep = type === 'integer' ? 1 : 0.1
  const suppliedStep = Math.abs(numberOr(limits[2], defaultStep))
  const step = suppliedStep || defaultStep
  const parsedInitial = numberOr(defaultText, min <= 0 && max >= 0 ? 0 : min)
  const roundedInitial = type === 'integer' ? Math.round(parsedInitial) : parsedInitial
  return {
    name,
    type,
    min,
    max,
    step,
    fastSet: type === 'rational' && fastSet,
    initial: Math.min(max, Math.max(min, roundedInitial)),
  }
}

export function parseShowMappings(content: string): ShowMapping[] {
  const pattern = /\*&([^:*&{}()\s]+):\{([\s\S]*?)\}\*&/g
  const mappings: ShowMapping[] = []
  let match: RegExpExecArray | null
  while ((match = pattern.exec(content))) {
    const values = new Map<string, string>()
    for (const pair of splitTopLevel(match[2], ';')) {
      const comma = pair.indexOf(',')
      if (comma < 0) continue
      const key = pair.slice(0, comma).trim()
      // A trailing % is accepted for compatibility with early syntax examples.
      const value = pair.slice(comma + 1).trim().replace(/%$/, '').trim()
      if (key) values.set(key, value)
    }
    if (values.size) mappings.push({ name: match[1].trim(), values })
  }
  return mappings
}

function mappingVariable(mapping: ShowMapping): ShowVariable {
  const keys = [...mapping.values.keys()]
  const numeric = keys.map((key) => Number(key))
  const allNumeric = numeric.every((key) => Number.isFinite(key))
  const allIntegers = allNumeric && numeric.every((key) => Number.isInteger(key))
  if (allNumeric) {
    const min = Math.min(...numeric)
    const max = Math.max(...numeric)
    return {
      name: mapping.name,
      type: allIntegers ? 'integer' : 'rational',
      min,
      max,
      step: allIntegers ? 1 : 0.1,
      initial: numeric[0],
    }
  }
  return {
    name: mapping.name,
    type: 'string',
    minLength: 0,
    maxLength: Math.max(20, ...keys.map((key) => key.length)),
    initial: keys[0] || '',
  }
}

export function parseShowVariables(specification: string, content: string): ShowVariable[] {
  const variables = new Map<string, ShowVariable>()
  for (const raw of splitTopLevel(specification)) {
    const variable = parseVariable(raw)
    if (variable) variables.set(variable.name, variable)
  }
  for (const mapping of parseShowMappings(content)) {
    if (!variables.has(mapping.name)) variables.set(mapping.name, mappingVariable(mapping))
  }
  return [...variables.values()]
}

export function showValueKey(value: ShowValue): string {
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(12)))
  return value
}

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return '未定义'
  if (Math.abs(value) < 1e-12) return '0'
  return String(Number(value.toFixed(10)))
}

/** Tiny arithmetic parser: + - * / ^ parentheses and variable names only. */
export function evaluateShowFormula(source: string, values: Record<string, ShowValue>): number | null {
  let cursor = 0
  const skip = () => {
    while (/\s/.test(source[cursor] || '')) cursor += 1
  }
  const parseExpression = (): number | null => {
    let value = parseTerm()
    while (value !== null) {
      skip()
      const operator = source[cursor]
      if (operator !== '+' && operator !== '-') break
      cursor += 1
      const next = parseTerm()
      if (next === null) return null
      value = operator === '+' ? value + next : value - next
    }
    return value
  }
  const parseTerm = (): number | null => {
    let value = parsePower()
    while (value !== null) {
      skip()
      const operator = source[cursor]
      if (operator !== '*' && operator !== '/') break
      cursor += 1
      const next = parsePower()
      if (next === null || (operator === '/' && next === 0)) return null
      value = operator === '*' ? value * next : value / next
    }
    return value
  }
  const parsePower = (): number | null => {
    let value = parsePrimary()
    skip()
    if (value !== null && source[cursor] === '^') {
      cursor += 1
      const exponent = parsePower()
      if (exponent === null) return null
      value = value ** exponent
    }
    return value
  }
  const parsePrimary = (): number | null => {
    skip()
    if (source[cursor] === '+') {
      cursor += 1
      return parsePrimary()
    }
    if (source[cursor] === '-') {
      cursor += 1
      const value = parsePrimary()
      return value === null ? null : -value
    }
    if (source[cursor] === '(') {
      cursor += 1
      const value = parseExpression()
      skip()
      if (source[cursor] !== ')') return null
      cursor += 1
      return value
    }
    const remainder = source.slice(cursor)
    const number = remainder.match(/^(?:\d+(?:\.\d*)?|\.\d+)/)
    if (number) {
      cursor += number[0].length
      return Number(number[0])
    }
    const identifier = remainder.match(/^[\p{L}_][\p{L}\p{N}_-]*/u)
    if (!identifier) return null
    cursor += identifier[0].length
    const value = values[identifier[0]]
    return typeof value === 'number' && Number.isFinite(value) ? value : null
  }

  const result = parseExpression()
  skip()
  return result === null || cursor !== source.length || !Number.isFinite(result) ? null : result
}

function unwrapPlaceholder(value: string): string {
  const trimmed = value.trim()
  return trimmed.startsWith('[') && trimmed.endsWith(']') ? trimmed.slice(1, -1).trim() : trimmed
}

function shiftDecimal(value: number, places: number): number {
  if (value === 0) return 0
  const [coefficient, exponent = '0'] = String(value).split('e')
  return Number(`${coefficient}e${Number(exponent) + places}`)
}

function formatDirectionalRound(value: number, places: number, mode: 'floor' | 'ceil'): string {
  // toFixed supports at most 100 decimal places. Bounding the exponent also
  // prevents malformed article input from producing Infinity.
  if (!Number.isInteger(places) || Math.abs(places) > 100) return '未定义'
  const shifted = shiftDecimal(value, places)
  if (!Number.isFinite(shifted)) return '未定义'
  // Arithmetic expressions such as 0.1 + 0.2 can land a few ULPs away from
  // an integer after scaling. Snap only that floating-point noise so ceil does
  // not unexpectedly turn 0.30000000000000004 into 0.4.
  const nearest = Math.round(shifted)
  const tolerance = Number.EPSILON * Math.max(1, Math.abs(shifted)) * 8
  const stableShifted = Math.abs(shifted - nearest) <= tolerance ? nearest : shifted
  const rounded = mode === 'floor' ? Math.floor(stableShifted) : Math.ceil(stableShifted)
  const result = shiftDecimal(rounded, -places)
  if (!Number.isFinite(result)) return '未定义'
  const normalized = Object.is(result, -0) ? 0 : result
  return places > 0 ? normalized.toFixed(places) : String(normalized)
}

/**
 * 替换 `&*floor(数值,位数)&*` / `&*ceil(数值,位数)&*`。
 * 同时容忍展示框旧语法所使用的 `*&…*&` 包裹方式。
 */
function replaceDirectionalRounds(source: string, values: Record<string, ShowValue>): string {
  const starts = ['&*floor(', '&*ceil(', '*&floor(', '*&ceil(']
  let output = ''
  let cursor = 0

  while (cursor < source.length) {
    let start = -1
    let marker = ''
    for (const candidate of starts) {
      const index = source.indexOf(candidate, cursor)
      if (index >= 0 && (start < 0 || index < start)) {
        start = index
        marker = candidate
      }
    }
    if (start < 0) {
      output += source.slice(cursor)
      break
    }

    output += source.slice(cursor, start)
    const openParen = start + marker.length - 1
    let depth = 1
    let endParen = openParen + 1
    while (endParen < source.length && depth > 0) {
      if (source[endParen] === '(') depth += 1
      if (source[endParen] === ')') depth -= 1
      if (depth > 0) endParen += 1
    }

    const suffix = marker.startsWith('&*') ? '&*' : '*&'
    if (depth !== 0 || source.slice(endParen + 1, endParen + 3) !== suffix) {
      output += source[start]
      cursor = start + 1
      continue
    }

    const args = splitTopLevel(source.slice(openParen + 1, endParen), ',')
    const number = args.length === 2
      ? evaluateShowFormula(unwrapPlaceholder(args[0]), values)
      : null
    const placesValue = args.length === 2
      ? evaluateShowFormula(unwrapPlaceholder(args[1]), values)
      : null
    const mode = marker.includes('floor') ? 'floor' : 'ceil'
    output += number === null || placesValue === null
      ? '未定义'
      : formatDirectionalRound(number, placesValue, mode)
    cursor = endParen + 3
  }

  return output
}

export function renderShowContent(
  body: string,
  values: Record<string, ShowValue>,
  mappings: ShowMapping[],
): string {
  const stashed: string[] = []
  const withoutMappings = body.replace(/\*&([^:*&{}()\s]+):\{([\s\S]*?)\}\*&/g, (_token, name: string) => {
    const mapping = mappings.find((item) => item.name === name)
    const value = mapping?.values.get(showValueKey(values[name] ?? '')) ?? ''
    const marker = `\uE000${stashed.length}\uE001`
    stashed.push(value)
    return marker
  })
  // 特殊语法等价于「在源码里把这一段直接替换成对应的值」，所以这里只写回
  // 纯文本：既不会被包进 <code> 展示框，也能出现在代码块、表格、公式里。
  const withRounds = replaceDirectionalRounds(withoutMappings, values)
  const withFormulas = withRounds.replace(/\*&hs\(([\s\S]*?)\)\*&/g, (_token, formula: string) => {
    const result = evaluateShowFormula(formula.trim(), values)
    return result === null ? '未定义' : formatNumber(result)
  })
  const withValues = withFormulas.replace(/\*&show\(([^)]+)\)\*&/g, (_token, rawName: string) => {
    const value = values[rawName.trim()]
    return value === undefined ? '未定义' : showValueKey(value)
  })
  return withValues.replace(/\uE000(\d+)\uE001/g, (_token, index: string) => stashed[Number(index)] ?? '')
}

export function initialShowValues(variables: ShowVariable[]): Record<string, ShowValue> {
  return Object.fromEntries(variables.map((variable) => [variable.name, variable.initial])) as Record<string, ShowValue>
}

export function clampShowVariable(variable: ShowVariable, raw: string): ShowValue {
  if (variable.type === 'string') return raw.slice(0, variable.maxLength ?? 100)
  const number = Number(raw)
  if (!Number.isFinite(number)) return variable.initial
  const limited = Math.min(variable.max ?? number, Math.max(variable.min ?? number, number))
  return variable.type === 'integer' ? Math.round(limited) : limited
}
