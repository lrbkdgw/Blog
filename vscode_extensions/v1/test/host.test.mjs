import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { builtinModules, createRequire } from 'node:module'
import { join } from 'node:path'
import { MarkdownIt, root } from './helpers.mjs'

const require = createRequire(import.meta.url)
const builtins = new Set(builtinModules.map((name) => name.replace(/^node:/, '')))

test('安装后的主进程包仅依赖 vscode/Node 内置模块，不依赖仓库或 node_modules', () => {
  const commands = new Map()
  const vscode = {
    workspace: { getConfiguration: () => ({ get: (_key, fallback) => fallback }) },
    commands: { registerCommand: (name, callback) => {
      commands.set(name, callback)
      return { dispose() { commands.delete(name) } }
    } },
  }
  const module = { exports: {} }
  new Function('module', 'exports', 'require', readFileSync(join(root, 'out/extension.js'), 'utf8'))(
    module, module.exports, (name) => {
      if (name === 'vscode') return vscode
      assert.ok(builtins.has(name.replace(/^node:/, '')), '发现未打包依赖：' + name)
      return require(name)
    },
  )
  const context = { subscriptions: [] }
  const api = module.exports.activate(context)
  assert.equal(commands.size, 10)
  assert.equal(context.subscriptions.length, 10)
  const md = api.extendMarkdownIt(new MarkdownIt())
  const html = md.render('::show_begin{测试}{a:Z=2[0,5,1]}\n$x_{*&show(a)*&}$\n::show_end')
  assert.match(html, /class="show-box /)
  assert.match(html, /class="katex"/)
  assert.match(html, /type="range"/)
  assert.equal(api.convertMarkdownForCopy('普通正文', 'basic'), '普通正文')
})
