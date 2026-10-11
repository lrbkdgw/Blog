import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import vm from 'node:vm'
import { blogMarkup, core, documentOf, engine, MarkdownIt, render, root } from './helpers.mjs'

const corpus = [
  '# 标题\n\n## 正文标题\n\n**粗体**、*斜体*、~~删除~~、[链接](https://example.com)。\n\n- [x] 已完成\n- [ ] 未完成\n\n> 引用\n\n---',
  '行内 $e^{i\\pi}+1=0$。\n\n$$\n\\sum_{i=1}^n i=\\frac{n(n+1)}2\n$$\n\n```math\nx^2+y^2\n```\n\n```cpp\nint n = 3; // 注释\n```',
  '::show_begin{二次函数}{a:Z=2[-5,5,1]; b:Q=0.5[-10,10,0.5]{faster_set}; name:S=星野[0,12]}\n值 *&show(a)*&，平方 *&hs(a^2+b)*&，&*floor(a/3,2)&*。\n\n*&a:{-1,**负**;0,零;2,$x^2$}*&\n\n`code *&show(a)*&`\n\n$$x_{*&show(a)*&}$$\n\n```cpp\nint a = *&show(a)*&;\n```\n::show_end',
  '::::tip[外层 $x^2$]{open}\n## 框内标题\n\n:::success\n**嵌套内容**\n:::\n::::\n\n:::warning[闭合框]\n内容\n:::',
  '::cute-table{tuack}\n\n| A | B | C |\n| :-: | :-: | :-: |\n| 甲 | < | $n$ |\n| ^ | ^ | 乙 |\n\n| A | B |\n| - | - |\n| 甲 | 乙 |\n| ^ | < |',
  '```markdown\n::show_begin{示例}{a:Z=1[0,2,1]}\n::show_end\n:::info[不执行]\n:::\n```\n\n~~~text\n::cute-table{tuack}\n~~~\n\n::show_begin{未闭合}{a:Z=1}\n正文',
  '<div class="custom"><strong>原始 HTML</strong></div>\n\n![图片](./images/demo.png)\n\n| 转义 | 代码 |\n| - | - |\n| 甲 | 乙 |\n| `^` | &lt; |',
]

for (const [index, source] of corpus.entries()) {
  test(`同款 DOM：语法样例 ${index + 1} 与博客组件完全相同`, () => {
    const expected = documentOf(core.renderReference(source)).body.innerHTML
    assert.equal(blogMarkup(render(source)), expected)
  })
}

test('公式、代码高亮、博客复制按钮与数学折叠标题都由同一组件渲染', () => {
  const doc = documentOf(render(corpus[1] + '\n\n:::info[标题 $x^2$]{open}\n内容\n:::'))
  assert.ok(doc.querySelector('.katex-display .katex'))
  assert.ok(doc.querySelector('.hljs-type'))
  assert.ok(doc.querySelector('button[aria-label="复制代码"]'))
  assert.ok(doc.querySelector('summary .katex'))
  assert.ok(doc.querySelector('summary svg.lucide-info'))
  assert.ok(doc.querySelector('summary .callout-chevron'))
  assert.equal(doc.querySelector('.katex-error'), null)
})

test('保留 markdown-it tokens、renderInline 与缓存 tokens 的行为', () => {
  const md = engine()
  core.extendMarkdownIt(md) // 幂等，不重复包装。
  const tokens = md.parse('## 标题\n\n[链接](./other.md)', {})
  assert.equal(tokens[0].type, 'heading_open')
  assert.equal(tokens[1].content, '标题')
  assert.match(md.renderer.render(tokens, md.options, {}), /id="标题"/)
  assert.equal(md.renderInline('**粗体**'), '<strong>粗体</strong>')
})

test('YAML frontmatter 与博客一样不作为正文显示，BOM/CRLF 不影响源行号', () => {
  const source = '\uFEFF---\r\ntitle: "文章标题"\r\ntags: [数学]\r\n---\r\n\r\n## 正文\r\n\r\n内容'
  const doc = documentOf(render(source))
  assert.equal(doc.querySelector('h2').textContent, '正文')
  assert.equal(doc.querySelector('h2').getAttribute('data-line'), '5')
  assert.doesNotMatch(doc.querySelector('.prose').textContent, /文章标题|tags:/)
  assert.equal(core.readPreviewModel(doc.querySelector('.markdown-extension-preview')).lineOffset, 5)
})

test('特殊块不造成行号漂移，框内标题不暴露正文锚点', () => {
  const source = ['## 开始', '', ':::info[提示]{open}', '### 框内', '内容', ':::', '', '::show_begin{展示}{a:Z=1}', '## 展示标题', '::show_end', '', '## 结尾'].join('\n')
  const doc = documentOf(render(source))
  assert.equal(doc.querySelector('#结尾').getAttribute('data-line'), '11')
  assert.equal(doc.querySelector('details h3').hasAttribute('id'), false)
  assert.equal(doc.querySelector('.show-box h2').hasAttribute('id'), false)
  assert.equal(doc.querySelector('.show-box').getAttribute('data-line'), '7')
})

test('渲染阶段再调用 VS Code 图片规则，缓存 token 不会丢失本地图片转换', () => {
  const md = engine()
  const source = '![根路径](/public/a.png)\n\n::show_begin{嵌套图片}{}\n![框内](/public/b.png)\n::show_end'
  const tokens = md.parse(source, {})
  const imageRule = md.renderer.rules.image
  md.renderer.rules.image = (tokens, index, options, env, self) => {
    const image = tokens[index]
    const src = image.attrGet('src')
    env.containingImages.add(src)
    if (src.startsWith('/')) image.attrSet('src', 'https://file.vscode-resource.test/workspace' + src)
    return imageRule(tokens, index, options, env, self)
  }
  const images = new Set()
  const doc = documentOf(md.renderer.render(tokens, md.options, { containingImages: images }))
  assert.equal(doc.querySelector('img').getAttribute('src'), 'https://file.vscode-resource.test/workspace/public/a.png')
  assert.equal(doc.querySelector('.show-box img').getAttribute('src'), 'https://file.vscode-resource.test/workspace/public/b.png')
  assert.ok(images.has('/public/a.png') && images.has('/public/b.png'))
  assert.equal(images.has('/'), false)
  const model = core.readPreviewModel(doc.querySelector('.markdown-extension-preview'))
  const transform = core.previewUrlTransform(model)
  assert.equal(transform('/public/new.png', 'src'), 'https://file.vscode-resource.test/workspace/public/new.png')
  assert.equal(transform('./other.md', 'href'), './other.md')
  assert.equal(transform('javascript:alert(1)', 'href'), '')
  assert.equal(transform('//images.test/a.png', 'src'), '//images.test/a.png')
})

test('原文中的 HTML 与引号不能逃逸预览模型属性', () => {
  const source = '```html\n"/><img src=x onerror="alert(1)">\n</script><script>alert(2)</script>\n```'
  const doc = documentOf(render(source))
  assert.equal(doc.querySelectorAll('.markdown-extension-preview').length, 1)
  assert.equal(doc.querySelectorAll('script, img').length, 0)
  assert.equal(core.readPreviewModel(doc.querySelector('.markdown-extension-preview')).content, source)
  assert.equal(core.readPreviewModel(doc.createElement('div')), undefined)
})

test('MPE 保留为自包含、单表达式的静态兼容模式', async () => {
  const code = readFileSync(join(root, 'resources/mpe/parser.js'), 'utf8')
  assert.doesNotMatch(code, /\brequire\(/)
  const parser = vm.runInNewContext('(' + code.trim().replace(/[;,]+$/, '') + ')', {})
  const output = await parser.onWillParseMarkdown('::show_begin{t}{a:Z=2[0,5,1]}\n值 *&show(a)*&\n::show_end\n\n| A | B |\n| - | - |\n| 甲 | < |')
  assert.match(output, /值 2/)
  assert.match(output, /starlog-showbox-vars/)
  assert.doesNotMatch(output, /type="range"/)
  assert.match(output, /\| 甲 \|\s+\|/)
})

test('源码降级直接复用博客实现', () => {
  const source = '::show_begin{标题}{a:Z=2[0,5,1]}\n值 *&show(a)*&\n::show_end\n\n:::info[提示]\n内容\n:::\n\n| A | B |\n| - | - |\n| 甲 | < |'
  assert.equal(core.convertMarkdownForCopy(source, 'direct'), source)
  const luogu = core.convertMarkdownForCopy(source, 'luogu')
  assert.match(luogu, /\*\*标题\*\*/)
  assert.match(luogu, /值 2/)
  assert.match(luogu, /:::info\[提示\]/)
  const basic = core.convertMarkdownForCopy(source, 'basic')
  assert.match(basic, /> \*\*提示\*\*/)
  assert.doesNotMatch(basic, /:::/)
  assert.match(basic, /\| 甲 \| 甲 \|/)
})

test('求值、取整与映射使用博客的边界规则', () => {
  assert.equal(core.evaluateShowFormula('2^3^2', {}), 512)
  assert.equal(core.evaluateShowFormula('1/0', {}), null)
  assert.equal(core.evaluateShowFormula('a+1', { a: 2 }), 3)
  assert.equal(core.evaluateShowFormula('a+', { a: 2 }), null)
  assert.equal(core.renderShowContent('&*floor(1.239,2)&* / &*ceil(1.231,2)&* / &*ceil(0.1+0.2,1)&*', {}, []), '1.23 / 1.24 / 0.3')
})

test('渐变默认关闭，配置在渲染缓存 token 时按当前文档重新读取', () => {
  let enabled = false
  const resources = []
  const md = core.extendMarkdownIt(new MarkdownIt({ html: true }), (documentUri) => {
    resources.push(documentUri)
    return { enableGradientBackground: enabled }
  })
  const tokens = md.parse('正文', {})
  const env = { currentDocument: { toString: () => 'file:///workspace/demo.md' } }
  const model = () => core.readPreviewModel(documentOf(md.renderer.render(tokens, md.options, env)).querySelector('[data-markdown-model]'))
  assert.equal(model().enableGradientBackground, false)
  enabled = true
  assert.equal(model().enableGradientBackground, true)
  enabled = false
  assert.equal(model().enableGradientBackground, false)
  assert.deepEqual(resources, Array(3).fill('file:///workspace/demo.md'))
})

test('预览模型拒绝非布尔背景配置，并兼容未配置背景的旧模型', () => {
  const wrapper = documentOf(render('正文')).querySelector('[data-markdown-model]')
  const model = core.readPreviewModel(wrapper)
  for (const value of ['true', 1, null, {}]) {
    wrapper.setAttribute('data-markdown-model', encodeURIComponent(JSON.stringify({ ...model, enableGradientBackground: value })))
    assert.equal(core.readPreviewModel(wrapper), undefined)
  }
  delete model.enableGradientBackground
  wrapper.setAttribute('data-markdown-model', encodeURIComponent(JSON.stringify(model)))
  assert.equal(core.readPreviewModel(wrapper).enableGradientBackground, false)
})
