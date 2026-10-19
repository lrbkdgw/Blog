/**
 * 默认字体栈与字体名工具（issue #54 / #59）。
 *
 * 这里刻意放在一个没有任何 React / 浏览器依赖的轻量模块里：
 * - `font.tsx`（设置页的字体偏好）与 `Markdown.tsx`（文章级 `::set-font` 指令）
 *   都要用同一组回退栈，但 Markdown 组件也会被 VS Code 插件直接打包，
 *   不应该因此把整套字体 Provider、GitHub 同步逻辑拖进去。
 *
 * 这三条回退栈与 `src/styles/index.css` 的 `:root`、`index.html` 的首屏内联脚本
 * 必须保持一致：CSS 里的版本决定「用户没有自定义字体时」用什么，这里的版本决定
 * 「自定义 / 文章强制字体缺字形时」往哪儿回退。
 */
export const SANS_FALLBACK =
  '"Google Sans", "Noto Sans CJK SC", "Noto Sans SC", system-ui, -apple-system, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif'
export const SERIF_FALLBACK = '"Noto Serif SC", "Songti SC", STSong, SimSun, serif'
export const MONO_FALLBACK =
  '"Cascadia Code", ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Noto Sans Mono CJK SC", monospace'

/** 给 CSS 字体名加上引号并转义内部的双引号 / 反斜杠。 */
export function quoteFamily(family: string): string {
  return `"${family.replace(/["\\]/g, '\\$&')}"`
}
