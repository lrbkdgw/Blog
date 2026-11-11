process.env.AWS_EXECUTION_ENV = 'AWS_Lambda_nodejs22.x'
process.env.FONTCONFIG_PATH = '/tmp/fonts'
const chromium = (await import('@sparticuz/chromium')).default
chromium.setGraphicsMode = true
const puppeteer = (await import('puppeteer-core')).default
const exe = await chromium.executablePath()
const args = chromium.args.filter((a) => a !== '--disable-web-security')
args.push('--allow-file-access-from-files', '--enable-unsafe-swiftshader')
const [w, h, out, t] = process.argv.slice(2)
const browser = await puppeteer.launch({ executablePath: exe, args, headless: 'shell', protocolTimeout: 900000, defaultViewport: { width: +w, height: +h } })
const page = await browser.newPage()
const errs = []
page.on('pageerror', (e) => errs.push(e.message))
await page.goto('file:///home/user/Blog/Test/2026-11-11-pelican-and-plane/pelican-bicycle.svg', { waitUntil: 'load' })
await new Promise((r) => setTimeout(r, 300 + (+(t || 0)) * 1000))
await page.screenshot({ path: out })
console.log('shot', out, 'errors', errs.length)
await browser.close()
