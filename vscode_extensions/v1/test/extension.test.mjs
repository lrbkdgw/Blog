/**
 * 轻量回归测试：`npm test`
 *
 * 1. markdown-it 插件（内置预览路线）能正确渲染展示框、折叠框与合并单元格；
 * 2. 生成的 MPE parser.js 是「单表达式」且在沙箱式求值下可用；
 * 3. 源码降级转换与 Blog 的行为一致。
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const root = join(dirname(fileURLToPath(import.meta.url)), '..')

const MarkdownIt = require('markdown-it')


// extension.js 依赖 vscode 模块，测试里直接用源码构建的纯函数副本：
const core = await buildCore()

async function buildCore() {
  const esbuild = await import('esbuild')
  const result = await esbuild.build({
    entryPoints: [join(root, 'src', 'testApi.ts')],
    bundle: true,
    write: false,
    format: 'cjs',
    platform: 'node',
    target: ['es2020'],
    logLevel: 'silent',
  })
  const module = { exports: {} }
  // eslint-disable-next-line no-new-func
  new Function('module', 'exports', 'require', result.outputFiles[0].text)(module, module.exports, require)
  return module.exports
}

function render(source) {
  const md = new MarkdownIt({ html: true })
  core.extendMarkdownIt(md)
  return md.render(source)
}

test('展示框按默认值渲染，并带上可交互控件', () => {
  const html = render(
    [
      '::show_begin{二次函数}{a:Z=2[-5,5,1]; b:Q=0.5[-10,10,0.5]{faster_set}}',
      '当 *&show(a)*& 时，结果是 *&hs(a^2+b)*&，向下两位 &*floor(a^2+b,2)&*。',
      '::show_end',
    ].join('\n'),
  )
  assert.match(html, /starlog-showbox/)
  assert.match(html, /data-sl-kind="show"[^>]*>2</)
  assert.match(html, /data-sl-kind="hs"[^>]*>4\.5</)
  assert.match(html, /data-sl-kind="floor"[^>]*>4\.50</)
  assert.match(html, /type="range"/)
  // 有理数带 {faster_set} 才有滑动条
  assert.equal((html.match(/type="range"/g) || []).length, 2)
})

test('展示框正文仍按 Markdown 解析，公式与代码块里只做静态替换', () => {
  const html = render(
    ['::show_begin{t}{n:Z=3[1,9,1]}', '', '- 列表 *&show(n)*&', '', '`code *&show(n)*&`', '', '$x_{*&show(n)*&}$', '::show_end'].join('\n'),
  )
  assert.match(html, /<ul>/)
  assert.match(html, /<code>code 3<\/code>/)
  assert.match(html, /\$x_\{3\}\$/)
})

test('折叠框转成 details/summary，内部仍是 Markdown', () => {
  const html = render([':::warning[小心]{open}', '', '**粗体**', '', ':::'].join('\n'))
  assert.match(html, /<details class="starlog-callout starlog-callout-warning" data-callout="warning" open>/)
  assert.match(html, /starlog-callout-title">小心</)
  assert.match(html, /<strong>粗体<\/strong>/)
})

test('折叠框省略标题时使用默认标题', () => {
  const html = render([':::success', '内容', ':::'].join('\n'))
  assert.match(html, /starlog-callout-title">成功</)
})

test('表格的 ^ / < 变成 rowspan / colspan', () => {
  const html = render(
    ['| A | B |', '| :-: | :-: |', '| 甲 | 乙 |', '| ^ | < |'].join('\n'),
  )
  assert.match(html, /rowspan="2"/)
  assert.doesNotMatch(html, />\^</)
  assert.doesNotMatch(html, />&lt;</)
})

test('::cute-table{tuack} 包裹后续表格', () => {
  const html = render(['::cute-table{tuack}', '', '| A |', '| :-: |', '| 1 |'].join('\n'))
  assert.match(html, /starlog-table-wrapper starlog-table-tuack/)
  assert.match(html, /<table>/)
})

test('代码块里的语法原样保留', () => {
  const html = render(['```markdown', '::show_begin{x}{a:Z=1[0,2,1]}', '::show_end', '```'].join('\n'))
  assert.match(html, /::show_begin/)
  assert.doesNotMatch(html, /starlog-showbox/)
})

test('MPE parser.js 是单表达式且可在沙箱里求值', async () => {
  const code = readFileSync(join(root, 'resources', 'mpe', 'parser.js'), 'utf8')
  assert.doesNotMatch(code, /\brequire\(/)
  assert.match(code, /starlog-markdown:parser/)
  // crossnote 的做法：把整个文件包进圆括号后求值
  const wrapped = '(' + code.trim().replace(/[;,]+$/, '') + ')'
  // eslint-disable-next-line no-new-func
  const api = new Function('return ' + wrapped)()
  assert.equal(typeof api.onWillParseMarkdown, 'function')

  const output = await api.onWillParseMarkdown(
    ['::show_begin{t}{a:Z=2[0,5,1]}', '值 *&show(a)*&', '::show_end', '', '| A | B |', '| - | - |', '| 甲 | < |'].join('\n'),
  )
  assert.match(output, /starlog-showbox/)
  assert.match(output, /值 2/)
  // 静态模式不输出交互控件，但要给出变量清单
  assert.doesNotMatch(output, /type="range"/)
  assert.match(output, /starlog-showbox-vars/)
  // `<` 要换成空单元格，交给 MPE 的扩展表格语法做 colspan
  assert.match(output, /\| 甲 \|\s+\|/)
})

test('源码降级：洛谷 / 基本 Markdown', () => {
  const source = [
    '::show_begin{标题}{a:Z=2[0,5,1]}',
    '值 *&show(a)*&',
    '::show_end',
    '',
    ':::info[提示]',
    '内容',
    ':::',
    '',
    '| A | B |',
    '| - | - |',
    '| 甲 | < |',
  ].join('\n')

  const luogu = core.convertMarkdownForCopy(source, 'luogu')
  assert.match(luogu, /\*\*标题\*\*/)
  assert.match(luogu, /值 2/)
  assert.match(luogu, /:::info\[提示\]/)

  const basic = core.convertMarkdownForCopy(source, 'basic')
  assert.match(basic, /> \*\*提示\*\*/)
  assert.doesNotMatch(basic, /:::/)
  assert.match(basic, /\| 甲 \| 甲 \|/)
})

test('求值器与 Blog 行为一致的若干边界', () => {
  const { evaluateShowFormula, formatDirectionalRound } = core
  assert.equal(evaluateShowFormula('2^3^2', { }), 512)
  assert.equal(evaluateShowFormula('1/0', {}), null)
  assert.equal(evaluateShowFormula('a+1', { a: 2 }), 3)
  assert.equal(evaluateShowFormula('a+', { a: 2 }), null)
  assert.equal(formatDirectionalRound(1.239, 2, 'floor'), '1.23')
  assert.equal(formatDirectionalRound(1.231, 2, 'ceil'), '1.24')
  assert.equal(formatDirectionalRound(0.1 + 0.2, 1, 'ceil'), '0.3')
})
