import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { chromium } from 'playwright-core'

// Start the app first: npm run dev. No browser downloads are performed by this test.
const executablePath = process.env.BROWSER_EXECUTABLE_PATH
const baseURL = (process.env.TEST_BASE_URL || 'http://localhost:5173/').replace(
  /\/?$/,
  '/',
)
const options = {
  skip: !executablePath && 'Set BROWSER_EXECUTABLE_PATH to run browser tests.',
}
let browser
before(async () => {
  if (executablePath)
    browser = await chromium.launch({
      executablePath,
      headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    })
})
after(async () => {
  await browser?.close()
})
async function open(path = '') {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    colorScheme: 'light',
  })
  const page = await context.newPage()
  await page.goto(new URL(path, baseURL).href)
  await page.locator('.site-shell').waitFor()
  await page.waitForFunction(() => document.documentElement.dataset.design)
  return { context, page }
}
async function hasDesign(page, design) {
  await page.waitForFunction(
    (value) => document.documentElement.dataset.design === value,
    design,
  )
}

for (const [name, id] of [
  ['星野蓝', 'blue'],
  ['极光紫', 'aurora'],
  ['翡翠森', 'forest'],
  ['琥珀暮色', 'amber'],
  ['樱雾粉', 'rose'],
  ['石墨极简', 'graphite'],
]) {
  test(
    `Theme ${id}: palette, dark/light, reload persistence`,
    options,
    async () => {
      const { context, page } = await open('settings')
      try {
        await page.getByRole('button', { name, exact: true }).click()
        await hasDesign(page, id)
        assert.equal(
          await page
            .getByRole('button', { name, exact: true })
            .getAttribute('aria-pressed'),
          'true',
        )
        assert.match(
          await page.evaluate(() =>
            getComputedStyle(document.documentElement).getPropertyValue(
              '--brand-500',
            ),
          ),
          /\d+ \d+ \d+/,
        )
        await page.getByRole('button', { name: '深色', exact: true }).click()
        await page.waitForFunction(() =>
          document.documentElement.classList.contains('dark'),
        )
        const darkBase = await page
          .locator('body')
          .evaluate((el) => getComputedStyle(el).backgroundColor)
        await page.getByRole('button', { name: '浅色', exact: true }).click()
        await page.waitForFunction(
          () => !document.documentElement.classList.contains('dark'),
        )
        const lightBase = await page
          .locator('body')
          .evaluate((el) => getComputedStyle(el).backgroundColor)
        assert.notEqual(darkBase, lightBase)
        await page.reload()
        await hasDesign(page, id)
        await page.getByRole('button', { name, exact: true }).waitFor()
        assert.equal(
          await page
            .getByRole('button', { name, exact: true })
            .getAttribute('aria-pressed'),
          'true',
        )
      } finally {
        await context.close()
      }
    },
  )
}

test(
  'Effects: subtle/off persist, no hidden content, system reduced motion wins',
  options,
  async () => {
    const { context, page } = await open('settings')
    try {
      await page.getByRole('button', { name: '轻柔', exact: true }).click()
      await page.goto(baseURL)
      assert.equal(
        await page
          .locator('.magic-aurora')
          .evaluate((el) => getComputedStyle(el).animationName),
        'none',
      )
      await page.goto(new URL('settings', baseURL).href)
      await page.getByRole('button', { name: '关闭', exact: true }).click()
      await page.goto(baseURL)
      await page.locator('.magic-card').first().waitFor()
      assert.equal(
        await page
          .locator('.magic-card')
          .first()
          .evaluate((el) => getComputedStyle(el).animationName),
        'none',
      )
      assert.equal(
        await page
          .locator('.magic-card')
          .first()
          .evaluate((el) => getComputedStyle(el).opacity),
        '1',
      )
      await page.reload()
      assert.equal(
        await page.evaluate(() => document.documentElement.dataset.effects),
        'off',
      )
      await page.goto(new URL('settings', baseURL).href)
      await page.getByRole('button', { name: '完整', exact: true }).click()
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await page.goto(baseURL)
      assert.equal(
        await page
          .locator('.magic-aurora')
          .evaluate((el) => getComputedStyle(el).animationName),
        'none',
      )
      assert.equal(
        await page
          .locator('.magic-border-beam')
          .evaluate((el) => getComputedStyle(el).display),
        'none',
      )
    } finally {
      await context.close()
    }
  },
)

test(
  'Responsive: 320/390/768/1440 and 130% font, no horizontal overflow',
  options,
  async () => {
    const { context, page } = await open()
    try {
      for (const width of [320, 390, 768, 1440]) {
        await page.setViewportSize({ width, height: 900 })
        for (const size of ['100%', '130%']) {
          await page.evaluate(
            (value) =>
              document.documentElement.style.setProperty(
                '--site-font-size',
                value,
              ),
            size,
          )
          assert.equal(
            await page.evaluate(
              () => document.documentElement.scrollWidth > innerWidth,
            ),
            false,
            `overflow ${width}/${size}`,
          )
        }
      }
      await page.goto(new URL('settings', baseURL).href)
      for (const width of [320, 390, 768, 1440]) {
        await page.setViewportSize({ width, height: 900 })
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth > innerWidth,
          ),
          false,
          `settings overflow ${width}`,
        )
      }
    } finally {
      await context.close()
    }
  },
)

test(
  'Cross-tab sync and invalid saved appearance safely falls back',
  options,
  async () => {
    const { context, page } = await open()
    try {
      const second = await context.newPage()
      await second.goto(baseURL)
      await page.getByRole('button', { name: '樱雾粉', exact: true }).click()
      await hasDesign(second, 'rose')
      await page.evaluate(() => {
        const settings = JSON.parse(
          localStorage.getItem('starlog:personal-settings'),
        )
        settings.appearance = { design: '<invalid>', effects: 'invalid' }
        localStorage.setItem(
          'starlog:personal-settings',
          JSON.stringify(settings),
        )
      })
      await page.reload()
      await hasDesign(page, 'blue')
      assert.equal(
        await page.evaluate(() => document.documentElement.dataset.effects),
        'full',
      )
    } finally {
      await context.close()
    }
  },
)

test(
  'Custom background priority and scene tone preserve chosen palette',
  options,
  async () => {
    const { context, page } = await open()
    try {
      await page.evaluate(() =>
        localStorage.setItem(
          'starlog:personal-settings',
          JSON.stringify({
            appearance: { design: 'aurora', effects: 'full' },
            background: {
              color: '#123456',
              intensity: 100,
              updatedAt: Date.now(),
            },
            animatedBackground: { scene: 'stars', values: {} },
          }),
        ),
      )
      await page.reload()
      await hasDesign(page, 'aurora')
      await page.waitForFunction(() =>
        document.documentElement.classList.contains('dark'),
      )
      assert.equal(
        await page.evaluate(() =>
          document.documentElement.style.getPropertyValue(
            '--site-background-dark',
          ),
        ),
        'rgba(18, 52, 86, 1.000)',
      )
      await page.goto(new URL('settings', baseURL).href)
      await page.getByRole('button', { name: '樱雾粉', exact: true }).click()
      await hasDesign(page, 'rose')
      assert.equal(
        await page.evaluate(() =>
          document.documentElement.style.getPropertyValue(
            '--site-background-dark',
          ),
        ),
        'rgba(18, 52, 86, 1.000)',
      )
    } finally {
      await context.close()
    }
  },
)

test(
  'Search shortcut, card navigation, archive and keyboard theme controls',
  options,
  async () => {
    const { context, page } = await open()
    const errors = []
    page.on('pageerror', (e) => errors.push(e.message))
    try {
      const theme = page.getByRole('button', { name: '极光紫', exact: true })
      await theme.focus()
      await page.keyboard.press('Enter')
      await hasDesign(page, 'aurora')
      await page.keyboard.press('Control+k')
      await page.getByRole('dialog').waitFor()
      await page.waitForFunction(
        () => document.activeElement?.tagName === 'INPUT',
      )
      await page.keyboard.press('Escape')
      await page.getByRole('dialog').waitFor({ state: 'hidden' })
      await page.locator('.magic-card h2 a').first().click()
      await page.waitForURL(/\/posts\//)
      await page.locator('.prose').first().waitFor()
      await page.goto(new URL('archive', baseURL).href)
      await page.getByRole('heading', { name: /归档/ }).waitFor()
      assert.deepEqual(errors, [])
    } finally {
      await context.close()
    }
  },
)

test(
  'MagicCard tracks mouse locally and white-on-color buttons have readable contrast',
  options,
  async () => {
    const { context, page } = await open()
    try {
      const card = page.locator('.magic-card').first()
      await card.scrollIntoViewIfNeeded()
      await card.hover()
      await page.waitForFunction(() =>
        document
          .querySelector('.magic-card')
          .style.getPropertyValue('--mouse-x'),
      )
      assert.match(
        await card.evaluate((el) => el.style.getPropertyValue('--mouse-x')),
        /px$/,
      )
      for (const name of [
        '星野蓝',
        '极光紫',
        '翡翠森',
        '琥珀暮色',
        '樱雾粉',
        '石墨极简',
      ]) {
        await page.getByRole('button', { name, exact: true }).click()
        const contrast = await page
          .locator('.shimmer-button')
          .evaluate((el) => {
            const style = getComputedStyle(el)
            function luminance(rgb) {
              const values = rgb
                .match(/[\d.]+/g)
                .slice(0, 3)
                .map(Number)
                .map((v) => {
                  v /= 255
                  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
                })
              return (
                values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722
              )
            }
            const colors = style.backgroundImage.match(/rgb\([^)]+\)/g)
            return Math.min(...colors.map((c) => 1.05 / (luminance(c) + 0.05)))
          })
        assert.ok(contrast >= 4.5, `${name} button contrast ${contrast}`)
      }
    } finally {
      await context.close()
    }
  },
)
