/**
 * Markdown Preview Enhanced 的扩展解析器入口。
 *
 * 构建后会被包成一个「单表达式」的 `parser.js`：MPE（crossnote ≥ 0.9.30）会把整个
 * 文件内容包进圆括号后交给 QuickJS WebAssembly 沙箱求值，所以文件里不能出现
 * require / module 顶层声明，也不能有多条顶层语句。见 build.mjs。
 */

import { transformMarkdown } from '../core/transform'

const parser = {
  /** MPE 解析前的钩子：把 Blog 特殊语法展开成 Markdown + HTML。 */
  onWillParseMarkdown: async function (markdown: string): Promise<string> {
    try {
      return transformMarkdown(markdown, { interactive: false })
    } catch (error) {
      return markdown
    }
  },

  /** 解析后的钩子：目前不需要改动 HTML，保留以便将来扩展。 */
  onDidParseMarkdown: async function (html: string): Promise<string> {
    return html
  },
}

export default parser
