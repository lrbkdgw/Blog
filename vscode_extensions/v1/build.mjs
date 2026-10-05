/**
 * 构建脚本：
 *   out/extension.js      扩展主进程（CommonJS，供 VS Code 加载）
 *   out/preview.js        内置 Markdown 预览的交互脚本（IIFE）
 *   resources/mpe/parser.js   Markdown Preview Enhanced 的扩展解析器（单表达式）
 *   resources/mpe/style.less  Markdown Preview Enhanced 的预览样式
 */

import { build, context } from 'esbuild'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url))
const watch = process.argv.includes('--watch')
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version

const common = {
  bundle: true,
  minify: false,
  sourcemap: false,
  target: ['es2020'],
  logLevel: 'info',
  absWorkingDir: root,
}

const targets = [
  {
    ...common,
    entryPoints: ['src/extension.ts'],
    outfile: 'out/extension.js',
    platform: 'node',
    format: 'cjs',
    external: ['vscode'],
  },
  {
    ...common,
    entryPoints: ['src/preview/preview.ts'],
    outfile: 'out/preview.js',
    platform: 'browser',
    format: 'iife',
  },
]

/**
 * crossnote 会把整个 parser.js 包进一对圆括号后在 QuickJS 沙箱里求值
 * （`(${code.trim().replace(/[;,]+$/, '')})`），所以产物必须是**单个表达式**，
 * 并且不能依赖 require / module / Node API。这里用一个 IIFE 包住 CJS 产物。
 */
async function buildMpeParser() {
  const result = await build({
    ...common,
    entryPoints: ['src/mpe/parserEntry.ts'],
    write: false,
    platform: 'neutral',
    format: 'cjs',
    logLevel: 'warning',
  })
  const code = result.outputFiles[0].text
  const wrapped = `/* starlog-markdown:parser v${version} — 由 VS Code 扩展「星野笔记特殊语法」自动生成，请勿手工修改。
 * 作用：让 Markdown Preview Enhanced 识别 ::show_begin / :::info / ::cute-table 等语法。
 * 移除方式：命令面板 → 「星野笔记: 移除 Markdown Preview Enhanced 支持」。
 */
(function () {
  var module = { exports: {} };
  var exports = module.exports;
${code
  .split('\n')
  .map((line) => (line ? '  ' + line : line))
  .join('\n')}
  var api = module.exports && module.exports.default ? module.exports.default : module.exports;
  return {
    onWillParseMarkdown: function (markdown) {
      return api.onWillParseMarkdown(markdown);
    },
    onDidParseMarkdown: function (html) {
      return api.onDidParseMarkdown(html);
    }
  };
})()
`
  mkdirSync(join(root, 'resources', 'mpe'), { recursive: true })
  writeFileSync(join(root, 'resources', 'mpe', 'parser.js'), wrapped, 'utf8')
}

/** MPE 的样式作用域是 .markdown-preview，用 Less 嵌套包一层即可复用同一份 CSS。 */
function buildMpeStyle() {
  const css = readFileSync(join(root, 'media', 'preview.css'), 'utf8')
  const body = css
    .split('\n')
    .map((line) => (line ? '  ' + line : line))
    .join('\n')
  const less = `// starlog-markdown:style v${version}
// 由 VS Code 扩展「星野笔记特殊语法」生成，可被命令一键更新 / 移除。
.markdown-preview.markdown-preview {
${body}
}
`
  mkdirSync(join(root, 'resources', 'mpe'), { recursive: true })
  writeFileSync(join(root, 'resources', 'mpe', 'style.less'), less, 'utf8')
}

if (watch) {
  for (const options of targets) {
    const ctx = await context(options)
    await ctx.watch()
  }
  await buildMpeParser()
  buildMpeStyle()
  console.log('[starlog] watching…')
} else {
  for (const options of targets) await build(options)
  await buildMpeParser()
  buildMpeStyle()
  console.log('[starlog] build done')
}
