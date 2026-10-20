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
