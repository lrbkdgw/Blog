import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { JSDOM } from 'jsdom'
import { blogRoot, core } from './helpers.mjs'

/** headerYield 直接引用全局 window / document，测试期临时挂到 globalThis 并在用例后还原。 */
async function withDom(html, run) {
  const dom = new JSDOM(`<!doctype html><html><body>${html}</body></html>`, { pretendToBeVisual: true })
  const saved = {
    window: globalThis.window,
    document: globalThis.document,
    raf: globalThis.requestAnimationFrame,
    caf: globalThis.cancelAnimationFrame,
    Event: globalThis.Event,
  }
  globalThis.window = dom.window
  globalThis.document = dom.window.document
  globalThis.requestAnimationFrame = (cb) => setTimeout(() => cb(performance.now()), 0)
  globalThis.cancelAnimationFrame = (id) => clearTimeout(id)
  globalThis.Event = dom.window.Event
  try {
    return await run(dom)
  } finally {
    globalThis.window = saved.window
    globalThis.document = saved.document
    globalThis.requestAnimationFrame = saved.raf
    globalThis.cancelAnimationFrame = saved.caf
    globalThis.Event = saved.Event
  }
}

const rect = (value) => () => ({
  top: value,
  bottom: value + 200,
  left: 0,
  right: 800,
  width: 800,
  height: 200,
  x: 0,
  y: value,
  toJSON() {},
})

const frame = () => new Promise((resolve) => setTimeout(resolve, 0))

test('内容块滚进页头栏时挂 mask 变量，滚出后移除', () => withDom(
  '<header class="site-header"></header><div data-yield-list><div id="block"></div></div>',
  () => {
    const header = document.querySelector('.site-header')
    const block = document.querySelector('#block')
    header.getBoundingClientRect = () => ({ ...rect(0)(), bottom: 64, height: 64 })
    block.getBoundingClientRect = rect(-100)

    const dispose = core.installHeaderYield()
    // 安装时立即测量：块顶 -100、页头下沿 64 → top=164，落在块高内，挂蒙版。
    assert.equal(block.getAttribute('data-yield'), 'on')
    assert.equal(block.style.getPropertyValue('--yield-top'), '164px')
    // 块高 200：fade = clamp(24, 64, 200×0.6) = 64
    assert.equal(block.style.getPropertyValue('--yield-fade'), '64px')

    // 滚回页头下方：top 为负且小于淡出行程，属性移除。
    block.getBoundingClientRect = rect(300)
    window.dispatchEvent(new Event('scroll'))
    return frame().then(() => {
      assert.equal(block.hasAttribute('data-yield'), false)
      dispose()
    })
  },
))

test('dispose 后滚动不再重新挂蒙版', () => withDom(
  '<header class="site-header"></header><div data-yield-list><div id="block"></div></div>',
  () => {
    const header = document.querySelector('.site-header')
    const block = document.querySelector('#block')
    header.getBoundingClientRect = () => ({ ...rect(0)(), bottom: 64, height: 64 })
    block.getBoundingClientRect = rect(300)

    const dispose = core.installHeaderYield()
    assert.equal(block.hasAttribute('data-yield'), false)
    dispose()
    block.getBoundingClientRect = rect(-100)
    window.dispatchEvent(new Event('scroll'))
    return frame().then(() => {
      assert.equal(block.hasAttribute('data-yield'), false)
    })
  },
))

test('.prose 作为 yield-list 直接子节点时自身不挂蒙版，内部段落照常逐个让路', () => withDom(
  '<header class="site-header"></header>' +
    '<div data-yield-list><div class="prose"><p id="p">正文</p></div></div>',
  () => {
    const header = document.querySelector('.site-header')
    const prose = document.querySelector('.prose')
    const paragraph = document.querySelector('#p')
    header.getBoundingClientRect = () => ({ ...rect(0)(), bottom: 64, height: 64 })
    prose.getBoundingClientRect = rect(-120)
    paragraph.getBoundingClientRect = rect(-40)

    const dispose = core.installHeaderYield()
    assert.equal(prose.hasAttribute('data-yield'), false)
    assert.equal(paragraph.getAttribute('data-yield'), 'on')
    dispose()
  },
))

test('全部页面都接入了顶部防冲突（data-yield-list 或 Markdown 的 .prose 机制）', () => {
  const pages = readdirSync(join(blogRoot, 'src/pages')).filter((name) => name.endsWith('.tsx'))
  const uncovered = []
  for (const name of pages) {
    const source = readFileSync(join(blogRoot, 'src/pages', name), 'utf8')
    if (!source.includes('data-yield-list')) uncovered.push(name)
  }
  assert.deepEqual(uncovered, [])
})
