process.env.AWS_EXECUTION_ENV = 'AWS_Lambda_nodejs22.x'
process.env.FONTCONFIG_PATH = '/tmp/fonts'
const chromium = (await import('@sparticuz/chromium')).default
chromium.setGraphicsMode = true
const puppeteer = (await import('puppeteer-core')).default
const exe = await chromium.executablePath()
const args = chromium.args.filter((a) => a !== '--disable-web-security')
args.push('--allow-file-access-from-files', '--enable-unsafe-swiftshader')
const browser = await puppeteer.launch({ executablePath: exe, args, headless: 'shell', protocolTimeout: 900000, defaultViewport: { width: 900, height: 450 } })
const page = await browser.newPage()
const errs = []
page.on('pageerror', (e) => errs.push(e.message))
await page.goto('file:///home/user/Blog/Test/2026-11-11-pelican-and-plane/plane-landing.html?ui=0&tod=day', { waitUntil: 'load' })
await page.waitForFunction('window.__ready === true', { timeout: 60000 })
await page.evaluate(() => { const f = document.getElementById('fade'); if (f) { f.style.transition='none'; f.style.opacity='0' } window.__plane.R.ui.cam = 'debug'; window.__plane.R.env.bloom = 0 })
for (const ax of (process.argv[2] || 'side,front,top').split(',')) {
  await page.evaluate((a) => window.__plane.ortho(a, 1), ax)
  await new Promise((r) => setTimeout(r, 100))
  await page.screenshot({ path: `/tmp/ortho-${ax}.png` })
}
console.log('errors', errs.length)
await browser.close()
