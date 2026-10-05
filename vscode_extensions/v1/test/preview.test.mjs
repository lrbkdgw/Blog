/** 用 jsdom 验证内置预览里的交互脚本：拖动控件后动态片段会即时更新。 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { JSDOM } from 'jsdom'

const require = createRequire(import.meta.url)
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const MarkdownIt = require('markdown-it')

const esbuild = await import('esbuild')
const built = await esbuild.build({
  entryPoints: [join(root, 'src', 'testApi.ts')],
  bundle: true,
  write: false,
  format: 'cjs',
  platform: 'node',
  target: ['es2020'],
  logLevel: 'silent',
})
const moduleShim = { exports: {} }
new Function('module', 'exports', 'require', built.outputFiles[0].text)(moduleShim, moduleShim.exports, require)
const core = moduleShim.exports

const md = new MarkdownIt({ html: true })
core.extendMarkdownIt(md)

const html = md.render(
  [
    '::show_begin{演示}{a:Z=2[-5,5,1]}',
    '值 *&show(a)*&，平方 *&hs(a^2)*&，符号 *&a:{-1,负;0,零;1,正;2,正;}*&',
    '::show_end',
  ].join('\n'),
)

test('控件改变后展示框内容实时刷新', async () => {
  const dom = new JSDOM('<body>' + html + '</body>', { runScripts: 'outside-only' })
  if (dom.window.document.readyState === 'loading') {
    await new Promise((resolve) => dom.window.addEventListener('load', resolve))
  }
  dom.window.eval(readFileSync(join(root, 'out', 'preview.js'), 'utf8'))

  const document = dom.window.document
  const spans = document.querySelectorAll('[data-sl-kind]')
  assert.equal(spans.length, 3)
  assert.equal(spans[0].textContent, '2')
  assert.equal(spans[1].textContent, '4')

  const range = document.querySelector('input[type="range"][data-sl-input="a"]')
  const number = document.querySelector('input[type="number"][data-sl-input="a"]')
  assert.ok(range && number)

  range.value = '-1'
  range.dispatchEvent(new dom.window.Event('input', { bubbles: true }))

  assert.equal(spans[0].textContent, '-1')
  assert.equal(spans[1].textContent, '1')
  assert.equal(spans[2].textContent, '负')
  // 数字框与滑动条保持同步
  assert.equal(number.value, '-1')
})
