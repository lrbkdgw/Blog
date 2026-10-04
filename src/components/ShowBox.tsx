import { useEffect, useMemo, useState } from 'react'
import { SlidersHorizontal } from 'lucide-react'
import { Markdown } from './Markdown'

type ShowValue = number | string
type ShowVariableType = 'integer' | 'rational' | 'string'

interface ShowVariable {
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

interface Mapping {
  name: string
  values: Map<string, string>
}

function splitTopLevel(input: string, separators = ',;'): string[] {
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

function parseMappings(content: string): Mapping[] {
  const pattern = /\*&([^:*&{}()\s]+):\{([\s\S]*?)\}\*&/g
  const mappings: Mapping[] = []
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

function mappingVariable(mapping: Mapping): ShowVariable {
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

function parseVariables(specification: string, content: string): ShowVariable[] {
  const variables = new Map<string, ShowVariable>()
  for (const raw of splitTopLevel(specification)) {
    const variable = parseVariable(raw)
    if (variable) variables.set(variable.name, variable)
  }
  for (const mapping of parseMappings(content)) {
    if (!variables.has(mapping.name)) variables.set(mapping.name, mappingVariable(mapping))
  }
  return [...variables.values()]
}

function valueKey(value: ShowValue): string {
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(12)))
  return value
}

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return '未定义'
  if (Math.abs(value) < 1e-12) return '0'
  return String(Number(value.toFixed(10)))
}

/** Tiny arithmetic parser: + - * / ^ parentheses and variable names only. */
function evaluateFormula(source: string, values: Record<string, ShowValue>): number | null {
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

function renderContent(body: string, values: Record<string, ShowValue>, mappings: Mapping[]): string {
  const stashed: string[] = []
  const withoutMappings = body.replace(/\*&([^:*&{}()\s]+):\{([\s\S]*?)\}\*&/g, (_token, name: string) => {
    const mapping = mappings.find((item) => item.name === name)
    const value = mapping?.values.get(valueKey(values[name] ?? '')) ?? ''
    const marker = `\uE000${stashed.length}\uE001`
    stashed.push(value)
    return marker
  })
  const withFormulas = withoutMappings.replace(/\*&hs\(([\s\S]*?)\)\*&/g, (_token, formula: string) => {
    const result = evaluateFormula(formula.trim(), values)
    return `<code class="show-result">${result === null ? '未定义' : formatNumber(result)}</code>`
  })
  const withValues = withFormulas.replace(/\*&show\(([^)]+)\)\*&/g, (_token, rawName: string) => {
    const value = values[rawName.trim()]
    return `<code class="show-value">${value === undefined ? '未定义' : valueKey(value)}</code>`
  })
  return withValues.replace(/\uE000(\d+)\uE001/g, (_token, index: string) => stashed[Number(index)] ?? '')
}

function clampVariable(variable: ShowVariable, raw: string): ShowValue {
  if (variable.type === 'string') return raw.slice(0, variable.maxLength ?? 100)
  const number = Number(raw)
  if (!Number.isFinite(number)) return variable.initial
  const limited = Math.min(variable.max ?? number, Math.max(variable.min ?? number, number))
  return variable.type === 'integer' ? Math.round(limited) : limited
}

export function ShowBox({ title, variableSpec, body }: { title: string; variableSpec: string; body: string }) {
  const variables = useMemo(() => parseVariables(variableSpec, body), [variableSpec, body])
  const mappings = useMemo(() => parseMappings(body), [body])
  const initialValues = useMemo(
    () => Object.fromEntries(variables.map((variable) => [variable.name, variable.initial])) as Record<string, ShowValue>,
    [variables],
  )
  const [values, setValues] = useState<Record<string, ShowValue>>(initialValues)

  useEffect(() => setValues(initialValues), [initialValues])

  const rendered = useMemo(() => renderContent(body, values, mappings), [body, values, mappings])
  const setValue = (variable: ShowVariable, raw: string) => {
    setValues((previous) => ({ ...previous, [variable.name]: clampVariable(variable, raw) }))
  }

  return (
    <section className="show-box not-prose my-6 overflow-hidden rounded-xl border border-ink-200 bg-ink-50/70 shadow-sm dark:border-white/10 dark:bg-white/[0.035]">
      <div className="flex items-center gap-2 border-b border-ink-200/80 bg-white/75 px-4 py-2.5 font-mono text-xs font-semibold text-ink-700 dark:border-white/10 dark:bg-white/[0.035] dark:text-ink-200">
        <SlidersHorizontal size={14} className="text-brand-500" />
        <span>{title || '交互展示'}</span>
      </div>
      <div className="show-box-content px-4 py-4">
        <Markdown content={rendered} />
      </div>
      {variables.length > 0 && (
        <div className="grid gap-3 border-t border-ink-200/80 bg-white/50 p-4 sm:grid-cols-2 dark:border-white/10 dark:bg-black/10">
          {variables.map((variable) => {
            const value = values[variable.name]
            const canSlide =
              (variable.type === 'integer' || (variable.type === 'rational' && variable.fastSet)) &&
              variable.min !== undefined &&
              variable.max !== undefined
            return (
              <label key={variable.name} className="block min-w-0">
                <span className="mb-1.5 flex items-center justify-between gap-2 font-mono text-xs font-medium text-ink-600 dark:text-ink-300">
                  <span>{variable.name}</span>
                  <span className="text-ink-400">
                    {variable.type === 'string'
                      ? `${String(value).length}/${variable.maxLength ?? 100}`
                      : `${variable.min ?? '−∞'} – ${variable.max ?? '∞'}`}
                  </span>
                </span>
                {variable.type === 'string' ? (
                  <input
                    value={String(value)}
                    minLength={variable.minLength}
                    maxLength={variable.maxLength}
                    onChange={(event) => setValue(variable, event.target.value)}
                    className="input !py-2 font-mono text-xs"
                  />
                ) : (
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      value={String(value)}
                      min={variable.min}
                      max={variable.max}
                      step={variable.step}
                      onChange={(event) => setValue(variable, event.target.value)}
                      className="input w-24 !py-2 font-mono text-xs"
                    />
                    {canSlide && (
                      <input
                        type="range"
                        value={Number(value)}
                        min={variable.min}
                        max={variable.max}
                        step={variable.step || 1}
                        onChange={(event) => setValue(variable, event.target.value)}
                        className="h-2 min-w-0 flex-1 cursor-pointer accent-brand-500"
                        aria-label={`${variable.name} 滑动条`}
                      />
                    )}
                  </div>
                )}
              </label>
            )
          })}
        </div>
      )}
    </section>
  )
}
