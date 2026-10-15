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
const components = ['magic-card', 'border-beam', 'shimmer-button', 'blur-fade', 'aurora-text', 'shine-border']
const pin = '85f97fd27b053339af74ba9dd4ca428ee25989fb'
// Use Vite's existing compiler in memory; exercise the real TSX without generated files or a new test framework.
const { outputFiles } = await build({
  stdin: { contents: [...components.map((name) => `export * from './src/components/magicui/${name}'`), "export { cn } from './src/lib/utils'"].join('\n'), resolveDir: fileURLToPath(root), loader: 'ts' },
  bundle: true, write: false, format: 'cjs', platform: 'node', packages: 'external', jsx: 'automatic', define: { 'import.meta.env': '{}' },
})
const module = { exports: {} }
new Function('module', 'exports', 'require', outputFiles[0].text)(module, module.exports, createRequire(import.meta.url))
const { MagicCard, BorderBeam, ShimmerButton, ShimmerLink, BlurFade, AuroraText, ShineBorder, cn } = module.exports
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
