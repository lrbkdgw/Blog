/**
 * 交互平面直角坐标系（issue #76）：`::begin_ui-ccs` … `::end_ui-ccs` 的解析层。
 *
 * 块内每行（或每条分号语句）支持三种命令：
 *
 * ```text
 * create_point:(x,y);
 * create_line:(x_1,y_1),(x_2,y_2),...,(x_n,y_n),[color=red];
 * create_line:(7*x^2+6*x+90*x^3);
 * ```
 *
 * - `create_point` 在坐标系里画一个点；`create_line` 给定点对序列时画折线，
 *   只给一个不含逗号的表达式时，把它当成关于 x 的函数画图像；
 * - 坐标可以是数字，也可以是只含 `+ - * / ^ ( )` 与数字的常量表达式（如 `(1+2)/3`）；
 * - 颜色写在语句末尾的 `[color=…]` 里，支持调色板名称（含中文）与 `#rrggbb`；
 * - 语句之间用 `;` 分隔，最后一条可以省略分号。
 *
 * 本模块是零依赖的纯解析 / 纯计算，博客与 VS Code 插件共用；
 * 交互（拖动、缩放、绘制）在 components/CoordinatePlane.tsx。
 * 任何写坏的语句都只记录错误、不抛异常，避免一篇文章里的笔误让整篇打不开。
 */

import { evaluateShowFormula, splitTopLevel } from './showBox'

export interface PlanePoint {
  x: number
  y: number
}

export interface PlanePointSpec extends PlanePoint {
  color: string
  /** 原始坐标文本，图例与点标注用。 */
  label: string
}

export interface PlanePolylineSpec {
  points: PlanePoint[]
  color: string
  /** 语句原文（去掉颜色后缀），图例用。 */
  source: string
}

export interface PlaneFunctionSpec {
  /** 归一化后的表达式原文。 */
  expression: string
  color: string
  source: string
}

export interface PlaneError {
  /** 语句序号（1 基，按块内非空语句计数），方便作者定位。 */
  statement: number
  message: string
}

export interface PlaneSpec {
  points: PlanePointSpec[]
  polylines: PlanePolylineSpec[]
  functions: PlaneFunctionSpec[]
  errors: PlaneError[]
}

export const EMPTY_PLANE_SPEC: PlaneSpec = { points: [], polylines: [], functions: [], errors: [] }

/** 未指定颜色时的默认色（蓝，在明暗两套底色上都能看清）。 */
export const DEFAULT_PLANE_COLOR = '#2563eb'

/** 语句数量与单点折线规模的上限，防止文章里的笔误 / 恶意输入拖垮渲染。 */
const MAX_STATEMENTS = 200
const MAX_POLYLINE_POINTS = 1000
const MAX_FUNCTIONS = 12

/** 调色板：英文名 + 中文名，统一归一化成 hex 存在 spec 里。 */
const NAMED_PLANE_COLORS: Record<string, string> = {
  red: '#dc2626',
  rose: '#e11d48',
  pink: '#db2777',
  fuchsia: '#c026d3',
  purple: '#9333ea',
  violet: '#7c3aed',
  indigo: '#4f46e5',
  blue: '#2563eb',
  sky: '#0284c7',
  cyan: '#0891b2',
  teal: '#0d9488',
  emerald: '#059669',
  green: '#16a34a',
  lime: '#65a30d',
  yellow: '#ca8a04',
  amber: '#d97706',
  orange: '#ea580c',
  brown: '#92400e',
  gray: '#4b5563',
  grey: '#4b5563',
  black: '#111827',
  white: '#f9fafb',
  红: '#dc2626',
  粉: '#db2777',
  紫: '#9333ea',
  蓝: '#2563eb',
  青: '#0d9488',
  绿: '#16a34a',
  黄: '#ca8a04',
  橙: '#ea580c',
  棕: '#92400e',
  灰: '#4b5563',
  黑: '#111827',
  白: '#f9fafb',
}

/** 解析 `[color=…]`；无法识别时回退默认色（颜色是装饰，不当成语法错误）。 */
export function parsePlaneColor(raw: string | undefined): string {
  if (!raw) return DEFAULT_PLANE_COLOR
  const text = raw.trim().toLowerCase()
  const named = NAMED_PLANE_COLORS[text]
  if (named) return named
  const hex = text.match(/^#?([0-9a-f]{6}|[0-9a-f]{3})$/)
  if (hex) {
    let digits = hex[1]
    if (digits.length === 3) digits = digits.split('').map((c) => c + c).join('')
    return `#${digits}`
  }
  return DEFAULT_PLANE_COLOR
}

/* --------------------------- 表达式编译与求值 --------------------------- */

type PlaneNode =
  | { kind: 'num'; value: number }
  | { kind: 'x' }
  | { kind: 'unary'; op: '+' | '-'; arg: PlaneNode }
  | { kind: 'binary'; op: '+' | '-' | '*' | '/' | '^'; left: PlaneNode; right: PlaneNode }

/**
 * 把关于 x 的表达式预编译成闭包，逐像素采样时不必反复做语法分析。
 * 文法与 showBox 的 evaluateShowFormula 对齐：数字、变量 x、+ - * / ^、括号、一元正负号；
 * 除零 / 无穷 / NaN 一律返回 null，绘制端据此断开路径（如 1/x 在 x=0 处）。
 */
export function compilePlaneExpression(source: string): ((x: number) => number | null) | null {
  const text = source.trim()
  if (!text) return null
  let cursor = 0

  const skip = () => {
    while (/\s/.test(text[cursor] || '')) cursor += 1
  }

  const parseExpression = (): PlaneNode | null => {
    let node = parseTerm()
    if (!node) return null
    for (;;) {
      skip()
      const op = text[cursor]
      if (op !== '+' && op !== '-') break
      cursor += 1
      const right = parseTerm()
      if (!right) return null
      node = { kind: 'binary', op, left: node, right }
    }
    return node
  }

  const parseTerm = (): PlaneNode | null => {
    let node = parsePower()
    if (!node) return null
    for (;;) {
      skip()
      const op = text[cursor]
      if (op !== '*' && op !== '/') break
      cursor += 1
      const right = parsePower()
      if (!right) return null
      node = { kind: 'binary', op, left: node, right }
    }
    return node
  }

  const parsePower = (): PlaneNode | null => {
    const base = parsePrimary()
    if (!base) return null
    skip()
    if (text[cursor] !== '^') return base
    cursor += 1
    // 幂运算右结合：2^3^2 = 2^(3^2)
    const exponent = parsePower()
    if (!exponent) return null
    return { kind: 'binary', op: '^', left: base, right: exponent }
  }

  const parsePrimary = (): PlaneNode | null => {
    skip()
    const char = text[cursor]
    if (char === '+') {
      cursor += 1
      const arg = parsePrimary()
      return arg ? { kind: 'unary', op: '+', arg } : null
    }
    if (char === '-') {
      cursor += 1
      const arg = parsePrimary()
      return arg ? { kind: 'unary', op: '-', arg } : null
    }
    if (char === '(') {
      cursor += 1
      const inner = parseExpression()
      skip()
      if (text[cursor] !== ')') return null
      cursor += 1
      return inner
    }
    const rest = text.slice(cursor)
    const number = rest.match(/^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?/i)
    if (number) {
      cursor += number[0].length
      const value = Number(number[0])
      return Number.isFinite(value) ? { kind: 'num', value } : null
    }
    const identifier = rest.match(/^[A-Za-z_\u4e00-\u9fff][\w\u4e00-\u9fff-]*/)
    if (identifier) {
      // 函数图像只允许变量 x（X 同样接受）；出现其它标识符说明语法不受支持。
      if (!/^x$/i.test(identifier[0])) return null
      cursor += identifier[0].length
      return { kind: 'x' }
    }
    return null
  }

  const ast = parseExpression()
  skip()
  if (!ast || cursor !== text.length) return null

  const evaluate = (node: PlaneNode, x: number): number | null => {
    switch (node.kind) {
      case 'num':
        return node.value
      case 'x':
        return x
      case 'unary': {
        const value = evaluate(node.arg, x)
        if (value === null) return null
        return node.op === '-' ? -value : value
      }
      case 'binary': {
        const left = evaluate(node.left, x)
        const right = evaluate(node.right, x)
        if (left === null || right === null) return null
        let result: number
        switch (node.op) {
          case '+': result = left + right; break
          case '-': result = left - right; break
          case '*': result = left * right; break
          case '/':
            if (right === 0) return null
            result = left / right
            break
          case '^': result = left ** right; break
        }
        return Number.isFinite(result) ? result : null
      }
    }
  }

  return (x: number) => evaluate(ast, x)
}

/** 点坐标：数字或不含变量的常量表达式；任何标识符 / 非法写法都返回 null。 */
function parseCoordinate(raw: string): number | null {
  const text = raw.trim()
  if (!text) return null
  const value = evaluateShowFormula(text, {})
  return value !== null && Number.isFinite(value) ? value : null
}

/** 取出语句里所有顶层括号组（括号嵌套时整组保留）。 */
function topLevelGroups(text: string): string[] {
  const groups: string[] = []
  let start = -1
  let depth = 0
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]
    if (char === '(') {
      if (depth === 0) start = i + 1
      depth += 1
    } else if (char === ')') {
      if (depth > 0) {
        depth -= 1
        if (depth === 0 && start >= 0) {
          groups.push(text.slice(start, i))
          start = -1
        }
      }
    }
  }
  return groups
}

/** 把 `(x,y)` 组解析成坐标点；失败返回 null。 */
function parsePointGroup(group: string): PlanePoint | null {
  const parts = splitTopLevel(group, ',')
  if (parts.length !== 2) return null
  const x = parseCoordinate(parts[0])
  const y = parseCoordinate(parts[1])
  if (x === null || y === null) return null
  return { x, y }
}

const COLOR_SUFFIX_RE = /\[\s*color\s*=\s*([^\]\r\n]+?)\s*\]\s*$/i
const COMMAND_RE = /^(create_point|create_line)\s*:\s*([\s\S]*)$/i

/**
 * 解析整个坐标系指令块。
 * 分号在括号 / 方括号外才视为语句分隔（splitTopLevel 已处理嵌套深度）。
 */
export function parseCoordinatePlane(body: string): PlaneSpec {
  const spec: PlaneSpec = { points: [], polylines: [], functions: [], errors: [] }
  if (!body || !body.trim()) return spec

  const statements = splitTopLevel(body, ';').map((s) => s.trim()).filter(Boolean)
  let polylinePointBudget = MAX_POLYLINE_POINTS

  statements.forEach((statement, index) => {
    const line = index + 1
    if (index >= MAX_STATEMENTS) {
      if (index === MAX_STATEMENTS) {
        spec.errors.push({ statement: line, message: `语句数量超过上限 ${MAX_STATEMENTS}，后续内容已忽略` })
      }
      return
    }
    const match = statement.match(COMMAND_RE)
    if (!match) {
      spec.errors.push({ statement: line, message: `无法识别的指令：${statement.slice(0, 24)}` })
      return
    }
    const command = match[1].toLowerCase()
    let remainder = match[2].trim()

    const colorMatch = remainder.match(COLOR_SUFFIX_RE)
    const color = parsePlaneColor(colorMatch?.[1])
    if (colorMatch) remainder = remainder.slice(0, colorMatch.index).trim()

    const groups = topLevelGroups(remainder)
    if (groups.length === 0) {
      spec.errors.push({ statement: line, message: '缺少括号包裹的坐标或表达式' })
      return
    }

    if (command === 'create_point') {
      if (groups.length !== 1) {
        spec.errors.push({ statement: line, message: 'create_point 只接受一个坐标 (x,y)' })
        return
      }
      const point = parsePointGroup(groups[0])
      if (!point) {
        spec.errors.push({ statement: line, message: `坐标无法解析：(${groups[0]})` })
        return
      }
      spec.points.push({ ...point, color, label: `(${groups[0].trim()})` })
      return
    }

    // create_line：单个括号组且内部没有顶层逗号 = 关于 x 的函数，否则是点对折线。
    if (groups.length === 1 && splitTopLevel(groups[0], ',').length === 1) {
      const expression = groups[0].trim()
      if (!compilePlaneExpression(expression)) {
        spec.errors.push({ statement: line, message: `函数表达式无法解析：${expression.slice(0, 32)}` })
        return
      }
      if (spec.functions.length >= MAX_FUNCTIONS) {
        spec.errors.push({ statement: line, message: `函数图像最多 ${MAX_FUNCTIONS} 条，后续已忽略` })
        return
      }
      spec.functions.push({ expression, color, source: remainder })
      return
    }

    if (groups.length < 2) {
      spec.errors.push({ statement: line, message: '折线至少需要两个坐标点，函数图像不要在括号内写逗号' })
      return
    }
    const points: PlanePoint[] = []
    for (const group of groups) {
      const point = parsePointGroup(group)
      if (!point) {
        spec.errors.push({ statement: line, message: `坐标无法解析：(${group.trim()})` })
        return
      }
      points.push(point)
    }
    if (points.length > polylinePointBudget) {
      spec.errors.push({ statement: line, message: `折线上限共 ${MAX_POLYLINE_POINTS} 个点，多余的已忽略` })
      points.length = polylinePointBudget
    }
    if (points.length < 2) return
    polylinePointBudget -= points.length
    spec.polylines.push({ points, color, source: remainder })
  })

  return spec
}

/** 点与折线的坐标范围（函数图像定义域无限，不参与初始取景）。 */
export function planeContentBounds(spec: PlaneSpec): { minX: number; maxX: number; minY: number; maxY: number } | null {
  const coords: PlanePoint[] = [...spec.points, ...spec.polylines.flatMap((line) => line.points)]
  if (coords.length === 0) return null
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  for (const { x, y } of coords) {
    minX = Math.min(minX, x)
    maxX = Math.max(maxX, x)
    minY = Math.min(minY, y)
    maxY = Math.max(maxY, y)
  }
  return { minX, maxX, minY, maxY }
}

/**
 * “好看”的刻度步长：在 1/2/5 ×10^k 序列里挑一个不小于 ideal 的值，
 * 网格间距大致恒定，缩放时刻度按 1–2–5 节奏切换。
 */
export function nicePlaneStep(ideal: number): number {
  if (!Number.isFinite(ideal) || ideal <= 0) return 1
  const exponent = Math.floor(Math.log10(ideal))
  const fraction = ideal / 10 ** exponent
  const mantissa = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10
  return mantissa * 10 ** exponent
}

/** 轴标签 / 点标注的数字格式：去掉浮点噪声，极大极小值走科学计数法。 */
export function formatPlaneNumber(value: number): string {
  if (!Number.isFinite(value)) return ''
  if (Object.is(value, -0)) value = 0
  const abs = Math.abs(value)
  if (abs !== 0 && (abs >= 1e7 || abs < 1e-4)) return value.toExponential(1)
  const rounded = Number(value.toPrecision(8))
  return String(rounded)
}
