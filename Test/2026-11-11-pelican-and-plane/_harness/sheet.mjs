// 无头浏览器截图：把若干机位/天色/时刻渲染成 PNG，并收集控制台错误。
// 用法：node sheet.mjs <html> <outDir> "cam:tod:t1,t2;cam:tod:t" [w] [h]
process.env.AWS_EXECUTION_ENV = 'AWS_Lambda_nodejs22.x'
process.env.FONTCONFIG_PATH = '/tmp/fonts'
const chromium = (await import('@sparticuz/chromium')).default
chromium.setGraphicsMode = true
const puppeteer = (await import('puppeteer-core')).default
const [,, file, outDir, spec, wArg, hArg] = process.argv
const W = parseInt(wArg || '960', 10), H = parseInt(hArg || '540', 10)
const exe = await chromium.executablePath()
const args = chromium.args.filter((a) => a !== '--disable-web-security')
args.push('--allow-file-access-from-files', '--enable-unsafe-swiftshader')
const browser = await puppeteer.launch({ executablePath: exe, args, headless: 'shell', protocolTimeout: 900000,
  defaultViewport: { width: W, height: H, deviceScaleFactor: 1 } })
const page = await browser.newPage()
const errs = []
page.on('console', (m) => { if (m.type() === 'error') errs.push(`[${m.type()}] ${m.text()}`) })
page.on('pageerror', (e) => errs.push('[pageerror] ' + e.message + '\n' + (e.stack || '').split('\n').slice(0, 4).join('\n')))
await page.goto('file://' + file + '?ui=0', { waitUntil: 'load', timeout: 90000 })
try { await page.waitForFunction('window.__ready === true', { timeout: 60000 }) }
catch (e) { console.log('WAIT FAILED'); console.log(errs.join('\n')); await browser.close(); process.exit(1) }
// 关掉开场淡入的黑场（截图时不等 CSS 过渡）
await page.evaluate(() => {
  const f = document.getElementById('fade')
  if (f) { f.style.transition = 'none'; f.style.opacity = '0' }
})
console.log('INFO', JSON.stringify(await page.evaluate(() => window.__plane.info)))
for (const group of spec.split(';')) {
  const [cam, tod, times] = group.split(':')
  if (!cam) continue
  await page.evaluate((c, td) => {
    const P = window.__plane
    if (td && td !== 'same') P.setTod(td)
    P.setCam(c)
  }, cam, tod)
  for (const t of times.split(',').map(Number)) {
    await page.evaluate((tt) => window.__plane.renderAt(tt), t)
    await new Promise((r) => setTimeout(r, 90))
    const p = `${outDir}/${cam}-${tod}-${t}.png`
    await page.screenshot({ path: p })
    console.log('shot', p)
  }
}
console.log('errors:', errs.length)
if (errs.length) console.log(errs.slice(0, 8).join('\n'))
await browser.close()
