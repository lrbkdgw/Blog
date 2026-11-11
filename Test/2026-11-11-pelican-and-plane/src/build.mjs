import { readFileSync, writeFileSync } from 'node:fs'
const dir = new URL('./', import.meta.url)
const order = ['00-head.html', '10-util.js', '20-geom.js', '30-plane.js', '40-airport.js', '50-shaders.js', '51-paint.js', '60-flight.js', '70-camera.js', '75-state.js', '80-render.js', '85-ui.js', '99-tail.html']
let s = ''
for (const f of order) {
  if (f === '10-util.js') s += "<script>\n'use strict';\n(() => {\n"
  if (f === '00-head.html') {
    // 内嵌的中文子集字体必须放进 <style> 里，否则会被浏览器丢掉
    const head = readFileSync(new URL(f, dir), 'utf8')
    const fonts = readFileSync(new URL('05-fonts.css', dir), 'utf8')
    s += head.replace('</style>', fonts + '</style>')
    continue
  }
  s += readFileSync(new URL(f, dir), 'utf8')
}
// 段与段之间补一个换行，保证不会粘在一起

const out = new URL('../plane-landing.html', import.meta.url)
writeFileSync(out, s)
const i = s.indexOf('<script>')
const j = s.indexOf('</script>')
writeFileSync(new URL('./_check.js', import.meta.url), s.slice(i + 8, j))
console.log('wrote', out.pathname, (s.length/1024).toFixed(1)+' KB')
