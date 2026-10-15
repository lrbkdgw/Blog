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
  await page.evaluate(async () => { await document.fonts.ready })
  await page.waitForFunction(() => [...document.querySelectorAll('.reveal')].filter((el) => {
    const rect = el.getBoundingClientRect()
    return rect.top < innerHeight - 24 && rect.bottom > 0
  }).every((el) => getComputedStyle(el).opacity === '1'))
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
  assert.equal(await page.locator('.magic-border-beam-trace').count(), 0)
  assert.equal(await page.locator('[data-magic-ui="border-beam"]').getAttribute('data-animating'), 'false')
  assert.equal(await page.locator('[data-magic-ui="blur-fade"]').first().getAttribute('data-motion-enabled'), 'false')
  assert.ok(await page.locator('.post-card').count() > 0)
})

test('Magic UI is mounted in real pages; shimmer links and buttons preserve keyboard navigation and semantics', options, async (t) => {
  const { page } = await setup(t)
  await ready(page)
  await page.locator('#home-title').waitFor()
  const kinds = new Set(await page.locator('[data-magic-ui]').evaluateAll((els) => els.map((el) => el.dataset.magicUi)))
  for (const kind of ['magic-card', 'blur-fade', 'border-beam', 'aurora-text', 'shimmer-button']) assert.ok(kinds.has(kind), kind)
  assert.equal(await page.locator('[data-magic-ui="magic-card"]').first().getAttribute('data-interactive'), 'false', 'Default subtle mode has no pointer tracking')
  assert.equal(await page.locator('.post-card article').count(), await page.locator('.post-card').count())
  assert.equal(await page.locator('.magic-shimmer button, .magic-shimmer a').count(), 0, 'No nested interactive controls')
  const read = page.getByRole('link', { name: '开始阅读', exact: true })
  assert.equal(await read.evaluate((el) => el.tagName), 'A')
  assert.equal(new URL(await read.getAttribute('href'), base).pathname.replace(/\/$/, ''), new URL(base).pathname.replace(/\/$/, ''))
  await read.focus()
  assert.ok(await read.evaluate((el) => parseFloat(getComputedStyle(el).outlineWidth)) >= 2)
  await read.press('Enter')
  await page.waitForURL((url) => url.hash === '#posts')
  await page.waitForFunction(() => document.getElementById('posts').getBoundingClientRect().top < 200)
  const before = await page.locator('.post-card').count()
  const more = page.getByRole('button', { name: /再读一些/ })
  if (await more.count()) {
    assert.equal(await more.getAttribute('data-magic-ui'), 'shimmer-button')
    assert.equal(await more.getAttribute('type'), 'button')
    await more.focus()
    await more.press('Space')
    assert.ok(await page.locator('.post-card').count() > before)
  }
  const title = page.locator('.post-title a').first()
  await title.focus()
  assert.equal(await page.locator('.reveal').first().evaluate((el) => getComputedStyle(el).opacity), '1')
  assert.equal(await page.locator('.reveal').first().evaluate((el) => getComputedStyle(el).filter), 'none')
  await title.press('Enter')
  await page.locator('.reading-surface h1').waitFor()
  assert.ok(new URL(page.url()).pathname.includes('/posts/'))
  const license = await page.request.get(new URL('licenses/magic-ui-MIT.txt', base).href)
  assert.equal(license.status(), 200)
  assert.match(await license.text(), /Copyright \(c\) Magic UI/)
})

test('Magic Card responds only in full desktop mode and switches all palettes without hook-order errors', options, async (t) => {
  const { page } = await setup(t)
  await ready(page, 'settings')
  await choose(page, '完整'); await choose(page, '深色')
  await ready(page)
  const card = page.locator('[data-magic-ui="magic-card"]').first()
  await card.waitFor()
  for (const [id, name] of palettes) {
    await page.getByRole('button', { name: `切换主题：${name}`, exact: true }).click()
    await page.waitForFunction((palette) => document.documentElement.dataset.palette === palette, id)
    assert.equal(await card.getAttribute('data-interactive'), 'true')
    assert.equal(await card.getAttribute('data-mode'), ['aurora', 'neon'].includes(id) ? 'orb' : 'gradient')
    const before = await card.getAttribute('style')
    await card.hover({ position: { x: 120, y: 85 } })
    await page.waitForFunction((element) => !element.style.background.includes('at -320px -320px'), await card.elementHandle())
    assert.notEqual(await card.getAttribute('style'), before)
    const radius = await card.evaluate((el) => ({ actual: parseFloat(getComputedStyle(el).borderRadius), expected: parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--card-radius')) }))
    assert.equal(radius.actual, radius.expected)
    if (['aurora', 'neon'].includes(id)) await page.waitForFunction((element) => Number(getComputedStyle(element.querySelector('.magic-card-orb')).opacity) > 0.01, await card.elementHandle())
  }
  await page.getByRole('button', { name: '切换主题：霓虹夜航', exact: true }).click()
  await card.hover({ position: { x: 220, y: 100 } })
  await page.waitForFunction((element) => Number(getComputedStyle(element.querySelector('.magic-card-orb')).opacity) > 0.1, await card.elementHandle())
  await snapshot(page, 'magic-card-neon-desktop.png')
})

async function assertMagicMotionStopped(page, reason) {
  const sample = await page.evaluate(async () => {
    // Allow the final render/cleanup frame, then measure with timers, not rAF polling.
    await new Promise((resolve) => setTimeout(resolve, 120))
    const startFrames = window.__magicAnimationFrames
    const styles = [...document.querySelectorAll('[data-magic-ui]')].map((el) => el.getAttribute('style'))
    await new Promise((resolve) => setTimeout(resolve, 220))
    const middleFrames = window.__magicAnimationFrames
    await new Promise((resolve) => setTimeout(resolve, 220))
    return {
      frames: [middleFrames - startFrames, window.__magicAnimationFrames - middleFrames],
      running: document.getAnimations().filter((animation) => animation.playState === 'running').length,
      beam: document.querySelectorAll('.magic-border-beam-trace').length,
      unchanged: JSON.stringify(styles) === JSON.stringify([...document.querySelectorAll('[data-magic-ui]')].map((el) => el.getAttribute('style'))),
    }
  })
  // Media-query layout changes can queue a final cleanup frame, but never a continuing frame loop.
  assert.ok(sample.frames[0] <= 2, `${reason}: continuing animation frames ${sample.frames}`)
  assert.equal(sample.frames[1], 0, `${reason}: animation did not settle`)
  assert.deepEqual({ running: sample.running, beam: sample.beam, unchanged: sample.unchanged }, { running: 0, beam: 0, unchanged: true }, reason)
  assert.equal(await page.locator('[data-magic-ui][data-animating="true"], [data-magic-ui="magic-card"][data-interactive="true"]').count(), 0, reason)
}

test('Magic UI stops real CSS, Motion and spring animation for hidden pages, reduced motion, print and live off', options, async (t) => {
  // Keep both the hero and the whole first card in view; hover must not scroll the beam out of view.
  const { context, page } = await setup(t, { viewport: { width: 1440, height: 1200 } })
  await context.addInitScript(() => {
    const raf = window.requestAnimationFrame.bind(window)
    window.__magicAnimationFrames = 0
    window.requestAnimationFrame = (callback) => raf((time) => { window.__magicAnimationFrames += 1; callback(time) })
  })
  await ready(page, 'settings')
  await choose(page, '完整'); await choose(page, '霓虹夜航')
  await ready(page)
  const card = page.locator('[data-magic-ui="magic-card"]').first()
  const resume = async () => {
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }))
    await page.mouse.move(10, 300)
    // Raw mouse input avoids Playwright's hover scroll retries moving the hero offscreen.
    const bounds = await card.boundingBox()
    assert.ok(bounds && bounds.y + 70 < 1200 && bounds.y > 0)
    await page.mouse.move(bounds.x + 120, bounds.y + 70)
    await page.waitForFunction((element) => Number(getComputedStyle(element.querySelector('.magic-card-orb')).opacity) > 0.03, await card.elementHandle())
    try {
      await page.locator('[data-magic-ui="border-beam"][data-animating="true"]').waitFor({ timeout: 3000 })
    } catch (error) {
      const details = await page.evaluate(() => {
        const beam = document.querySelector('[data-magic-ui="border-beam"]')
        return { beam: beam.outerHTML, rect: beam.getBoundingClientRect().toJSON(), card: document.querySelector('.post-card').getBoundingClientRect().toJSON(), viewport: [innerWidth, innerHeight], display: getComputedStyle(beam).display, visibility: getComputedStyle(beam).visibility, hidden: document.hidden, state: document.visibilityState, scroll: scrollY, effects: document.documentElement.dataset.effects, printing: matchMedia('print').matches, observer: typeof IntersectionObserver }
      })
      throw new Error(`Beam did not resume: ${JSON.stringify(details)}`, { cause: error })
    }
  }
  await resume()
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')) })
  await assertMagicMotionStopped(page, 'Hidden page')
  await page.evaluate(() => { delete document.hidden; document.dispatchEvent(new Event('visibilitychange')) })
  await resume()
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.waitForFunction(() => document.documentElement.dataset.effects === 'off')
  await assertMagicMotionStopped(page, 'OS reduced motion')
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('starlog:personal-settings')).appearance.effects), 'full')
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await resume()
  await page.emulateMedia({ media: 'print' })
  await assertMagicMotionStopped(page, 'Printing')
  assert.equal(await page.locator('.magic-aurora-text').evaluate((el) => getComputedStyle(el).webkitTextFillColor), 'rgb(17, 17, 17)')
  await page.emulateMedia({ media: 'screen' })
  await resume()
  // Exercise live preference sync without unmounting an actively hovered Magic Card.
  await page.evaluate(() => {
    const key = 'starlog:personal-settings'
    const settings = JSON.parse(localStorage.getItem(key))
    settings.appearance.effects = 'off'
    localStorage.setItem(key, JSON.stringify(settings))
    window.dispatchEvent(new StorageEvent('storage', { key }))
  })
  await page.waitForFunction(() => document.documentElement.dataset.effects === 'off')
  await assertMagicMotionStopped(page, 'User effects off')
  for (const opacity of await page.locator('.reveal').evaluateAll((els) => els.map((el) => getComputedStyle(el).opacity))) assert.equal(opacity, '1')
})

test('Border Beam moves along a real CSS path, unmounts offscreen and resumes on return', options, async (t) => {
  const { page } = await setup(t)
  await ready(page)
  const beam = page.locator('.magic-border-beam-trace')
  await beam.waitFor()
  const motion = await beam.evaluate(async (el) => {
    const before = getComputedStyle(el).offsetDistance
    await new Promise((resolve) => setTimeout(resolve, 180))
    return { before, after: getComputedStyle(el).offsetDistance, path: getComputedStyle(el).offsetPath }
  })
  assert.notEqual(motion.path, 'none')
  assert.notEqual(motion.after, motion.before)
  await page.evaluate(() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'instant' }))
  await page.waitForFunction(() => document.querySelector('[data-magic-ui="border-beam"]').dataset.animating === 'false')
  assert.equal(await beam.count(), 0)
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }))
  await beam.waitFor()
})

test('Shine Border decorates only the selected native theme radio and respects keyboard focus and effects off', options, async (t) => {
  const { page } = await setup(t)
  await ready(page, 'settings')
  const border = page.locator('[data-magic-ui="shine-border"]')
  assert.equal(await border.count(), 1)
  assert.equal(await border.evaluate((el) => el.closest('label').querySelector('input').value), 'classic')
  assert.equal(await border.evaluate((el) => getComputedStyle(el).pointerEvents), 'none')
  assert.equal(await border.evaluate((el) => getComputedStyle(el).animationName), 'magic-shine')
  await page.getByRole('radio', { name: '星野经典', exact: true }).focus()
  await page.keyboard.press('ArrowRight')
  await page.waitForFunction(() => document.documentElement.dataset.palette === 'aurora')
  assert.equal(await border.count(), 1)
  assert.equal(await border.evaluate((el) => el.closest('label').querySelector('input').value), 'aurora')
  assert.ok(await page.locator('input[name="palette"]:checked + .theme-option-content').evaluate((el) => parseFloat(getComputedStyle(el).outlineWidth)) >= 2)
  await choose(page, '关闭')
  assert.equal(await border.getAttribute('data-animating'), 'false')
  assert.equal(await border.evaluate((el) => getComputedStyle(el).animationName), 'none')
})

test('Touch devices never enable Magic Card pointer tracking; forced colors keep the gradient title and CTA readable', options, async (t) => {
  const { page } = await setup(t, { viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true })
  await ready(page, 'settings')
  await choose(page, '完整')
  await ready(page)
  const card = page.locator('[data-magic-ui="magic-card"]').first()
  await card.waitFor()
  assert.equal(await card.getAttribute('data-interactive'), 'false')
  const style = await card.getAttribute('style')
  await card.dispatchEvent('pointermove', { pointerType: 'mouse', clientX: 100, clientY: 200 })
  await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 60)))
  assert.equal(await card.getAttribute('style'), style)
  await noOverflow(page)
  await page.emulateMedia({ forcedColors: 'active' })
  assert.equal(await page.locator('.magic-aurora-text').evaluate((el) => getComputedStyle(el).backgroundImage), 'none')
  assert.notEqual(await page.locator('.magic-aurora-text').evaluate((el) => getComputedStyle(el).webkitTextFillColor), 'rgba(0, 0, 0, 0)')
  assert.equal(await page.locator('.hero-read .magic-shimmer-spark-container').evaluate((el) => getComputedStyle(el).display), 'none')
  assert.ok(await page.getByRole('link', { name: '开始阅读', exact: true }).isVisible())
})
