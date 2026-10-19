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
    window.__calls = []
    window.scrollTo = (o) => { const top = typeof o === 'object' && o ? (o.top ?? 0) : (arguments[1] ?? 0); window.__calls.push('scrollTo:' + top); fakeScrollY = top }
    window.HTMLElement.prototype.focus = new Proxy(window.HTMLElement.prototype.focus, {
      apply(t, thisArg, args) { window.__calls.push('focus:' + thisArg.className.split(' ')[0] + ':' + JSON.stringify(args[0] ?? null)); return t.apply(thisArg, args) } })
    window.HTMLTextAreaElement.prototype.setSelectionRange = new Proxy(window.HTMLTextAreaElement.prototype.setSelectionRange, {
      apply(t, thisArg, args) { window.__calls.push('setSel:' + (thisArg.className.includes('editor-textarea') ? 'editor:' : '') + args[0] + '-' + args[1]); return t.apply(thisArg, args) } })
    window.ResizeObserver = class { observe(){} unobserve(){} disconnect(){} }
    window.IntersectionObserver = class { constructor(cb){this.cb=cb} observe(el){this.cb([{isIntersecting:true,target:el,timing:{}}],this)} unobserve(){} disconnect(){} takeRecords(){return[]} }
    window.matchMedia ??= (q) => ({ matches:false, media:q, addEventListener(){}, removeEventListener(){}, addListener(){}, removeListener(){}, onchange:null })
  } })
const { window } = dom
const doc = window.document
const wait = (ms) => new Promise(r => setTimeout(r, ms))
const setValue = (el, v) => { Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new window.Event('input', { bubbles: true })) }
await wait(2600)
const header = doc.querySelector('header.site-header')
const hide = async (y) => { fakeScrollY = y; window.dispatchEvent(new window.Event('scroll')); await wait(160) }
const hidden = () => /-translate-y-full/.test(header.className)
console.log('① 顶部可见:', hidden() ? '❌' : '✅')
await hide(500); console.log('② 滚到 500px 隐藏:', hidden() ? '✅ 渐变消失' : '❌ 仍挡着')
console.log('③ inert + 不可点:', header.hasAttribute('inert') && /pointer-events-none/.test(header.className) ? '✅' : '❌')
await hide(60); console.log('④ 迟滞区间不闪:', hidden() ? '✅ 保持隐藏' : '❌ 抖动')
await hide(0); console.log('⑤ 回到顶部恢复:', hidden() ? '❌ 仍隐藏' : '✅ 重新出现')
await hide(75); console.log('⑥ 阈值边界（75px < 80）不误隐:', hidden() ? '❌ 提前隐藏' : '✅')
/* #70 */
window.location.hash = '#/editor'; await wait(1800)
const ta = doc.querySelector('textarea.editor-textarea')
setValue(ta, 'B'.repeat(400))
await wait(400)
ta.setSelectionRange(100, 100)
window.__calls.length = 0
;[...doc.querySelectorAll('button')].find(b => /LaTeX 符号/.test(b.getAttribute('title') ?? '')).click()
await wait(300)
const input = [...doc.querySelectorAll('input')].find(i => /搜索命令或别名/.test(i.placeholder ?? ''))
setValue.length
Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(input, 'pm')
input.dispatchEvent(new window.Event('input', { bubbles: true }))
await wait(300)
input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
await wait(600)
const at = ta.value.indexOf('\\pm')
console.log('⑦ 插入位置:', at === 100 ? '✅ 正好在光标处 100' : `${at} （期望 100；长度 ${ta.value.length}）`)
console.log('⑧ 光标未被挪到末尾:', ta.selectionStart !== ta.value.length ? `✅ selectionStart=${ta.selectionStart}` : '❌ =len')
const seq = window.__calls.join('  →  ')
console.log('⑨ 调用序列:', seq)
console.log('⑩ 页面未被滚动:', window.__calls.some(c => c.startsWith('scrollTo:')) ? '❌ ' + window.__calls.filter(c=>c.startsWith('scrollTo')).join(',') : '✅ 无 window.scrollTo')
console.log('--- errors ---'); console.log(errors.slice(0, 6).join('\n') || '(none)')
process.exit(0)
