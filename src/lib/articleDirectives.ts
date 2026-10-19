import type { CSSProperties } from 'react'
import { MONO_FALLBACK, SANS_FALLBACK, SERIF_FALLBACK, buildFontStack } from './fontStacks'
import type { SceneId } from './animatedBackground'

/**
 * 文章级排版指令（issue #59）：只能写在文章开头（frontmatter 之后、正文开始之前），
 * 强制本文的正文字体、代码字体与阅读时的动态背景：
 *
 * ```markdown
 * ::set-font[LXGW WenKai]
 * ::set-code-font[Fira Code]
 * ::set-background[1]
 * ```
 *
 * 规则：
 * - 只有「文件头」连续出现的指令有效：从正文第一行开始、允许夹空行，
 *   遇到第一行真正的正文（或代码围栏等其他内容）后，后面同形文字只是普通文本。
 *   这样教程里可以用代码围栏展示语法，展示框 / 折叠框内部也不会误触发。
 * - `::set-font` / `::set-code-font` 可以出现多次：越早出现的优先级越高，
 *   后面的作为回退（与设置页的字体优先级列表一致）；同一条指令里也可以用
 *   逗号分隔多个字体名。列表最后仍会接站点默认字体栈兜底。
 * - `::set-background[<id>]` 的 id 范围 0–5（见 `ARTICLE_BACKGROUND_SCENES`），
 *   多个时第一个**合法**的生效；非法 id 忽略。
 * - 指令行本身不是正文：渲染、摘要、字数统计与「洛谷 / 基本」源码复制都会移除它
 *   （「直接复制源码」原样保留）。
 *
 * 作用范围：字体作用于本文的渲染区域（文章页含标题区、编辑器预览、版本对比、
 * VS Code 插件预览），背景只在博客文章页与站内编辑器里强制动态背景场景，
 * 离开文章后恢复读者自己的偏好，不会改动任何已保存的设置。
 *
 * 本模块只做纯解析与样式拼接（零运行时依赖），博客与 VS Code 插件共用。
 */

/**
 * `::set-background[<id>]` 的 id 与动态背景场景的对应（下标即 id）。
 * 顺序与 `animatedBackground.ts` 的 `SCENES` 一致，0 表示强制关无动态背景。
 * 新增场景时只能往后追加，不能改动已有下标，否则旧文章的 id 会指错场景。
 */
export const ARTICLE_BACKGROUND_SCENES: readonly SceneId[] = [
  'none',
  'sakura',
  'network',
  'snow',
  'rain',
  'bamboo',
]

/** 场景 id 的可读名称（设置页提示与帮助文档用），下标与 ARTICLE_BACKGROUND_SCENES 一致。 */
export const ARTICLE_BACKGROUND_NAMES: readonly string[] = [
  '无',
  '樱花',
  '粒子星链',
  '雪花',
  '暴雨',
  '竹林',
]

export interface ArticleDirectives {
  /** `::set-font` 指定的正文字体，按优先级从高到低；空数组表示未指定。 */
  fonts: string[]
  /** `::set-code-font` 指定的代码字体，按优先级从高到低；空数组表示未指定。 */
  codeFonts: string[]
  /** `::set-background[<id>]` 的原始编号；null 表示未指定（0 是合法值，不要与 null 混淆）。 */
  backgroundId: number | null
  /** 编号对应的动态背景场景；null 表示未指定。 */
  background: SceneId | null
}

export const EMPTY_ARTICLE_DIRECTIVES: ArticleDirectives = {
  fonts: [],
  codeFonts: [],
  backgroundId: null,
  background: null,
}

export function hasArticleDirectives(directives: ArticleDirectives): boolean {
  return (
    directives.fonts.length > 0 ||
    directives.codeFonts.length > 0 ||
    directives.backgroundId !== null
  )
}

/** id → 场景；非 0–5 的整数（或非整数）一律返回 null。 */
export function sceneForBackgroundId(id: unknown): SceneId | null {
  if (typeof id !== 'number' || !Number.isInteger(id)) return null
  return ARTICLE_BACKGROUND_SCENES[id] ?? null
}

/** 场景 → id（写文档 / 提示文字时用）。 */
export function backgroundIdForScene(scene: SceneId): number {
  return ARTICLE_BACKGROUND_SCENES.indexOf(scene)
}

export type ArticleDirectiveKind = 'set-font' | 'set-code-font' | 'set-background'

export interface ArticleDirectiveLine {
  kind: ArticleDirectiveKind
  /** 方括号内的原文（未 trim）。 */
  value: string
}

const DIRECTIVE_LINE_RE = /^\s*::(set-font|set-code-font|set-background)\[([^\]\r\n]*)\]\s*$/i

/** 判断一整行是否为文章排版指令（不判断它是否位于文首）。 */
export function parseArticleDirectiveLine(line: string): ArticleDirectiveLine | null {
  const match = line.match(DIRECTIVE_LINE_RE)
  if (!match) return null
  return { kind: match[1].toLowerCase() as ArticleDirectiveKind, value: match[2] }
}

/**
 * 校验单个字体名，规则与 `font.tsx` 的 `normalizeFamily` 对齐
 * （长度上限、拒绝可逃逸 CSS 的字符），但这里不合规直接丢弃而不是抛错：
 * 文章内容来自文件，一条写坏的指令不应让整篇文章打不开。
 */
function normalizeDirectiveFontName(raw: string): string | null {
  let name = raw.trim().replace(/\s+/g, ' ')
  // 容忍作者给字体名加上引号：::set-font["Noto Serif SC"]
  if (name.length >= 2) {
    const first = name[0]
    if ((first === '"' || first === "'") && name.endsWith(first)) {
      name = name.slice(1, -1).trim().replace(/\s+/g, ' ')
    }
  }
  if (!name || name.length > 120 || /[[\]{};<>]/.test(name)) return null
  return name
}

/** 一条字体指令里可用逗号 / 分号分隔多个字体名（字体名本身不含这些符号）。 */
export function parseDirectiveFontList(value: string): string[] {
  const names: string[] = []
  for (const part of value.split(/[,，、;；]/)) {
    const name = normalizeDirectiveFontName(part)
    if (name && !names.includes(name)) names.push(name)
  }
  return names
}

/** `::set-background[…]` 的值只接受 0–5 的整数写法，其余（空、负数、文字）忽略。 */
export function parseDirectiveBackgroundId(value: string): number | null {
  const text = value.trim()
  if (!/^\d+$/.test(text)) return null
  const id = Number(text)
  return sceneForBackgroundId(id) === null ? null : id
}

export interface ScannedArticleDirectives {
  directives: ArticleDirectives
  /** 被识别为「文首指令」的行下标（0 基，针对传入的 lines），渲染时应整体移除。 */
  directiveLines: ReadonlySet<number>
}

/**
 * 扫描文首指令区：从第一行起、允许夹空行，直到第一行非空且非指令的内容为止。
 * 代码围栏的第一行（```）属于正文，会自然结束扫描，因此围栏里的语法示例不会被执行。
 */
export function scanArticleDirectives(lines: readonly string[]): ScannedArticleDirectives {
  const fonts: string[] = []
  const codeFonts: string[] = []
  const directiveLines = new Set<number>()
  let backgroundId: number | null = null

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    if (line.trim() === '') continue
    const directive = parseArticleDirectiveLine(line)
    if (!directive) break
    directiveLines.add(i)
    if (directive.kind === 'set-font') {
      for (const name of parseDirectiveFontList(directive.value)) {
        if (!fonts.includes(name)) fonts.push(name)
      }
    } else if (directive.kind === 'set-code-font') {
      for (const name of parseDirectiveFontList(directive.value)) {
        if (!codeFonts.includes(name)) codeFonts.push(name)
      }
    } else if (backgroundId === null) {
      backgroundId = parseDirectiveBackgroundId(directive.value)
    }
  }

  return {
    directives: {
      fonts,
      codeFonts,
      backgroundId,
      background: backgroundId === null ? null : sceneForBackgroundId(backgroundId),
    },
    directiveLines,
  }
}

/**
 * 解析文章正文（已去掉 frontmatter 的 content）的文首排版指令。
 * 对没有指令的普通文章只是扫到第一行正文就返回，开销可忽略。
 */
export function parseArticleDirectives(content: string): ArticleDirectives {
  if (!content) return EMPTY_ARTICLE_DIRECTIVES
  return scanArticleDirectives(content.split('\n')).directives
}

/**
 * 文首若存在 YAML frontmatter，返回正文起始行下标；否则返回 0。
 * 与 `frontmatter.ts` 的 FM_RE 语义对齐的轻量行级判断（避免为删几行引入 YAML 解析）：
 * 首行 `---`（可带 BOM），之后第一行单独的 `---` 为结束。
 */
function frontmatterEndLine(lines: readonly string[]): number {
  if (lines.length === 0) return 0
  if (lines[0].replace(/^\uFEFF/, '').trim() !== '---') return 0
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i].trim() === '---') return i + 1
  }
  return 0
}

/**
 * 移除整篇（含可选 frontmatter 的）Markdown 文首的排版指令行。
 * 用于「洛谷 / 基本」源码复制、MPE 静态兼容与摘要等不该出现指令原文的场合。
 */
export function stripArticleDirectives(markdown: string): string {
  if (!markdown) return markdown
  const lines = markdown.split('\n')
  const offset = frontmatterEndLine(lines)
  const { directiveLines } = scanArticleDirectives(lines.slice(offset))
  if (directiveLines.size === 0) return markdown
  return lines.filter((_, index) => !directiveLines.has(index - offset)).join('\n')
}

/**
 * 把字体指令转成可挂在渲染容器上的行内样式（scoped CSS 变量 + fontFamily）。
 *
 * 原理：正文的字体来自继承，所以要真的换字体必须在容器上写 `font-family`；
 * 元素自己引用 `--font-serif` / `--font-mono` 的地方（标题、代码、kbd……）
 * 则靠在容器上覆盖这几个变量实现局部生效。读者自己的全站字体偏好
 * 写在 `<html>` 上，不受影响，离开文章即恢复。
 * 没有任何字体指令时返回 undefined，避免普通文章多出 style 属性。
 */
export function articleFontStyle(directives: ArticleDirectives): CSSProperties | undefined {
  const style: Record<string, string> = {}
  const sans = buildFontStack(directives.fonts, SANS_FALLBACK)
  if (sans) {
    style['--font-sans'] = sans
    style['--font-serif'] = buildFontStack(directives.fonts, SERIF_FALLBACK)!
    style.fontFamily = sans
  }
  const mono = buildFontStack(directives.codeFonts, MONO_FALLBACK)
  if (mono) style['--font-mono'] = mono
  return Object.keys(style).length > 0 ? (style as CSSProperties) : undefined
}
