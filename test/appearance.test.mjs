import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

// These modules are deliberately pure; use the existing compiler, not a new test dependency.
async function sourceModule(path) {
  const source = await readFile(new URL(path, import.meta.url), 'utf8')
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } })
  return import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`)
}
const appearance = await sourceModule('../src/lib/appearance.ts')
const scenes = await sourceModule('../src/lib/scenes.ts')
const { createRenderer } = await sourceModule('../src/lib/backdrop/renderers.ts')
const html = await readFile(new URL('../index.html', import.meta.url), 'utf8')
const bootstrap = html.match(/<script id="appearance-init">([\s\S]*?)<\/script>/)[1]
const themeCSS = await readFile(new URL('../src/styles/themes.css', import.meta.url), 'utf8')

function boot(raw, legacy, systemDark, reduced, corrupt = false) {
  const classes = new Set()
  const root = { dataset: {}, style: {}, classList: { toggle(name, active) { if (active) classes.add(name); else classes.delete(name) } } }
  vm.runInNewContext(bootstrap, {
    document: { documentElement: root },
    localStorage: { getItem(key) { return key === 'starlog:theme' ? legacy : corrupt ? '{broken' : JSON.stringify({ appearance: raw }) } },
    window: { matchMedia: (query) => ({ matches: query.includes('reduced-motion') ? reduced : systemDark }) },
  })
  return { palette: root.dataset.palette, effects: root.dataset.effects, mode: root.style.colorScheme, dark: classes.has('dark') }
}

test('appearance defaults, legacy migration, malformed values and valid selections', () => {
  assert.deepEqual(appearance.normalizeAppearance(null), appearance.DEFAULT_APPEARANCE)
  assert.equal(appearance.normalizeAppearance(null, 'dark').mode, 'dark')
  assert.equal(appearance.normalizeAppearance(null, 'invalid').mode, 'system')
  assert.deepEqual(appearance.normalizeAppearance({ palette: '<script>', mode: 'night', effects: 100 }), appearance.DEFAULT_APPEARANCE)
  assert.deepEqual(appearance.normalizeAppearance(['aurora']), appearance.DEFAULT_APPEARANCE)
  assert.equal(appearance.normalizeAppearance({ mode: 'system' }, 'dark').mode, 'system')
  for (const palette of appearance.THEME_IDS) assert.equal(appearance.normalizeAppearance({ palette }).palette, palette)
})

test('pre-paint bootstrap and React normalization agree for every palette/mode/motion combination', () => {
  for (const palette of appearance.THEME_IDS) for (const mode of ['light', 'dark', 'system', 'invalid']) {
    for (const effects of ['off', 'subtle', 'full', null]) for (const systemDark of [false, true]) for (const reduced of [false, true]) {
      const normalized = appearance.normalizeAppearance({ palette, mode, effects }, 'light')
      const tone = appearance.resolveColorMode(normalized.mode, systemDark)
      assert.deepEqual(boot({ palette, mode, effects }, 'light', systemDark, reduced), {
        palette: normalized.palette, effects: reduced ? 'off' : normalized.effects, mode: tone, dark: tone === 'dark',
      })
    }
  }
  assert.deepEqual(boot(null, 'dark', false, false, true), { palette: 'classic', effects: 'subtle', mode: 'dark', dark: true })
})

test('pre-paint bootstrap remains usable when storage is blocked', () => {
  const root = { dataset: {}, style: {}, classList: { toggle() {} } }
  vm.runInNewContext(bootstrap, { document: { documentElement: root }, localStorage: { getItem() { throw Error('blocked') } }, window: { matchMedia: () => ({ matches: false }) } })
  assert.equal(root.dataset.palette, 'classic')
  assert.equal(root.style.colorScheme, 'light')
})

function tokens(id) {
  const block = [...themeCSS.matchAll(/([^{}]+)\{([^{}]+)\}/g)].find((match) => match[1].includes(`[data-palette="${id}"]`) && match[2].includes('--brand-50:'))
  assert.ok(block, `Missing palette CSS: ${id}`)
  return Object.fromEntries([...block[2].matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((match) => [match[1], match[2].trim()]))
}
function luminance(color) {
  const values = color.split(' ').map(Number).map((v) => v / 255).map((v) => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
  return values[0] * .2126 + values[1] * .7152 + values[2] * .0722
}
function contrast(a, b) { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05) }

for (const palette of appearance.PALETTES) {
  test(`${palette.name}: complete tokens, valid recommendation and readable accent colors`, () => {
    const t = tokens(palette.id)
    for (const shade of [50,100,200,300,400,500,600,700,800,900,950]) assert.match(t[`--brand-${shade}`], /^\d+ \d+ \d+$/)
    for (const key of ['theme-bg-light', 'theme-bg-dark', 'theme-surface-light', 'theme-surface-dark', 'theme-secondary']) assert.ok(t[`--${key}`])
    assert.ok(palette.scene === 'none' || scenes.findScene(palette.scene))
    for (const bg of ['--theme-bg-light', '--theme-surface-light']) assert.ok(contrast(t['--brand-600'], t[bg]) >= 4.5, `${palette.id} link contrast on ${bg}`)
    for (const bg of ['--theme-bg-dark', '--theme-surface-dark']) assert.ok(contrast(t['--brand-300'], t[bg]) >= 4.5, `${palette.id} dark link contrast on ${bg}`)
    for (const bg of ['--brand-600', '--brand-800']) assert.ok(contrast('255 255 255', t[bg]) >= 4.5, `${palette.id} primary button contrast`)
  })
}

test('system color resolution and render budgets are deterministic and bounded', () => {
  assert.equal(appearance.resolveColorMode('system', true), 'dark')
  assert.equal(appearance.resolveColorMode('light', true), 'light')
  assert.equal(appearance.resolveColorMode('dark', false), 'dark')
  const full = appearance.backdropBudget('full', 1440), mobile = appearance.backdropBudget('full', 375)
  assert.equal(full.fps, 60); assert.equal(full.dpr, 1.5)
  assert.equal(mobile.fps, 30); assert.equal(mobile.dpr, 1)
  assert.ok(mobile.particles < full.particles)
  assert.equal(appearance.backdropBudget('off', 1440).animate, false)
  assert.ok(appearance.backdropBudget('subtle', 1440).particles < full.particles)
})

test('all eight scenes validate their settings and preserve independent parameters', () => {
  assert.equal(scenes.SCENES.length, 8)
  assert.equal(new Set(scenes.SCENES.map((scene) => scene.id)).size, 8)
  assert.equal(scenes.normalizeAnimatedBackground({ scene: 'unknown' }).scene, 'none')
  assert.equal(scenes.normalizeAnimatedBackground(null).scene, 'none')
  const pref = scenes.normalizeAnimatedBackground({ scene: 'rain', values: { rain: { density: 92, wind: -33 }, stars: { density: 12 } } })
  assert.equal(pref.values.rain.density, 92)
  assert.equal(pref.values.rain.wind, -33)
  assert.equal(pref.values.stars.density, 12)
  assert.equal(pref.values.rain.lightning, 0)
  for (const scene of scenes.SCENES) {
    for (const value of [null, '', [], NaN, Infinity, -Infinity]) {
      const result = scenes.normalizeSceneValues(scene, Object.fromEntries(scene.params.map((p) => [p.key, value])))
      assert.deepEqual(result, scenes.defaultSceneValues(scene))
    }
    for (const p of scene.params) {
      assert.equal(scenes.normalizeSceneValues(scene, { [p.key]: -1000 })[p.key], p.min)
      assert.equal(scenes.normalizeSceneValues(scene, { [p.key]: 1000 })[p.key], p.max)
    }
  }
})

function canvasContext() {
  const calls = []
  const context = new Proxy({}, {
    get(target, name) {
      if (name in target) return target[name]
      return (...args) => {
        for (const arg of args) if (typeof arg === 'number') assert.ok(Number.isFinite(arg), `${String(name)} received a non-finite number`)
        calls.push(name)
        if (name === 'createLinearGradient' || name === 'createRadialGradient') return { addColorStop(offset) { assert.ok(offset >= 0 && offset <= 1) } }
      }
    },
    set(target, key, value) { target[key] = value; return true },
  })
  return { context, calls }
}

for (const scene of scenes.SCENES) {
  test(`${scene.name}: static, animated, resized and boundary-parameter rendering stays finite`, () => {
    const old = globalThis.document
    globalThis.document = { createElement() { return { width: 0, height: 0, getContext: () => canvasContext().context } } }
    try {
      for (const dark of [false, true]) {
        const { context, calls } = canvasContext()
        const renderer = createRenderer(scene.id, { dark, primary: [70, 130, 180], secondary: [160, 120, 210] }, .55)
        renderer.setup(1440, 900)
        renderer.configure(scenes.defaultSceneValues(scene))
        renderer.draw(context) // No step: the reduced-motion/static path.
        for (let i = 0; i < 12; i++) { renderer.step(1 / 30); renderer.draw(context) }
        renderer.setup(320, 640)
        for (const boundary of ['min', 'max']) {
          renderer.configure(Object.fromEntries(scene.params.map((p) => [p.key, p[boundary]])))
          renderer.step(.1); renderer.draw(context)
        }
        assert.ok(calls.includes('clearRect'))
        assert.ok(renderer.fps <= 60)
      }
    } finally { globalThis.document = old }
  })
}


test('compiled Tailwind typography and opacity utilities contain no unresolved alpha placeholders', async () => {
  const require = createRequire(import.meta.url)
  const config = require('tailwindcss/loadConfig')(fileURLToPath(new URL('../tailwind.config.js', import.meta.url)))
  config.content = [{ raw: '<div class="prose dark:prose-invert bg-brand-500/25 text-brand-600 border-brand-300 hover:text-brand-700"></div>' }]
  const { css } = await require('postcss')([require('tailwindcss')(config)]).process('@tailwind components; @tailwind utilities;', { from: undefined })
  assert.doesNotMatch(css, /<alpha-value>/)
  assert.match(css, /--tw-prose-links:\s*rgb\(var\(--brand-600\)\)/)
  assert.match(css, /color:\s*var\(--prose-link-hover\)/)
})
