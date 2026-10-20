/** 可选的真实 Chromium 对照测试：先构建博客，并设置 BROWSER_EXECUTABLE_PATH。 */
import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { basename, join } from 'node:path'
import { chromium } from 'playwright-core'
import { blogRoot, core, nativeContent, nativePreviewScript, render, root } from './helpers.mjs'

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
  '| 默认 | 左 | 中 | 右 |', '| - | :- | :-: | -: |', '| 文本 | 文本 | 文本 | 文本 |', '',
  '| 合并 | 第二格 |', '| - | - |', '| 甲 | < |', '| ^ | ^ |', '',
  '::cute-table{tuack}', '', '| A | B |', '| - | - |', '| 甲 | < |', '',
  ':::info[数学 $x^2$]{open}', '内容 **粗体**', ':::', '',
  '::show_begin{展示}{n:Z=3[1,9,1]}', '值 *&show(n)*&', '', '$$',
  'x_{*&show(n)*&}=*&hs(n^2)*&', '$$', '::show_end', '',
  '::begin_ui-ccs', 'create_point:(0,0);', 'create_line:(-2,-1),(2,3),[color=red];', 'create_line:(7*x^2+6*x+90*x^3);', '::end_ui-ccs',
].join('\n')

const properties = [
  'font-family', 'font-size', 'font-weight', 'font-style', 'line-height', 'letter-spacing',
  'white-space', 'color', 'background-color', 'padding-top', 'padding-left', 'padding-right', 'padding-bottom',
  'margin-top', 'margin-bottom', 'border-top', 'border-bottom', 'border-left', 'border-right',
  'border-radius', 'display', 'justify-content', 'text-align', 'max-width', 'height', 'width', 'vertical-align', 'box-shadow',
]
const selectors = [
  '.prose h1', '.prose h2', '.prose p', '.prose a', '.prose blockquote', '.prose ul', '.prose pre',
  '.prose pre code', '.prose p code', '.prose .hljs-type', '.prose table', '.prose th', '.prose td', '.prose details',
  '.prose summary', '.prose .callout-content', '.prose .show-box', '.show-box-content .prose',
  '.prose .markdown-table-wrapper', '.prose .table-tuack-wrapper', '.prose .table-tuack-wrapper .markdown-table-wrapper',
  '.prose .table-tuack-wrapper table', '.prose .table-tuack-wrapper th', '.prose .table-tuack-wrapper td',
  '.show-box input[type=number]', '.show-box input[type=range]', '.prose .ui-ccs-box', '.katex', '.katex-display',
]

async function styles(page) {
  return page.evaluate(({ properties, selectors }) => Object.fromEntries(selectors.map((selector) => {
    const element = document.querySelector(selector)
    if (!element) throw new Error('缺失元素：' + selector)
    const style = getComputedStyle(element)
    return [selector, Object.fromEntries(properties.map((property) => [property, style.getPropertyValue(property)]))]
  })), { properties, selectors })
}

async function refreshPreview(page, content, documentUri = 'file:///workspace/demo.md', options = {}) {
  const nextUpdate = await page.evaluate((data) => {
    window.postMessage(data, '*')
    return window.nativePreviewUpdates + 1
  }, { type: 'updateContent', source: documentUri, content: nativeContent(content, documentUri, options) })
  // postMessage 是异步真实消息，等宿主处理及微任务结束后再检查 DOM。
  await page.waitForFunction((nextUpdate) => window.nativePreviewUpdates >= nextUpdate, nextUpdate)
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
    await extension.setContent(`<!doctype html><html><head><style>:root{--markdown-font-size:14px;--markdown-font-family:monospace;--markdown-line-height:22px;--vscode-editor-foreground:#ee1111;--vscode-textCodeBlock-background:#eeaaaa;--vscode-textBlockQuote-background:#eeaaaa;--vscode-textLink-foreground:#ee1111;--vscode-textPreformat-foreground:#ee1111;--vscode-textSeparator-foreground:#ee1111;--vscode-textBlockQuote-border:#ee1111;} ${nativeCss}</style><link rel="stylesheet" href="https://render.test/extension/preview.css"></head><body class="vscode-${dark ? 'dark' : 'light'} wordWrap"><main class="markdown-body">${render(source)}</main><script>${nativePreviewScript}</script><script src="https://render.test/extension/preview.js"></script></body></html>`, { waitUntil: 'networkidle' })
    await reference.evaluate(() => document.fonts.ready)
    await extension.evaluate(() => document.fonts.ready)
    assert.deepEqual(await styles(extension), await styles(reference))
    const tables = await extension.evaluate(() => [...document.querySelectorAll('.markdown-table')].map((table) => ({
      justify: getComputedStyle(table.parentElement).justifyContent,
      header: [...table.querySelectorAll('th')].map((cell) => getComputedStyle(cell).textAlign),
      cells: [...table.querySelectorAll('td')].map((cell) => getComputedStyle(cell).textAlign),
      merged: table.querySelector('[colspan]')?.getAttribute('colspan'),
    })))
    assert.deepEqual(tables[0], { justify: 'flex-start', header: ['left', 'left', 'center', 'right'], cells: ['left', 'left', 'center', 'right'], merged: undefined })
    assert.deepEqual(tables[1], { justify: 'flex-start', header: ['left', 'left'], cells: ['left'], merged: '2' })
    assert.deepEqual(tables[2], { justify: 'center', header: ['center', 'center'], cells: ['center'], merged: '2' })
    assert.equal(await extension.evaluate(() => getComputedStyle(document.body).backgroundImage), 'none')
    assert.equal(await extension.evaluate(() => getComputedStyle(document.body).backgroundColor), await reference.evaluate(() => getComputedStyle(document.body).backgroundColor))
    await extension.locator('input[type=range]').evaluate((input) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '5')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await extension.waitForFunction(() => document.querySelector('.show-box-content').textContent.includes('值 5'))
    assert.equal(await extension.locator('.katex-display annotation').textContent(), 'x_{5}=25')
    await refreshPreview(extension, source, 'file:///workspace/demo.md', { enableGradientBackground: true })
    assert.equal(await extension.evaluate(() => getComputedStyle(document.body).backgroundImage), await reference.evaluate(() => getComputedStyle(document.body).backgroundImage))
    assert.equal(await extension.locator('input[type=number]').inputValue(), '5')
    await refreshPreview(extension, source, 'file:///workspace/demo.md', { enableGradientBackground: false })
    assert.equal(await extension.evaluate(() => getComputedStyle(document.body).backgroundImage), 'none')
    assert.equal(await extension.locator('input[type=number]').inputValue(), '5')
    assert.deepEqual(errors, [])
  })
}

for (const nativeFirst of [true, false]) {
  test(`真实 Chromium：创建→删除→再次创建展示框不丢失正文（内置监听器${nativeFirst ? '先' : '后'}注册）`, {
    skip: !executablePath && '未设置 BROWSER_EXECUTABLE_PATH（不影响其余回归测试）',
  }, async (t) => {
    const page = await browser.newPage()
    t.after(() => page.close())
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    const extensionScript = readFileSync(join(root, 'out/preview.js'), 'utf8')
    const scripts = nativeFirst ? [nativePreviewScript, extensionScript] : [extensionScript, nativePreviewScript]
    const base = '# 正文\n\n**前文**与 $x^2$。\n\n:::info[保留折叠框]{open}\n内容\n:::\n\n```cpp\nint n = 3;\n```\n\n结尾正文'
    const box = '::show_begin{展示}{n:Z=3[1,9,1]}\n值 *&show(n)*&\n\n$$\nx_{*&show(n)*&}=*&hs(n^2)*&\n$$\n::show_end'
    await page.setContent(`<!doctype html><html><body class="vscode-light">${nativeContent(base)}</body></html>`)
    for (const script of scripts) await page.addScriptTag({ content: script })
    await page.waitForFunction(() => document.querySelector('.markdown-extension-mount .prose'))
    const refresh = (...args) => refreshPreview(page, ...args)
    for (let i = 0; i < 3; ++i) {
      await refresh(base + '\n\n' + box)
      assert.equal(await page.locator('.show-box').count(), 1)
      await page.locator('input[type=range]').evaluate((input) => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '5')
        input.dispatchEvent(new Event('input', { bubbles: true }))
      })
      await page.waitForFunction(() => document.querySelector('.show-box-content').textContent.includes('值 5'))
      await page.evaluate(() => { window.previousMount = document.querySelector('.markdown-extension-mount') })
      await refresh(base + '\n\n' + box)
      assert.equal(await page.evaluate(() => document.querySelector('.markdown-extension-mount') === window.previousMount), true)
      assert.equal(await page.locator('input[type=number]').inputValue(), '5')
      assert.equal(await page.locator('.katex-display annotation').textContent(), 'x_{5}=25')
      await refresh(base)
      assert.equal(await page.locator('.show-box').count(), 0)
      assert.match(await page.locator('.markdown-extension-mount').innerText(), /前文[\s\S]*结尾正文/)
      assert.equal(await page.locator('h1').textContent(), '正文')
      assert.ok(await page.locator('.hljs-type').count())
      assert.equal(await page.evaluate(() => window.nativeCodeLineElements.every((element) => element.isConnected && document.querySelector('.markdown-extension-host').contains(element))), true)
      assert.equal(await page.evaluate(() => window.nativeCodeLineElements[0].getAttribute('data-line')), '0')
      assert.equal(await page.evaluate(() => window.nativeCodeLineElements.at(-1).getAttribute('data-line')), String(base.split('\n').length))
      assert.equal(await page.locator('.katex').count(), 1)
      assert.deepEqual(errors, [])
    }
    for (const partial of ['::show_begin', box.replace('::show_end', ''), '::show_end']) {
      await refresh(base + '\n\n' + partial)
      assert.match(await page.locator('.markdown-extension-mount').innerText(), /前文[\s\S]*结尾正文/)
      assert.deepEqual(errors, [])
    }
    await refresh('')
    assert.equal(await page.locator('.show-box, h1').count(), 0)
    await refresh(base + '\n\n' + box, 'file:///workspace/other.md')
    assert.equal(await page.locator('input[type=number]').inputValue(), '3')
    assert.match(await page.locator('.markdown-extension-mount').innerText(), /结尾正文/)
    assert.deepEqual(errors, [])
  })
}
