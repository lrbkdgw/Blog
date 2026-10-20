/**
 * 平面直角坐标系（ui-ccs）内容解析与表达式求值（issue #76）。
 *
 * Markdown 里这样写（代码围栏中只是示例，不会执行）：
 *
 *   ::begin_ui-ccs
 *   create_point:(2,3);
 *   create_line:(0,0),(1,2),(3,1),[color=red];
 *   create_line:(7*x^2+6*x+90*x^3);
 *   ::end_ui-ccs
 *
 * - `create_point:(x,y);` 画一个点（分量可写 `sqrt(2)`、`pi/2` 等常数表达式）；
 * - `create_line:(x1,y1),…,(xn,yn);` 画一条折线；
 * - `create_line:(关于 x 的表达式);` 画函数 y=f(x)，也可写 `y=表达式`；
 * - 末尾可加 `[color=…]` 指定颜色（颜色名、#rrggbb、rgb()/hsl()），缺省按调色板轮换。
 *
 * 本模块零运行时依赖：博客与 VS Code 插件（MPE 静态兼容、源码降级）共用同一份解析。
 * 渲染在 `src/components/CoordinateSystem.tsx`。
 */

export interface CcsPoint {
  kind: 'point'
  x: number
  y: number
  color: string
}
export interface CcsPolyline {
  kind: 'polyline'
  points: [number, number][]
  color: string
}
export interface CcsFunction {
  kind: 'function'
  expr: string
  color: string
}
export type CcsItem = CcsPoint | CcsPolyline | CcsFunction

export interface CcsParseResult {
  items: CcsItem[]
  errors: string[]
}

/** 块起止行（整行匹配，大小写与首尾空白不敏感；下划线写法一并容忍）。 */
export const CCS_BEGIN_RE = /^\s*::begin_ui[-_]ccs\s*$/i
export const CCS_END_RE = /^\s*::end_ui[-_]ccs\s*$/i

export function isCcsBeginLine(line: string): boolean {
  return CCS_BEGIN_RE.test(line)
}
export function isCcsEndLine(line: string): boolean {
  return CCS_END_RE.test(line)
}

const PALETTE = ['#ef4444', '#2563eb', '#059669', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16']
/** 单块最多绘制的元素数，避免异常文章把画布拖死。 */
const MAX_ITEMS = 200
/** 单条折线最多保留的顶点数；超过后截断并提示，防止超长坐标串拖死解析与绘制。 */
const MAX_POINTS_PER_ITEM = 1000
/** 单块最多扫描的语句数（含写错的语句）。 */
const MAX_STATEMENTS = 500

interface CoordinateListResult {
  points: [number, number][]
  truncated: boolean
}

/** 坐标里只允许与 x 无关的常数表达式，如 `sqrt(2)`、`pi/2`、`-2^3`。 */
function constantCoordinateValue(raw: string): number | null {
  const trimmed = raw.trim()
  // 绝大多数坐标是纯数字：直读，避免长折线逐个数字都走一遍表达式编译。
  if (/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(trimmed)) {
    const n = Number(trimmed)
    return Number.isFinite(n) ? n : null
  }
  // 含独立变量 x 的一律拒绝（只采样两点会被 x(x-1) 这类式子骗过）；exp/max 等函数名里的 x 不算。
  if (/\bx\b/i.test(trimmed)) return null
  const fn = compileCcsExpression(trimmed)
  if (!fn) return null
  const atZero = fn(0)
  const atOne = fn(1)
  if (atZero === null || atOne === null) return null
  const tolerance = 1e-9 * Math.max(1, Math.abs(atZero), Math.abs(atOne))
  return Math.abs(atZero - atOne) <= tolerance ? atZero : null
}

function splitTopLevelComma(raw: string): string[] | null {
  const parts: string[] = []
  let depth = 0
  let start = 0
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i]
    if (ch === '(') depth += 1
    else if (ch === ')') {
      depth -= 1
      if (depth < 0) return null
    } else if (ch === ',' && depth === 0) {
      parts.push(raw.slice(start, i))
      start = i + 1
    }
  }
  if (depth !== 0) return null
  parts.push(raw.slice(start))
  return parts
}

/**
 * 严格解析一串坐标 `(x,y),(x,y),…`；整串有任何杂质都返回 null，
 * 这样 `create_line` 才能可靠地在「折线」与「函数表达式」之间二选一。
 * 坐标分量可写常数表达式（见 constantCoordinateValue）。
 */
function parseCoordinateList(rawInput: string): CoordinateListResult | null {
  const raw = rawInput.trim()
  if (!raw.startsWith('(')) return null
  const points: [number, number][] = []
  let truncated = false
  let cursor = 0

  while (cursor < raw.length) {
    while (/\s/.test(raw[cursor] || '')) cursor += 1
    if (raw[cursor] !== '(') return null

    let depth = 0
    let end = -1
    for (let i = cursor; i < raw.length; i += 1) {
      if (raw[i] === '(') depth += 1
      else if (raw[i] === ')') {
        depth -= 1
        if (depth === 0) {
          end = i
          break
        }
      }
    }
    if (end < 0) return null

    const parts = splitTopLevelComma(raw.slice(cursor + 1, end))
    if (!parts || parts.length !== 2) return null
    const x = constantCoordinateValue(parts[0])
    const y = constantCoordinateValue(parts[1])
    if (x === null || y === null) return null
    if (points.length < MAX_POINTS_PER_ITEM) points.push([x, y])
    else truncated = true

    cursor = end + 1
    while (/\s/.test(raw[cursor] || '')) cursor += 1
    if (cursor >= raw.length) break
    if (raw[cursor] === ',') {
      cursor += 1
      while (/\s/.test(raw[cursor] || '')) cursor += 1
      if (cursor >= raw.length) break // 尾随逗号容忍
    } else if (raw[cursor] !== '(') {
      return null
    }
  }

  return points.length > 0 ? { points, truncated } : null
}

/**
 * 颜色只接受安全形式：单词颜色名（如 red）、# 十六进制、rgb()/rgba()/hsl()/hsla()。
 * 拒绝 url() 等一切带函数或符号的写法——颜色会进 Canvas 与图例的 style，不能成为注入面。
 */
function validColor(input: string | undefined): string | null {
  if (!input) return null
  const s = input.trim()
  if (!s || s.length > 48) return null
  if (/^[a-zA-Z]+$/.test(s)) return s
  if (/^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(s)) return s
  if (/^rgba?\(\s*[\d.]+%?\s*,\s*[\d.]+%?\s*,\s*[\d.]+%?\s*(?:,\s*[\d.]+\s*)?\)$/i.test(s)) return s
  if (/^hsla?\(\s*-?[\d.]+\s*,\s*[\d.]+%\s*,\s*[\d.]+%\s*(?:,\s*[\d.]+\s*)?\)$/i.test(s)) return s
  return null
}

/* -------------------------------------------------------------------------- */
/*                          表达式求值（先编译后采样）                          */
/* -------------------------------------------------------------------------- */

type CompiledFn = (x: number) => number | null

const finite = (v: number): number | null => (Number.isFinite(v) ? v : null)

const MATH_FUNCTIONS: Record<string, (v: number) => number | null> = {
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  asin: Math.asin,
  arcsin: Math.asin,
  acos: Math.acos,
  arccos: Math.acos,
  atan: Math.atan,
  arctan: Math.atan,
  sinh: Math.sinh,
  cosh: Math.cosh,
  tanh: Math.tanh,
  sqrt: (v) => (v < 0 ? null : Math.sqrt(v)),
  cbrt: Math.cbrt,
  abs: Math.abs,
  exp: Math.exp,
  log: (v) => (v <= 0 ? null : Math.log(v)),
  ln: (v) => (v <= 0 ? null : Math.log(v)),
  log2: (v) => (v <= 0 ? null : Math.log2(v)),
  log10: (v) => (v <= 0 ? null : Math.log10(v)),
  floor: Math.floor,
  ceil: Math.ceil,
  round: Math.round,
  sign: Math.sign,
}

/**
 * 把 y=f(x) 表达式编译成可反复调用的函数；语法不合法返回 null。
 *
 * 支持 `+ - * / % ^`（^ 右结合）、括号、变量 `x`、常量 `pi`/`tau`/`e`、隐式乘法
 * （`2x`、`3(x+1)`、`(x-1)(x+1)`）与 sin/cos/tan/sqrt/abs/exp/log/ln 等函数
 * （另含双参 min/max）。表达式最长 512 字符、嵌套最深 64 层，超出直接判无效。
 * 定义域外（除零、负数开方等）返回 null，绘图时在该处断线。逐像素采样时只
 * 解析一次，避免旧实现「每列像素重解析一遍字符串」拖慢拖动。
 */
export function compileCcsExpression(expr: string): CompiledFn | null {
  // 容忍从公式编辑器 / 文档里粘来的全角与排版符号。
  const source = expr
    .trim()
    .replace(/[−–—]/g, '-')
    .replace(/[×·]/g, '*')
    .replace(/÷/g, '/')
    .replace(/π/g, 'pi')
  if (!source || source.length > 512) return null
  let cursor = 0
  let depth = 0
  const MAX_DEPTH = 64

  const skip = () => {
    while (/\s/.test(source[cursor] || '')) cursor += 1
  }
  const combine = (a: CompiledFn, b: CompiledFn, op: '+' | '-' | '*' | '/' | '%' | '^'): CompiledFn => (x) => {
    const av = a(x)
    if (av === null) return null
    const bv = b(x)
    if (bv === null) return null
    if (op === '+') return finite(av + bv)
    if (op === '-') return finite(av - bv)
    if (op === '*') return finite(av * bv)
    if (op === '/') return bv === 0 ? null : finite(av / bv)
    if (op === '%') return bv === 0 ? null : finite(av % bv)
    return finite(av ** bv)
  }

  const parseExpression = (): CompiledFn | null => {
    let left = parseTerm()
    if (left === null) return null
    for (;;) {
      skip()
      const op = source[cursor]
      if (op !== '+' && op !== '-') break
      cursor += 1
      const right = parseTerm()
      if (right === null) return null
      left = combine(left, right, op)
    }
    return left
  }

  const parseTerm = (): CompiledFn | null => {
    let left = parseUnary()
    if (left === null) return null
    for (;;) {
      skip()
      const op = source[cursor]
      if (op === '*' || op === '/' || op === '%') {
        cursor += 1
        const right = parseUnary()
        if (right === null) return null
        left = combine(left, right, op)
        continue
      }
      // 隐式乘法：2x、3(x+1)、(x-1)(x+1)、x sin(x) 等
      if (op !== undefined && /[A-Za-z_(]/.test(op)) {
        const right = parseUnary()
        if (right === null) return null
        left = combine(left, right, '*')
        continue
      }
      break
    }
    return left
  }

  const parseUnary = (): CompiledFn | null => {
    skip()
    if (source[cursor] === '+') {
      cursor += 1
      if (depth >= MAX_DEPTH) return null
      depth += 1
      const inner = parseUnary()
      depth -= 1
      return inner
    }
    if (source[cursor] === '-') {
      cursor += 1
      if (depth >= MAX_DEPTH) return null
      depth += 1
      const inner = parseUnary()
      depth -= 1
      if (inner === null) return null
      return (x) => {
        const v = inner(x)
        return v === null ? null : -v
      }
    }
    return parsePower()
  }

  const parsePower = (): CompiledFn | null => {
    const base = parsePrimary()
    if (base === null) return null
    skip()
    if (source[cursor] === '^') {
      cursor += 1
      // 指数走 parseUnary：右结合（2^3^2=512），且容忍负指数 x^-1
      const exponent = parseUnary()
      if (exponent === null) return null
      return combine(base, exponent, '^')
    }
    return base
  }

  const parsePrimary = (): CompiledFn | null => {
    skip()
    if (source[cursor] === '(') {
      if (depth >= MAX_DEPTH) return null
      cursor += 1
      depth += 1
      const inner = parseExpression()
      depth -= 1
      skip()
      if (inner === null || source[cursor] !== ')') return null
      cursor += 1
      return inner
    }
    const rest = source.slice(cursor)
    const numMatch = rest.match(/^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/)
    if (numMatch) {
      cursor += numMatch[0].length
      const n = Number(numMatch[0])
      if (!Number.isFinite(n)) return null
      return () => n
    }
    const idMatch = rest.match(/^[a-zA-Z_][a-zA-Z0-9_]*/)
    if (!idMatch) return null
    const id = idMatch[0].toLowerCase()
    cursor += idMatch[0].length
    skip()
    if (source[cursor] === '(') {
      if (depth >= MAX_DEPTH) return null
      cursor += 1
      depth += 1
      const first = parseExpression()
      if (first === null) {
        depth -= 1
        return null
      }
      skip()
      // min / max 是唯二的双参函数：分段函数里很常用，如 max(0, x)。
      if (id === 'min' || id === 'max') {
        if (source[cursor] !== ',') {
          depth -= 1
          return null
        }
        cursor += 1
        const second = parseExpression()
        depth -= 1
        skip()
        if (second === null || source[cursor] !== ')') return null
        cursor += 1
        const pick = id === 'min' ? Math.min : Math.max
        return (x) => {
          const a = first(x)
          const b = second(x)
          return a === null || b === null ? null : finite(pick(a, b))
        }
      }
      depth -= 1
      const fn = MATH_FUNCTIONS[id]
      if (!fn || source[cursor] !== ')') return null
      cursor += 1
      return (x) => {
        const v = first(x)
        if (v === null) return null
        const r = fn(v)
        return r === null ? null : finite(r)
      }
    }
    if (id === 'x') return (x) => x
    if (id === 'pi') return () => Math.PI
    if (id === 'tau') return () => Math.PI * 2
    if (id === 'e') return () => Math.E
    return null
  }

  const compiled = parseExpression()
  skip()
  if (compiled === null || cursor !== source.length) return null
  return (x) => {
    const v = compiled(x)
    return v === null ? null : finite(v)
  }
}

/** 在给定 x 处求表达式的值（单次求值用；连续采样请先 compileCcsExpression）。 */
export function evaluateCcsExpression(expr: string, xVal: number): number | null {
  const fn = compileCcsExpression(expr)
  return fn ? fn(xVal) : null
}

/* -------------------------------------------------------------------------- */
/*                                块内容解析                                  */
/* -------------------------------------------------------------------------- */

export function parseCcsContent(raw: string): CcsParseResult {
  const items: CcsItem[] = []
  const errors: string[] = []
  let autoColorIdx = 0

  // 整行注释（# 或 // 开头）直接丢弃；语句之间用分号分隔，缺尾分号也能识别最后一条。
  const withoutComments = raw
    .split('\n')
    .filter((line) => {
      const t = line.trim()
      return !(t.startsWith('#') || t.startsWith('//'))
    })
    .join('\n')
  const statements = withoutComments
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)

  for (let statementIndex = 0; statementIndex < statements.length; statementIndex += 1) {
    const stmt = statements[statementIndex]
    if (statementIndex >= MAX_STATEMENTS) {
      errors.push(`语句过多，仅解析前 ${MAX_STATEMENTS} 条`)
      break
    }
    if (items.length >= MAX_ITEMS) {
      errors.push(`元素过多，仅绘制前 ${MAX_ITEMS} 个`)
      break
    }
    const m = stmt.match(/^(\w+)\s*:\s*([\s\S]*)$/)
    if (!m) {
      errors.push(`无效语句「${stmt}」：缺少冒号分隔`)
      continue
    }
    const cmd = m[1].toLowerCase()
    let args = m[2].trim()
    if (!args) {
      errors.push(`指令 ${cmd} 参数为空`)
      continue
    }

    // 末尾可选颜色：…,[color=red] 或 …[color=#2563eb]
    let colorRaw: string | undefined
    const colorMatch = args.match(/\[\s*color\s*=\s*([^\]]+)\s*\]\s*$/i)
    if (colorMatch) {
      colorRaw = colorMatch[1].trim()
      args = args.slice(0, colorMatch.index).trim()
      if (args.endsWith(',')) args = args.slice(0, -1).trim()
    }
    // 只在语句确实绘制时才消耗一个自动配色，避免错误语句打乱后续颜色。
    const pickColor = () => validColor(colorRaw) ?? PALETTE[autoColorIdx++ % PALETTE.length]

    if (cmd === 'create_point') {
      const parsedPoints = parseCoordinateList(args)
      if (!parsedPoints || parsedPoints.points.length !== 1) {
        errors.push(`create_point 需要一个坐标点 (x,y)（分量可写 sqrt(2)、pi/2 等常数表达式），得到「${args}」`)
        continue
      }
      const [[x, y]] = parsedPoints.points
      items.push({ kind: 'point', x, y, color: pickColor() })
    } else if (cmd === 'create_line') {
      const parsedPoints = parseCoordinateList(args)
      if (parsedPoints) {
        if (parsedPoints.truncated) {
          errors.push(`create_line 顶点过多，仅绘制前 ${MAX_POINTS_PER_ITEM} 个`)
        }
        items.push({ kind: 'polyline', points: parsedPoints.points, color: pickColor() })
        continue
      }
      // 形如 (x_1,y_1),(x_2,y_2) 的占位写法的意图是折线，只是坐标无法求值：
      // 给出针对性的提示，不要落进下面的函数解析里报一个看不懂的错。
      if (/\)\s*,\s*\(/.test(args)) {
        errors.push(`create_line 的折线坐标必须是数字或常数表达式（如 sqrt(2)），得到「${args}」`)
        continue
      }
      // 否则按函数表达式处理；容忍 y=… / f(x)=… 前缀与整体再包一层括号的写法。
      let expr = args.trim().replace(/^(?:y|f\s*\(\s*x\s*\))\s*=\s*/i, '')
      if (expr.startsWith('(') && expr.endsWith(')')) {
        let depth = 0
        let outer = true
        for (let i = 0; i < expr.length; i += 1) {
          if (expr[i] === '(') depth += 1
          else if (expr[i] === ')') depth -= 1
          if (depth === 0 && i < expr.length - 1) {
            outer = false
            break
          }
        }
        if (outer) expr = expr.slice(1, -1).trim()
      }
      if (!expr) {
        errors.push('create_line 函数表达式为空')
        continue
      }
      if (compileCcsExpression(expr) === null) {
        errors.push(`无法解析函数表达式「${expr}」：仅支持 + - * / % ^、括号、变量 x 与 sin/cos/sqrt/min/max 等函数`)
        continue
      }
      items.push({ kind: 'function', expr, color: pickColor() })
    } else {
      errors.push(`未知指令「${cmd}」：仅支持 create_point / create_line`)
    }
  }

  return { items, errors }
}

/**
 * 从 Markdown 中整体移除已闭合的 ui-ccs 块（摘要、字数统计用）。
 * 未闭合的块只是普通文字，与渲染规则一致予以保留。
 */
export function stripCcsBlocks(markdown: string): string {
  if (!markdown.includes('::begin_ui')) return markdown
  const lines = markdown.split('\n')
  const output: string[] = []
  for (let i = 0; i < lines.length; i += 1) {
    if (isCcsBeginLine(lines[i])) {
      let end = i + 1
      while (end < lines.length && !isCcsEndLine(lines[end])) end += 1
      if (end < lines.length) {
        i = end
        continue
      }
    }
    output.push(lines[i])
  }
  return output.join('\n')
}

/**
 * 把一块 ui-ccs 内容降级成静态 Markdown 行（复制为洛谷 / 基本源码、MPE 专用）：
 * 那两处没有画布，只把点、折线与函数式如实列出来，不丢信息。
 */
export function describeCcsContent(raw: string): string[] {
  const { items, errors } = parseCcsContent(raw)
  const lines: string[] = ['**平面直角坐标系**', '']
  const formatValue = (value: number) => (Number.isInteger(value) ? String(value) : String(Number(value.toPrecision(10))))
  const formatPoint = ([x, y]: [number, number]) => `(${formatValue(x)}, ${formatValue(y)})`
  if (items.length === 0) lines.push('- （无可绘制内容）')
  for (const item of items) {
    if (item.kind === 'point') {
      lines.push(`- 点：${formatPoint([item.x, item.y])}，颜色 ${item.color}`)
    } else if (item.kind === 'polyline') {
      // 静态源码里把上千个顶点全展开只会淹没正文：长折线写首尾摘要并注明总数。
      const shown =
        item.points.length <= 12
          ? item.points.map(formatPoint).join(' → ')
          : `${item.points.slice(0, 6).map(formatPoint).join(' → ')} → … → ${item.points.slice(-3).map(formatPoint).join(' → ')}（共 ${item.points.length} 点）`
      lines.push(`- 折线：${shown}，颜色 ${item.color}`)
    } else {
      lines.push(`- 函数：\`y = ${item.expr.replace(/`/g, "'")}\`，颜色 ${item.color}`)
    }
  }
  for (const error of errors) lines.push(`- 解析提示：${error}`)
  return lines
}
