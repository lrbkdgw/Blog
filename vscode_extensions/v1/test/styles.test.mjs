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
  '.prose .markdown-table-wrapper',
  '.prose table.markdown-table',
  '.prose table.markdown-table th',
  '.prose table.markdown-table td',
  '.prose .table-tuack-wrapper',
  '.prose .table-tuack-wrapper .markdown-table-wrapper',
  '.prose .table-tuack-wrapper table',
  '.prose .table-tuack-wrapper table th',
  '.prose .table-tuack-wrapper table td',
  '.dark .prose .table-tuack-wrapper table',
  '.prose details.callout',
  '.prose details.callout summary.callout-summary',
  '.prose details.callout-info',
  '.prose details.callout-warning',
  '.prose details.callout-success',
  '.show-box',
  '.show-box .show-box-content > .prose',
  '.ui-choose-card .prose',
  '.ui-if-card .prose',
  '.ui-if-lined .ui-if-strike-text',
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
  assert.equal(manifest.version, '2.3.0')
  assert.ok(manifest.contributes.commands.every((command) => command.category === 'Markdown 语法拓展'))
  for (const file of [manifest.main, ...manifest.contributes['markdown.previewStyles'], ...manifest.contributes['markdown.previewScripts']]) {
    assert.ok(existsSync(resolve(root, file)), file)
  }
  const notices = readFileSync(join(root, 'resources/third-party-notices.txt'), 'utf8')
  assert.match(notices, /react 19\./)
  assert.match(notices, /katex 0\.16\./)
})

test('普通/合并表格默认靠左，Tuack 外壳和内部表格仍居中', () => {
  assert.equal(declarations(extension, '.markdown-extension-preview .prose .markdown-table-wrapper')['justify-content'], 'flex-start')
  for (const selector of ['table.markdown-table', 'table.markdown-table th', 'table.markdown-table td']) {
    assert.equal(declarations(extension, '.markdown-extension-preview .prose ' + selector)['text-align'], 'left')
  }
  assert.equal(declarations(extension, '.markdown-extension-preview .prose .table-tuack-wrapper .markdown-table-wrapper')['justify-content'], 'center')
  assert.equal(declarations(extension, '.markdown-extension-preview .prose .table-tuack-wrapper table th')['text-align'], 'center')
  assert.equal(declarations(extension, '.markdown-extension-preview .prose .table-tuack-wrapper table td')['text-align'], 'center')
  // 静态兼容层也不能额外强制普通合并单元格居中，Tuack 的专用居中规则仍保留。
  const mpe = postcss.parse(readFileSync(join(root, 'media/mpe.css'), 'utf8'))
  assert.equal(declarations(mpe, 'table td[colspan]')['text-align'], undefined)
  assert.equal(declarations(mpe, '.starlog-table-tuack td')['text-align'], 'center')
})

test('选择框与是否框内正文排版与折叠框 .callout-content 字号及行高完全一致', () => {
  const callout = declarations(reference, '.prose details.callout .callout-content')
  const choose = declarations(reference, '.ui-choose-card .prose')
  const uiIf = declarations(reference, '.ui-if-card .prose')
  assert.equal(choose['font-size'], callout['font-size'])
  assert.equal(choose['line-height'], callout['line-height'])
  assert.equal(uiIf['font-size'], callout['font-size'])
  assert.equal(uiIf['line-height'], callout['line-height'])
})

// 去掉空白与小数的前导 0，避免压缩器写法不同（0.95rem / .95rem）影响比较。
const compact = (value) => String(value).replace(/\s+/g, '').replace(/(^|[^\d.])0+(?=\.\d)/g, '$1')

test('正文字号缩放：正文根字号与表格、折叠框、展示框、表单控件统一乘以 --prose-font-scale，代码块不参与', () => {
  const scaled = (size) => compact(`calc(${size} * var(--prose-font-scale))`)
  // 选择器 → 缩放前的原始字号。新增带固定字号的正文元素时，在这里补一行。
  const original = {
    '.prose': '1rem',
    '.prose-base': '1rem',
    '.prose-sm': '0.875rem',
    '.prose table.markdown-table': '1rem',
    '.prose table.table-tuack': '1rem',
    '.prose .table-tuack-wrapper table': '1rem',
    '.prose details.callout': '0.875rem',
    '.prose details.callout .callout-content': '14.5px',
    '.show-box .show-box-content > .prose': '0.95rem',
    '.ui-choose-card .prose': '14.5px',
    '.ui-if-card .prose': '14.5px',
    '.text-callout': '14.5px',
    '.text-callout-label': '0.875rem',
  }
  const factors = []
  for (const [tree, scope, label] of [[reference, '', '博客'], [extension, '.markdown-extension-preview ', '插件']]) {
    const factor = Number(declarations(tree, ':root')['--prose-font-scale'])
    assert.ok(Number.isFinite(factor) && factor > 0, `${label}：:root 必须定义数值型的 --prose-font-scale`)
    factors.push(factor)
    for (const [selector, size] of Object.entries(original)) {
      assert.equal(compact(declarations(tree, scope + selector)['font-size']), scaled(size), `${label}：${selector} 的字号`)
    }
    // 折叠框标题与控件标签的行高原为 1.25rem（text-sm），和字号一起缩放才能保持原有比例。
    for (const selector of ['.prose details.callout', '.text-callout-label']) {
      assert.equal(compact(declarations(tree, scope + selector)['line-height']), scaled('1.25rem'), `${label}：${selector} 的行高`)
    }
    // 代码块属于「代码字体」，沿用固定字号，不随正文缩放。
    assert.equal(declarations(tree, scope + '.prose pre')['font-size'], '13.5px', `${label}：代码块字号`)
  }
  assert.equal(factors[0], factors[1], '博客与插件预览的正文缩放系数必须相同')

  // 表单控件必须用 text-callout / text-callout-label；再写死 14.5px 或 text-sm，正文缩放后就会和折叠框错位。
  const widgets = readFileSync(join(blogRoot, 'src/components/UiWidgets.tsx'), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')
  assert.match(widgets, /\btext-callout(?![\w-])/)
  assert.match(widgets, /\btext-callout-label(?![\w-])/)
  assert.doesNotMatch(widgets, /text-\[14\.5px\]|\btext-sm\b/, 'UiWidgets.tsx 不应写死折叠框字号')
})

test('标题行不参与正文字号缩放：h1–h6 的字号把 --prose-font-scale 除回去，保持原始大小', () => {
  // 标题字号是相对所在正文的 em；正文乘了系数，标题就得写成 calc(原倍数 / var(--prose-font-scale)) 才能保持原样。
  const unscaled = (size) => compact(`calc(${size} / var(--prose-font-scale))`)
  // 各级标题相对「未缩放正文字号」的倍数：@tailwindcss/typography 的默认值，h4–h6 与正文同字号。
  const base = { h1: '2.25em', h2: '1.5em', h3: '1.25em', h4: '1em', h5: '1em', h6: '1em' }
  const original = {
    '.prose': base,
    '.prose-base': base,
    '.prose-sm': { h1: '2.1428571em', h2: '1.4285714em', h3: '1.2857143em', h4: '1em', h5: '1em', h6: '1em' },
  }
  // 不同压缩器对引号、逗号后空格的写法不一样，比较前统一掉。
  const normalize = (selector) => selector.replace(/["']/g, '').replace(/\s*,\s*/g, ',').replace(/\s+/g, ' ').trim()
  const fontSize = (tree, selector) => {
    let value
    tree.walkRules((rule) => {
      if (!rule.selectors.some((item) => normalize(item) === normalize(selector))) return
      rule.walkDecls('font-size', (decl) => { value = decl.value })
    })
    return value === undefined ? undefined : compact(value)
  }
  // typography 的标题规则只作用于不在 not-prose 容器里的标题；其余的（展示框、选择框 / 是否框里的正文，
  // 以及手写的 not-prose 容器）在里面与所在正文同字号，由 index.css 用正好互补的选择器把系数除回去。
  const notProse = ':where([class~=not-prose],[class~=not-prose] *)'
  for (const [tree, scope, label] of [[reference, '', '博客'], [extension, '.markdown-extension-preview ', '插件']]) {
    for (const [variant, sizes] of Object.entries(original)) {
      for (const [tag, size] of Object.entries(sizes)) {
        assert.equal(fontSize(tree, `${scope}${variant} :where(${tag}):not(${notProse})`), unscaled(size), `${label}：${variant} 里 ${tag} 的字号`)
      }
    }
    assert.equal(fontSize(tree, `${scope}.prose :where(h1,h2,h3,h4,h5,h6)${notProse}`), unscaled('1em'), `${label}：not-prose 容器内标题的字号`)
  }
})

test('Settings 暴露默认关闭的渐变背景开关，并保留共享背景而不是重新定义渐变', () => {
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  const setting = manifest.contributes.configuration.properties['starlog.preview.enableGradientBackground']
  assert.equal(setting.type, 'boolean')
  assert.equal(setting.default, false)
  assert.equal(setting.scope, 'resource')
  assert.equal(declarations(extension, 'body:not(.markdown-extension-gradient-background)')['background-image'], 'none')
  assert.ok(declarations(extension, 'body')['background-image'].includes('radial-gradient'))
  assert.equal(declarations(extension, '.markdown-extension-source').display, 'none!important')
})
