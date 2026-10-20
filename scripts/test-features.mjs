import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')
const requireExt = createRequire(join(root, 'vscode_extensions/v1/package.json'))
const { JSDOM } = requireExt('jsdom')

async function importTsModule(entryPath) {
  const result = await build({
    entryPoints: [join(root, entryPath)],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
  })
  const code = result.outputFiles[0].text
  const dataUrl = `data:text/javascript;base64,${Buffer.from(code, 'utf8').toString('base64')}`
  return import(dataUrl)
}

const weatherMod = await importTsModule('src/components/WeatherBackdrops.ts')
const headerYieldMod = await importTsModule('src/lib/headerYield.ts')
const uiCcsMod = await importTsModule('src/lib/uiCcs.ts')
const postsMod = await importTsModule('src/lib/posts.ts')
const mdSourceMod = await importTsModule('src/lib/markdownSource.ts')

function makeMock2dContext(strokeSink) {
  return {
    canvas: { width: 1280, height: 720 },
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    lineCap: 'butt',
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    imageSmoothingEnabled: true,
    imageSmoothingQuality: 'high',
    createLinearGradient: () => ({ addColorStop() {} }),
    createRadialGradient: () => ({ addColorStop() {} }),
    createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
    putImageData() {},
    clearRect() {},
    fillRect() {},
    drawImage() {},
    save() {},
    restore() {},
    translate() {},
    scale() {},
    rotate() {},
    clip() {},
    rect() {},
    closePath() {},
    fill() {},
    arc() {},
    ellipse() {},
    quadraticCurveTo() {},
    bezierCurveTo() {},
    beginPath() {
      this._cur = []
    },
    moveTo(x, y) {
      this._lastMove = { x, y }
    },
    lineTo(x, y) {
      if (strokeSink && this._lastMove) {
        this._cur.push({ x0: this._lastMove.x, y0: this._lastMove.y, x1: x, y1: y })
        this._lastMove = null
      }
    },
    stroke() {
      if (strokeSink && this._cur?.length) {
        strokeSink.push(...this._cur)
      }
    },
  }
}

/* -------------------------------------------------------------------------- */
/*                     1. 暴雨背景速度、帧率与轨迹同轴验证                       */
/* -------------------------------------------------------------------------- */

test('暴雨渲染器：60fps 全帧率、真实高速下落且移动方向与雨丝绘制方向严格同轴', () => {
  const prevDocument = globalThis.document
  globalThis.document = {
    createElement() {
      const c = {
        width: 1,
        height: 1,
        getContext() {
          const ctx = makeMock2dContext(null)
          ctx.canvas = c
          return ctx
        },
      }
      return c
    },
  }

  try {
    const rain = weatherMod.createRain(true)
    assert.equal(rain.fps, 60)

    rain.configure({ count: 65, speed: 65, wind: 42, mist: 55, flash: 0 })
    rain.setup(1280, 720)

    const strokes = []
    const drawCtx = makeMock2dContext(strokes)

    rain.draw(drawCtx)
    const before = strokes.splice(0)
    assert.ok(before.length >= 100, `期望雨滴数量充足，实际 ${before.length}`)

    // 推进一帧 1/60s，逐滴核验真实位移速度与雨丝角度同轴度
    const dt = 1 / 60
    rain.step(dt)
    rain.draw(drawCtx)
    const after = strokes.splice(0)

    const speeds = []
    for (let i = 0; i < Math.min(before.length, after.length); i += 1) {
      const b = before[i]
      const a = after[i]
      const dy = a.y0 - b.y0
      const dx = a.x0 - b.x0
      if (dy <= 0) continue // 跳过跨底重生的雨滴
      speeds.push(dy / dt)
      const moveSlope = dx / dy
      const strokeSlope = (b.x1 - b.x0) / (b.y1 - b.y0)
      assert.ok(
        Math.abs(moveSlope - strokeSlope) < 1e-6,
        `雨滴移动斜率 ${moveSlope} 与雨丝绘制斜率 ${strokeSlope} 必须严格同轴`,
      )
    }

    assert.ok(speeds.length > 50)
    const minVy = Math.min(...speeds)
    const maxVy = Math.max(...speeds)
    const avgVy = speeds.reduce((s, v) => s + v, 0) / speeds.length
    assert.ok(minVy > 1000, `远景雨滴速度过慢：${minVy} px/s`)
    assert.ok(avgVy > 1800, `平均雨滴速度不足以呈现真实暴雨感：${avgVy} px/s`)
    assert.ok(maxVy > 3000, `近景雨滴速度不足：${maxVy} px/s`)

    const backdropSource = readFileSync(join(root, 'src/components/AnimatedBackdrop.tsx'), 'utf8')
    assert.match(backdropSource, /interval \* 0\.82/)
  } finally {
    globalThis.document = prevDocument
  }
})

/* -------------------------------------------------------------------------- */
/*                     2. 全站顶部防冲突让位机制完整验证                         */
/* -------------------------------------------------------------------------- */

test('全站所有路由页面与悬浮门户组件均已接入顶部防冲突机制', () => {
  const requiredYieldFiles = [
    'src/App.tsx',
    'src/components/Layout.tsx',
    'src/components/Comments.tsx',
    'src/components/OfflineExportPanel.tsx',
    'src/pages/Home.tsx',
    'src/pages/PostPage.tsx',
    'src/pages/Archive.tsx',
    'src/pages/TagsPage.tsx',
    'src/pages/About.tsx',
    'src/pages/SettingsPage.tsx',
    'src/pages/Admin.tsx',
    'src/pages/Editor.tsx',
    'src/pages/Login.tsx',
    'src/pages/NotFound.tsx',
  ]
  for (const rel of requiredYieldFiles) {
    const content = readFileSync(join(root, rel), 'utf8')
    assert.match(content, /data-yield-list/, `${rel} 缺少 data-yield-list 标记`)
  }

  for (const portalFile of ['src/components/LatexPicker.tsx', 'src/components/BundleImportDialog.tsx']) {
    const content = readFileSync(join(root, portalFile), 'utf8')
    assert.match(content, /createPortal\(/, `${portalFile} 应使用 createPortal 避免祖先 mask 裁切`)
  }
})

test('headerYield 引擎：精确裁切穿过顶栏的叶级块，跳过模态框、fixed 浮层与分栏内滚容器', async () => {
  const dom = new JSDOM(`<!doctype html><html><body>
    <header class="site-header"></header>
    <main>
      <div id="page-root" data-yield-list>
        <section id="hero">Hero</section>
        <div id="card-list" data-yield-list>
          <article id="card-1">Card 1</article>
          <article id="card-2">Card 2</article>
        </div>
        <div id="editor-preview" data-yield-ignore>
          <div class="prose"><p id="ignored-p">Preview paragraph</p></div>
        </div>
      </div>
    </main>
    <div role="dialog" class="fixed">
      <div class="prose"><p id="dialog-p">Dialog paragraph</p></div>
    </div>
  </body></html>`)

  const prevWindow = globalThis.window
  const prevDocument = globalThis.document
  const prevMutationObserver = globalThis.MutationObserver
  const prevRAF = globalThis.requestAnimationFrame
  const prevCAF = globalThis.cancelAnimationFrame

  globalThis.window = dom.window
  globalThis.document = dom.window.document
  globalThis.MutationObserver = dom.window.MutationObserver
  globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0)
  globalThis.cancelAnimationFrame = (id) => clearTimeout(id)

  let scrollY = 0
  const layoutBoxes = new Map([
    ['hero', { top: 80, height: 120 }],
    ['card-1', { top: 220, height: 90 }],
    ['card-2', { top: 330, height: 90 }],
    ['ignored-p', { top: 80, height: 60 }],
    ['dialog-p', { top: 80, height: 60 }],
  ])

  const flushYield = async () => {
    headerYieldMod.requestHeaderYieldRefresh()
    await new Promise((r) => setTimeout(r, 10))
  }

  const header = dom.window.document.querySelector('.site-header')
  header.getBoundingClientRect = () => ({ top: 0, bottom: 56, left: 0, right: 1000, width: 1000, height: 56 })

  for (const [id, box] of layoutBoxes.entries()) {
    const el = dom.window.document.getElementById(id)
    el.getBoundingClientRect = () => ({
      top: box.top - scrollY,
      bottom: box.top + box.height - scrollY,
      left: 0,
      right: 800,
      width: 800,
      height: box.height,
    })
  }

  try {
    const cleanup = headerYieldMod.installHeaderYield()
    await new Promise((r) => setTimeout(r, 15))

    const pageRoot = dom.window.document.getElementById('page-root')
    const cardList = dom.window.document.getElementById('card-list')
    const hero = dom.window.document.getElementById('hero')
    const card1 = dom.window.document.getElementById('card-1')
    const card2 = dom.window.document.getElementById('card-2')
    const ignoredP = dom.window.document.getElementById('ignored-p')
    const dialogP = dom.window.document.getElementById('dialog-p')

    assert.equal(hero.hasAttribute('data-yield'), false)
    assert.equal(card1.hasAttribute('data-yield'), false)

    // 滚动使 hero 深入顶栏（header bottom = 56px）：hero 被精确设置渐变遮罩变量，外层容器不重复遮罩，浮层与忽略容器不遮罩
    scrollY = 100 // hero: top=-20, height=120 -> top=76px, fade=64px
    await flushYield()
    assert.equal(hero.getAttribute('data-yield'), 'on')
    assert.equal(hero.style.getPropertyValue('--yield-top'), '76px')
    assert.equal(hero.style.getPropertyValue('--yield-fade'), '64px')
    assert.equal(pageRoot.hasAttribute('data-yield'), false)
    assert.equal(cardList.hasAttribute('data-yield'), false)
    assert.equal(ignoredP.hasAttribute('data-yield'), false)
    assert.equal(dialogP.hasAttribute('data-yield'), false)

    // 继续滚动：card-1 进入顶栏，card-2 仍在顶栏下方保持完整清晰
    scrollY = 230 // card-1: top=-10, height=90 -> top=66px, fade=54px
    await flushYield()
    assert.equal(card1.getAttribute('data-yield'), 'on')
    assert.equal(card1.style.getPropertyValue('--yield-top'), '66px')
    assert.equal(card1.style.getPropertyValue('--yield-fade'), '54px')
    assert.equal(card2.hasAttribute('data-yield'), false)

    cleanup()
    assert.equal(card1.hasAttribute('data-yield'), false)
    assert.equal(hero.hasAttribute('data-yield'), false)
  } finally {
    dom.window.close()
    globalThis.window = prevWindow
    globalThis.document = prevDocument
    globalThis.MutationObserver = prevMutationObserver
    globalThis.requestAnimationFrame = prevRAF
    globalThis.cancelAnimationFrame = prevCAF
  }
})

/* -------------------------------------------------------------------------- */
/*                     3. ui-ccs 直角坐标系数学与边界测试                        */
/* -------------------------------------------------------------------------- */

test('ui-ccs 解析器、数学运算符优先级、高次曲线裁剪、间断点与文章元数据隔离', () => {
  assert.equal(uiCcsMod.compileCcsExpression('-x^2')(3), -9)
  assert.equal(uiCcsMod.compileCcsExpression('(-x)^2')(3), 9)
  assert.equal(uiCcsMod.compileCcsExpression('2^-x')(3), 0.125)
  assert.equal(uiCcsMod.compileCcsExpression('7*x^2+6*x+90*x^3')(2), 7 * 4 + 12 + 90 * 8)
  assert.ok(Math.abs(uiCcsMod.compileCcsExpression('2x + sin(pi/2)')(4) - 9) < 1e-9)

  const parsed = uiCcsMod.parseUiCcs([
    'create_point:(3,-4);',
    'create_line:(-3,-2),(0,1),(4,-1),[color=red];',
    'create_line:(7*x^2+6*x+90*x^3);',
  ].join('\n'))
  assert.equal(parsed.errors.length, 0)
  assert.equal(parsed.items.length, 3)
  assert.equal(parsed.items[0].kind, 'point')
  assert.deepEqual({ x: parsed.items[0].x, y: parsed.items[0].y }, { x: 3, y: -4 })
  assert.equal(parsed.items[1].kind, 'polyline')
  assert.equal(parsed.items[1].color, 'red')
  assert.equal(parsed.items[1].points.length, 3)
  assert.equal(parsed.items[2].kind, 'function')

  for (const unitsPerPx of [1e-4, 0.03, 50, 5000]) {
    const cubicPath = uiCcsMod.buildFunctionSvgPath(parsed.items[2].evaluate, {
      centerX: 0,
      centerY: 0,
      unitsPerPx,
    })
    assert.doesNotMatch(cubicPath, /NaN|Infinity/)
  }

  const reciprocal = uiCcsMod.compileCcsExpression('1/x')
  const recPath = uiCcsMod.buildFunctionSvgPath(reciprocal, { centerX: 0, centerY: 0, unitsPerPx: 0.03 })
  assert.ok((recPath.match(/M/g) || []).length >= 2, '1/x 在渐近线 x=0 两侧应拆分为独立路径段')

  assert.equal(uiCcsMod.sanitizeCcsColor('red;position:fixed'), undefined)
  assert.equal(uiCcsMod.sanitizeCcsColor('red'), 'red')
  assert.equal(uiCcsMod.sanitizeCcsColor('#10b981'), '#10b981')

  const postSample = '## 第一节\n\n导语文字。\n\n::begin_ui-ccs\ncreate_point:(0,0);\ncreate_line:(7*x^2+6*x+90*x^3);\n::end_ui-ccs\n\n## 第二节'
  assert.deepEqual(postsMod.extractToc(postSample).map((t) => t.text), ['第一节', '第二节'])
  assert.doesNotMatch(postsMod.excerpt(postSample), /create_point|create_line|ui-ccs/)
  assert.doesNotMatch(mdSourceMod.convertMarkdownForCopy(postSample, 'basic'), /::begin_ui-ccs/)
})
