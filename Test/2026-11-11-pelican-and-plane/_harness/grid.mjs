// 用法: node grid.mjs <out.png> <cols> <w> <h> "cam:tod:t;..." [label]
// 在页面里渲染多张并拼成一张对照表（省得一张张看）
process.env.AWS_EXECUTION_ENV = 'AWS_Lambda_nodejs22.x'
process.env.FONTCONFIG_PATH = '/tmp/fonts'
const chromium = (await import('@sparticuz/chromium')).default
chromium.setGraphicsMode = true
const puppeteer = (await import('puppeteer-core')).default
const exe = await chromium.executablePath()
const args = chromium.args.filter((a) => a !== '--disable-web-security')
args.push('--allow-file-access-from-files', '--enable-unsafe-swiftshader')
const fs = await import('node:fs/promises')
const [out, cols, w, h, spec] = process.argv.slice(2)
const browser = await puppeteer.launch({ executablePath: exe, args, headless: 'shell', protocolTimeout: 900000, defaultViewport: { width: 900, height: 500 } })
const page = await browser.newPage()
const errs = []
page.on('pageerror', (e) => errs.push(e.message))
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()) })
await page.goto('file:///home/user/Blog/Test/2026-11-11-pelican-and-plane/plane-landing.html?ui=0&paused=1', { waitUntil: 'load' })
await page.waitForFunction('window.__ready === true', { timeout: 90000 })
await page.evaluate(() => { const f = document.getElementById('fade'); if (f) { f.style.transition = 'none'; f.style.opacity = '0' } })
const url = await page.evaluate(async (spec, cols, cw, ch) => {
  const P = window.__plane, R = P.R
  const items = spec.split(';').filter(Boolean).map((s) => s.split(':'))
  const n = items.length, C = Math.min(cols, n), Rw = Math.ceil(n / C)
  const c = document.createElement('canvas')
  c.width = C * cw; c.height = Rw * ch
  const g = c.getContext('2d')
  const tmp = document.createElement('canvas'); tmp.width = R.W; tmp.height = R.H
  const tx = tmp.getContext('2d')
  for (let i = 0; i < n; i++) {
    const [cam, tod, t] = items[i]
    P.setCam(cam); P.setTod(tod); P.renderAt(parseFloat(t))
    tx.clearRect(0, 0, R.W, R.H)
    tx.drawImage(R.canvas, 0, 0)
    const x0 = (i % C) * cw, y0 = Math.floor(i / C) * ch
    g.drawImage(tmp, 0, 0, R.W, R.H, x0, y0, cw, ch)
    g.fillStyle = 'rgba(0,0,0,.55)'
    g.fillRect(x0, y0, cw, 18)
    g.fillStyle = '#fff'
    g.font = '12px sans-serif'
    g.fillText(`${cam} ${tod} t=${t}`, x0 + 6, y0 + 13)
  }
  return c.toDataURL('image/png')
}, spec, +cols, +w, +h)
await fs.writeFile(out, Buffer.from(url.split(',')[1], 'base64'))
console.log('grid', out, 'errors:', errs.length, errs.slice(0, 4).join(' | '))
await browser.close()
