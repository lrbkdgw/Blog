// 采样指定相机/时间下的若干像素，用来标定颜色
process.env.AWS_EXECUTION_ENV = 'AWS_Lambda_nodejs22.x'
process.env.FONTCONFIG_PATH = '/tmp/fonts'
const chromium = (await import('@sparticuz/chromium')).default
chromium.setGraphicsMode = true
const puppeteer = (await import('puppeteer-core')).default
const exe = await chromium.executablePath()
const args = chromium.args.filter((a) => a !== '--disable-web-security')
args.push('--allow-file-access-from-files', '--enable-unsafe-swiftshader')
const browser = await puppeteer.launch({ executablePath: exe, args, headless: 'shell', protocolTimeout: 900000, defaultViewport: { width: 1100, height: 620 } })
const page = await browser.newPage()
page.on('pageerror', (e) => console.log('PE', e.message))
await page.goto('file:///home/user/Blog/Test/2026-11-11-pelican-and-plane/plane-landing.html?ui=0&paused=1', { waitUntil: 'load' })
await page.waitForFunction('window.__ready === true', { timeout: 60000 })
await page.evaluate(() => { const f = document.getElementById('fade'); if (f) { f.style.transition = 'none'; f.style.opacity = '0' } })
const spec = process.argv[2] || 'orbit:day:9.5'
const pts = JSON.parse(process.argv[3] || '[]')
const out = await page.evaluate((spec, pts) => {
  const [cam, tod, t] = spec.split(':')
  const P = window.__plane, R = P.R
  P.setCam(cam); P.setTod(tod); P.renderAt(parseFloat(t))
  const c = document.createElement('canvas'); c.width = R.W; c.height = R.H
  const x = c.getContext('2d'); x.drawImage(R.canvas, 0, 0)
  const d = x.getImageData(0, 0, R.W, R.H).data
  const at = (px, py) => Array.from(d.slice((py * R.W + px) * 4, (py * R.W + px) * 4 + 3))
  const o = { size: [R.W, R.H] }
  for (const [px, py, name] of pts) o[name] = at(px, py)
  return o
}, spec, pts)
console.log(JSON.stringify(out))
await browser.close()
