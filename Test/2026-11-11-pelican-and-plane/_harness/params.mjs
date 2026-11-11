process.env.AWS_EXECUTION_ENV = 'AWS_Lambda_nodejs22.x'
process.env.FONTCONFIG_PATH = '/tmp/fonts'
const chromium = (await import('@sparticuz/chromium')).default
chromium.setGraphicsMode = true
const puppeteer = (await import('puppeteer-core')).default
const exe = await chromium.executablePath()
const args = chromium.args.filter((a) => a !== '--disable-web-security')
args.push('--allow-file-access-from-files', '--enable-unsafe-swiftshader')
const browser = await puppeteer.launch({ executablePath: exe, args, headless: 'shell', protocolTimeout: 900000, defaultViewport: { width: 900, height: 500 } })
const cases = [
  '?t=12&cam=spot&tod=day',
  '?t=24&cam=chase&tod=night&speed=2&paused=1',
  '?t=30&cam=nose&tod=dusk&ui=0',
  '?cam=orbit&tod=day&q=0.5',
  '?t=99&cam=bogus&tod=nope',
]
for (const c of cases) {
  const page = await browser.newPage()
  const errs = []
  page.on('pageerror', (e) => errs.push('PE ' + e.message))
  page.on('console', (m) => { if (m.type() === 'error') errs.push('C ' + m.text()) })
  await page.goto('file:///home/user/Blog/Test/2026-11-11-pelican-and-plane/plane-landing.html' + c, { waitUntil: 'load' })
  await page.waitForFunction('window.__ready === true', { timeout: 60000 })
  await new Promise((r) => setTimeout(r, 700))
  const st = await page.evaluate(() => ({ t: +window.__plane.R.time.toFixed(2), cam: window.__plane.R.ui.cam, tod: window.__plane.R.ui.tod, paused: window.__plane.R.ui.paused, speed: window.__plane.R.ui.speed, q: window.__plane.R.ui.q }))
  const uiHidden = await page.evaluate(() => document.body.classList.contains('ui-hidden'))
  console.log(c, '->', JSON.stringify(st), 'uiHidden', uiHidden, 'err', errs.length, errs[0] || '')
  await page.close()
}
await browser.close()
