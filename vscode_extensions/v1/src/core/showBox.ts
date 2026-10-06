/**
 * 交互展示框的解析 / 求值 / 渲染核心。
 *
 * 这份代码从 Blog 仓库的 `src/lib/showBox.ts` 移植而来，去掉了所有对 React 与
 * 浏览器 API 的依赖，因此可以同时在以下三种环境里运行：
 *
 * 1. VS Code 扩展主进程（markdown-it 插件、命令）；
 * 2. VS Code 内置 Markdown 预览的 Webview（交互脚本）；
 * 3. Markdown Preview Enhanced 的 QuickJS 沙箱（`~/.crossnote/parser.js`）。
 *
 * 所以这里只允许使用 ES2019 级别的纯语言特性，不能出现 require / fs / DOM。
 */

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
  values: Array<[string, string]>
}

/** 按顶层分隔符切分，忽略圆括号、方括号与花括号内的分隔符。 */
export function splitTopLevel(input: string, separators = ',;'): string[] {
  const output: string[] = []
  let start = 0
  let depth = 0
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index]
    if ('([{'.indexOf(char) >= 0) depth += 1
    if (')]}'.indexOf(char) >= 0) depth = Math.max(0, depth - 1)
    if (depth === 0 && separators.indexOf(char) >= 0) {
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
  return isFinite(parsed) ? parsed : fallback
}

function parseVariable(raw: string): ShowVariable | null {
  const match = raw.trim().match(/^([^\s:=\[\](){}]+)([\s\S]*)$/)
  if (!match) return null
  const name = match[1]
  let remainder = match[2].trim()
  let type: ShowVariableType = 'integer'

  // Z / Q / S 是整数、有理数、字符串的推荐简写。
  const typeMatch = remainder.match(
    /^:\s*(integer|int|z|整数|rational|number|float|q|有理数|string|text|s|字符串)/i,
  )
  if (typeMatch) {
    const normalized = typeMatch[1].toLowerCase()
    type = ['string', 'text', 's', '字符串'].indexOf(normalized) >= 0
      ? 'string'
      : ['rational', 'number', 'float', 'q', '有理数'].indexOf(normalized) >= 0
        ? 'rational'
        : 'integer'
    remainder = remainder.slice(typeMatch[0].length).trim()
  }

  // {faster_set} 对 Q 变量是显式开关，避免长区间意外变成不精确的滑动条。
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
    const initial = (defaultText === undefined ? '' : defaultText).slice(0, maxLength)
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

const MAPPING_PATTERN = /\*&([^:*&{}()\s]+):\{([\s\S]*?)\}\*&/g

export function parseShowMappings(content: string): ShowMapping[] {
  const pattern = new RegExp(MAPPING_PATTERN.source, 'g')
  const mappings: ShowMapping[] = []
  let match: RegExpExecArray | null
  while ((match = pattern.exec(content))) {
    const values: Array<[string, string]> = []
    const seen: Record<string, number> = {}
    for (const pair of splitTopLevel(match[2], ';')) {
      const comma = pair.indexOf(',')
      if (comma < 0) continue
      const key = pair.slice(0, comma).trim()
      // 早期语法示例里会带一个结尾的 %，这里一并兼容。
      const value = pair.slice(comma + 1).trim().replace(/%$/, '').trim()
      if (!key) continue
      if (Object.prototype.hasOwnProperty.call(seen, key)) values[seen[key]] = [key, value]
      else {
        seen[key] = values.length
        values.push([key, value])
      }
    }
    if (values.length) mappings.push({ name: match[1].trim(), values })
  }
  return mappings
}

export function mappingValue(mapping: ShowMapping, key: string): string | undefined {
  for (const pair of mapping.values) if (pair[0] === key) return pair[1]
  return undefined
}

function mappingVariable(mapping: ShowMapping): ShowVariable {
  const keys = mapping.values.map((pair) => pair[0])
  const numeric = keys.map((key) => Number(key))
  const allNumeric = numeric.every((key) => isFinite(key))
  const allIntegers = allNumeric && numeric.every((key) => key === Math.round(key))
  if (allNumeric) {
    const min = Math.min.apply(null, numeric)
    const max = Math.max.apply(null, numeric)
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
    maxLength: Math.max.apply(null, [20].concat(keys.map((key) => key.length))),
    initial: keys[0] || '',
  }
}

export function parseShowVariables(specification: string, content: string): ShowVariable[] {
  const order: string[] = []
  const variables: Record<string, ShowVariable> = {}
  const remember = (variable: ShowVariable) => {
    if (!Object.prototype.hasOwnProperty.call(variables, variable.name)) order.push(variable.name)
    variables[variable.name] = variable
  }
  for (const raw of splitTopLevel(specification)) {
    const variable = parseVariable(raw)
    if (variable) remember(variable)
  }
  for (const mapping of parseShowMappings(content)) {
    if (!Object.prototype.hasOwnProperty.call(variables, mapping.name)) remember(mappingVariable(mapping))
  }
  return order.map((name) => variables[name])
}

export function showValueKey(value: ShowValue): string {
  if (typeof value === 'number') {
    return value === Math.round(value) ? String(value) : String(Number(value.toFixed(12)))
  }
  return value
}

export function formatNumber(value: number): string {
  if (!isFinite(value)) return '未定义'
  if (Math.abs(value) < 1e-12) return '0'
  return String(Number(value.toFixed(10)))
}

/** 极小的四则运算解析器：只支持 + - * / ^ 括号与变量名。 */
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
      value = Math.pow(value, exponent)
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
    return typeof value === 'number' && isFinite(value) ? value : null
  }

  const result = parseExpression()
  skip()
  return result === null || cursor !== source.length || !isFinite(result) ? null : result
}

function unwrapPlaceholder(value: string): string {
  const trimmed = value.trim()
  return trimmed.charAt(0) === '[' && trimmed.charAt(trimmed.length - 1) === ']'
    ? trimmed.slice(1, -1).trim()
    : trimmed
}

function shiftDecimal(value: number, places: number): number {
  if (value === 0) return 0
  const parts = String(value).split('e')
  const coefficient = parts[0]
  const exponent = parts.length > 1 ? parts[1] : '0'
  return Number(coefficient + 'e' + (Number(exponent) + places))
}

export function formatDirectionalRound(value: number, places: number, mode: 'floor' | 'ceil'): string {
  // toFixed 最多支持 100 位小数；限制指数同时也能避免畸形输入产生 Infinity。
  if (places !== Math.round(places) || Math.abs(places) > 100) return '未定义'
  const shifted = shiftDecimal(value, places)
  if (!isFinite(shifted)) return '未定义'
  // 0.1 + 0.2 这类运算在放大后会落在整数附近几个 ULP 的位置，
  // 这里只吸收这种浮点噪声，避免 ceil 把 0.30000000000000004 变成 0.4。
  const nearest = Math.round(shifted)
  const tolerance = Number.EPSILON * Math.max(1, Math.abs(shifted)) * 8
  const stableShifted = Math.abs(shifted - nearest) <= tolerance ? nearest : shifted
  const rounded = mode === 'floor' ? Math.floor(stableShifted) : Math.ceil(stableShifted)
  const result = shiftDecimal(rounded, -places)
  if (!isFinite(result)) return '未定义'
  const normalized = result === 0 ? 0 : result
  return places > 0 ? normalized.toFixed(places) : String(normalized)
}

export function initialShowValues(variables: ShowVariable[]): Record<string, ShowValue> {
  const values: Record<string, ShowValue> = {}
  for (const variable of variables) values[variable.name] = variable.initial
  return values
}

export function clampShowVariable(variable: ShowVariable, raw: string): ShowValue {
  if (variable.type === 'string') return raw.slice(0, variable.maxLength === undefined ? 100 : variable.maxLength)
  const number = Number(raw)
  if (!isFinite(number)) return variable.initial
  const limited = Math.min(
    variable.max === undefined ? number : variable.max,
    Math.max(variable.min === undefined ? number : variable.min, number),
  )
  return variable.type === 'integer' ? Math.round(limited) : limited
}

/* ------------------------------------------------------------------ *
 * 内联记号（*&show()*& / *&hs()*& / &*floor()&* / &*ceil()&* / 映射）
 * ------------------------------------------------------------------ */

export type ShowTokenKind = 'show' | 'hs' | 'floor' | 'ceil' | 'map'

export interface ShowToken {
  kind: ShowTokenKind
  /** 记号在源串中的起止位置。 */
  start: number
  end: number
  /** show/map 为变量名；hs 为表达式；floor/ceil 为括号内的原始参数串。 */
  arg: string
}

function matchBalanced(source: string, openParen: number): number {
  let depth = 1
  let cursor = openParen + 1
  while (cursor < source.length && depth > 0) {
    if (source[cursor] === '(') depth += 1
    if (source[cursor] === ')') depth -= 1
    if (depth > 0) cursor += 1
  }
  return depth === 0 ? cursor : -1
}

/** 按出现顺序扫描出全部内联记号。 */
export function findShowTokens(source: string): ShowToken[] {
  const tokens: ShowToken[] = []
  let index = 0
  while (index < source.length) {
    const marker = source.substr(index, 2)
    if (marker !== '*&' && marker !== '&*') {
      index += 1
      continue
    }
    const rest = source.slice(index)

    if (marker === '*&') {
      const mapping = rest.match(/^\*&([^:*&{}()\s]+):\{[\s\S]*?\}\*&/)
      if (mapping) {
        tokens.push({ kind: 'map', start: index, end: index + mapping[0].length, arg: mapping[1].trim() })
        index += mapping[0].length
        continue
      }
      const show = rest.match(/^\*&show\(([^)]+)\)\*&/)
      if (show) {
        tokens.push({ kind: 'show', start: index, end: index + show[0].length, arg: show[1].trim() })
        index += show[0].length
        continue
      }
      const hs = rest.match(/^\*&hs\(/)
      if (hs) {
        const close = matchBalanced(source, index + 5)
        if (close > 0 && source.substr(close + 1, 2) === '*&') {
          tokens.push({ kind: 'hs', start: index, end: close + 3, arg: source.slice(index + 5, close) })
          index = close + 3
          continue
        }
      }
    }

    // &*floor(…)&* / &*ceil(…)&*，同时兼容旧语法里的 *&floor(…)*&。
    const rounding = rest.match(/^(?:\*&|&\*)(floor|ceil)\(/)
    if (rounding) {
      const openParen = index + rounding[0].length - 1
      const close = matchBalanced(source, openParen)
      const suffix = marker === '&*' ? '&*' : '*&'
      if (close > 0 && source.substr(close + 1, 2) === suffix) {
        tokens.push({
          kind: rounding[1] as 'floor' | 'ceil',
          start: index,
          end: close + 3,
          arg: source.slice(openParen + 1, close),
        })
        index = close + 3
        continue
      }
    }

    index += 1
  }
  return tokens
}

/** 计算单个记号在当前变量取值下的文本结果。 */
export function evaluateShowToken(
  token: { kind: ShowTokenKind; arg: string },
  values: Record<string, ShowValue>,
  mappings: ShowMapping[],
): string {
  if (token.kind === 'map') {
    for (const mapping of mappings) {
      if (mapping.name !== token.arg) continue
      const key = showValueKey(values[token.arg] === undefined ? '' : values[token.arg])
      const value = mappingValue(mapping, key)
      return value === undefined ? '' : value
    }
    return ''
  }
  if (token.kind === 'show') {
    const value = values[token.arg]
    return value === undefined ? '未定义' : showValueKey(value)
  }
  if (token.kind === 'hs') {
    const result = evaluateShowFormula(token.arg.trim(), values)
    return result === null ? '未定义' : formatNumber(result)
  }
  const args = splitTopLevel(token.arg, ',')
  const number = args.length === 2 ? evaluateShowFormula(unwrapPlaceholder(args[0]), values) : null
  const places = args.length === 2 ? evaluateShowFormula(unwrapPlaceholder(args[1]), values) : null
  if (number === null || places === null) return '未定义'
  return formatDirectionalRound(number, places, token.kind)
}

/**
 * 把展示框正文中的特殊记号替换为当前取值。
 *
 * 等价于「在源码里把这一段直接换成对应的值」，所以输出是纯文本：
 * 既不会被包进 <code>，也能出现在代码块、表格与公式里。
 */
export function renderShowContent(
  body: string,
  values: Record<string, ShowValue>,
  mappings: ShowMapping[],
  wrap?: (token: ShowToken, text: string) => string,
): string {
  const tokens = findShowTokens(body)
  let output = ''
  let cursor = 0
  for (const token of tokens) {
    output += body.slice(cursor, token.start)
    const text = evaluateShowToken(token, values, mappings)
    output += wrap ? wrap(token, text) : text
    cursor = token.end
  }
  return output + body.slice(cursor)
}
