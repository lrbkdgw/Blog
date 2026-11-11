process.env.AWS_EXECUTION_ENV = 'AWS_Lambda_nodejs22.x'
process.env.FONTCONFIG_PATH = '/tmp/fonts'
const chromium = (await import('@sparticuz/chromium')).default
chromium.setGraphicsMode = true
const puppeteer = (await import('puppeteer-core')).default
const exe = await chromium.executablePath()
const args = chromium.args.filter((a) => a !== '--disable-web-security')
args.push('--allow-file-access-from-files', '--enable-unsafe-swiftshader')
const [w, h, out, tod, t, cam] = process.argv.slice(2)
const browser = await puppeteer.launch({ executablePath: exe, args, headless: 'shell', protocolTimeout: 900000, defaultViewport: { width: +w, height: +h } })
const page = await browser.newPage()
const errs = []
page.on('pageerror', (e) => errs.push(e.message))
await page.goto('file:///home/user/Blog/Test/2026-11-11-pelican-and-plane/plane-landing.html?ui=1', { waitUntil: 'load' })
await page.waitForFunction('window.__ready === true', { timeout: 90000 })
await page.evaluate((tod, t, cam) => {
  const f = document.getElementById('fade'); f.style.transition = 'none'; f.style.opacity = '0'
  window.__plane.setTod(tod); window.__plane.setCam(cam); window.__plane.renderAt(+t)
}, tod || 'dusk', t || '18', cam || 'auto')
await new Promise((r) => setTimeout(r, 500))
await page.screenshot({ path: out })
console.log('shot', out, 'errors', errs.length, errs.slice(0, 2).join(' | '))
await browser.close()
