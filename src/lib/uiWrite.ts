import { isValidUiId } from './uiChoices'

export type UiWriteValue = number | string

export interface UiWriteConfig {
  id: string
  mode: 'real' | 'text'
  options: string[]
  minValue?: number
  maxValue?: number
  decimalPlaces?: number
  minLength?: number
  maxLength?: number
  initialValue?: UiWriteValue
  name: string
  newLine: boolean
  faster: boolean
  merge: boolean
  errors: string[]
}

export interface UiWriteToken {
  id: string
  options: string[]
  start: number
  end: number
}

const NUMBER_RE = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i

/** Parse one inline `::ui-write[id][option]...` token, preserving option groups. */
export function parseUiWriteToken(source: string, start: number): UiWriteToken | null {
  const prefix = source.slice(start).match(/^::ui-write(?=\[)/i)
  if (!prefix) return null

  let cursor = start + prefix[0].length
  const groups: string[] = []
  while (source[cursor] === '[') {
    const close = source.indexOf(']', cursor + 1)
    if (close < 0) return null
    groups.push(source.slice(cursor + 1, close).trim())
    cursor = close + 1
  }
  if (groups.length === 0) return null

  return {
    id: groups[0],
    options: groups.slice(1),
    start,
    end: cursor,
  }
}

/** Parse a source line containing only one `::ui-write` directive. */
export function parseUiWriteLine(line: string): UiWriteToken | null {
  const leading = line.match(/^\s*/)?.[0].length ?? 0
  const token = parseUiWriteToken(line, leading)
  return token && line.slice(token.end).trim() === '' ? token : null
}

function parseBounds(option: string, kind: 'R' | 'len'): { values: number[] } | { error: string } {
  const parts = option.trim().split(/\s+/)
  if (parts.length !== (kind === 'R' ? 4 : 3)) {
    return { error: kind === 'R' ? 'R 格式应为 `R 小数位数 下限 上限`。' : 'len 格式应为 `len 下限 上限`。' }
  }
  const values = parts.slice(1).map((part) => (NUMBER_RE.test(part) ? Number(part) : Number.NaN))
  if (values.some((value) => !Number.isFinite(value))) {
    return { error: `${kind} 的参数必须是有限数字。` }
  }
  if (kind === 'R') {
    if (!Number.isInteger(values[0]) || values[0] < 0 || values[0] > 100) {
      return { error: 'R 的小数位数必须是 0 到 100 之间的整数。' }
    }
    if (values[1] > values[2]) return { error: 'R 的下限不能大于上限。' }
  } else {
    if (!values.every(Number.isInteger) || values[0] < 0 || values[1] < values[0]) {
      return { error: 'len 的长度范围必须是非负整数，且下限不大于上限。' }
    }
  }
  return { values }
}

/** Parse and validate the options attached to one `::ui-write` control. */
export function parseUiWriteConfig(id: string, options: string[]): UiWriteConfig {
  const errors: string[] = []
  const realOption = options.find((option) => /^R(?:\s|$)/i.test(option.trim()))
  const lengthOption = options.find((option) => /^len(?:\s|$)/i.test(option.trim()))
  const defaultOption = options.find((option) => /^set(?:\s|$)/i.test(option.trim()))
  const nameOption = options.find((option) => /^name(?:\s|$)/i.test(option.trim()))
  const newLine = options.some((option) => /^new$/i.test(option.trim()))
  const faster = options.some((option) => /^faster$/i.test(option.trim()))
  const merge = options.some((option) => /^merge$/i.test(option.trim()))

  if (!isValidUiId(id)) errors.push('填空框 id 不能为空，且只能包含字母、数字、下划线、点或连字符。')

  let mode: UiWriteConfig['mode'] = realOption ? 'real' : 'text'
  let minValue: number | undefined
  let maxValue: number | undefined
  let decimalPlaces: number | undefined
  let minLength: number | undefined
  let maxLength: number | undefined

  if (realOption) {
    const parsed = parseBounds(realOption, 'R')
    if ('error' in parsed) errors.push(parsed.error)
    else {
      ;[decimalPlaces, minValue, maxValue] = parsed.values
    }
  }
  if (lengthOption) {
    const parsed = parseBounds(lengthOption, 'len')
    if ('error' in parsed) errors.push(parsed.error)
    else [minLength, maxLength] = parsed.values.map((value) => Math.trunc(value))
  }
  if (realOption && lengthOption) errors.push('R 与 len 不能同时使用。')

  let initialNumber: number | undefined
  if (defaultOption) {
    const match = defaultOption.trim().match(/^set\s+(.+)$/i)
    if (!match || !NUMBER_RE.test(match[1].trim()) || !Number.isFinite(Number(match[1]))) {
      errors.push('set 后必须提供一个有限数字。')
    } else {
      initialNumber = Number(match[1])
    }
  }

  const name = nameOption?.trim().replace(/^name\s*/i, '') ?? ''
  if (nameOption && !name) errors.push('name 后必须提供输入框标题。')
  if (nameOption && !newLine) errors.push('name 必须与 new 一起使用。')
  if (merge && !newLine) errors.push('merge 必须与 new 一起使用。')
  if (faster && (!realOption || !newLine)) errors.push('faster 必须与 R 和 new 一起使用。')

  const knownOption = (option: string) =>
    /^(?:R(?:\s|$)|len(?:\s|$)|set(?:\s|$)|name(?:\s|$)|new$|faster$|merge$)/i.test(option.trim())
  for (const option of options) {
    if (!knownOption(option)) errors.push(`无法识别填空框附加项：${option}`)
  }

  let initialValue: UiWriteValue | undefined
  if (initialNumber !== undefined) {
    initialValue = mode === 'real' ? initialNumber : String(initialNumber)
  } else if (faster && minValue !== undefined) {
    // A range control cannot be empty; in the absence of `set`, start at its lower bound.
    initialValue = minValue
  }

  if (mode === 'real' && initialNumber !== undefined && minValue !== undefined && maxValue !== undefined) {
    if (initialNumber < minValue || initialNumber > maxValue) {
      errors.push('set 的初始值必须位于 R 指定的上下限内。')
    }
    if (decimalPlaces !== undefined && countDecimalPlaces(String(initialNumber)) > decimalPlaces) {
      errors.push('set 的初始值不能超过 R 指定的小数位数。')
    }
  }
  if (mode === 'text' && lengthOption && initialNumber !== undefined && maxLength !== undefined) {
    const length = String(initialNumber).length
    if (length < (minLength ?? 0) || length > maxLength) errors.push('set 的初始值长度不在 len 指定的范围内。')
  }

  return {
    id,
    mode,
    options,
    minValue,
    maxValue,
    decimalPlaces,
    minLength,
    maxLength,
    initialValue,
    name,
    newLine,
    faster,
    merge,
    errors: [...new Set(errors)],
  }
}

export function countDecimalPlaces(value: string): number {
  const [base, exponentText] = value.toLowerCase().split('e')
  const fractionLength = base.split('.')[1]?.length ?? 0
  const exponent = exponentText ? Number(exponentText) : 0
  return Math.max(0, fractionLength - (Number.isFinite(exponent) ? exponent : 0))
}

/** Return a user-facing validation error for a numeric draft, or null when valid/empty. */
export function validateUiWriteRealValue(value: string, config: UiWriteConfig): string | null {
  if (value.trim() === '') return null
  if (!NUMBER_RE.test(value.trim()) || !Number.isFinite(Number(value))) return '请输入有效的实数。'
  const number = Number(value)
  if (config.minValue !== undefined && number < config.minValue) return `数值不能小于 ${config.minValue}。`
  if (config.maxValue !== undefined && number > config.maxValue) return `数值不能大于 ${config.maxValue}。`
  if (config.decimalPlaces !== undefined && countDecimalPlaces(value.trim()) > config.decimalPlaces) {
    return `最多只能输入 ${config.decimalPlaces} 位小数。`
  }
  return null
}
