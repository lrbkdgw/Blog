import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { builtinModules, createRequire } from 'node:module'
import { join } from 'node:path'
import { core, documentOf, MarkdownIt, root } from './helpers.mjs'

const require = createRequire(import.meta.url)
const builtins = new Set(builtinModules.map((name) => name.replace(/^node:/, '')))

function activateHost() {
  const commands = new Map()
  const configuration = new Map()
  const calls = []
  let configurationListener
  const vscode = {
    Uri: { parse: (value) => ({ toString: () => value }) },
    workspace: {
      getConfiguration: (_section, uri) => ({ get: (key, fallback) => configuration.get(`${uri?.toString() ?? ''}:${key}`) ?? fallback }),
      onDidChangeConfiguration: (callback) => {
        configurationListener = callback
        return { dispose() { configurationListener = undefined } }
      },
    },
    commands: {
      registerCommand: (name, callback) => {
        commands.set(name, callback)
        return { dispose() { commands.delete(name) } }
      },
      executeCommand: (name) => { calls.push(name); return Promise.resolve() },
    },
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
  return { api, commands, context, configuration, calls, changeConfiguration: (event) => configurationListener(event) }
}

test('安装后的主进程包仅依赖 vscode/Node 内置模块，不依赖仓库或 node_modules', () => {
  const { api, commands, context } = activateHost()
  assert.equal(commands.size, 12)
  assert.equal(context.subscriptions.length, 13)
  const md = api.extendMarkdownIt(new MarkdownIt())
  const html = md.render(
    '::show_begin{测试}{a:Z=2[0,5,1]}\n$x_{*&show(a)*&}$\n::show_end\n\n::begin_ui-ccs\ncreate_point:(1,2);\ncreate_line:(0,0),(2,3),[color=red];\ncreate_line:(7*x^2+6*x+90*x^3);\n::end_ui-ccs',
  )
  assert.match(html, /class="show-box /)
  assert.match(html, /class="ui-ccs-box /)
  assert.match(html, /class="katex"/)
  assert.match(html, /type="range"/)
  assert.equal(api.convertMarkdownForCopy('普通正文', 'basic'), '普通正文')
  for (const subscription of context.subscriptions) subscription.dispose()
  assert.equal(commands.size, 0)
})

test('主进程按文档读取背景设置，修改开关刷新原生预览，不相关设置不刷新', () => {
  const { api, configuration, calls, changeConfiguration } = activateHost()
  const md = api.extendMarkdownIt(new MarkdownIt())
  const tokens = md.parse('正文', {})
  const read = (documentUri) => core.readPreviewModel(documentOf(md.renderer.render(tokens, md.options, {
    currentDocument: { toString: () => documentUri },
  })).querySelector('[data-markdown-model]'))
  assert.equal(read('file:///workspace/demo.md').enableGradientBackground, false)
  configuration.set('file:///workspace/demo.md:preview.enableGradientBackground', true)
  assert.equal(read('file:///workspace/demo.md').enableGradientBackground, true)
  assert.equal(read('file:///other/demo.md').enableGradientBackground, false)
  changeConfiguration({ affectsConfiguration: () => false })
  assert.deepEqual(calls, [])
  changeConfiguration({ affectsConfiguration: (key) => key === 'starlog.preview.enableGradientBackground' })
  assert.deepEqual(calls, ['markdown.api.reloadPlugins'])
  configuration.set('file:///workspace/demo.md:preview.enableGradientBackground', false)
  changeConfiguration({ affectsConfiguration: () => true })
  assert.equal(read('file:///workspace/demo.md').enableGradientBackground, false)
  assert.deepEqual(calls, Array(2).fill('markdown.api.reloadPlugins'))
})
