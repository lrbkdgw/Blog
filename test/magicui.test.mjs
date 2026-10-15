import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'

const root = new URL('../', import.meta.url)
const read = (path) => readFile(new URL(path, root), 'utf8')
const components = ['magic-card', 'border-beam', 'shimmer-button', 'blur-fade', 'aurora-text', 'shine-border', 'bento-grid', 'dock', 'number-ticker', 'scroll-progress']
const pin = '85f97fd27b053339af74ba9dd4ca428ee25989fb'
// Use Vite's existing compiler in memory; exercise the real TSX without generated files or a new test framework.
const { outputFiles } = await build({
  stdin: { contents: [...components.map((name) => `export * from './src/components/magicui/${name}'`), "export { cn } from './src/lib/utils'"].join('\n'), resolveDir: fileURLToPath(root), loader: 'ts' },
  bundle: true, write: false, format: 'cjs', platform: 'node', packages: 'external', jsx: 'automatic', define: { 'import.meta.env': '{}' },
})
const module = { exports: {} }
new Function('module', 'exports', 'require', outputFiles[0].text)(module, module.exports, createRequire(import.meta.url))
const { MagicCard, BorderBeam, ShimmerButton, ShimmerLink, BlurFade, AuroraText, ShineBorder, BentoGrid, BentoCard, Dock, DockIcon, NumberTicker, ScrollProgress, cn } = module.exports
const render = (component, props, children) => renderToStaticMarkup(h(component, props, children))

test('Magic UI has pinned, attributed source and a shipped MIT notice; no direct or transitive Radix', async () => {
  const attribution = await read('src/components/magicui/README.md')
  const license = await read('public/licenses/magic-ui-MIT.txt')
  assert.ok(attribution.includes(pin))
  assert.match(license, /Copyright \(c\) Magic UI/)
  assert.match(license, /Permission is hereby granted, free of charge/)
  assert.match(license, /THE SOFTWARE IS PROVIDED "AS IS"/)
  for (const name of components) {
    const source = await read(`src/components/magicui/${name}.tsx`)
    assert.ok(source.includes(pin), name)
    assert.match(source, /MIT License, Copyright \(c\) Magic UI/)
    assert.ok(attribution.includes(`/${name}.tsx`), name)
  }
  const lock = JSON.parse(await read('package-lock.json'))
  for (const name of Object.keys(lock.packages)) assert.doesNotMatch(name, /node_modules\/(?:@radix-ui\/|cmdk(?:\/|$)|sonner(?:\/|$)|next-themes(?:\/|$)|next(?:\/|$))/)
  assert.ok(lock.packages['node_modules/motion'])
  assert.match(lock.packages['node_modules/tailwind-merge'].version, /^2\./)
  for (const file of await readdir(new URL('src/', root), { recursive: true })) {
    if (/\.tsx?$/.test(file)) assert.doesNotMatch(await read(`src/${file}`), /from\s+['"](?:@radix-ui\/|cmdk['"]|next-themes['"])/)
  }
})

test('Magic UI cn combines conditions and resolves Tailwind 3 conflicts', () => {
  assert.equal(cn('p-2 text-sm', false, ['p-4', undefined], { 'text-lg': true, hidden: false }), 'p-4 text-lg')
  assert.equal(cn('h-full rounded-[inherit]', 'rounded-[var(--card-radius)]'), 'h-full rounded-[var(--card-radius)]')
})

test('Shimmer Button defaults to a safe button; its link adapter is a single base-aware anchor', () => {
  const button = render(ShimmerButton, { disabled: true, className: 'custom', style: { '--speed': '9s' } }, '再读一些')
  assert.match(button, /^<button[^>]*type="button"/)
  assert.match(button, /disabled=""/)
  assert.match(button, /data-animating="false"/)
  assert.match(button, /--speed:9s/)
  assert.equal((button.match(/<button/g) || []).length, 1)
  assert.match(render(ShimmerButton, { type: 'submit' }, '提交'), /type="submit"/)
  for (const [to, expected] of [['/archive', '/Blog/archive'], ['#posts', '/Blog#posts']]) {
    const link = renderToStaticMarkup(h(MemoryRouter, { basename: '/Blog', initialEntries: ['/Blog/'] }, h(ShimmerLink, { to }, '开始阅读')))
    assert.match(link, /^<a\s/)
    assert.ok(link.includes(`href="${expected}"`), `Expected ${expected}: ${link}`)
    assert.equal((link.match(/<a\s/g) || []).length, 1)
    assert.doesNotMatch(link, /<button/)
  }
})

test('Aurora text has one accessible copy; border decorations are hidden and static without a motion provider', () => {
  const title = render(AuroraText, { colors: ['#123456', '#654321'] }, '收藏灵光')
  assert.match(title, /<span class="sr-only">收藏灵光<\/span>/)
  assert.match(title, /aria-hidden="true"[^>]*>收藏灵光<\/span>/)
  assert.match(title, /animation-play-state:paused/)
  const shine = render(ShineBorder, { shineColor: ['#123456', '#654321'], borderWidth: 2 })
  assert.match(shine, /^<span\s/)
  assert.match(shine, /aria-hidden="true"/)
  assert.match(shine, /padding:2px/)
  assert.match(shine, /mask-composite:exclude/)
  assert.match(shine, /animation-play-state:paused/)
  const beam = render(BorderBeam)
  assert.match(beam, /aria-hidden="true"/)
  assert.match(beam, /data-animating="false"/)
  assert.doesNotMatch(beam, /magic-border-beam-trace/)
})

test('Blur Fade without browser observation or enabled motion keeps content visible', () => {
  const content = render(BlurFade, { inView: true, delay: 0.2 }, h('article', null, '可读正文'))
  assert.match(content, /data-motion-enabled="false"/)
  assert.match(content, /opacity:1/)
  assert.match(content, /filter:blur\(0px\)/)
  assert.match(content, /<article>可读正文<\/article>/)
})

test('Magic Card preserves semantic content and palette radius in both upstream modes', () => {
  for (const mode of ['gradient', 'orb']) {
    const card = render(MagicCard, { mode, className: 'post-card' }, h('article', null, h('a', { href: '/posts/example' }, '文章标题')))
    assert.ok(card.includes(`data-mode="${mode}"`))
    assert.match(card, /data-interactive="false"/)
    assert.match(card, /rounded-\[var\(--card-radius\)\]/)
    assert.match(card, /<article><a href="\/posts\/example">文章标题<\/a><\/article>/)
    assert.match(card, /aria-hidden="true"/)
  }
})

test('Magic UI animation CSS is app-only and uses the official, namespaced keyframes', async () => {
  const entry = await read('src/main.tsx')
  const shared = await read('src/styles/index.css')
  const css = await read('src/styles/magicui.css')
  assert.match(entry, /import '\.\/styles\/magicui\.css'/)
  assert.doesNotMatch(shared, /magicui\.css/)
  for (const name of ['aurora', 'shimmer-slide', 'spin-around', 'shine']) assert.ok(css.includes(`@keyframes magic-${name}`))
  assert.match(css, /@media \(forced-colors: active\)/)
  assert.match(css, /@media print/)
  assert.match(css, /pointer-events: none/)
})


test('transparent Magic Cards remove the solid fill in both modes and use a masked border', async () => {
  for (const mode of ['gradient', 'orb']) {
    const card = render(MagicCard, { mode, surface: 'transparent' }, h('article', null, '透明文章'))
    assert.match(card, /data-surface="transparent"/)
    assert.match(card, /style="background:transparent"/)
    assert.match(card, /class="magic-card-border"/)
    assert.doesNotMatch(card, /data-magic-card-fill/)
  }
  assert.match(render(MagicCard, {}, '保留通用实色模式'), /data-magic-card-fill="true"/)
  const css = await read('src/styles/magicui.css')
  assert.match(css, /\.magic-card-border[^}]+mask-composite: exclude/)
  assert.match(await read('src/styles/appearance.css'), /\.reading-surface \{[^}]+background: transparent/)
})

test('Bento Grid and Card keep a single title link, semantic article, cover and metadata slots', () => {
  const card = h(BentoCard, { name: '文章标题', description: '文章摘要', href: '/posts/example', background: h('img', { src: '/cover.png', alt: '' }), metadata: h('time', { dateTime: '2026-10-16' }, '日期'), footer: h('span', null, '#测试') })
  const html = renderToStaticMarkup(h(MemoryRouter, { basename: '/Blog', initialEntries: ['/Blog/'] }, h(BentoGrid, null, card)))
  assert.match(html, /data-magic-ui="bento-grid"/)
  assert.match(html, /<article[^>]+data-magic-ui="bento-card"/)
  assert.equal((html.match(/<a\s/g) || []).length, 1)
  assert.match(html, /href="\/Blog\/posts\/example"/)
  assert.match(html, /<h2[^>]+><a[^>]+>文章标题<\/a><\/h2>/)
  for (const text of ['文章摘要', '#测试', 'dateTime="2026-10-16"', '/cover.png']) assert.ok(html.includes(text), text)
  assert.doesNotMatch(html, /<button/)
})

test('Dock preserves native links and its configured size without enabled interactive motion', () => {
  const html = render(Dock, { iconSize: 48 }, h(DockIcon, null, h('a', { href: '/archive' }, '归档')))
  assert.match(html, /data-magic-ui="dock"/)
  assert.match(html, /data-interactive="false"/)
  assert.match(html, /width:48px;height:48px/)
  assert.match(html, /<a href="\/archive">归档<\/a>/)
  assert.doesNotMatch(html, /tabindex|<button/i)
})

test('Number Ticker exposes the true count immediately, including no-observer and decimal fallbacks', () => {
  for (const [props, expected] of [[{ value: 8 }, '8'], [{ value: 0 }, '0'], [{ value: 1234.25, decimalPlaces: 2 }, '1,234.25'], [{ value: 9, startValue: 2, direction: 'down' }, '2']]) {
    const html = render(NumberTicker, props)
    assert.match(html, /data-animating="false"/)
    assert.ok(html.includes(`<span class="sr-only">${expected}</span>`))
    assert.ok(html.includes(`aria-hidden="true" class="magic-number-visual">${expected}</span>`))
  }
})

test('Scroll Progress has a real named progressbar and starts at zero without browser layout', () => {
  const html = render(ScrollProgress)
  assert.match(html, /data-magic-ui="scroll-progress"/)
  assert.match(html, /role="progressbar"/)
  assert.match(html, /aria-label="页面阅读进度"/)
  assert.match(html, /aria-valuenow="0"/)
  assert.match(html, /aria-valuemax="100"/)
  assert.match(html, /transform:scaleX\(0\)/)
})
