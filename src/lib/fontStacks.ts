/**
 * 默认字体栈与字体栈拼接（纯字符串逻辑，不依赖 DOM / localStorage）。
 *
 * 博客的字体偏好（lib/font.tsx）与文章级排版指令（lib/articleDirectives.ts，
 * issue #59）都要拼 CSS `font-family` 栈，规则必须只有一份，因此抽到这里共用。
 * 本模块保持零运行时依赖，VS Code 插件（Node 主进程 + 预览脚本）也可直接打包。
 *
 * 这三条常量与 `src/styles/index.css` 的 `:root`、`index.html` 的首屏内联脚本
 * 必须保持一致：CSS 里的版本决定「没有自定义字体时」用什么，这里的版本决定
 * 「自定义字体缺字形时」往哪儿回退，index.html 里的版本负责 React 挂载前的首屏。
 */
export const SANS_FALLBACK =
  '"Google Sans", "Noto Sans CJK SC", "Noto Sans SC", system-ui, -apple-system, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif'
export const SERIF_FALLBACK = '"Noto Serif SC", "Songti SC", STSong, SimSun, serif'
export const MONO_FALLBACK =
  '"Cascadia Code", ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Noto Sans Mono CJK SC", monospace'

/** 把字体名转成可安全写入 CSS 的带引号形式（转义内部的引号与反斜杠）。 */
export function quoteFontFamily(family: string): string {
  return `"${family.replace(/["\\]/g, '\\$&')}"`
}

/** 有自定义字体时拼出完整的字体栈；列表为空返回 null，表示沿用 CSS 里的默认栈。 */
export function buildFontStack(families: string[], fallback: string): string | null {
  if (families.length === 0) return null
  return `${families.map(quoteFontFamily).join(', ')}, ${fallback}`
}
