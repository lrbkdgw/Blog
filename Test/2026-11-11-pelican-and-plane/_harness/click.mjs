process.env.AWS_EXECUTION_ENV = 'AWS_Lambda_nodejs22.x'
process.env.FONTCONFIG_PATH = '/tmp/fonts'
const chromium = (await import('@sparticuz/chromium')).default
chromium.setGraphicsMode = true
const puppeteer = (await import('puppeteer-core')).default
const exe = await chromium.executablePath()
const args = chromium.args.filter((a) => a !== '--disable-web-security')
args.push('--allow-file-access-from-files', '--enable-unsafe-swiftshader')
const browser = await puppeteer.launch({ executablePath: exe, args, headless: 'shell', protocolTimeout: 900000, defaultViewport: { width: 1280, height: 720 } })
const page = await browser.newPage()
const errs = []
page.on('pageerror', (e) => errs.push(e.message))
page.on('console', (m) => { if (m.type() === 'error') errs.push('C:' + m.text()) })
await page.goto('file:///home/user/Blog/Test/2026-11-11-pelican-and-plane/plane-landing.html', { waitUntil: 'load' })
await page.waitForFunction('window.__ready === true', { timeout: 60000 })
const clickText = async (sel, text) => {
  const ok = await page.evaluate((s, t) => {
    const el = [...document.querySelectorAll(s)].find((e) => e.textContent.trim() === t)
    if (!el) return false
    el.click(); return true
  }, sel, text)
  console.log('click', text, ok)
}
await clickText('.seg button', '伴飞')
await clickText('.seg button', '白天')
await page.evaluate(() => window.__plane.renderAt(9))
await page.screenshot({ path: '/tmp/ui-1.png' })
await clickText('.seg button', '跑道边')
await clickText('.seg button', '夜晚')
await page.evaluate(() => window.__plane.renderAt(24))
await page.screenshot({ path: '/tmp/ui-2.png' })
await clickText('.seg button', '导播')
await clickText('.seg button', '黄昏')
await page.evaluate(() => window.__plane.renderAt(30))
await page.screenshot({ path: '/tmp/ui-3.png' })
// 拖动时间轴
await page.evaluate(() => { const s = document.getElementById('seek'); s.value = '800'; s.dispatchEvent(new Event('input', { bubbles: true })) })
await new Promise((r) => setTimeout(r, 300))
const time = await page.evaluate(() => window.__plane.R.time)
console.log('seek ->', time.toFixed(2))
await page.screenshot({ path: '/tmp/ui-4.png' })
console.log('errors', errs.length, errs.slice(0, 5).join(' | '))
await browser.close()
