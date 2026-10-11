/** 可选的真实 Chromium 对照测试：先构建博客，并设置 BROWSER_EXECUTABLE_PATH。 */
import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { basename, join } from 'node:path'
import { chromium } from 'playwright-core'
import { blogRoot, core, render, root } from './helpers.mjs'

const executablePath = process.env.BROWSER_EXECUTABLE_PATH
const browser = executablePath ? await chromium.launch({
  executablePath,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--no-zygote'],
}) : undefined

after(async () => browser?.close())

const source = [
  '# 标题', '', '## 正文', '', '段落 **加粗** $x^2$、`inline code` 与 [链接](https://example.com)。', '',
  '> 引用', '', '- 列表', '- 列表', '', '```cpp', 'int n = 3; // 注释', '// long comment '.repeat(30), '```', '',
  '::cute-table{tuack}', '', '| A | B |', '| - | - |', '| 甲 | < |', '',
  ':::info[数学 $x^2$]{open}', '内容 **粗体**', ':::', '',
  '::show_begin{展示}{n:Z=3[1,9,1]}', '值 *&show(n)*&', '', '$$',
  'x_{*&show(n)*&}=*&hs(n^2)*&', '$$', '::show_end',
].join('\n')

const properties = [
  'font-family', 'font-size', 'font-weight', 'font-style', 'line-height', 'letter-spacing',
  'white-space', 'color', 'background-color', 'padding-top', 'padding-left', 'padding-right', 'padding-bottom',
  'margin-top', 'margin-bottom', 'border-top', 'border-bottom', 'border-left', 'border-right',
  'border-radius', 'display', 'text-align', 'max-width', 'height', 'width', 'vertical-align', 'box-shadow',
]
const selectors = [
  '.prose h1', '.prose h2', '.prose p', '.prose a', '.prose blockquote', '.prose ul', '.prose pre',
  '.prose pre code', '.prose p code', '.prose .hljs-type', '.prose table', '.prose th', '.prose td', '.prose details',
  '.prose summary', '.prose .callout-content', '.prose .show-box', '.show-box-content .prose',
  '.show-box input[type=number]', '.show-box input[type=range]', '.katex', '.katex-display',
]

async function styles(page) {
  return page.evaluate(({ properties, selectors }) => Object.fromEntries(selectors.map((selector) => {
    const element = document.querySelector(selector)
    if (!element) throw new Error('缺失元素：' + selector)
    const style = getComputedStyle(element)
    return [selector, Object.fromEntries(properties.map((property) => [property, style.getPropertyValue(property)]))]
  })), { properties, selectors })
}

for (const dark of [false, true]) {
  test(`真实 Chromium：${dark ? '深色' : '浅色'}预览在 VS Code 默认 CSS 干扰下仍与博客一致`, {
    skip: !executablePath && '未设置 BROWSER_EXECUTABLE_PATH（不影响其余回归测试）',
  }, async (t) => {
    const assets = join(blogRoot, 'dist/assets')
    assert.ok(existsSync(assets), '请先在仓库根目录执行 npm run build')
    const blogCss = readdirSync(assets).find((name) => name.startsWith('index-') && name.endsWith('.css'))
    const nativeCss = ['vscode-markdown.css', 'vscode-highlight.css']
      .map((name) => readFileSync(join(root, 'test/fixtures', name), 'utf8')).join('\n')
    const context = await browser.newContext({ viewport: { width: 960, height: 1600 }, deviceScaleFactor: 1 })
    t.after(() => context.close())
    const errors = []
    await context.route('https://render.test/**', async (route) => {
      const url = new URL(route.request().url())
      const file = url.pathname.startsWith('/extension/')
        ? join(root, 'out', url.pathname.slice('/extension/'.length))
        : join(assets, basename(url.pathname))
      if (!existsSync(file)) return route.abort()
      const contentType = file.endsWith('.css') ? 'text/css' : file.endsWith('.js') ? 'application/javascript' : 'application/octet-stream'
      return route.fulfill({ body: readFileSync(file), contentType })
    })
    const reference = await context.newPage()
    const extension = await context.newPage()
    extension.on('pageerror', (error) => errors.push(error.message))
    await reference.setContent(`<!doctype html><html class="${dark ? 'dark' : ''}"><head><link rel="stylesheet" href="https://render.test/blog/${blogCss}"></head><body style="padding:24px"><main>${core.renderReference(source)}</main></body></html>`, { waitUntil: 'networkidle' })
    await extension.setContent(`<!doctype html><html><head><style>:root{--markdown-font-size:14px;--markdown-font-family:monospace;--markdown-line-height:22px;--vscode-editor-foreground:#ee1111;--vscode-textCodeBlock-background:#eeaaaa;--vscode-textBlockQuote-background:#eeaaaa;--vscode-textLink-foreground:#ee1111;--vscode-textPreformat-foreground:#ee1111;--vscode-textSeparator-foreground:#ee1111;--vscode-textBlockQuote-border:#ee1111;} ${nativeCss}</style><link rel="stylesheet" href="https://render.test/extension/preview.css"></head><body class="vscode-${dark ? 'dark' : 'light'} wordWrap"><main class="markdown-body">${render(source)}</main><script src="https://render.test/extension/preview.js"></script></body></html>`, { waitUntil: 'networkidle' })
    await reference.evaluate(() => document.fonts.ready)
    await extension.evaluate(() => document.fonts.ready)
    assert.deepEqual(await styles(extension), await styles(reference))
    await extension.locator('input[type=range]').evaluate((input) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '5')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await extension.waitForFunction(() => document.querySelector('.show-box-content').textContent.includes('值 5'))
    assert.equal(await extension.locator('.katex-display annotation').textContent(), 'x_{5}=25')
    assert.deepEqual(errors, [])
  })
}
