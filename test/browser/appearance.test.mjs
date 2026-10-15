import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

// Reuse the repository's optional browser-test tooling; no new runtime dependency.
const executablePath = process.env.BROWSER_EXECUTABLE_PATH
const base = (process.env.BLOG_TEST_URL || 'http://127.0.0.1:5173/').replace(/\/?$/, '/')
const requireExtension = createRequire(new URL('../../vscode_extensions/v1/package.json', import.meta.url))
const browser = executablePath ? await requireExtension('playwright-core').chromium.launch({
  executablePath, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--no-zygote'],
}) : null
const options = { skip: !browser && 'Set BROWSER_EXECUTABLE_PATH and start the blog first.', timeout: 90000 }
after(async () => browser?.close())

async function setup(t, settings = {}) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, ...settings })
  const errors = []
  context.on('page', (page) => page.on('pageerror', (error) => errors.push(error.message)))
  // These are UI tests, never authenticated writes to a repository.
  await context.route('https://api.github.com/**', (route) => route.fulfill({ status: 503, json: { message: 'Offline UI test' } }))
  t.after(async () => { await context.close(); assert.deepEqual(errors, [], 'Unexpected page errors') })
  return { context, page: await context.newPage() }
}
async function choose(page, name) {
  const input = page.getByRole('radio', { name, exact: true })
  await input.locator('..').click()
  await page.waitForFunction((element) => element.checked, await input.elementHandle())
}
async function ready(page, path = '') {
  await page.goto(base + path)
  await page.locator(path.startsWith('settings') ? '#appearance' : '#main-content').waitFor()
}
async function rootValue(page, key) { return page.locator('html').getAttribute(`data-${key}`) }
async function noOverflow(page) {
  const result = await page.evaluate(() => ({ viewport: innerWidth, width: document.documentElement.scrollWidth,
    overflowing: [...document.querySelectorAll('main *')].filter((el) => el.getBoundingClientRect().right > innerWidth + 1 && getComputedStyle(el).position !== 'absolute').slice(0, 4).map((el) => el.className),
  }))
  assert.ok(result.width <= result.viewport + 1, JSON.stringify(result))
}
async function snapshot(page, filename) {
  const dir = process.env.BLOG_SCREENSHOT_DIR
  if (!dir) return
  await mkdir(dir, { recursive: true })
  await page.screenshot({ path: join(dir, filename) })
}

const palettes = [['classic', '星野经典'], ['aurora', '极光幻境'], ['sakura', '樱落春日'], ['forest', '森林微光'], ['ocean', '深海漫游'], ['sunset', '落日余晖'], ['neon', '霓虹夜航'], ['paper', '墨色书房']]
const scenes = [['rain', '雨夜'], ['sunshine', '阳光'], ['stars', '星空'], ['aurora', '极光'], ['petals', '樱落'], ['fireflies', '萤火'], ['snow', '轻雪'], ['waves', '海波']]

test('eight palettes × two modes, saved selection, cross-tab sync and native keyboard selection', options, async (t) => {
  const { context, page } = await setup(t)
  await ready(page, 'settings')
  await choose(page, '关闭')
  for (const [id, name] of palettes) {
    await choose(page, name)
    assert.equal(await rootValue(page, 'palette'), id)
    for (const mode of ['浅色', '深色']) {
      await choose(page, mode)
      assert.equal(await page.evaluate(() => document.documentElement.classList.contains('dark')), mode === '深色')
      assert.notEqual(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), 'rgba(0, 0, 0, 0)')
    }
  }
  await page.reload()
  await page.locator('#appearance').waitFor()
  assert.equal(await rootValue(page, 'palette'), 'paper')
  assert.equal(await page.getByRole('radio', { name: '深色', exact: true }).isChecked(), true)
  const other = await context.newPage()
  await ready(other)
  await choose(page, '星野经典')
  await other.waitForFunction(() => document.documentElement.dataset.palette === 'classic')
  await page.getByRole('radio', { name: '星野经典', exact: true }).focus()
  await page.keyboard.press('ArrowRight')
  await page.waitForFunction(() => document.documentElement.dataset.palette === 'aurora')
  assert.equal(await page.getByRole('radio', { name: '极光幻境', exact: true }).evaluate((el) => el === document.activeElement), true)
})

test('all scenes draw, adapt to explicit light mode, save independent parameters and reset', options, async (t) => {
  const { page } = await setup(t)
  await ready(page, 'settings')
  await choose(page, '关闭')
  await choose(page, '浅色')
  for (const [id, name] of scenes) {
    await choose(page, `背景：${name}`)
    const canvas = page.locator(`canvas[data-scene="${id}"]`)
    await canvas.waitFor()
    assert.equal(await page.locator('canvas').count(), 1)
    assert.equal(await canvas.getAttribute('data-running'), 'false')
    assert.equal(await page.evaluate(() => document.documentElement.classList.contains('dark')), false)
    assert.ok(await canvas.evaluate((el) => el.getContext('2d').getImageData(0, 0, el.width, el.height).data.some((value, i) => i % 4 === 3 && value > 0)))
  }
  await choose(page, '背景：星空')
  await page.getByLabel('星星数量', { exact: true }).press('End')
  assert.equal(await page.getByLabel('星星数量', { exact: true }).inputValue(), '100')
  await choose(page, '背景：雨夜')
  await page.getByLabel('雨量', { exact: true }).press('Home')
  await choose(page, '背景：星空')
  assert.equal(await page.getByLabel('星星数量', { exact: true }).inputValue(), '100')
  await page.reload()
  await page.locator('canvas[data-scene=stars]').waitFor()
  assert.equal(await page.getByLabel('星星数量', { exact: true }).inputValue(), '100')
  await page.getByRole('button', { name: '恢复场景参数', exact: true }).click()
  assert.equal(await page.getByLabel('星星数量', { exact: true }).inputValue(), '50')
  await choose(page, '背景：纯净背景')
  assert.equal(await page.locator('canvas').count(), 0)
})

test('reduced motion, user off, visibility pause and mobile canvas budgets', options, async (t) => {
  const { page } = await setup(t, { deviceScaleFactor: 2 })
  await ready(page, 'settings')
  await choose(page, '完整')
  await choose(page, '背景：雨夜')
  await page.locator('canvas[data-running=true]').waitFor()
  assert.equal(await page.locator('canvas').evaluate((el) => el.width), 2160)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.waitForFunction(() => document.documentElement.dataset.effects === 'off')
  assert.equal(await page.locator('canvas').getAttribute('data-running'), 'false')
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('starlog:personal-settings')).appearance.effects), 'full')
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.locator('canvas[data-running=true]').waitFor()
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')) })
  assert.equal(await page.locator('canvas').getAttribute('data-running'), 'false')
  assert.equal(await rootValue(page, 'page-hidden'), 'true')
  await page.evaluate(() => { delete document.hidden; document.dispatchEvent(new Event('visibilitychange')) })
  await page.locator('canvas[data-running=true]').waitFor()
  await page.setViewportSize({ width: 375, height: 812 })
  await page.waitForFunction(() => document.querySelector('canvas').width === 375)
  await choose(page, '关闭')
  assert.equal(await page.locator('canvas').getAttribute('data-running'), 'false')
  await ready(page)
  assert.equal(await page.locator('.art-orbit').evaluate((el) => getComputedStyle(el).animationName), 'none')
})

test('system mode follows live OS changes; rapid cross-control changes keep the latest intent', options, async (t) => {
  const { page } = await setup(t)
  await ready(page, 'settings')
  await choose(page, '跟随系统')
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.waitForFunction(() => document.documentElement.classList.contains('dark'))
  await page.emulateMedia({ colorScheme: 'light' })
  await page.waitForFunction(() => !document.documentElement.classList.contains('dark'))
  // Exercise synchronous bursts while a View Transition update may still be pending.
  await page.evaluate(() => {
    document.querySelector('input[aria-label="樱落春日"]').click()
    document.querySelectorAll('input[name=color-mode]')[1].click()
    document.querySelectorAll('input[name=effects]')[2].click()
  })
  await page.waitForFunction(() => {
    const a = JSON.parse(localStorage.getItem('starlog:personal-settings')).appearance
    return a.palette === 'sakura' && a.mode === 'dark' && a.effects === 'full'
  })
  assert.equal(await rootValue(page, 'palette'), 'sakura')
})

test('legacy preferences survive; resetting appearance does not clear fonts, gradients or drafts', options, async (t) => {
  const { context, page } = await setup(t)
  await context.addInitScript(() => {
    if (localStorage.getItem('fixture')) return
    localStorage.setItem('fixture', '1')
    localStorage.setItem('starlog:theme', 'dark')
    localStorage.setItem('starlog:drafts', '[]')
    localStorage.setItem('starlog:personal-settings', JSON.stringify({ font: { families: [], sizePercent: 110, updatedAt: 1 }, background: { color: '#9AB0C0', intensity: 98, updatedAt: 1 }, animatedBackground: { scene: 'rain', values: { rain: { density: 23, lightning: 0 } } } }))
  })
  await ready(page, 'settings')
  assert.equal(await page.getByRole('radio', { name: '深色', exact: true }).isChecked(), true)
  assert.equal(await page.getByLabel('雨量', { exact: true }).inputValue(), '23')
  await choose(page, '关闭')
  await choose(page, '森林微光')
  await page.getByRole('button', { name: '重置主题与特效' }).click()
  await page.waitForFunction(() => document.documentElement.dataset.palette === 'classic')
  const saved = await page.evaluate(() => ({ preferences: JSON.parse(localStorage.getItem('starlog:personal-settings')), drafts: localStorage.getItem('starlog:drafts') }))
  assert.equal(saved.preferences.font.sizePercent, 110)
  assert.equal(saved.preferences.background.color, '#9AB0C0')
  assert.equal(saved.preferences.animatedBackground.scene, 'none')
  assert.equal(saved.drafts, '[]')
})

test('storage quota failure keeps appearance and scene controls usable for this visit', options, async (t) => {
  const { page } = await setup(t)
  await ready(page, 'settings')
  await page.evaluate(() => { Storage.prototype.setItem = () => { throw new DOMException('Full', 'QuotaExceededError') } })
  await choose(page, '关闭')
  await choose(page, '深海漫游')
  await choose(page, '背景：海波')
  await page.locator('canvas[data-scene=waves]').waitFor()
  assert.equal(await rootValue(page, 'palette'), 'ocean')
  assert.match(await page.locator('.appearance-footer').innerText(), /本次访问/)
})

test('home filtering, pagination, search, article rendering and public routes still work', options, async (t) => {
  const { page } = await setup(t)
  await ready(page)
  const before = await page.locator('.post-card').count()
  const more = page.getByRole('button', { name: /再读一些/ })
  if (await more.count()) { await more.click(); assert.ok(await page.locator('.post-card').count() > before) }
  const filters = page.locator('.filter-chip')
  if (await filters.count() > 1) {
    const label = (await filters.nth(1).innerText()).split('\n')[0].replace(/^#\s*/, '').trim()
    await filters.nth(1).click()
    for (const tags of await page.locator('.post-card-footer').allTextContents()) assert.ok(tags.includes(label))
    await filters.first().click()
  }
  await page.getByRole('button', { name: '搜索', exact: true }).first().click()
  const search = page.getByPlaceholder('搜索文章标题、标签或正文…')
  await search.fill('KaTeX')
  await page.getByRole('dialog').getByRole('button').first().click()
  await page.locator('.reading-surface .prose').first().waitFor()
  assert.ok(await page.locator('.reading-surface h1').innerText())
  await page.emulateMedia({ media: 'print' })
  assert.equal(await page.locator('.reading-surface h1').evaluate((el) => getComputedStyle(el).color), 'rgb(17, 17, 17)')
  assert.equal(await page.locator('.site-backdrop').evaluate((el) => getComputedStyle(el).display), 'none')
  await page.emulateMedia({ media: 'screen' })
  for (const route of ['archive', 'tags', 'about', 'login', 'editor']) {
    await ready(page, route)
    assert.ok((await page.locator('#main-content').innerText()).trim().length > 0, route)
  }
})

test('responsive home/settings and enlarged text have no page overflow; capture representative views', options, async (t) => {
  const { page } = await setup(t)
  await ready(page, 'settings')
  await choose(page, '极光幻境'); await choose(page, '深色')
  await page.getByRole('button', { name: '应用主题推荐场景' }).click()
  await ready(page)
  await snapshot(page, 'home-aurora-desktop.png')
  for (const width of [320, 375, 390, 640, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 950 })
    for (const route of ['', 'settings']) {
      await ready(page, route)
      await noOverflow(page)
    }
  }
  await page.setViewportSize({ width: 375, height: 812 })
  await choose(page, '樱落春日'); await choose(page, '浅色')
  await page.getByRole('button', { name: '应用主题推荐场景' }).click()
  const initialLabelSize = await page.locator('.theme-choice-name').first().evaluate((el) => parseFloat(getComputedStyle(el).fontSize))
  await page.getByLabel('全站字体大小', { exact: true }).press('End')
  assert.ok(await page.locator('.theme-choice-name').first().evaluate((el) => parseFloat(getComputedStyle(el).fontSize)) > initialLabelSize, 'New controls follow the global font size preference')
  for (const width of [320, 390, 640, 768, 1024]) {
    await page.setViewportSize({ width, height: 950 })
    for (const route of ['', 'settings']) { await ready(page, route); await noOverflow(page) }
  }
  await page.setViewportSize({ width: 375, height: 812 })
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }))
  await noOverflow(page)
  await snapshot(page, 'settings-sakura-mobile.png')
  await page.getByRole('link', { name: '回到首页' }).click()
  await page.locator('#home-title').waitFor()
  await noOverflow(page)
  await snapshot(page, 'home-sakura-mobile.png')
})


test('missing optional browser APIs and malformed stored preferences degrade to a readable page', options, async (t) => {
  const { context, page } = await setup(t)
  await context.addInitScript(() => {
    delete window.IntersectionObserver
    document.startViewTransition = undefined
    HTMLCanvasElement.prototype.getContext = () => null
    if (!localStorage.getItem('fixture')) {
      localStorage.setItem('fixture', '1')
      localStorage.setItem('starlog:personal-settings', '{broken')
      localStorage.setItem('starlog:theme', 'invalid')
    }
  })
  await ready(page, 'settings')
  assert.equal(await rootValue(page, 'palette'), 'classic')
  await choose(page, '森林微光')
  await choose(page, '背景：雨夜')
  await page.locator('canvas').waitFor()
  await ready(page)
  assert.equal(await rootValue(page, 'palette'), 'forest')
  assert.equal(await page.locator('.reveal').first().evaluate((el) => getComputedStyle(el).opacity), '1')
  assert.ok(await page.locator('.post-card').count() > 0)
})
