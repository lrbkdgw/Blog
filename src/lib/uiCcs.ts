import { splitTopLevel } from './showBox'

/**
 * 直角坐标系语法（issue #76）：
 *
 * ::begin_ui-ccs
 * create_point:(x,y);
 * create_line:(x_1,y_1),(x_2,y_2),...,(x_n,y_n),[color=red];
 * create_line:(7*x^2+6*x+90*x^3);
 * ::end_ui-ccs
 */

export interface UiCcsPointItem {
  kind: 'point'
  x: number
  y: number
  color?: string
  label?: string
  raw: string
}

export interface UiCcsPolylineItem {
  kind: 'polyline'
  points: Array<{ x: number; y: number }>
  color?: string
  label?: string
  raw: string
}

export interface UiCcsFunctionItem {
  kind: 'function'
  expression: string
  evaluate: (x: number) => number
  color?: string
  label?: string
  raw: string
}

export type UiCcsItem = UiCcsPointItem | UiCcsPolylineItem | UiCcsFunctionItem

export interface ParsedUiCcs {
  items: UiCcsItem[]
  errors: string[]
}

export interface UiCcsViewport {
  centerX: number
  centerY: number
  /** 每个 SVG 像素对应的坐标单位长度（X / Y 等比例 1:1）。 */
  unitsPerPx: number
}

export const UI_CCS_VIEW_WIDTH = 680
export const UI_CCS_VIEW_HEIGHT = 420
export const UI_CCS_MIN_UNITS_PER_PX = 1e-5
export const UI_CCS_MAX_UNITS_PER_PX = 1e5

const DEFAULT_PALETTE = [
  'rgb(var(--brand-500))',
  '#0ea5e9',
  '#10b981',
  '#f59e0b',
  '#8b5cf6',
  '#ec4899',
]

const CHINESE_COLOR_ALIASES: Record<string, string> = {
  红: '#ef4444',
  红色: '#ef4444',
  蓝: '#3b82f6',
  蓝色: '#3b82f6',
  绿: '#10b981',
  绿色: '#10b981',
  橙: '#f97316',
  橙色: '#f97316',
  黄: '#eab308',
  黄色: '#eab308',
  紫: '#8b5cf6',
  紫色: '#8b5cf6',
  粉: '#ec4899',
  粉色: '#ec4899',
  青: '#06b6d4',
  青色: '#06b6d4',
  黑: '#18181b',
  黑色: '#18181b',
  白: '#f8fafc',
  白色: '#f8fafc',
  灰: '#6b7280',
  灰色: '#6b7280',
}

/** 校验并归一化颜色值，阻断任意样式注入。 */
export function sanitizeCcsColor(raw: string | undefined): string | undefined {
  if (!raw) return undefined
  const trimmed = raw.trim().replace(/^['"]|['"]$/g, '').trim()
  if (!trimmed) return undefined
  if (CHINESE_COLOR_ALIASES[trimmed]) return CHINESE_COLOR_ALIASES[trimmed]
  if (/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(trimmed)) {
    return trimmed
  }
  if (/^[a-zA-Z]{2,32}$/.test(trimmed)) {
    return trimmed.toLowerCase()
  }
  if (/^(?:rgb|rgba|hsl|hsla)\(\s*[-+0-9.,%\s/]+\s*\)$/i.test(trimmed)) {
    return trimmed
  }
  return undefined
}

export function resolveCcsItemColor(item: UiCcsItem, index: number, staticFallback = false): string {
  if (item.color) return item.color
  if (staticFallback && index % DEFAULT_PALETTE.length === 0) return '#4f46e5'
  return DEFAULT_PALETTE[index % DEFAULT_PALETTE.length]
}

/* -------------------------------------------------------------------------- */
/*                               数学表达式编译器                                */
/* -------------------------------------------------------------------------- */

type ExprFn = (x: number) => number

const UNARY_MATH_FNS: Record<string, (v: number) => number> = {
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
  sinh: Math.sinh,
  cosh: Math.cosh,
  tanh: Math.tanh,
  sqrt: Math.sqrt,
  cbrt: Math.cbrt,
  abs: Math.abs,
  ln: Math.log,
  log: Math.log,
  log10: Math.log10,
  log2: Math.log2,
  exp: Math.exp,
  floor: Math.floor,
  ceil: Math.ceil,
  round: Math.round,
  sign: Math.sign,
}

const BINARY_MATH_FNS: Record<string, (a: number, b: number) => number> = {
  pow: Math.pow,
  min: Math.min,
  max: Math.max,
  atan2: Math.atan2,
  hypot: Math.hypot,
}

const MATH_CONSTANTS: Record<string, number> = {
  pi: Math.PI,
  e: Math.E,
  tau: Math.PI * 2,
}

/**
 * 将关于 `x`（或纯常量）的数学表达式编译为求值函数：
 * - 支持 `+ - * / ^`、括号、隐式乘法（如 `2x`、`3(x+1)`）与标准数学函数；
 * - 严格遵循数学优先级：`-x^2` 解析为 `-(x^2)`，`(-x)^2` 解析为 `(-x)^2`，`2^-x` 解析为 `2^(-x)`。
 */
export function compileCcsExpression(rawSource: string, allowVariableX = true): ExprFn | null {
  const source = rawSource.trim()
  if (!source) return null
  let cursor = 0

  const skip = () => {
    while (cursor < source.length && /\s/.test(source[cursor])) cursor += 1
  }

  const canImplicitMultiply = (): boolean => {
    skip()
    const ch = source[cursor]
    if (!ch) return false
    return ch === '(' || /[A-Za-z_]/.test(ch)
  }

  const parseExpression = (): ExprFn | null => {
    let left: ExprFn | null = parseTerm()
    if (!left) return null
    while (true) {
      skip()
      const op = source[cursor]
      if (op !== '+' && op !== '-') break
      cursor += 1
      const right: ExprFn | null = parseTerm()
      if (!right) return null
      const prev: ExprFn = left
      left = op === '+' ? (x: number) => prev(x) + right(x) : (x: number) => prev(x) - right(x)
    }
    return left
  }

  const parseTerm = (): ExprFn | null => {
    let left: ExprFn | null = parseUnary()
    if (!left) return null
    while (true) {
      skip()
      const op = source[cursor]
      if (op === '*' || op === '/') {
        cursor += 1
        const right: ExprFn | null = parseUnary()
        if (!right) return null
        const prev: ExprFn = left
        left =
          op === '*'
            ? (x: number) => prev(x) * right(x)
            : (x: number) => {
                const denom = right(x)
                return denom === 0 ? Number.NaN : prev(x) / denom
              }
      } else if (canImplicitMultiply()) {
        const right: ExprFn | null = parsePower()
        if (!right) return null
        const prev: ExprFn = left
        left = (x: number) => prev(x) * right(x)
      } else {
        break
      }
    }
    return left
  }

  const parseUnary = (): ExprFn | null => {
    skip()
    if (source[cursor] === '+') {
      cursor += 1
      return parseUnary()
    }
    if (source[cursor] === '-') {
      cursor += 1
      const inner = parseUnary()
      return inner ? (x) => -inner(x) : null
    }
    return parsePower()
  }

  const parsePower = (): ExprFn | null => {
    const base = parsePrimary()
    if (!base) return null
    skip()
    if (source[cursor] === '^') {
      cursor += 1
      const exponent = parseUnary()
      if (!exponent) return null
      return (x) => Math.pow(base(x), exponent(x))
    }
    return base
  }

  const parsePrimary = (): ExprFn | null => {
    skip()
    if (source[cursor] === '(') {
      cursor += 1
      const inner = parseExpression()
      skip()
      if (!inner || source[cursor] !== ')') return null
      cursor += 1
      return inner
    }

    const rest = source.slice(cursor)
    const numMatch = rest.match(/^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?/i)
    if (numMatch) {
      cursor += numMatch[0].length
      const literal = Number(numMatch[0])
      if (!Number.isFinite(literal)) return null
      return () => literal
    }

    const idMatch = rest.match(/^[A-Za-z_][A-Za-z0-9_]*/)
    if (!idMatch) return null
    const ident = idMatch[0]
    const lower = ident.toLowerCase()
    cursor += ident.length

    skip()
    if (source[cursor] === '(') {
      cursor += 1
      const args: ExprFn[] = []
      skip()
      if (source[cursor] !== ')') {
        while (true) {
          const arg = parseExpression()
          if (!arg) return null
          args.push(arg)
          skip()
          if (source[cursor] === ',') {
            cursor += 1
            continue
          }
          break
        }
      }
      if (source[cursor] !== ')') return null
      cursor += 1

      if (args.length === 1 && UNARY_MATH_FNS[lower]) {
        const fn = UNARY_MATH_FNS[lower]
        const arg0 = args[0]
        return (x) => fn(arg0(x))
      }
      if (args.length === 2 && BINARY_MATH_FNS[lower]) {
        const fn = BINARY_MATH_FNS[lower]
        const [arg0, arg1] = args
        return (x) => fn(arg0(x), arg1(x))
      }
      if (args.length === 2 && lower === 'log') {
        const [arg0, arg1] = args
        return (x) => Math.log(arg0(x)) / Math.log(arg1(x))
      }
      return null
    }

    if (lower === 'x') {
      return allowVariableX ? (x) => x : null
    }
    if (Object.prototype.hasOwnProperty.call(MATH_CONSTANTS, lower)) {
      const constant = MATH_CONSTANTS[lower]
      return () => constant
    }
    return null
  }

  const compiled = parseExpression()
  skip()
  if (!compiled || cursor !== source.length) return null
  return compiled
}

function evaluateConstant(raw: string): number | null {
  const fn = compileCcsExpression(raw, false)
  if (!fn) return null
  const value = fn(0)
  return Number.isFinite(value) ? value : null
}

function parsePointTuple(raw: string): { x: number; y: number } | null {
  const trimmed = raw.trim()
  if (!trimmed.startsWith('(') || !trimmed.endsWith(')')) return null
  const coords = splitTopLevel(trimmed.slice(1, -1), ',')
  if (coords.length !== 2) return null
  const x = evaluateConstant(coords[0])
  const y = evaluateConstant(coords[1])
  if (x === null || y === null) return null
  return { x, y }
}

interface ItemOptions {
  color?: string
  label?: string
}

function parseOptionsBlock(raw: string): ItemOptions {
  const options: ItemOptions = {}
  for (const entry of splitTopLevel(raw, ',;')) {
    const eq = entry.indexOf('=')
    if (eq < 0) continue
    const key = entry.slice(0, eq).trim().toLowerCase()
    const val = entry.slice(eq + 1).trim()
    if (key === 'color' || key === 'colour' || key === 'c') {
      options.color = sanitizeCcsColor(val)
    } else if (key === 'label' || key === 'name') {
      options.label = val.replace(/^['"]|['"]$/g, '').slice(0, 32)
    }
  }
  return options
}

/** 剥离语句末尾可选的 `,[color=...]` 或 `[color=...]` 修饰块。 */
function extractTrailingOptions(body: string): { core: string; options: ItemOptions } {
  const trimmed = body.trim()
  if (!trimmed.endsWith(']')) return { core: trimmed, options: {} }
  let depth = 0
  let openIndex = -1
  for (let i = trimmed.length - 1; i >= 0; i -= 1) {
    const ch = trimmed[i]
    if (ch === ']') depth += 1
    else if (ch === '[') {
      depth -= 1
      if (depth === 0) {
        openIndex = i
        break
      }
    }
  }
  if (openIndex < 0) return { core: trimmed, options: {} }
  const options = parseOptionsBlock(trimmed.slice(openIndex + 1, -1))
  const prefix = trimmed.slice(0, openIndex).trim().replace(/,\s*$/, '').trim()
  return { core: prefix, options }
}

function stripOuterParens(expr: string): string {
  let current = expr.trim()
  while (current.startsWith('(') && current.endsWith(')')) {
    let depth = 0
    let wrapsAll = true
    for (let i = 0; i < current.length; i += 1) {
      if (current[i] === '(') depth += 1
      else if (current[i] === ')') depth -= 1
      if (depth === 0 && i < current.length - 1) {
        wrapsAll = false
        break
      }
    }
    if (!wrapsAll || depth !== 0) break
    current = current.slice(1, -1).trim()
  }
  return current
}

/** 解析 `::begin_ui-ccs ... ::end_ui-ccs` 块内的全部绘图指令。 */
export function parseUiCcs(source: string): ParsedUiCcs {
  const items: UiCcsItem[] = []
  const errors: string[] = []
  if (!source.trim()) return { items, errors }

  const cleanedLines = source
    .split('\n')
    .map((line) => line.replace(/^\s*(?:\/\/|#).*$/, ''))
    .join('\n')

  for (const statement of splitTopLevel(cleanedLines, ';\n')) {
    const trimmed = statement.trim()
    if (!trimmed) continue
    const match = trimmed.match(/^(create_point|create_line)\s*:\s*([\s\S]+)$/i)
    if (!match) {
      errors.push(`无法识别的指令：${trimmed}`)
      continue
    }

    const command = match[1].toLowerCase()
    const { core, options } = extractTrailingOptions(match[2])
    const parts = splitTopLevel(core, ',')

    if (command === 'create_point') {
      const parsedPoints = parts.map(parsePointTuple)
      if (parsedPoints.length > 0 && parsedPoints.every((pt): pt is { x: number; y: number } => pt !== null)) {
        for (const pt of parsedPoints) {
          items.push({
            kind: 'point',
            x: pt.x,
            y: pt.y,
            color: options.color,
            label: options.label,
            raw: trimmed,
          })
        }
      } else {
        errors.push(`点坐标语法无效：${trimmed}`)
      }
      continue
    }

    // create_line：至少两个 (x_i, y_i) 坐标点时为折线/线段，否则按函数 y = f(x) 解析。
    if (parts.length >= 2) {
      const vertices = parts.map(parsePointTuple)
      if (vertices.every((pt): pt is { x: number; y: number } => pt !== null)) {
        items.push({
          kind: 'polyline',
          points: vertices,
          color: options.color,
          label: options.label,
          raw: trimmed,
        })
        continue
      }
    }

    const rawFormula = stripOuterParens(core).replace(/^y\s*=\s*/i, '').trim()
    const evaluate = compileCcsExpression(rawFormula, true)
    if (evaluate) {
      items.push({
        kind: 'function',
        expression: rawFormula,
        evaluate,
        color: options.color,
        label: options.label,
        raw: trimmed,
      })
    } else {
      errors.push(`线或函数表达式无效：${trimmed}`)
    }
  }

  return { items, errors }
}

/* -------------------------------------------------------------------------- */
/*                           视口计算、刻度生成与曲线裁剪                        */
/* -------------------------------------------------------------------------- */

export function clampUnitsPerPx(unitsPerPx: number): number {
  if (!Number.isFinite(unitsPerPx) || unitsPerPx <= 0) return 14 / UI_CCS_VIEW_HEIGHT
  return Math.min(UI_CCS_MAX_UNITS_PER_PX, Math.max(UI_CCS_MIN_UNITS_PER_PX, unitsPerPx))
}

export function computeInitialUiCcsViewport(
  items: UiCcsItem[],
  width = UI_CCS_VIEW_WIDTH,
  height = UI_CCS_VIEW_HEIGHT,
): UiCcsViewport {
  const coords: Array<{ x: number; y: number }> = []
  for (const item of items) {
    if (item.kind === 'point') coords.push({ x: item.x, y: item.y })
    else if (item.kind === 'polyline') coords.push(...item.points)
  }

  if (coords.length === 0) {
    return {
      centerX: 0,
      centerY: 0,
      unitsPerPx: clampUnitsPerPx(14 / height),
    }
  }

  let minX = Math.min(...coords.map((p) => p.x))
  let maxX = Math.max(...coords.map((p) => p.x))
  let minY = Math.min(...coords.map((p) => p.y))
  let maxY = Math.max(...coords.map((p) => p.y))

  // 坐标离原点不太远时一并把原点收入初始视野，方便直接对照坐标轴阅读。
  if (Math.max(Math.abs(minX), Math.abs(maxX), Math.abs(minY), Math.abs(maxY)) <= 50) {
    minX = Math.min(minX, 0)
    maxX = Math.max(maxX, 0)
    minY = Math.min(minY, 0)
    maxY = Math.max(maxY, 0)
  }

  const centerX = (minX + maxX) / 2
  const centerY = (minY + maxY) / 2
  const spanX = Math.max(maxX - minX, 10) * 1.32
  const spanY = Math.max(maxY - minY, 10) * 1.32
  const unitsPerPx = clampUnitsPerPx(Math.max(spanX / width, spanY / height, 14 / height))
  return { centerX, centerY, unitsPerPx }
}

/** 按 1–2–5 序列选择可读的主刻度步长，以及细分副网格步长。 */
export function chooseGridStep(unitsPerPx: number, targetPx = 76): { major: number; minor: number } {
  const raw = Math.max(unitsPerPx * targetPx, 1e-9)
  const exp = Math.floor(Math.log10(raw))
  const base = Math.pow(10, exp)
  const fraction = raw / base
  let mult = 1
  if (fraction >= 7.5) mult = 10
  else if (fraction >= 3.2) mult = 5
  else if (fraction >= 1.6) mult = 2
  const major = mult * base
  const minor = mult === 2 ? major / 4 : major / 5
  return { major, minor }
}

export function formatAxisTick(value: number, step: number): string {
  if (Math.abs(value) < step * 1e-6) return '0'
  const abs = Math.abs(value)
  if (abs >= 1e6 || (abs > 0 && abs < 1e-4)) {
    return value.toExponential(2).replace(/\.?0+e/, 'e').replace('+', '')
  }
  const decimals = Math.max(0, Math.min(8, Math.ceil(-Math.log10(step) + 1e-9)))
  const fixed = value.toFixed(decimals)
  return decimals > 0 ? fixed.replace(/\.?0+$/, '') : fixed
}

export function formatCoordinateValue(value: number): string {
  if (!Number.isFinite(value)) return '—'
  if (Math.abs(value) < 1e-9) return '0'
  const abs = Math.abs(value)
  if (abs >= 1e6 || abs < 1e-4) return value.toExponential(2).replace('+', '')
  return String(Number(value.toFixed(3)))
}

interface ClippedSegment {
  x0: number
  y0: number
  x1: number
  y1: number
}

/** Cohen–Sutherland 线段裁剪：保证极大缩放比或高次多项式不会生成越界浮点 SVG 坐标。 */
function clipSegmentToRect(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  minX: number,
  maxX: number,
  minY: number,
  maxY: number,
): ClippedSegment | null {
  const INSIDE = 0
  const LEFT = 1
  const RIGHT = 2
  const BOTTOM = 4
  const TOP = 8

  const outCode = (x: number, y: number) => {
    let code = INSIDE
    if (x < minX) code |= LEFT
    else if (x > maxX) code |= RIGHT
    if (y < minY) code |= BOTTOM
    else if (y > maxY) code |= TOP
    return code
  }

  let x0 = ax
  let y0 = ay
  let x1 = bx
  let y1 = by
  let code0 = outCode(x0, y0)
  let code1 = outCode(x1, y1)

  for (let iter = 0; iter < 12; iter += 1) {
    if ((code0 | code1) === 0) return { x0, y0, x1, y1 }
    if ((code0 & code1) !== 0) return null
    const out = code0 !== 0 ? code0 : code1
    let x = 0
    let y = 0
    const dx = x1 - x0
    const dy = y1 - y0
    if (out & TOP) {
      x = dy === 0 ? x0 : x0 + (dx * (maxY - y0)) / dy
      y = maxY
    } else if (out & BOTTOM) {
      x = dy === 0 ? x0 : x0 + (dx * (minY - y0)) / dy
      y = minY
    } else if (out & RIGHT) {
      y = dx === 0 ? y0 : y0 + (dy * (maxX - x0)) / dx
      x = maxX
    } else {
      y = dx === 0 ? y0 : y0 + (dy * (minX - x0)) / dx
      x = minX
    }
    if (out === code0) {
      x0 = x
      y0 = y
      code0 = outCode(x0, y0)
    } else {
      x1 = x
      y1 = y
      code1 = outCode(x1, y1)
    }
  }
  return null
}

function fmtSvgNum(value: number): string {
  return String(Number(value.toFixed(2)))
}

export function buildPolylineSvgPath(
  points: Array<{ x: number; y: number }>,
  viewport: UiCcsViewport,
  width = UI_CCS_VIEW_WIDTH,
  height = UI_CCS_VIEW_HEIGHT,
): string {
  if (points.length < 2) return ''
  const halfW = (width / 2) * viewport.unitsPerPx
  const halfH = (height / 2) * viewport.unitsPerPx
  const padX = halfW * 0.15
  const padY = halfH * 0.15
  const minX = viewport.centerX - halfW - padX
  const maxX = viewport.centerX + halfW + padX
  const minY = viewport.centerY - halfH - padY
  const maxY = viewport.centerY + halfH + padY

  const toSX = (wx: number) => width / 2 + (wx - viewport.centerX) / viewport.unitsPerPx
  const toSY = (wy: number) => height / 2 - (wy - viewport.centerY) / viewport.unitsPerPx

  const cmds: string[] = []
  let lastEnd: { x: number; y: number } | null = null

  for (let i = 0; i < points.length - 1; i += 1) {
    const p0 = points[i]
    const p1 = points[i + 1]
    const clipped = clipSegmentToRect(p0.x, p0.y, p1.x, p1.y, minX, maxX, minY, maxY)
    if (!clipped) {
      lastEnd = null
      continue
    }
    const sx0 = toSX(clipped.x0)
    const sy0 = toSY(clipped.y0)
    const sx1 = toSX(clipped.x1)
    const sy1 = toSY(clipped.y1)
    if (!lastEnd || Math.hypot(sx0 - lastEnd.x, sy0 - lastEnd.y) > 0.05) {
      cmds.push(`M${fmtSvgNum(sx0)} ${fmtSvgNum(sy0)}`)
    }
    cmds.push(`L${fmtSvgNum(sx1)} ${fmtSvgNum(sy1)}`)
    lastEnd = { x: sx1, y: sy1 }
  }

  return cmds.join(' ')
}

/** 自适应采样并裁剪函数图像 `y = f(x)`，兼顾高次陡峭曲线与间断点。 */
export function buildFunctionSvgPath(
  evaluate: (x: number) => number,
  viewport: UiCcsViewport,
  width = UI_CCS_VIEW_WIDTH,
  height = UI_CCS_VIEW_HEIGHT,
): string {
  const halfW = (width / 2) * viewport.unitsPerPx
  const halfH = (height / 2) * viewport.unitsPerPx
  const minX = viewport.centerX - halfW
  const maxX = viewport.centerX + halfW
  const marginY = halfH * 0.25
  const clipMinY = viewport.centerY - halfH - marginY
  const clipMaxY = viewport.centerY + halfH + marginY

  const toSX = (wx: number) => width / 2 + (wx - viewport.centerX) / viewport.unitsPerPx
  const toSY = (wy: number) => height / 2 - (wy - viewport.centerY) / viewport.unitsPerPx

  const baseSamples = Math.max(320, Math.round(width * 0.8))
  const dx = (maxX - minX) / baseSamples
  const samples: Array<{ x: number; y: number }> = []
  for (let i = 0; i <= baseSamples; i += 1) {
    const x = minX + i * dx
    samples.push({ x, y: evaluate(x) })
  }

  const cmds: string[] = []
  let pen: { x: number; y: number } | null = null

  const emitSegment = (x0: number, y0: number, x1: number, y1: number) => {
    if (!Number.isFinite(y0) || !Number.isFinite(y1)) {
      pen = null
      return
    }
    // 渐近线 / 跳跃间断检测：中点偏离两端线性插值过大且跨度显著时断开画笔。
    const xm = (x0 + x1) * 0.5
    const ym = evaluate(xm)
    if (!Number.isFinite(ym)) {
      pen = null
      return
    }
    const spanY = Math.abs(y1 - y0)
    const linearMid = (y0 + y1) * 0.5
    if (
      spanY > viewport.unitsPerPx * 18 &&
      Math.abs(ym - linearMid) > spanY * 0.45 + viewport.unitsPerPx * 4
    ) {
      pen = null
      return
    }

    const clipped = clipSegmentToRect(x0, y0, x1, y1, minX, maxX, clipMinY, clipMaxY)
    if (!clipped) {
      pen = null
      return
    }
    const sx0 = toSX(clipped.x0)
    const sy0 = toSY(clipped.y0)
    const sx1 = toSX(clipped.x1)
    const sy1 = toSY(clipped.y1)
    if (!pen || Math.hypot(sx0 - pen.x, sy0 - pen.y) > 0.25) {
      cmds.push(`M${fmtSvgNum(sx0)} ${fmtSvgNum(sy0)}`)
    }
    cmds.push(`L${fmtSvgNum(sx1)} ${fmtSvgNum(sy1)}`)
    pen = { x: sx1, y: sy1 }
  }

  const refine = (x0: number, y0: number, x1: number, y1: number, depth: number) => {
    const f0 = Number.isFinite(y0)
    const f1 = Number.isFinite(y1)
    if (!f0 && !f1) {
      pen = null
      return
    }
    if (depth > 0) {
      // 定义域边界二分逼近（如 sqrt(x)、ln(x)）
      if (f0 !== f1) {
        const xm = (x0 + x1) * 0.5
        const ym = evaluate(xm)
        refine(x0, y0, xm, ym, depth - 1)
        refine(xm, ym, x1, y1, depth - 1)
        return
      }
      // 穿过或接近可视区的高斜率曲线（如 90*x^3 + 7*x^2 + 6*x）细分加密
      const crossesBand =
        (y0 >= clipMinY && y0 <= clipMaxY) ||
        (y1 >= clipMinY && y1 <= clipMaxY) ||
        (y0 < clipMinY && y1 > clipMaxY) ||
        (y0 > clipMaxY && y1 < clipMinY)
      if (crossesBand && Math.abs(y1 - y0) > viewport.unitsPerPx * 4) {
        const xm = (x0 + x1) * 0.5
        const ym = evaluate(xm)
        refine(x0, y0, xm, ym, depth - 1)
        refine(xm, ym, x1, y1, depth - 1)
        return
      }
    }
    emitSegment(x0, y0, x1, y1)
  }

  for (let i = 0; i < samples.length - 1; i += 1) {
    refine(samples[i].x, samples[i].y, samples[i + 1].x, samples[i + 1].y, 6)
  }

  return cmds.join(' ')
}

/* -------------------------------------------------------------------------- */
/*                    特殊点求解：单点、端点、折点与全部交点                      */
/* -------------------------------------------------------------------------- */

export type UiCcsSpecialPointKind = 'point' | 'endpoint' | 'intersection'
export type UiCcsHoverKind = UiCcsSpecialPointKind | 'line'

export interface UiCcsSpecialPoint {
  kind: UiCcsSpecialPointKind
  x: number
  y: number
  sx: number
  sy: number
  color?: string
  label?: string
}

export interface UiCcsHoverTarget {
  kind: UiCcsHoverKind
  x: number
  y: number
  sx: number
  sy: number
  distancePx: number
  color?: string
  label?: string
}

export const UI_CCS_SNAP_RADIUS_PX = 16
export const UI_CCS_SNAP_CORE_RADIUS_PX = 11
export const UI_CCS_LINE_HOVER_RADIUS_PX = 14

interface Segment2D {
  ax: number
  ay: number
  bx: number
  by: number
}

function normalizeZero(value: number): number {
  return Math.abs(value) < 1e-10 ? 0 : value
}

/**
 * 在一维区间 `[a, b]` 上求解 `diff(x) = f1(x) - f2(x) = 0` 的全部连续根（含横截根与偶重相切根），
 * 自动过滤反比例函数 / 正切函数等竖直渐近线与阶跃间断点。
 */
function solve1DRootsOnInterval(
  diff: (x: number) => number,
  evalY: (x: number) => number,
  a: number,
  b: number,
  samplesCount: number,
  tolY: number,
  maxJumpY: number,
): Array<{ x: number; y: number }> {
  if (!(b > a)) return []
  const n = Math.max(16, samplesCount)
  const step = (b - a) / n
  const xs = new Float64Array(n + 1)
  const ds = new Float64Array(n + 1)
  for (let i = 0; i <= n; i += 1) {
    const x = i === n ? b : a + i * step
    xs[i] = x
    ds[i] = diff(x)
  }

  const roots: Array<{ x: number; y: number }> = []
  const acceptCandidate = (xStar: number) => {
    const dVal = diff(xStar)
    const yVal = evalY(xStar)
    if (!Number.isFinite(dVal) || !Number.isFinite(yVal)) return
    const deltaCoarse = Math.max(1e-6, step * 1e-3)
    const deltaFine = Math.max(1e-10, step * 1e-7)
    const dCoarseL = diff(Math.max(a, xStar - deltaCoarse))
    const dCoarseR = diff(Math.min(b, xStar + deltaCoarse))
    const dFineL = diff(Math.max(a, xStar - deltaFine))
    const dFineR = diff(Math.min(b, xStar + deltaFine))
    if (
      !Number.isFinite(dCoarseL) ||
      !Number.isFinite(dCoarseR) ||
      !Number.isFinite(dFineL) ||
      !Number.isFinite(dFineR)
    ) {
      return
    }
    const oscCoarse = Math.abs(dCoarseR - dCoarseL)
    const oscFine = Math.abs(dFineR - dFineL)
    // 连续函数在区间缩小 10^4 倍后振幅必然收敛趋零；极点渐近线与阶跃间断不会收敛
    if (oscFine > oscCoarse * 0.25 + 1e-7 || oscFine > maxJumpY) return
    const slopeAllowance = oscFine * 4
    if (Math.abs(dVal) > Math.max(tolY, slopeAllowance)) return
    roots.push({ x: normalizeZero(xStar), y: normalizeZero(yVal) })
  }

  for (let i = 0; i < n; i += 1) {
    const x0 = xs[i]
    const x1 = xs[i + 1]
    const d0 = ds[i]
    const d1 = ds[i + 1]
    if (!Number.isFinite(d0) || !Number.isFinite(d1)) continue

    if (d0 === 0) {
      acceptCandidate(x0)
      continue
    }

    if ((d0 < 0 && d1 > 0) || (d0 > 0 && d1 < 0)) {
      let lo = x0
      let hi = x1
      let fLo = d0
      for (let iter = 0; iter < 52; iter += 1) {
        const mid = (lo + hi) * 0.5
        const fMid = diff(mid)
        if (!Number.isFinite(fMid)) break
        if (fMid === 0) {
          lo = mid
          hi = mid
          break
        }
        if ((fLo < 0 && fMid > 0) || (fLo > 0 && fMid < 0)) {
          hi = mid
        } else {
          lo = mid
          fLo = fMid
        }
      }
      acceptCandidate((lo + hi) * 0.5)
    } else if (i > 0) {
      // 检测偶重相切根（如 y = (x - 2)^2 与 x 轴切于 (2, 0)，或 y = x^2 与 y = 2x - 1 切于 (1, 1)）
      const prevAbs = Math.abs(ds[i - 1])
      const currAbs = Math.abs(d0)
      const nextAbs = Math.abs(d1)
      if (Number.isFinite(prevAbs) && currAbs <= prevAbs && currAbs <= nextAbs) {
        let left = xs[i - 1]
        let right = x1
        const invPhi = (Math.sqrt(5) - 1) / 2
        let c = right - (right - left) * invPhi
        let d = left + (right - left) * invPhi
        let fc = Math.abs(diff(c))
        let fd = Math.abs(diff(d))
        for (let iter = 0; iter < 48; iter += 1) {
          if (fc < fd) {
            right = d
            d = c
            fd = fc
            c = right - (right - left) * invPhi
            fc = Math.abs(diff(c))
          } else {
            left = c
            c = d
            fc = fd
            d = left + (right - left) * invPhi
            fd = Math.abs(diff(d))
          }
        }
        acceptCandidate((left + right) * 0.5)
      }
    }
  }

  if (Number.isFinite(ds[n]) && ds[n] === 0) {
    acceptCandidate(b)
  }

  return roots
}

function intersectTwoSegments(s1: Segment2D, s2: Segment2D): { x: number; y: number } | null {
  const rX = s1.bx - s1.ax
  const rY = s1.by - s1.ay
  const sX = s2.bx - s2.ax
  const sY = s2.by - s2.ay
  const denom = rX * sY - rY * sX
  if (Math.abs(denom) <= 1e-12) return null
  const qpX = s2.ax - s1.ax
  const qpY = s2.ay - s1.ay
  const t = (qpX * sY - qpY * sX) / denom
  const u = (qpX * rY - qpY * rX) / denom
  const eps = 1e-9
  if (t < -eps || t > 1 + eps || u < -eps || u > 1 + eps) return null
  return {
    x: normalizeZero(s1.ax + t * rX),
    y: normalizeZero(s1.ay + t * rY),
  }
}

/**
 * 提取当前视口内所有可悬停吸附的特殊点：
 * - 单点（`create_point`）
 * - 折线 / 线段的全部端点与中间折点、闭定义域函数的定义域端点（如 `sqrt(x)`、`acos(x)`）
 * - 线段×线段、曲线×曲线、曲线×线段、图形×坐标轴及坐标轴原点 `(0, 0)` 的全部交点
 */
export function findUiCcsSpecialPoints(
  items: UiCcsItem[],
  viewport: UiCcsViewport,
  width = UI_CCS_VIEW_WIDTH,
  height = UI_CCS_VIEW_HEIGHT,
): UiCcsSpecialPoint[] {
  const halfW = (width / 2) * viewport.unitsPerPx
  const halfH = (height / 2) * viewport.unitsPerPx
  const padX = halfW * 0.08
  const padY = halfH * 0.08
  const minX = viewport.centerX - halfW - padX
  const maxX = viewport.centerX + halfW + padX
  const minY = viewport.centerY - halfH - padY
  const maxY = viewport.centerY + halfH + padY

  const toSX = (wx: number) => width / 2 + (wx - viewport.centerX) / viewport.unitsPerPx
  const toSY = (wy: number) => height / 2 - (wy - viewport.centerY) / viewport.unitsPerPx

  const rawCandidates: Array<UiCcsSpecialPoint & { priority: number }> = []
  const pushCandidate = (
    kind: UiCcsSpecialPointKind,
    x: number,
    y: number,
    priority: number,
    color?: string,
    label?: string,
  ) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return
    if (x < minX || x > maxX || y < minY || y > maxY) return
    const nx = normalizeZero(x)
    const ny = normalizeZero(y)
    rawCandidates.push({
      kind,
      x: nx,
      y: ny,
      sx: toSX(nx),
      sy: toSY(ny),
      color,
      label,
      priority,
    })
  }

  const allSegments: Array<{ seg: Segment2D; itemIndex: number }> = []
  const allFunctions: Array<{ item: UiCcsFunctionItem; itemIndex: number }> = []

  // 1. 单点与折线端点/折点
  items.forEach((item, idx) => {
    const color = resolveCcsItemColor(item, idx)
    if (item.kind === 'point') {
      pushCandidate('point', item.x, item.y, 1, color, item.label)
    } else if (item.kind === 'polyline') {
      for (const vertex of item.points) {
        pushCandidate('endpoint', vertex.x, vertex.y, 2, color, item.label)
      }
      for (let i = 0; i < item.points.length - 1; i += 1) {
        allSegments.push({
          seg: {
            ax: item.points[i].x,
            ay: item.points[i].y,
            bx: item.points[i + 1].x,
            by: item.points[i + 1].y,
          },
          itemIndex: idx,
        })
      }
    } else {
      allFunctions.push({ item, itemIndex: idx })
    }
  })

  // 2. 闭定义域函数曲线的定义域端点（如 sqrt(x) 在 (0,0)、sqrt(4-x^2) 在 (±2,0)、acos(x) 在 (-1,π)/(1,0)）
  const domainSamples = 480
  const dx = (maxX - minX) / domainSamples
  for (const { item, itemIndex } of allFunctions) {
    const color = resolveCcsItemColor(item, itemIndex)
    let prevX = minX
    let prevY = item.evaluate(minX)
    for (let i = 1; i <= domainSamples; i += 1) {
      const currX = i === domainSamples ? maxX : minX + i * dx
      const currY = item.evaluate(currX)
      const prevValid = Number.isFinite(prevY)
      const currValid = Number.isFinite(currY)
      if (prevValid !== currValid && Number.isNaN(prevValid ? currY : prevY)) {
        let validX = prevValid ? prevX : currX
        let invalidX = prevValid ? currX : prevX
        for (let iter = 0; iter < 48; iter += 1) {
          const mid = (validX + invalidX) * 0.5
          if (Number.isFinite(item.evaluate(mid))) validX = mid
          else invalidX = mid
        }
        const snappedX = Math.abs(validX - Math.round(validX)) < 1e-7 ? Math.round(validX) : validX
        const exactAtSnapped = item.evaluate(snappedX)
        const edgeX = Number.isFinite(exactAtSnapped) ? snappedX : validX
        const edgeY = Number.isFinite(exactAtSnapped) ? exactAtSnapped : item.evaluate(validX)
        const innerProbeX = edgeX + (prevValid ? -1 : 1) * Math.max(1e-6, dx * 1e-4)
        const innerProbeY = item.evaluate(innerProbeX)
        if (
          Number.isFinite(edgeY) &&
          Number.isFinite(innerProbeY) &&
          Math.abs(edgeY - innerProbeY) <= 0.05 * (1 + Math.abs(edgeY))
        ) {
          pushCandidate('endpoint', edgeX, edgeY, 2, color)
        }
      }
      prevX = currX
      prevY = currY
    }
  }

  // 3. 线段与线段交点 + 线段与坐标轴交点
  for (let i = 0; i < allSegments.length; i += 1) {
    const s1 = allSegments[i].seg
    for (let j = i + 1; j < allSegments.length; j += 1) {
      // 同一折线相邻两段共享公共顶点已在端点中收录，无需重复求交
      if (
        allSegments[i].itemIndex === allSegments[j].itemIndex &&
        ((s1.bx === allSegments[j].seg.ax && s1.by === allSegments[j].seg.ay) ||
          (s1.ax === allSegments[j].seg.bx && s1.ay === allSegments[j].seg.by))
      ) {
        continue
      }
      const hit = intersectTwoSegments(s1, allSegments[j].seg)
      if (hit) pushCandidate('intersection', hit.x, hit.y, 3)
    }

    const hitXAxis = intersectTwoSegments(s1, { ax: minX - 1, ay: 0, bx: maxX + 1, by: 0 })
    if (hitXAxis) pushCandidate('intersection', hitXAxis.x, hitXAxis.y, 4)

    const hitYAxis = intersectTwoSegments(s1, { ax: 0, ay: minY - 1, bx: 0, by: maxY + 1 })
    if (hitYAxis) pushCandidate('intersection', hitYAxis.x, hitYAxis.y, 4)
  }

  const tolY = Math.max(1e-5, viewport.unitsPerPx * 0.05)
  const maxJumpY = Math.max(2, halfH * 0.6)

  // 4. 函数曲线与坐标轴交点、函数曲线与函数曲线交点、函数曲线与线段交点
  for (let i = 0; i < allFunctions.length; i += 1) {
    const fnA = allFunctions[i].item.evaluate

    // 与 Y 轴交点 (0, f(0))
    if (minX <= 0 && maxX >= 0) {
      const y0 = fnA(0)
      if (Number.isFinite(y0)) pushCandidate('intersection', 0, y0, 4)
    }

    // 与 X 轴交点 f(x) = 0
    for (const root of solve1DRootsOnInterval(fnA, () => 0, minX, maxX, 540, tolY, maxJumpY)) {
      pushCandidate('intersection', root.x, 0, 4)
    }

    // 与其他函数曲线交点 fA(x) = fB(x)
    for (let j = i + 1; j < allFunctions.length; j += 1) {
      const fnB = allFunctions[j].item.evaluate
      const roots = solve1DRootsOnInterval(
        (x) => fnA(x) - fnB(x),
        fnA,
        minX,
        maxX,
        540,
        tolY,
        maxJumpY,
      )
      for (const r of roots) {
        pushCandidate('intersection', r.x, r.y, 3)
      }
    }

    // 与折线各线段交点
    for (const { seg } of allSegments) {
      if (Math.abs(seg.bx - seg.ax) <= 1e-12) {
        // 竖直线段 x = c
        const xConst = seg.ax
        if (xConst >= minX && xConst <= maxX) {
          const yVal = fnA(xConst)
          const segMinY = Math.min(seg.ay, seg.by) - 1e-7
          const segMaxY = Math.max(seg.ay, seg.by) + 1e-7
          if (Number.isFinite(yVal) && yVal >= segMinY && yVal <= segMaxY) {
            pushCandidate('intersection', xConst, yVal, 3)
          }
        }
      } else {
        const segMinX = Math.max(minX, Math.min(seg.ax, seg.bx))
        const segMaxX = Math.min(maxX, Math.max(seg.ax, seg.bx))
        if (segMaxX >= segMinX) {
          const slope = (seg.by - seg.ay) / (seg.bx - seg.ax)
          const lineY = (x: number) => seg.ay + slope * (x - seg.ax)
          if (segMinX === segMaxX) {
            if (Math.abs(fnA(segMinX) - lineY(segMinX)) <= tolY) {
              pushCandidate('intersection', segMinX, lineY(segMinX), 3)
            }
          } else {
            const segSamples = Math.max(24, Math.min(360, Math.ceil((segMaxX - segMinX) / dx) * 2))
            const roots = solve1DRootsOnInterval(
              (x) => fnA(x) - lineY(x),
              lineY,
              segMinX,
              segMaxX,
              segSamples,
              tolY,
              maxJumpY,
            )
            for (const r of roots) {
              pushCandidate('intersection', r.x, r.y, 3)
            }
          }
        }
      }
    }
  }

  // 5. X 轴与 Y 轴交点：原点 (0, 0)
  pushCandidate('intersection', 0, 0, 5)

  // 按优先级排序后去重，合并数值误差范围内重合的同一点
  rawCandidates.sort((a, b) => a.priority - b.priority)
  const deduped: UiCcsSpecialPoint[] = []
  const mergeDistWorld = Math.max(1e-5, viewport.unitsPerPx * 0.75)

  for (const item of rawCandidates) {
    const exists = deduped.some(
      (prev) => Math.hypot(prev.x - item.x, prev.y - item.y) <= mergeDistWorld,
    )
    if (!exists) {
      deduped.push({
        kind: item.kind,
        x: item.x,
        y: item.y,
        sx: item.sx,
        sy: item.sy,
        color: item.color,
        label: item.label,
      })
    }
  }

  return deduped
}

export function findNearestUiCcsSpecialPoint(
  specialPoints: UiCcsSpecialPoint[],
  svgX: number,
  svgY: number,
  maxRadiusPx = UI_CCS_SNAP_RADIUS_PX,
): UiCcsHoverTarget | null {
  let best: UiCcsHoverTarget | null = null
  let bestDist = maxRadiusPx
  for (const pt of specialPoints) {
    const dist = Math.hypot(pt.sx - svgX, pt.sy - svgY)
    if (dist <= bestDist) {
      bestDist = dist
      best = { ...pt, distancePx: dist }
    }
  }
  return best
}

/**
 * 计算指针到所有折线 / 线段与函数曲线的二维欧氏最近点（精确正交投影，兼容高斜率陡峭曲线）。
 */
export function findNearestPointOnUiCcsLines(
  items: UiCcsItem[],
  viewport: UiCcsViewport,
  svgX: number,
  svgY: number,
  maxRadiusPx = UI_CCS_LINE_HOVER_RADIUS_PX,
  width = UI_CCS_VIEW_WIDTH,
  height = UI_CCS_VIEW_HEIGHT,
): UiCcsHoverTarget | null {
  const units = viewport.unitsPerPx
  const mx = viewport.centerX + (svgX - width / 2) * units
  const my = viewport.centerY - (svgY - height / 2) * units
  const maxWorldDist = maxRadiusPx * units
  const maxWorldDistSq = maxWorldDist * maxWorldDist

  const toSX = (wx: number) => width / 2 + (wx - viewport.centerX) / units
  const toSY = (wy: number) => height / 2 - (wy - viewport.centerY) / units

  let bestWorldDistSq = maxWorldDistSq
  let bestTarget: UiCcsHoverTarget | null = null

  const consider = (wx: number, wy: number, color: string, label?: string) => {
    if (!Number.isFinite(wx) || !Number.isFinite(wy)) return
    const dx = wx - mx
    const dy = wy - my
    const d2 = dx * dx + dy * dy
    if (d2 <= bestWorldDistSq) {
      bestWorldDistSq = d2
      const nx = normalizeZero(wx)
      const ny = normalizeZero(wy)
      bestTarget = {
        kind: 'line',
        x: nx,
        y: ny,
        sx: toSX(nx),
        sy: toSY(ny),
        distancePx: Math.sqrt(d2) / units,
        color,
        label,
      }
    }
  }

  const invPhi = (Math.sqrt(5) - 1) / 2

  items.forEach((item, idx) => {
    const color = resolveCcsItemColor(item, idx)
    if (item.kind === 'polyline') {
      for (let i = 0; i < item.points.length - 1; i += 1) {
        const ax = item.points[i].x
        const ay = item.points[i].y
        const bx = item.points[i + 1].x
        const by = item.points[i + 1].y
        const vx = bx - ax
        const vy = by - ay
        const lenSq = vx * vx + vy * vy
        let t = lenSq > 1e-24 ? ((mx - ax) * vx + (my - ay) * vy) / lenSq : 0
        if (t < 0) t = 0
        else if (t > 1) t = 1
        consider(ax + t * vx, ay + t * vy, color, item.label)
      }
    } else if (item.kind === 'function') {
      // 距离鼠标不超过 maxWorldDist 的曲线点必然满足 |x - mx| <= maxWorldDist
      const xStart = mx - maxWorldDist
      const xEnd = mx + maxWorldDist
      const n = 96
      const step = (xEnd - xStart) / n
      const xs = new Float64Array(n + 1)
      const ys = new Float64Array(n + 1)
      const d2s = new Float64Array(n + 1)

      const evalDistSq = (x: number) => {
        const y = item.evaluate(x)
        if (!Number.isFinite(y)) return Number.POSITIVE_INFINITY
        const dx = x - mx
        const dy = y - my
        return dx * dx + dy * dy
      }

      for (let i = 0; i <= n; i += 1) {
        const x = i === n ? xEnd : xStart + i * step
        const y = item.evaluate(x)
        xs[i] = x
        ys[i] = y
        d2s[i] = Number.isFinite(y) ? (x - mx) * (x - mx) + (y - my) * (y - my) : Number.POSITIVE_INFINITY
        if (Number.isFinite(y)) {
          consider(x, y, color, item.label)
        }
      }

      const refineBracket = (leftInit: number, rightInit: number) => {
        let left = leftInit
        let right = rightInit
        let c = right - (right - left) * invPhi
        let d = left + (right - left) * invPhi
        let fc = evalDistSq(c)
        let fd = evalDistSq(d)
        for (let iter = 0; iter < 36; iter += 1) {
          if (fc <= fd) {
            right = d
            d = c
            fd = fc
            c = right - (right - left) * invPhi
            fc = evalDistSq(c)
          } else {
            left = c
            c = d
            fc = fd
            d = left + (right - left) * invPhi
            fd = evalDistSq(d)
          }
        }
        const xStar = (left + right) * 0.5
        const yStar = item.evaluate(xStar)
        if (!Number.isFinite(yStar)) return
        // 排除竖直渐近线 / 跳变间断伪点
        const eps = Math.max(1e-9, step * 1e-5)
        const yL = item.evaluate(xStar - eps)
        const yR = item.evaluate(xStar + eps)
        if (Number.isFinite(yL) && Number.isFinite(yR) && Math.abs(yR - yL) > Math.max(2, maxWorldDist * 8)) {
          return
        }
        consider(xStar, yStar, color, item.label)
      }

      for (let i = 0; i < n; i += 1) {
        const y0 = ys[i]
        const y1 = ys[i + 1]
        // 情况 A：高斜率函数在相邻采样点间跨过鼠标纵坐标 my
        if (Number.isFinite(y0) && Number.isFinite(y1) && ((y0 <= my && y1 >= my) || (y0 >= my && y1 <= my))) {
          refineBracket(xs[i], xs[i + 1])
        } else if (i > 0 && d2s[i] <= d2s[i - 1] && d2s[i] <= d2s[i + 1] && Number.isFinite(d2s[i])) {
          // 情况 B：局部欧氏距离极小值区间精细收敛
          refineBracket(xs[i - 1], xs[i + 1])
        }
      }
    }
  })

  return bestTarget
}

/**
 * 综合悬停解析：
 * - 当指针进入特殊点磁吸核心半径（默认 11px）或比任何线条更接近特殊点时，优先吸附至特殊点（交点 / 折线顶点 / 端点 / 单点）；
 * - 否则当指针靠近任意折线或函数曲线（默认 14px 内）时，平滑跟随显示线上距指针最近的精确点坐标。
 */
export function resolveUiCcsHoverTarget(
  items: UiCcsItem[],
  specialPoints: UiCcsSpecialPoint[],
  viewport: UiCcsViewport,
  svgX: number,
  svgY: number,
  width = UI_CCS_VIEW_WIDTH,
  height = UI_CCS_VIEW_HEIGHT,
): UiCcsHoverTarget | null {
  const nearestSpecial = findNearestUiCcsSpecialPoint(specialPoints, svgX, svgY, UI_CCS_SNAP_RADIUS_PX)
  if (nearestSpecial && nearestSpecial.distancePx <= UI_CCS_SNAP_CORE_RADIUS_PX) {
    return nearestSpecial
  }

  const nearestOnLine = findNearestPointOnUiCcsLines(
    items,
    viewport,
    svgX,
    svgY,
    UI_CCS_LINE_HOVER_RADIUS_PX,
    width,
    height,
  )

  if (nearestSpecial && (!nearestOnLine || nearestSpecial.distancePx <= nearestOnLine.distancePx)) {
    return nearestSpecial
  }

  return nearestOnLine
}

/** 静态 HTML / SVG 渲染（用于 MPE 静态兼容模式）。 */
export function renderStaticUiCcsSvg(source: string): string {
  const { items } = parseUiCcs(source)
  const width = UI_CCS_VIEW_WIDTH
  const height = UI_CCS_VIEW_HEIGHT
  const viewport = computeInitialUiCcsViewport(items, width, height)
  const { major, minor } = chooseGridStep(viewport.unitsPerPx)
  const halfW = (width / 2) * viewport.unitsPerPx
  const halfH = (height / 2) * viewport.unitsPerPx
  const minX = viewport.centerX - halfW
  const maxX = viewport.centerX + halfW
  const minY = viewport.centerY - halfH
  const maxY = viewport.centerY + halfH
  const toSX = (wx: number) => width / 2 + (wx - viewport.centerX) / viewport.unitsPerPx
  const toSY = (wy: number) => height / 2 - (wy - viewport.centerY) / viewport.unitsPerPx

  const minorParts: string[] = []
  for (let x = Math.ceil(minX / minor) * minor; x <= maxX; x += minor) {
    const sx = fmtSvgNum(toSX(x))
    minorParts.push(`M${sx} 0V${height}`)
  }
  for (let y = Math.ceil(minY / minor) * minor; y <= maxY; y += minor) {
    const sy = fmtSvgNum(toSY(y))
    minorParts.push(`M0 ${sy}H${width}`)
  }

  const majorParts: string[] = []
  const labels: string[] = []
  const axisX = Math.min(width - 26, Math.max(26, toSX(0)))
  const axisY = Math.min(height - 20, Math.max(20, toSY(0)))

  for (let x = Math.ceil(minX / major) * major; x <= maxX; x += major) {
    const sx = toSX(x)
    majorParts.push(`M${fmtSvgNum(sx)} 0V${height}`)
    if (Math.abs(x) >= major * 1e-4 && sx > 22 && sx < width - 22) {
      labels.push(
        `<text x="${fmtSvgNum(sx)}" y="${fmtSvgNum(Math.min(height - 6, axisY + 15))}" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.58">${formatAxisTick(x, major)}</text>`,
      )
    }
  }
  for (let y = Math.ceil(minY / major) * major; y <= maxY; y += major) {
    const sy = toSY(y)
    majorParts.push(`M0 ${fmtSvgNum(sy)}H${width}`)
    if (Math.abs(y) >= major * 1e-4 && sy > 16 && sy < height - 16) {
      labels.push(
        `<text x="${fmtSvgNum(Math.max(8, axisX - 7))}" y="${fmtSvgNum(sy + 3.5)}" text-anchor="end" font-size="10" fill="currentColor" opacity="0.58">${formatAxisTick(y, major)}</text>`,
      )
    }
  }

  const shapes = items
    .map((item, idx) => {
      const color = resolveCcsItemColor(item, idx, true)
      if (item.kind === 'point') {
        const sx = toSX(item.x)
        const sy = toSY(item.y)
        if (sx < -12 || sx > width + 12 || sy < -12 || sy > height + 12) return ''
        return `<circle cx="${fmtSvgNum(sx)}" cy="${fmtSvgNum(sy)}" r="4.5" fill="${color}" stroke="#fff" stroke-width="1.5" />`
      }
      const d =
        item.kind === 'polyline'
          ? buildPolylineSvgPath(item.points, viewport, width, height)
          : buildFunctionSvgPath(item.evaluate, viewport, width, height)
      return d
        ? `<path d="${d}" fill="none" stroke="${color}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" />`
        : ''
    })
    .filter(Boolean)
    .join('')

  return (
    `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="直角坐标系">` +
    `<path d="${minorParts.join('')}" stroke="currentColor" stroke-opacity="0.06" stroke-width="1" />` +
    `<path d="${majorParts.join('')}" stroke="currentColor" stroke-opacity="0.14" stroke-width="1" />` +
    `<line x1="0" y1="${fmtSvgNum(axisY)}" x2="${width}" y2="${fmtSvgNum(axisY)}" stroke="currentColor" stroke-opacity="0.55" stroke-width="1.4" />` +
    `<line x1="${fmtSvgNum(axisX)}" y1="0" x2="${fmtSvgNum(axisX)}" y2="${height}" stroke="currentColor" stroke-opacity="0.55" stroke-width="1.4" />` +
    labels.join('') +
    shapes +
    `</svg>`
  )
}
