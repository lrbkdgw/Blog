// 真实播放（不暂停），看首帧淡入和自动播放
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
page.on('pageerror', (e) => errs.push('PE ' + e.message))
page.on('console', (m) => { if (m.type() === 'error') errs.push('C ' + m.text()) })
const t0 = Date.now()
await page.goto('file:///home/user/Blog/Test/2026-11-11-pelican-and-plane/plane-landing.html', { waitUntil: 'load' })
await page.waitForFunction('window.__ready === true', { timeout: 90000 })
console.log('ready in', Date.now() - t0, 'ms')
await new Promise((r) => setTimeout(r, 400))
await page.screenshot({ path: '/tmp/live1.png' })
await new Promise((r) => setTimeout(r, 6000))
await page.screenshot({ path: '/tmp/live2.png' })
const st = await page.evaluate(() => ({ t: window.__plane.R.time, frames: window.__plane.R.frames, paused: window.__plane.R.ui.paused, fps: window.__plane.R.fps }))
console.log(JSON.stringify(st), 'errors:', errs.length, errs.slice(0, 3).join(' | '))
await browser.close()
