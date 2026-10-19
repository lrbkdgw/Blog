import { MONO_FALLBACK, SANS_FALLBACK, SERIF_FALLBACK, quoteFamily } from './fontStacks'

/**
 * 文章级排版指令（issue #59）。
 *
 * 三种语句只能出现在文章开头（允许前面有空行），渲染前会被移除，不显示为正文：
 *
 * ```
 * ::set-font[<name>]
 * ::set-code-font[<name>]
 * ::set-background[<id>]
 * ```
 *
 * 同一篇文章里同一类语句出现多次时，**越早出现的优先级越高**；
 * 因此解析时后面的同类型语句只被移除、不覆盖已经取到的值。
 * 这些指令只在「文章开头连续的指令 / 空行段」里生效，正文中间出现的同款文本按普通文字处理，
 * 避免把代码示例里的 `::set-font[...]` 误当成指令。
 */

/** `::set-background` 的编号：0 = 无，1–5 对应 `SCENES` 的顺序。 */
export const BACKGROUND_ID_MIN = 0
export const BACKGROUND_ID_MAX = 5

export interface PostDirectives {
  /** 正文字体名（`::set-font`） */
  font?: string
  /** 代码字体名（`::set-code-font`） */
  codeFont?: string
  /** 动态背景编号（`::set-background`），0–5 */
  background?: number
}

export interface LeadingDirectivesResult {
  directives: PostDirectives
  /** 移除开头指令行后的正文 */
  body: string
  /** body 第 k 行（0 基）在原文档中的行号（0 基） */
  lineMap: number[]
}

type DirectiveField = keyof PostDirectives

interface DirectiveMatch {
  field: DirectiveField
  value: string
}

const DIRECTIVE_PATTERNS: { field: DirectiveField; pattern: RegExp }[] = [
  // 先匹配 set-code-font：虽然它不会被 set-font 的正则命中，但按语义排在一起更清楚。
  { field: 'codeFont', pattern: /^::set-code-font\[([^[\]]*)\]\s*$/i },
  { field: 'font', pattern: /^::set-font\[([^[\]]*)\]\s*$/i },
  { field: 'background', pattern: /^::set-background\[\s*([+-]?\d+)\s*\]\s*$/i },
]

function trimDirectiveLine(line: string): string {
  return line.trim().replace(/[ \t]+$/, '')
}

function matchDirective(line: string): DirectiveMatch | null {
  const text = trimDirectiveLine(line)
  for (const { field, pattern } of DIRECTIVE_PATTERNS) {
    const match = text.match(pattern)
    if (match) return { field, value: match[1] }
  }
  return null
}

/**
 * 字体名清洗：与 `font.tsx` 的 `normalizeFamily` 保持同一套限制
 * （长度、禁止会破坏 CSS / HTML 的字符），非法名称视为无效指令。
 */
export function normalizeDirectiveFont(raw: string): string | undefined {
  const family = raw.trim().replace(/\s+/g, ' ')
  if (!family || family.length > 120 || /[{};<>[\]\n\r]/.test(family)) return undefined
  return family
}

function normalizeBackgroundId(raw: string): number | undefined {
  const id = Number.parseInt(raw, 10)
  if (!Number.isFinite(id)) return undefined
  if (id < BACKGROUND_ID_MIN || id > BACKGROUND_ID_MAX) return undefined
  return id
}

function applyDirective(target: PostDirectives, match: DirectiveMatch): void {
  // 越早出现优先级越高：已经有值的字段不再覆盖。
  if (match.field === 'background') {
    if (target.background !== undefined) return
    const id = normalizeBackgroundId(match.value)
    if (id !== undefined) target.background = id
    return
  }
  if (target[match.field] !== undefined) return
  const family = normalizeDirectiveFont(match.value)
  if (family) target[match.field] = family
}

/** 取出文章开头的排版指令，并返回去掉这些行的正文与行号映射。 */
export function parseLeadingDirectives(markdown: string): LeadingDirectivesResult {
  if (!markdown) return { directives: {}, body: '', lineMap: [] }

  const lines = markdown.split('\n')
  const directives: PostDirectives = {}
  const bodyLines: string[] = []
  const lineMap: number[] = []
  let inHeader = true

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (inHeader) {
      // 指令之间允许空行；空行本身保留，保证渲染结果与源码行的对应关系不被打乱。
      if (!line.trim()) {
        bodyLines.push(line)
        lineMap.push(index)
        continue
      }
      const match = matchDirective(line)
      if (match) {
        applyDirective(directives, match)
        continue
      }
      inHeader = false
    }
    bodyLines.push(line)
    lineMap.push(index)
  }

  return { directives, body: bodyLines.join('\n'), lineMap }
}

/**
 * 只读出版排版指令（用于文章页设置背景等渲染之外的用途）。
 * 与 `parseLeadingDirectives` 不同，这里不构造去掉指令后的正文与行号映射，
 * 读到第一条正文行就停止，不会在长文章上多分配一份全文。
 */
export function parsePostDirectives(markdown: string): PostDirectives {
  const directives: PostDirectives = {}
  if (!markdown) return directives
  for (const line of markdown.split('\n')) {
    if (!line.trim()) continue
    const match = matchDirective(line)
    if (!match) break
    applyDirective(directives, match)
  }
  return directives
}

/** 移除开头指令行，其余内容原样保留（复制洛谷 / 基本源码时用）。 */
export function stripLeadingDirectives(markdown: string): string {
  return parseLeadingDirectives(markdown).body
}

export interface DirectiveFontVars {
  '--font-sans'?: string
  '--font-serif'?: string
  '--font-mono'?: string
}

/**
 * 把 `::set-font` / `::set-code-font` 转成 CSS 变量。
 *
 * Tailwind 的 `font-sans` / `font-serif` / `font-mono` 都引用这些变量，
 * 因此把返回值写到文章容器（或 Markdown 根节点）上即可让标题、正文、代码一起换字体，
 * 又不会影响页头、目录等文章之外的部分。
 */
export function directiveFontVars(directives: PostDirectives): DirectiveFontVars | undefined {
  const vars: DirectiveFontVars = {}
  if (directives.font) {
    const family = quoteFamily(directives.font)
    vars['--font-sans'] = `${family}, ${SANS_FALLBACK}`
    vars['--font-serif'] = `${family}, ${SERIF_FALLBACK}`
  }
  if (directives.codeFont) {
    vars['--font-mono'] = `${quoteFamily(directives.codeFont)}, ${MONO_FALLBACK}`
  }
  return Object.keys(vars).length > 0 ? vars : undefined
}
