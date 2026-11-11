// 渲染后裁一块区域放大，用来看细节
process.env.AWS_EXECUTION_ENV = 'AWS_Lambda_nodejs22.x'
process.env.FONTCONFIG_PATH = '/tmp/fonts'
const chromium = (await import('@sparticuz/chromium')).default
chromium.setGraphicsMode = true
const puppeteer = (await import('puppeteer-core')).default
const exe = await chromium.executablePath()
const args = chromium.args.filter((a) => a !== '--disable-web-security')
args.push('--allow-file-access-from-files', '--enable-unsafe-swiftshader')
const fs = await import('node:fs/promises')
const [cam, tod, t, x, y, w, h, out, scale] = process.argv.slice(2)
const browser = await puppeteer.launch({ executablePath: exe, args, headless: 'shell', protocolTimeout: 900000, defaultViewport: { width: 1400, height: 800 } })
const page = await browser.newPage()
page.on('pageerror', (e) => console.log('PE', e.message))
await page.goto('file:///home/user/Blog/Test/2026-11-11-pelican-and-plane/plane-landing.html?ui=0&paused=1', { waitUntil: 'load' })
await page.waitForFunction('window.__ready === true', { timeout: 60000 })
await page.evaluate(() => { const f = document.getElementById('fade'); if (f) { f.style.transition = 'none'; f.style.opacity = '0' } })
const url = await page.evaluate((cam, tod, t, x, y, w, h, scale) => {
  const P = window.__plane, R = P.R
  P.setCam(cam); P.setTod(tod); P.renderAt(parseFloat(t))
  const c = document.createElement('canvas'); c.width = w * scale; c.height = h * scale
  const g = c.getContext('2d'); g.imageSmoothingEnabled = false
  g.drawImage(R.canvas, -x * scale, -y * scale, R.W * scale, R.H * scale)
  return c.toDataURL('image/png')
}, cam, tod, t, +x, +y, +w, +h, +(scale || 2))
await fs.writeFile(out, Buffer.from(url.split(',')[1], 'base64'))
console.log('ok', out)
await browser.close()
