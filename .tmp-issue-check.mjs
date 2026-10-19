import { readFileSync } from 'node:fs'
import { JSDOM, VirtualConsole } from 'jsdom'
const html = readFileSync('dist-offline/index.html', 'utf8')
const errors = []
const vc = new VirtualConsole()
vc.on('jsdomError', (e) => { const m = e.stack?.split('\n')[0] ?? e.message; if (!/scrollTo|Not implemented/.test(m)) errors.push('jsdomError: ' + m) })
vc.on('error', (...a) => { const m = a.join(' ').slice(0, 180); if (!/IndexedDB 不可用/.test(m)) errors.push('console.error: ' + m) })
let fakeScrollY = 0
const dom = new JSDOM(html, { url: 'file:///Users/t/starlog.html', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
  beforeParse(window) {
    const store = new Map()
    const make = () => ({ get length(){return store.size}, key:(i)=>[...store.keys()][i] ?? null, getItem:(k)=>store.has(String(k))?store.get(String(k)):null, setItem:(k,v)=>store.set(String(k),String(v)), removeItem:(k)=>store.delete(String(k)), clear:()=>store.clear() })
    Object.defineProperty(window,'localStorage',{value:make(),configurable:true})
    Object.defineProperty(window,'sessionStorage',{value:make(),configurable:true})
    Object.defineProperty(window,'scrollY',{configurable:true,get:()=>fakeScrollY})
    Object.defineProperty(window,'pageYOffset',{configurable:true,get:()=>fakeScrollY})
    window.__calls = []
    window.scrollTo = (o) => { const top = typeof o === 'object' && o ? (o.top ?? 0) : (arguments[1] ?? 0); window.__calls.push('scrollTo:' + top); fakeScrollY = top }
    window.HTMLElement.prototype.focus = new Proxy(window.HTMLElement.prototype.focus, {
      apply(t, thisArg, args) { window.__calls.push('focus:' + thisArg.tagName + ':' + JSON.stringify(args[0] ?? null)); return t.apply(thisArg, args) },
    })
    window.HTMLTextAreaElement.prototype.setSelectionRange = new Proxy(window.HTMLTextAreaElement.prototype.setSelectionRange, {
      apply(t, thisArg, args) { window.__calls.push('setSel:' + args[0] + '-' + args[1]); return t.apply(thisArg, args) },
    })
    window.scrollTo = (o) => { const top = typeof o === 'object' && o ? (o.top ?? 0) : (arguments[1] ?? 0); window.__calls.push('scrollTo:' + top); fakeScrollY = top }
    window.scrollTo = window.scrollTo
    window.ResizeObserver = class { observe(){} unobserve(){} disconnect(){} }
    window.IntersectionObserver = class { constructor(cb){this.cb=cb} observe(el){this.cb([{isIntersecting:true,target:el,timing:{}}],this)} unobserve(){} disconnect(){} takeRecords(){return[]} }
    window.matchMedia ??= (q) => ({ matches:false, media:q, addEventListener(){}, removeEventListener(){}, addListener(){}, removeListener(){}, onchange:null })
  } })
const { window } = dom
const doc = window.document
const wait = (ms) => new Promise(r => setTimeout(r, ms))
const setValue = (el, v) => {
  const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v)
  el.dispatchEvent(new window.Event('input', { bubbles: true }))
}
const pressKey = (el, key) => el.dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))

await wait(2600)
/* ───────── #71：页头随滚动渐变消失 ───────── */
const header = doc.querySelector('header.site-header')
console.log('① 页头存在:', header ? '✅' : '❌')
console.log('② 顶部时可见:', /-translate-y-full/.test(header.className) ? '❌ 一上来就隐藏' : '✅')
fakeScrollY = 500
window.dispatchEvent(new window.Event('scroll'))
await wait(160)
const cls = header.className
console.log('③ 滚到 500px 后:', /-translate-y-full/.test(cls) && /opacity-0/.test(cls) ? '✅ 已渐变消失' : '❌ ' + cls.slice(0, 120))
console.log('④ 隐藏时不可点/移出 Tab:', /pointer-events-none/.test(cls) && header.hasAttribute('inert') ? '✅ pointer-events-none + inert' : '❌ inert=' + header.getAttribute('inert'))
console.log('⑤ 过渡动画:', /transition-\[transform,opacity\]/.test(cls) ? '✅ 有渐变' : '❌ 无 transition')
fakeScrollY = 60
window.dispatchEvent(new window.Event('scroll'))
await wait(160)
console.log('⑥ 迟滞区间内保持隐藏:', /-translate-y-full/.test(header.className) ? '✅ 不闪' : '❌ 抖动（60px 处恢复了）')
fakeScrollY = 0
window.dispatchEvent(new window.Event('scroll'))
await wait(160)
console.log('⑦ 回到顶部后恢复:', /-translate-y-full/.test(header.className) ? '❌ 仍隐藏' : '✅ 重新出现')

/* ───────── #70：LaTeX 符号插入后不再跳到文末 ───────── */
window.location.hash = '#/editor'
await wait(1800)
const ta = doc.querySelector('textarea')
console.log('⑧ 编辑器 textarea:', ta ? '✅' : '❌')
setValue(ta, 'A'.repeat(400) + '\n结尾')
await wait(400)
ta.setSelectionRange(100, 100)
window.__calls.length = 0
const btn = [...doc.querySelectorAll('button')].find(b => /LaTeX 符号/.test(b.getAttribute('title') ?? ''))
console.log('⑨ 工具栏按钮:', btn ? '✅' : '❌')
btn.click()
await wait(300)
const pickerInput = [...doc.querySelectorAll('input')].find(i => /搜索|符号/.test(i.placeholder ?? ''))
console.log('⑩ 选择框搜索输入:', pickerInput ? '✅ placeholder=' + JSON.stringify(pickerInput.placeholder) : '❌')
setValue(pickerInput, 'pm')
await wait(300)
pressKey(pickerInput, 'Enter')
await wait(500)
console.log('⑪ 插入结果:', ta.value.includes('\\pm', 95) && ta.value.slice(98, 108).includes('\\pm') ? '✅ 落在光标处（index ' + ta.value.indexOf('\\pm') + '）' : '❌ 位置=' + ta.value.indexOf('\\pm') + ' / 长度=' + ta.value.length)
console.log('⑫ 光标位置:', ta.selectionStart, '| 文本长度:', ta.value.length, ta.selectionStart !== ta.value.length ? '✅ 未被挪到末尾' : '❌ 在末尾')
const seq = window.__calls.filter(c => /^(focus|setSel|scrollTo)/.test(c))
console.log('⑬ 调用序列:', seq.join('  →  '))
console.log('⑭ focus 带 preventScroll:', seq.some(c => c.startsWith('focus:TEXTAREA:{"preventScroll":true}')) ? '✅' : '❌')
console.log('⑮ 页面是否被滚走:', seq.some(c => c.startsWith('scrollTo:')) ? '❌ ' + seq.filter(c=>c.startsWith('scrollTo')).join(',') : '✅ 无 window 滚动')
console.log('--- errors ---'); console.log(errors.slice(0, 6).join('\n') || '(none)')
process.exit(0)
