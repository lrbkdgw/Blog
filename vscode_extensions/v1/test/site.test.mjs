import test from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { JSDOM } from 'jsdom'
import { blogRoot, core } from './helpers.mjs'

test('顶部防冲突（issue #78）：每个站内页面都登记了让路范围，浮层都登记了排除', () => {
  const pagesDir = join(blogRoot, 'src/pages')
  for (const file of readdirSync(pagesDir).filter((name) => name.endsWith('.tsx')).sort()) {
    const source = readFileSync(join(pagesDir, file), 'utf8')
    assert.match(source, /data-yield-(?:list|block|ignore)/, `${file} 应包含 data-yield-* 标记`)
  }
  for (const file of ['Comments.tsx', 'OfflineExportPanel.tsx']) {
    const source = readFileSync(join(blogRoot, 'src/components', file), 'utf8')
    assert.match(source, /data-yield-list/, `${file} 应包含 data-yield-list`)
  }
  for (const file of ['BundleImportDialog.tsx', 'LatexPicker.tsx', 'QueueDiff.tsx', 'SearchDialog.tsx', 'VersionCompare.tsx']) {
    const source = readFileSync(join(blogRoot, 'src/components', file), 'utf8')
    assert.match(source, /data-yield-ignore/, `${file} 是固定浮层，必须排除在让路之外`)
  }
})

test('顶部防冲突几何：最外层块挂蒙版、嵌套范围只作容器、ignore 与残留被清理', (t) => {
  const dom = new JSDOM(`<!doctype html><body>
    <header class="site-header"></header>
    <main>
      <div data-yield-list>
        <section id="plain-card">普通卡片</section>
        <div id="nested-scope" data-yield-list><article id="nested-card">嵌套卡片</article></div>
        <div id="outer-block"><div class="prose"><p id="inner-prose">正文</p></div></div>
        <p id="far-below">远在下方</p>
        <p id="offscreen">已滚出视口</p>
      </div>
      <div data-yield-ignore>
        <div class="prose"><p id="ignored" data-yield="on" style="--yield-top:10px;--yield-fade:10px">编辑器预览</p></div>
      </div>
      <footer id="single" data-yield-block>页脚</footer>
    </main>
  </body>`, { pretendToBeVisual: true })

  global.window = dom.window
  global.document = dom.window.document
  global.MutationObserver = dom.window.MutationObserver
  global.ResizeObserver = class { observe() {} disconnect() {} }
  global.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window)
  global.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window)
  Object.defineProperty(dom.window, 'innerHeight', { value: 800, configurable: true })
  t.after(() => dom.window.close())

  const rect = (top, height) => ({
    x: 0,
    y: top,
    top,
    left: 0,
    right: 300,
    bottom: top + height,
    width: 300,
    height,
    toJSON() {},
  })
  const put = (selector, top, height) => {
    const el = document.querySelector(selector)
    el.getBoundingClientRect = () => rect(top, height)
    return el
  }
  put('.site-header', 0, 64)
  put('#plain-card', -20, 100)
  put('#nested-scope', -30, 140)
  put('#nested-card', -10, 40)
  put('#outer-block', -40, 300)
  const innerProse = put('#inner-prose', -5, 30)
  innerProse.setAttribute('data-yield', 'on')
  innerProse.style.setProperty('--yield-top', '1px')
  innerProse.style.setProperty('--yield-fade', '1px')
  put('#far-below', 500, 40)
  put('#offscreen', -200, 50)
  put('#ignored', -10, 50)
  put('#single', 10, 30)

  const cleanup = core.installHeaderYield()
  t.after(cleanup)
  const state = (selector) => {
    const el = document.querySelector(selector)
    return [
      el.getAttribute('data-yield'),
      el.style.getPropertyValue('--yield-top'),
      el.style.getPropertyValue('--yield-fade'),
    ]
  }
  assert.deepEqual(state('#plain-card'), ['on', '84px', '60px'])
  assert.deepEqual(state('#nested-scope'), [null, '', ''])
  assert.deepEqual(state('#nested-card'), ['on', '64px', '24px'])
  assert.deepEqual(state('#outer-block'), ['on', '104px', '64px'])
  assert.deepEqual(state('#inner-prose'), [null, '', ''], '外层已挂蒙版时内层残留应被清理')
  assert.deepEqual(state('#far-below'), [null, '', ''])
  assert.deepEqual(state('#offscreen'), [null, '', ''])
  assert.deepEqual(state('#ignored'), [null, '', ''], 'ignore 子树不得参与，旧蒙版要清掉')
  assert.deepEqual(state('#single'), ['on', '54px', '24px'])
  assert.deepEqual(
    [...document.querySelectorAll('[data-yield="on"]')].map((el) => el.id),
    ['plain-card', 'nested-card', 'outer-block', 'single'],
  )
})
