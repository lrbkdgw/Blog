import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { transform } from 'esbuild'
import { blogRoot, root } from './helpers.mjs'

const requireBlog = createRequire(join(blogRoot, 'package.json'))
const postcss = requireBlog('postcss')
const tailwindcss = requireBlog('tailwindcss')
const config = requireBlog('tailwindcss/loadConfig')(join(blogRoot, 'tailwind.config.js'))
config.content = config.content.map((pattern) => resolve(blogRoot, pattern))
const generated = await postcss([tailwindcss(config), requireBlog('autoprefixer')]).process(
  readFileSync(join(blogRoot, 'src/styles/index.css'), 'utf8'), { from: join(blogRoot, 'src/styles/index.css') },
)
const katexCss = readFileSync(requireBlog.resolve('katex/dist/katex.min.css'), 'utf8')
const blogCss = generated.css.replace(/@import\s+["']katex\/dist\/katex\.min\.css["'];/, '')
const reference = postcss.parse((await transform(katexCss + '\n' + blogCss, { loader: 'css', minify: true })).code)
const extensionCss = readFileSync(join(root, 'out/preview.css'), 'utf8')
const extension = postcss.parse(extensionCss)

function declarations(tree, selector) {
  const result = {}
  tree.walkRules((rule) => {
    const normalize = (value) => value.replace(/\s*([>+~])\s*/g, '$1')
    if (!rule.selectors.some((value) => normalize(value) === normalize(selector))) return
    rule.walkDecls((decl) => { result[decl.prop] = decl.value + (decl.important ? '!important' : '') })
  })
  assert.ok(Object.keys(result).length, '没有找到样式：' + selector)
  return result
}

const selectors = [
  '.prose pre',
  '.prose h2',
  '.prose blockquote',
  '.prose table.markdown-table',
  '.prose table.markdown-table th',
  '.prose table.markdown-table td',
  '.prose .table-tuack-wrapper table',
  '.dark .prose .table-tuack-wrapper table',
  '.prose details.callout',
  '.prose details.callout summary.callout-summary',
  '.prose details.callout-info',
  '.prose details.callout-warning',
  '.prose details.callout-success',
  '.show-box',
  '.show-box .show-box-content > .prose',
  '.hljs-keyword',
  '.hljs-string',
  '.katex-display',
]

for (const selector of selectors) {
  test(`同款 CSS：${selector}`, () => {
    const scoped = selector.startsWith('.dark ')
      ? '.dark .markdown-extension-preview ' + selector.slice(6)
      : '.markdown-extension-preview ' + selector
    const actual = declarations(extension, scoped)
    const expected = declarations(reference, selector)
    // 宿主层可以显式恢复浏览器默认值（如 position: static / 左侧圆角为 0）。
    // 博客自己声明的每个属性必须保持不变；完整级联由真实浏览器测试验证。
    for (const [property, value] of Object.entries(expected)) {
      assert.equal(actual[property], value, `${selector} 的 ${property}`)
    }
  })
}

test('KaTeX 样式与全部字体均在安装包目录中，无 CDN 依赖', () => {
  assert.match(extensionCss, /font-family:KaTeX_Main/)
  assert.match(extensionCss, /\.markdown-extension-preview \.katex/)
  const fonts = [...extensionCss.matchAll(/url\("?([^)"]+)"?\)/g)].map((match) => match[1])
  assert.ok(fonts.length >= 20)
  for (const font of fonts) {
    assert.doesNotMatch(font, /^https?:/)
    assert.ok(existsSync(resolve(root, 'out', font)), font)
  }
})

test('插件名、命令分类、预览贡献与实际构建产物一致', () => {
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  assert.equal(manifest.displayName, 'Markdown 语法拓展')
  assert.equal(manifest.name, 'starlog-markdown') // 保留扩展 ID，旧用户直接升级。
  assert.equal(manifest.version, '2.0.0')
  assert.ok(manifest.contributes.commands.every((command) => command.category === 'Markdown 语法拓展'))
  for (const file of [manifest.main, ...manifest.contributes['markdown.previewStyles'], ...manifest.contributes['markdown.previewScripts']]) {
    assert.ok(existsSync(resolve(root, file)), file)
  }
  const notices = readFileSync(join(root, 'resources/third-party-notices.txt'), 'utf8')
  assert.match(notices, /react 19\./)
  assert.match(notices, /katex 0\.16\./)
})
