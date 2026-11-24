import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { get as httpRequest } from 'node:http'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')
const requireExt = createRequire(join(root, 'vscode_extensions/v1/package.json'))
const { JSDOM } = requireExt('jsdom')

const viteRawImports = {
  name: 'vite-raw',
  setup(build) {
    build.onResolve({ filter: /\?raw$/ }, ({ path, resolveDir }) => {
      const file = path.slice(0, -4)
      return {
        path: file.startsWith('/') ? join(root, file.slice(1)) : resolve(resolveDir, file),
        namespace: 'vite-raw',
      }
    })
    build.onLoad({ filter: /.*/, namespace: 'vite-raw' }, ({ path }) => ({
      contents: readFileSync(path, 'utf8'),
      loader: 'text',
    }))
  },
}

async function importTsModule(entryPath) {
  const result = await build({
    entryPoints: [join(root, entryPath)],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    define: {
      __STARLOG_OFFLINE__: 'false',
    },
  })
  const code = result.outputFiles[0].text
  const dataUrl = `data:text/javascript;base64,${Buffer.from(code, 'utf8').toString('base64')}`
  return import(dataUrl)
}

const weatherMod = await importTsModule('src/components/WeatherBackdrops.ts')
const headerYieldMod = await importTsModule('src/lib/headerYield.ts')
const uiCcsMod = await importTsModule('src/lib/uiCcs.ts')
const uiWidgetsMod = await importTsModule('src/lib/uiWidgets.ts')
const uiGraphMod = await importTsModule('src/lib/uiGraph.ts')
const postsMod = await importTsModule('src/lib/posts.ts')
const mdSourceMod = await importTsModule('src/lib/markdownSource.ts')
const echoCaveMod = await importTsModule('src/lib/echoCave.ts')
const echoAshMod = await importTsModule('src/lib/echoAsh.ts')
const editorMod = await importTsModule('src/lib/editor.ts')

test('issue #111: Enter continues quotes and Tab nests whole list items', async () => {
  const { unified } = await import('unified')
  const { default: remarkParse } = await import('remark-parse')
  const parse = (value) => unified().use(remarkParse).parse(value)
  const press = (source, key, shiftKey = false) => {
    const caret = source.indexOf('|')
    let prevented = false
    const action = editorMod.handleEditorKey({
      key,
      shiftKey,
      currentTarget: { value: source.replace('|', ''), selectionStart: caret, selectionEnd: caret },
      preventDefault() { prevented = true },
    })
    assert.ok(prevented && action, source)
    assert.equal(action.selectionStart, action.selectionEnd)
    return action.value.slice(0, action.selectionStart) + '|' + action.value.slice(action.selectionEnd)
  }

  assert.equal(press('> First|', 'Enter'), '> First\n> |')
  assert.equal(press('> > First\n> > |', 'Enter'), '> > First\n> |')
  assert.equal(press('> > 9) First|', 'Enter'), '> > 9) First\n> > 10) |')
  assert.equal(press('> - [X] First|', 'Enter'), '> - [X] First\n> - [ ] |')
  assert.equal(press('> - |First', 'Enter'), '> - \n> - |First')
  assert.equal(press('> - First\n> - |', 'Enter'), '> - First\n> |')
  assert.equal(press('- First\n- |', 'Enter'), '- First\n|')

  const unordered = press('- Parent\n- |', 'Tab')
  assert.equal(unordered, '- Parent\n  - |')
  assert.equal(parse(unordered.replace('|', 'Child')).children[0].children[0].children[1].type, 'list')

  const ordered = press('9. Parent\n10. |', 'Tab')
  assert.equal(ordered, '9. Parent\n   1. |')
  const nested = parse(ordered.replace('|', 'Child')).children[0].children[0].children[1]
  assert.equal(nested.type, 'list')
  assert.equal(nested.start, 1)
  assert.equal(press(ordered, 'Tab', true), '9. Parent\n10. |')
  assert.equal(press('> 10) Parent\n> 11) |', 'Tab'), '> 10) Parent\n>     1) |')
})

function makeMock2dContext(strokeSink, drawSink) {
  const stack = []
  let textBitmap = null
  return {
    canvas: { width: 1280, height: 720 },
    fillStyle: '',
    strokeStyle: '',
    font: '16px serif',
    textAlign: 'left',
    textBaseline: 'alphabetic',
    lineWidth: 1,
    lineCap: 'butt',
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    imageSmoothingEnabled: true,
    imageSmoothingQuality: 'high',
    _tx: 0,
    _ty: 0,
    _rot: 0,
    createLinearGradient: () => ({ addColorStop() {} }),
    createRadialGradient: () => ({ addColorStop() {} }),
    createPattern: () => ({}),
    createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
    measureText: (str) => ({
      width: String(str).length * 18,
      fontBoundingBoxAscent: 18,
      fontBoundingBoxDescent: 4,
      actualBoundingBoxAscent: 17,
      actualBoundingBoxDescent: 4,
    }),
    fillText(str, x, y) {
      const w = 640
      const h = 240
      if (!textBitmap) textBitmap = new Uint8ClampedArray(w * h * 4)
      const chars = Array.from(String(str))
      const alphaByte = Math.max(40, Math.min(255, Math.round(this.globalAlpha * 255)))
      for (let c = 0; c < chars.length; c++) {
        const bx = Math.round(x + c * 18)
        const by = Math.round(y - 14)
        for (let dy = 0; dy < 12; dy += 2) {
          for (let dx = 0; dx < 12; dx += 2) {
            const px = bx + dx
            const py = by + dy
            if (px >= 0 && px < w && py >= 0 && py < h) {
              textBitmap[(py * w + px) * 4 + 3] = alphaByte
            }
          }
        }
      }
    },
    getImageData(sx, sy, sw, sh) {
      const out = new Uint8ClampedArray(sw * sh * 4)
      if (textBitmap) {
        const srcW = 640
        const srcH = 240
        for (let py = 0; py < sh && sy + py < srcH; py++) {
          for (let px = 0; px < sw && sx + px < srcW; px++) {
            const a = textBitmap[((sy + py) * srcW + (sx + px)) * 4 + 3]
            if (a > 0) out[(py * sw + px) * 4 + 3] = a
          }
        }
      }
      return { width: sw, height: sh, data: out }
    },
    createImageData(sw, sh) {
      return { width: sw, height: sh, data: new Uint8ClampedArray(sw * sh * 4) }
    },
    putImageData() {},
    setTransform() {},
    bezierCurveTo() {},
    quadraticCurveTo() {},
    clearRect() {},
    fillRect() {},
    drawImage(img, x, y, w, h) {
      if (drawSink) {
        drawSink.push({
          sw: img?.width ?? 0,
          sh: img?.height ?? 0,
          tx: this._tx,
          ty: this._ty,
          rot: this._rot,
          alpha: this.globalAlpha,
          x,
          y,
          w,
          h,
        })
      }
    },
    save() {
      stack.push({ tx: this._tx, ty: this._ty, rot: this._rot, alpha: this.globalAlpha })
    },
    restore() {
      const s = stack.pop()
      if (s) {
        this._tx = s.tx
        this._ty = s.ty
        this._rot = s.rot
        this.globalAlpha = s.alpha
      }
    },
    translate(x, y) {
      this._tx += x
      this._ty += y
    },
    scale() {},
    rotate(rad) {
      this._rot += rad
    },
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
/*                     1. 暴雨背景自然水滴形态、同轴与阅读保护验证                */
/* -------------------------------------------------------------------------- */

test('暴雨渲染器：60fps 晶莹折射水珠 + 浅景深散景水珠（零直线雨丝）、轨迹严格同轴且中央阅读区深度降噪', () => {
  const prevDocument = globalThis.document
  globalThis.document = {
    createElement() {
      const c = {
        width: 1,
        height: 1,
        getContext() {
          const ctx = makeMock2dContext(null, null)
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
    assert.equal(headerYieldMod.VANISH_OFFSET_PX, -8)
    assert.equal(headerYieldMod.FADE_SPAN_PX, 40)

    rain.configure({ count: 65, speed: 65, wind: 42, mist: 55, flash: 0 })
    rain.setup(1280, 720)

    const strokes = []
    const draws = []
    const drawCtx = makeMock2dContext(strokes, draws)

    rain.draw(drawCtx)
    assert.equal(strokes.length, 0, `不应再使用直线 lineTo 绘制生硬雨丝，实际残留 ${strokes.length} 条`)
    const isDropSprite = (d) => d.sw === 40 || (d.sw === 64 && d.w !== d.h)
    const beforeDrops = draws.splice(0).filter(isDropSprite)
    assert.ok(beforeDrops.length >= 120, `期望光学水珠贴图数量充足，实际 ${beforeDrops.length}`)
    assert.ok(beforeDrops.some((d) => d.sw === 64), '应包含浅景深散景近景水珠贴图')
    for (const d of beforeDrops) {
      assert.ok(d.h / d.w <= 4.5, `水珠长宽比（${(d.h / d.w).toFixed(2)}）必须圆润自然，绝不拉成细硬直线`)
    }

    // 推进一帧 1/60s，逐滴核验真实位移速度与水滴旋转角严格同轴
    const dt = 1 / 60
    rain.step(dt)
    rain.draw(drawCtx)
    const afterDrops = draws.splice(0).filter(isDropSprite)

    const speeds = []
    let centerAlphaSum = 0
    let centerCount = 0
    let flankAlphaSum = 0
    let flankCount = 0

    for (let i = 0; i < Math.min(beforeDrops.length, afterDrops.length); i += 1) {
      const b = beforeDrops[i]
      const a = afterDrops[i]
      if (b.sw === 40) {
        if (b.tx >= 440 && b.tx <= 840) {
          centerAlphaSum += b.alpha
          centerCount += 1
        } else if (b.tx <= 220 || b.tx >= 1060) {
          flankAlphaSum += b.alpha
          flankCount += 1
        }
      }
      const dy = a.ty - b.ty
      const dx = a.tx - b.tx
      if (dy <= 0) continue // 跳过跨底重生的雨滴
      speeds.push(dy / dt)
      const moveSlope = dx / dy
      const spriteSlope = -Math.tan(b.rot)
      assert.ok(
        Math.abs(moveSlope - spriteSlope) < 1e-6,
        `水滴位移斜率 ${moveSlope} 与贴图旋转方向 ${spriteSlope} 必须严格同轴`,
      )
    }

    assert.ok(speeds.length > 80)
    const minVy = Math.min(...speeds)
    const maxVy = Math.max(...speeds)
    const avgVy = speeds.reduce((s, v) => s + v, 0) / speeds.length
    assert.ok(minVy > 360, `远景水珠速度过慢：${minVy} px/s`)
    assert.ok(avgVy > 480 && avgVy < 900, `平均水珠速度应低于人眼拉丝阈值并富自然动感：${avgVy} px/s`)
    assert.ok(maxVy < 1100, `近景水珠速度不应过高造成频闪拉丝：${maxVy} px/s`)

    const centerAvgAlpha = centerAlphaSum / Math.max(1, centerCount)
    const flankAvgAlpha = flankAlphaSum / Math.max(1, flankCount)
    assert.ok(
      centerAvgAlpha < flankAvgAlpha * 0.35,
      `中央阅读区水珠对比度（${centerAvgAlpha.toFixed(3)}）应显著低于两侧边缘（${flankAvgAlpha.toFixed(3)}）以保护阅读体验`,
    )

    // 连续推进 30 帧并切换浅色模式验证涟漪溅水亦无任何直线 lineTo 残留
    for (let k = 0; k < 30; k += 1) rain.step(dt)
    rain.setTone(false)
    strokes.length = 0
    draws.length = 0
    rain.draw(drawCtx)
    assert.equal(strokes.length, 0, `浅色模式及湖面水花溅起后亦不应残留任何 lineTo 直线，实际 ${strokes.length}`)

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
    'src/pages/Toolbox.tsx',
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

    // 滚动使 hero 进入紧凑上移后的顶栏防挡区间（header bottom = 56px -> yVanish = 48px, yOpaque = 88px）：
    // hero: top=-20, bottom=100 -> 跨越 [48, 88]，--yield-top = 88 - (-20) = 108px，--yield-fade = 40px
    scrollY = 100
    await flushYield()
    assert.equal(hero.getAttribute('data-yield'), 'on')
    assert.equal(hero.style.getPropertyValue('--yield-top'), '108px')
    assert.equal(hero.style.getPropertyValue('--yield-fade'), '40px')
    assert.equal(pageRoot.hasAttribute('data-yield'), false)
    assert.equal(cardList.hasAttribute('data-yield'), false)
    assert.equal(ignoredP.hasAttribute('data-yield'), false)
    assert.equal(dialogP.hasAttribute('data-yield'), false)

    // 继续滚动：hero 整块越过 yVanish=48px 进入 hidden 态；card-1 进入 [48, 88] 过渡带；card-2 位于 80px 亦同步平滑过渡
    scrollY = 250 // hero: bottom=-50<=48 -> hidden; card-1: top=-30, bottom=60 -> top=118px; card-2: top=80, bottom=170 -> top=8px
    await flushYield()
    assert.equal(hero.getAttribute('data-yield'), 'hidden')
    assert.equal(card1.getAttribute('data-yield'), 'on')
    assert.equal(card1.style.getPropertyValue('--yield-top'), '118px')
    assert.equal(card1.style.getPropertyValue('--yield-fade'), '40px')
    assert.equal(card2.getAttribute('data-yield'), 'on')
    assert.equal(card2.style.getPropertyValue('--yield-top'), '8px')

    // 再回退一点：card-2 完全处于清晰线 yOpaque=88px 下方，不挂任何蒙版
    scrollY = 230 // card-2: top=100 >= 88 -> unmasked
    await flushYield()
    assert.equal(card2.hasAttribute('data-yield'), false)

    // 校验深色模式感知补偿多控制点 S 曲线与防平铺规则均已写入全局样式
    const cssSource = readFileSync(join(root, 'src/styles/index.css'), 'utf8')
    assert.match(cssSource, /\.dark \[data-yield='on'\]/)
    assert.match(cssSource, /mask-repeat:\s*no-repeat/)
    assert.match(cssSource, /\[data-yield='hidden'\]/)

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

  // 校验单点、线段端点、曲线定义域端点、线线交点、曲曲相切交点、曲线线段交点及反比例渐近线无伪根
  const intersectScene = uiCcsMod.parseUiCcs([
    'create_point:(-3,4);',
    'create_line:(-2,2),(2,-2);',
    'create_line:(x^2);',
    'create_line:(2*x-1);',
    'create_line:(sqrt(4-x^2));',
    'create_line:(1/x);',
  ].join('\n'))
  const special = uiCcsMod.findUiCcsSpecialPoints(intersectScene.items, {
    centerX: 0,
    centerY: 0,
    unitsPerPx: 14 / 420,
  })
  const hasNear = (tx, ty) => special.some((p) => Math.hypot(p.x - tx, p.y - ty) < 1e-2)
  assert.ok(hasNear(-3, 4), '应识别单点 (-3, 4)')
  assert.ok(hasNear(-2, 2) && hasNear(2, -2), '应识别线段两端点 (-2, 2) 与 (2, -2)')
  assert.ok(hasNear(-2, 0) && hasNear(2, 0), '应识别半圆定义域端点 (-2, 0) 与 (2, 0)')
  assert.ok(hasNear(1, 1), '应识别抛物线 y=x^2 与切线 y=2x-1 的切点 (1, 1)')
  assert.ok(hasNear(-1, 1), '应识别 y=-x 线段与抛物线 y=x^2 的交点 (-1, 1)')
  assert.ok(hasNear(1 / 3, -1 / 3), '应识别 y=-x 线段与 y=2x-1 曲线的交点 (1/3, -1/3)')
  assert.ok(hasNear(-Math.SQRT2, Math.SQRT2), '应识别半圆 y=sqrt(4-x^2) 与线段 y=-x 的交点 (-√2, √2)')

  // 校验高斜率三次曲线 y=90*x^3+7*x^2+6*x 上的 2D 欧氏正交最近点投影（而非朴素竖直求值）
  const steepScene = uiCcsMod.parseUiCcs('create_line:(7*x^2+6*x+90*x^3);')
  const steepVp = { centerX: 0, centerY: 0, unitsPerPx: 14 / 420 }
  const steepSpecial = uiCcsMod.findUiCcsSpecialPoints(steepScene.items, steepVp)
  // 在 x=0.35 处 y ≈ 5.8169，斜率 ≈ 39.97；在右侧横向偏移 3px 处悬停仍能精确找到曲线最近点
  const yAt035 = 7 * 0.35 ** 2 + 6 * 0.35 + 90 * 0.35 ** 3
  const sxNearSteep = 340 + 0.35 / steepVp.unitsPerPx + 3
  const syNearSteep = 210 - yAt035 / steepVp.unitsPerPx
  const steepHit = uiCcsMod.resolveUiCcsHoverTarget(steepScene.items, steepSpecial, steepVp, sxNearSteep, syNearSteep)
  assert.ok(steepHit && steepHit.kind === 'line', '高斜率曲线旁 3px 悬停应命中曲线最近点')
  assert.ok(steepHit.distancePx < 3.2, `高斜率正交投影距离应 <= 3.2px，实际 ${steepHit.distancePx}`)
  assert.ok(Math.abs(steepHit.y - yAt035) < 0.05)
})

/* -------------------------------------------------------------------------- */
/*              4. Issue #82 表单交互控件、位运算/KaTeX 条件求值与边界测试         */
/* -------------------------------------------------------------------------- */

test('Issue #82：ui-choose / ui-select / ui-if / ui-write 解析、约束规则与 KaTeX 四则/位运算/比较求值', () => {
  const sampleMd = [
    '::begin_ui-choose[a_new_choose][今天吃什么][more 1 2]',
    '[A]',
    '香蕉好吃！',
    '[B]',
    '我！',
    '爱！',
    '$\\texttt{吃}$！',
    '香！',
    '蕉！',
    '[X]',
    '都不吃！',
    '[$\\sum$]',
    '计算题！',
    '::end_ui-choose',
    '',
    '主食：',
    '::begin_ui-select[Food][more 1 2][search]',
    '米饭',
    '面条',
    '面包',
    '::end_ui-select',
    '',
    '::begin_ui-if[Todo][lined]',
    '任务一',
    '::nex',
    '任务二',
    '::end_ui-if',
    '',
    '我今天要吃 ::ui-write[Number][R 0 1 4] 根香蕉！',
    '::ui-write[IgnoredNoNew][name 无效标题][faster][merge]',
    '::ui-write[Name][len 2 4][new][name 名字]',
    '::ui-write[MergePeer][set 同行][len 1 6][new][merge][name 同行输入]',
    '::ui-write[Ti][R 0 0 3][new][name 已经吃的香蕉][faster]',
  ].join('\n')

  const defs = uiWidgetsMod.extractUiWidgetDefs(sampleMd)
  assert.equal(defs.length, 8)

  const chooseDef = defs[0]
  assert.equal(chooseDef.kind, 'choose')
  assert.equal(chooseDef.name, '今天吃什么')
  assert.deepEqual({ min: chooseDef.minSelect, max: chooseDef.maxSelect }, { min: 1, max: 2 })
  assert.equal(chooseDef.options.length, 4)
  assert.equal(chooseDef.options[3].label, '$\\sum$')
  assert.match(chooseDef.options[1].content, /\\texttt\{吃\}/)

  const selectDef = defs[1]
  assert.equal(selectDef.kind, 'select')
  assert.equal(selectDef.search, true)
  assert.deepEqual({ min: selectDef.minSelect, max: selectDef.maxSelect }, { min: 1, max: 2 })

  const ifDef = defs[2]
  assert.equal(ifDef.kind, 'if')
  assert.equal(ifDef.lined, true)
  assert.equal(ifDef.items.length, 2)

  // 验证 name / faster / merge 修饰符前置条件（无 new 时 name/merge 不生效；无 R+new 时 faster 不生效）
  const ignoredNoNew = defs[4]
  assert.equal(ignoredNoNew.isNew, false)
  assert.equal(ignoredNoNew.name, undefined)
  assert.equal(ignoredNoNew.faster, false)
  assert.equal(ignoredNoNew.merge, false)

  const sliderDef = defs[7]
  assert.equal(sliderDef.faster, true)
  assert.equal(sliderDef.name, '已经吃的香蕉')

  // 验证 <<id>> / <id>（含精确匹配优先与大小写不敏感回退 Number -> <number>）及 <<id-number>>
  const lookup = uiWidgetsMod.buildUiValueLookup(defs, {
    a_new_choose: { kind: 'choose', selected: [2, 4] },
    Food: { kind: 'select', selected: [3] },
    Todo: { kind: 'if', checked: [true, false] },
    Number: { kind: 'write', value: '2' },
    Ti: { kind: 'write', value: '2' },
  })
  const replaced = uiWidgetsMod.substituteUiPlaceholdersInLine(
    '选=<<a_new_choose>>, 食=<Food>, 勾1=<<Todo-1>>, 勾2=<Todo-2>, 数=<number>, 吃=<Ti>',
    lookup,
  )
  assert.equal(replaced, '选=2, 4, 食=3, 勾1=1, 勾2=0, 数=2, 吃=2')

  // 验证 KaTeX 四则运算、位运算（& | \oplus << >> ~）、比较运算（\le \leq \ge \geq \ne \neq）与逻辑运算
  assert.equal(uiWidgetsMod.evaluateUiCondition('$2 \\le 2$'), true)
  assert.equal(uiWidgetsMod.evaluateUiCondition('$3 \\leq 2 \\times 2$'), true)
  assert.equal(uiWidgetsMod.evaluateUiCondition('$\\frac{6}{2} == 3$'), true)
  assert.equal(uiWidgetsMod.evaluateUiCondition('$(5 \\oplus 3) == 6$'), true)
  assert.equal(uiWidgetsMod.evaluateUiCondition('$(1 << 3) == 8$'), true)
  assert.equal(uiWidgetsMod.evaluateUiCondition('$((6 & 3) == 2) \\land (4 \\ge 5)$'), false)

  const inlineExpanded = uiWidgetsMod.expandInlineIfDirectives(
    uiWidgetsMod.substituteUiPlaceholdersInLine(
      '<IF:$<number> \\le <Ti>$,你真棒！><IF:$<number> \\leq 2 \\times <Ti>$,还不错！>',
      lookup,
    ),
  )
  assert.equal(inlineExpanded, '你真棒！还不错！')

  // 验证 TOC 与文章摘要不会泄漏 UI 控件源码
  const postWithUi = `## 引言\n\n摘要正文。\n\n${sampleMd}\n\n## 总结`
  assert.deepEqual(postsMod.extractToc(postWithUi).map((h) => h.text), ['引言', '总结'])
  assert.doesNotMatch(postsMod.excerpt(postWithUi), /begin_ui-choose|ui-write|::nex/)
})

/* -------------------------------------------------------------------------- */
/*          5. Issue #83 图论画布自动建点、几何裁剪与编辑器「调整模式」写回验证    */
/* -------------------------------------------------------------------------- */

test('Issue #83：ui-graph 自动创建未声明节点、dag 有向箭头、重边自环几何，以及编辑器「调整模式」拖拽写回源码', async () => {
  const graph = uiGraphMod.parseUiGraph(
    '[dag]',
    [
      'isolated',
      '1 2 10',
      '2 1 20',
      '2 3',
      '3 3 7',
      '4 5 - -2.5 3.5',
    ].join('\n'),
  )
  assert.equal(graph.directed, true)
  assert.equal(graph.errors.length, 0)
  // isolated + 自动创建的 1, 2, 3, 4, 5 共 6 个点
  assert.deepEqual(
    graph.nodes.map((n) => n.id),
    ['isolated', '1', '2', '3', '4', '5'],
  )
  const node4 = graph.nodes.find((n) => n.id === '4')
  assert.deepEqual({ x: node4.x, y: node4.y }, { x: -2.5, y: 3.5 })

  const vp = uiGraphMod.computeInitialUiGraphViewport(graph.nodes)
  const geoms = uiGraphMod.computeGraphEdgeGeometries(graph.nodes, graph.edges, true, vp)
  assert.equal(geoms.length, 5)
  // 1->2 与 2->1 为平行重边，应自动弯曲为二次贝塞尔曲线 Q，且每条有向边均有箭头
  assert.match(geoms[0].pathD, /^M[\d.-]+ [\d.-]+ Q/)
  assert.match(geoms[1].pathD, /^M[\d.-]+ [\d.-]+ Q/)
  // 3->3 自环为三次贝塞尔曲线 C
  assert.match(geoms[3].pathD, /^M[\d.-]+ [\d.-]+ C/)
  for (const g of geoms) {
    assert.ok(g.arrowTip, 'dag 模式下每条边均应生成有向箭头坐标与角度')
    assert.doesNotMatch(g.pathD, /NaN|Infinity/)
  }

  // 在真实 JSDOM + React 19 中挂载带 onContentChange 的编辑器预览，实测开启「调整模式」拖拽点位并写回源码
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    pretendToBeVisual: true,
    url: 'http://localhost/',
  })
  const prevGlobals = {
    window: globalThis.window,
    document: globalThis.document,
    DOMParser: globalThis.DOMParser,
    HTMLElement: globalThis.HTMLElement,
    SVGElement: globalThis.SVGElement,
    Node: globalThis.Node,
  }
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    DOMParser: dom.window.DOMParser,
    HTMLElement: dom.window.HTMLElement,
    SVGElement: dom.window.SVGElement,
    Node: dom.window.Node,
  })

  try {
    const editorBundle = await build({
      stdin: {
        contents: `
          import React from 'react'
          import { createRoot } from 'react-dom/client'
          import { Markdown } from './src/components/Markdown'
          export { React, createRoot, Markdown }
        `,
        resolveDir: root,
        loader: 'tsx',
      },
      bundle: true,
      write: false,
      format: 'esm',
      platform: 'browser',
      target: 'es2022',
      define: { __STARLOG_OFFLINE__: 'false' },
      loader: { '.css': 'empty', '.woff': 'empty', '.woff2': 'empty', '.ttf': 'empty' },
    })
    const { React, createRoot, Markdown } = await import(
      `data:text/javascript;base64,${Buffer.from(editorBundle.outputFiles[0].text, 'utf8').toString('base64')}`
    )

    let currentMd = [
      '## 图论演示',
      '',
      '::begin_ui-graph[dag]',
      '5',
      '1 2 10',
      '2 3 5',
      '::end_ui-graph',
    ].join('\n')

    const container = dom.window.document.getElementById('root')
    const reactRoot = createRoot(container)
    const rerender = async () => {
      reactRoot.render(
        React.createElement(Markdown, {
          content: currentMd,
          sourceLineMarkers: true,
          onContentChange: (updater) => {
            currentMd = typeof updater === 'function' ? updater(currentMd) : updater
          },
        }),
      )
      await new Promise((r) => setTimeout(r, 35))
    }

    await rerender()

    const svg = container.querySelector('.ui-graph-box svg[role="application"]')
    svg.getBoundingClientRect = () => ({ left: 0, top: 0, width: 680, height: 420, right: 680, bottom: 420 })
    svg.setPointerCapture = () => {}

    // 验证纯图论画布：无任何直角坐标系网格线、无坐标轴 <line>、无坐标刻度，悬浮节点时也绝不显示任何坐标文字
    assert.equal(svg.querySelectorAll('line').length, 0, '图论画布不应渲染 X/Y 坐标轴线')
    assert.equal(svg.querySelectorAll('path').length, 2, 'SVG path 数量应严格等于边数（无背景网格 path）')
    // Issue #91：边权只保留纯数字文本，不再带有白色/深色底色块（无任何 <rect> 底）
    assert.equal(
      svg.querySelectorAll('g[data-graph-edge] rect').length,
      0,
      '边权标签不应再包裹任何底色 <rect>，应改为纯数字',
    )
    const weightTexts = [...svg.querySelectorAll('g[data-graph-edge] text')].map((t) => t.textContent)
    assert.deepEqual(weightTexts.sort(), ['10', '5'], '边权应以纯数字文本直接标注在边旁')
    const staticSvg = uiGraphMod.renderStaticUiGraphSvg('[dag]', '5\n1 2 10\n2 3 5')
    assert.doesNotMatch(staticSvg, /<line\b/, '静态 SVG 模式也不应包含任何坐标轴')
    assert.equal((staticSvg.match(/<path\b/g) || []).length, 2, '静态 SVG path 数量应严格等于边数')
    assert.doesNotMatch(staticSvg, /<rect\b/, '静态 SVG 的边权同样不应带底色块')
    assert.match(staticSvg, />10</, '静态 SVG 应保留纯数字边权 10')

    // 读取节点 1 当前屏幕坐标，先测试普通悬浮绝不弹出坐标气泡
    const node1El = container.querySelector('[data-node-id="1"]')
    const matchT = node1El.getAttribute('transform').match(/translate\(([-\d.]+),([-\d.]+)\)/)
    const startSX = Number(matchT[1])
    const startSY = Number(matchT[2])
    const Ptr = dom.window.PointerEvent || dom.window.MouseEvent

    svg.dispatchEvent(new Ptr('pointermove', { bubbles: true, clientX: startSX, clientY: startSY, pointerId: 1 }))
    await new Promise((r) => setTimeout(r, 15))
    assert.doesNotMatch(svg.textContent || '', /\([-\d.]+,\s*[-\d.]+\)/, '悬浮节点时绝不应显示坐标文本')

    // 再开启「调整模式」拖拽到新的目标坐标 (490, 90)
    const adjustBtn = [...container.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('调整模式'),
    )
    assert.ok(adjustBtn, '编辑器模式下 GraphPlane 应渲染「调整模式」按钮')
    adjustBtn.click()
    await new Promise((r) => setTimeout(r, 25))

    svg.dispatchEvent(new Ptr('pointerdown', { bubbles: true, button: 0, clientX: startSX, clientY: startSY, pointerId: 1 }))
    await new Promise((r) => setTimeout(r, 15))
    svg.dispatchEvent(new Ptr('pointermove', { bubbles: true, clientX: 490, clientY: 90, pointerId: 1 }))
    await new Promise((r) => setTimeout(r, 15))
    assert.doesNotMatch(svg.textContent || '', /\([-\d.]+,\s*[-\d.]+\)/, '拖拽节点时画布内同样不显示坐标气泡')
    svg.dispatchEvent(new Ptr('pointerup', { bubbles: true, clientX: 490, clientY: 90, pointerId: 1 }))
    await new Promise((r) => setTimeout(r, 25))

    // 验证松手后点位已自动保存回 Markdown 源码，且边权完全保留
    assert.match(currentMd, /1 \([-\d.]+, [-\d.]+\)/, `拖拽后应将节点 1 新坐标写入源码，实际：\n${currentMd}`)
    assert.match(currentMd, /1 2 10/)
    assert.match(currentMd, /2 3 5/)

    // 重新渲染后再点击重置按钮，验证恢复自动布局并清理辅助坐标行
    await rerender()
    const resetBtn = container.querySelector('button[title*="重置"]')
    if (resetBtn) {
      resetBtn.click()
      await new Promise((r) => setTimeout(r, 25))
      assert.doesNotMatch(currentMd, /1 \([-\d.]+, [-\d.]+\)/)
    }

    // 同步实测：多行/多段 ui-if[lined] 逐行删除线结构 & 单行 ui-write 无外层包裹卡片框
    currentMd = [
      '::begin_ui-if[MultiLined][lined]',
      '第一行待办',
      '第二行带公式 $\\texttt{AC}$',
      '::nex',
      '第一段说明',
      '',
      '第二段说明',
      '::end_ui-if',
      '',
      '::ui-write[CleanSingle][len 2 6][new][name 昵称]',
    ].join('\n')
    await rerender()

    const ifCard = container.querySelector('[data-ui-id="MultiLined"]')
    assert.equal(ifCard.querySelectorAll('.ui-if-strike-bar').length, 0, '不应残留旧版单条绝对定位划线元素')
    const strikeRuns = ifCard.querySelectorAll('.ui-if-lined .ui-if-strike-text')
    assert.equal(strikeRuns.length, 3, '多行条目（1 段含 <br>）+ 多段条目（2 段）应生成 3 个逐行内联删除线片段')
    assert.equal(strikeRuns[0].querySelectorAll('br').length, 1, '多行单换行条目应保留 <br> 实现逐行删除线')
    const cssSource = readFileSync(join(root, 'src/styles/index.css'), 'utf8')
    assert.match(cssSource, /\.ui-if-lined\s+\.ui-if-strike-text/)
    assert.match(cssSource, /box-decoration-break:\s*clone/)

    const writeField = container.querySelector('[data-ui-id="CleanSingle"]')
    assert.ok(writeField, '应渲染独立行 ui-write 字段')
    assert.doesNotMatch(writeField.className, /\bborder\b/, '单行输入框外层容器不应再有包裹边框框')

    reactRoot.unmount()
    await new Promise((r) => setTimeout(r, 30))
  } finally {
    dom.window.close()
    Object.assign(globalThis, prevGlobals)
  }
})

test('回声洞（#93）：严格识别每小时前 3 条 / 每天前 10 条，仓库贡献者不受限制', () => {
  const { filterRecognizedEchoes } = echoCaveMod
  const t0 = Date.parse('2026-10-22T08:00:00Z')
  const min = 60_000
  const hour = 3_600_000

  // 1) 普通访客同一小时发送 5 条（故意乱序输入）：严格只识别按时间最早的前 3 条
  const burstComments = [
    { id: 'c4', body: '第 4 条（应忽略）', createdAt: new Date(t0 + 40 * min).toISOString(), authorLogin: 'visitor_a', authorAssociation: 'NONE' },
    { id: 'c2', body: '第 2 条', createdAt: new Date(t0 + 15 * min).toISOString(), authorLogin: 'visitor_a', authorAssociation: 'NONE' },
    { id: 'c5', body: '第 5 条（应忽略）', createdAt: new Date(t0 + 50 * min).toISOString(), authorLogin: 'visitor_a', authorAssociation: 'NONE' },
    { id: 'c1', body: '第 1 条', createdAt: new Date(t0 + 5 * min).toISOString(), authorLogin: 'visitor_a', authorAssociation: 'NONE' },
    { id: 'c3', body: '第 3 条', createdAt: new Date(t0 + 25 * min).toISOString(), authorLogin: 'visitor_a', authorAssociation: 'NONE' },
  ]
  const recognizedHour = filterRecognizedEchoes(burstComments, { repoOwner: 'lrbkdgw' })
  assert.deepEqual(
    recognizedHour.map((item) => item.text),
    ['第 1 条', '第 2 条', '第 3 条'],
    '同一小时超出 3 条时应仅识别最早发送的前 3 条',
  )

  // 2) 普通访客一天内分 4 个独立小时共发送 12 条（每小时 3 条）：严格只识别当天前 10 条
  const dailyComments = []
  for (let h = 0; h < 4; h++) {
    for (let k = 0; k < 3; k++) {
      const idx = h * 3 + k + 1
      dailyComments.push({
        id: `d${idx}`,
        body: `当日第 ${idx} 条`,
        createdAt: new Date(t0 + h * 2 * hour + k * 10 * min).toISOString(),
        authorLogin: 'visitor_b',
        authorAssociation: 'NONE',
      })
    }
  }
  const recognizedDay = filterRecognizedEchoes(dailyComments, { repoOwner: 'lrbkdgw' })
  assert.equal(recognizedDay.length, 10, '24 小时内最多识别前 10 条')
  assert.equal(recognizedDay[9].text, '当日第 10 条')

  // 3) 仓库贡献者（OWNER / CONTRIBUTOR / contributorLogins 列表）完全不受限制
  const contributorComments = Array.from({ length: 15 }, (_, i) => ({
    id: `owner-${i + 1}`,
    body: `贡献者回声 ${i + 1}`,
    createdAt: new Date(t0 + i * min).toISOString(),
    authorLogin: 'commit_helper',
    authorAssociation: 'NONE',
  }))
  const recognizedContributor = filterRecognizedEchoes(contributorComments, {
    repoOwner: 'lrbkdgw',
    contributorLogins: new Set(['commit_helper']),
  })
  assert.equal(recognizedContributor.length, 15, '仓库贡献者发送任意条均应全部识别')

    // 4) 经匿名中继写入（即使 GitHub 令牌账号为 OWNER）仍按匿名访客严格限制每小时 3 条
    const relayedComments = Array.from({ length: 5 }, (_, i) => ({
      id: `relay-${i + 1}`,
      body: `匿名留言 ${i + 1}\n\n<${'!--'} echo-sender:anon:abcdef012345 -->`,
      createdAt: new Date(t0 + i * 5 * min).toISOString(),
      authorLogin: 'lrbkdgw',
      authorAssociation: 'OWNER',
    }))
    const recognizedRelay = filterRecognizedEchoes(relayedComments, { repoOwner: 'lrbkdgw' })
    assert.deepEqual(
      recognizedRelay.map((item) => item.text),
      ['匿名留言 1', '匿名留言 2', '匿名留言 3'],
      '匿名中继访客仍受每小时前 3 条识别限制且不泄露 HTML 标记',
    )

    // 5) 无重复轮播选择器：即使 Discussions 只有 1 条留言且一言偶发返回重复文本，连续点击 30 次严格零重复
    const deck = echoCaveMod.createEchoDeck()
    deck.setDiscussionEchoes([
      { id: 'disc-only-1', text: '唯一一条社区留言', source: 'discussion' },
    ])
    assert.equal(deck.pushHitokoto({ id: 'h1', text: '重复缓存一言', source: 'hitokoto' }), true)
    assert.equal(deck.pushHitokoto({ id: 'h2', text: '重复缓存一言', source: 'hitokoto' }), false)

    const picked30 = []
    let prevText
    for (let i = 0; i < 30; i++) {
      const next = deck.next(prevText)
      picked30.push(next.text)
      prevText = next.text
    }
    assert.equal(
      new Set(picked30).size,
      30,
      `连续点击 30 次不应出现任何重复内容，实际去重数：${new Set(picked30).size}`,
    )
})

test('百宝箱与全屏极简回声洞（#93）：顶栏页签、用户背景、逐字出现、箭头发送按钮与无多余按键交互', async () => {
  const harnessEntry = join(root, 'node_modules/.cache/echo-cave-test-harness.tsx')
  const { mkdirSync, writeFileSync } = await import('node:fs')
  mkdirSync(dirname(harnessEntry), { recursive: true })
  writeFileSync(
    harnessEntry,
    `
      import React from 'react'
      import { createRoot } from 'react-dom/client'
      import { MemoryRouter } from 'react-router-dom'
      import { ThemeProvider } from '../../src/lib/theme'
      import { BackgroundProvider } from '../../src/lib/background'
      import { AuthProvider } from '../../src/lib/auth'
      import { ToastProvider } from '../../src/components/Toast'
      import { setAnimatedScene, setAnimatedSceneOverride } from '../../src/lib/animatedBackground'
      import App from '../../src/App'
      export {
        React,
        createRoot,
        MemoryRouter,
        ThemeProvider,
        BackgroundProvider,
        AuthProvider,
        ToastProvider,
        setAnimatedScene,
        setAnimatedSceneOverride,
        App,
      }
    `,
    'utf8',
  )

  const bundled = await build({
    entryPoints: [harnessEntry],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    plugins: [viteRawImports],
    loader: {
      '.css': 'empty',
      '.jpg': 'dataurl',
      '.png': 'dataurl',
      '.svg': 'dataurl',
      '.md': 'text',
      '.css': 'empty',
    },
    define: {
      'process.env.NODE_ENV': '"production"',
      __STARLOG_OFFLINE__: 'false',
    },
  })
  const { pathToFileURL } = await import('node:url')
  const bundlePath = join(dirname(harnessEntry), 'echo-cave-test-bundle.mjs')
  writeFileSync(bundlePath, bundled.outputFiles[0].text, 'utf8')
  const {
    React,
    createRoot,
    MemoryRouter,
    ThemeProvider,
    BackgroundProvider,
    AuthProvider,
    ToastProvider,
    setAnimatedScene,
    setAnimatedSceneOverride,
    App,
  } = await import(pathToFileURL(bundlePath).href)

  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'https://blog-apa.pages.dev/',
    pretendToBeVisual: true,
  })

  const savedComments = [
    {
      id: 101,
      node_id: 'DC_101',
      body: '来自 Discussions 的第一声回响',
      created_at: '2026-10-22T06:00:00Z',
      author_association: 'NONE',
      user: { login: 'alice' },
    },
  ]
  let hitokotoSeq = 0

  const prevGlobals = {
    window: globalThis.window,
    document: globalThis.document,
    localStorage: globalThis.localStorage,
    sessionStorage: globalThis.sessionStorage,
    HTMLElement: globalThis.HTMLElement,
    SVGElement: globalThis.SVGElement,
    Node: globalThis.Node,
    MutationObserver: globalThis.MutationObserver,
    ResizeObserver: globalThis.ResizeObserver,
    matchMedia: globalThis.matchMedia,
    requestAnimationFrame: globalThis.requestAnimationFrame,
    cancelAnimationFrame: globalThis.cancelAnimationFrame,
    fetch: globalThis.fetch,
    DOMParser: globalThis.DOMParser,
    CustomEvent: globalThis.CustomEvent,
    Event: globalThis.Event,
  }

  globalThis.window = dom.window
  globalThis.document = dom.window.document
  globalThis.localStorage = dom.window.localStorage
  globalThis.sessionStorage = dom.window.sessionStorage
  globalThis.HTMLElement = dom.window.HTMLElement
  globalThis.SVGElement = dom.window.SVGElement
  globalThis.Node = dom.window.Node
  globalThis.MutationObserver = dom.window.MutationObserver
  globalThis.DOMParser = dom.window.DOMParser
  globalThis.CustomEvent = dom.window.CustomEvent
  globalThis.Event = dom.window.Event
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  dom.window.matchMedia = () => ({
    matches: false,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
  })
  globalThis.matchMedia = dom.window.matchMedia
  dom.window.requestAnimationFrame = (cb) => setTimeout(() => cb(performance.now()), 16)
  dom.window.cancelAnimationFrame = (id) => clearTimeout(id)
  globalThis.requestAnimationFrame = dom.window.requestAnimationFrame
  globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame
  dom.window.scrollTo = () => {}

  globalThis.fetch = async (input, init) => {
    const url = String(input)
    if (url.includes('/discussions?')) {
      return new Response(
        JSON.stringify([{ number: 99, node_id: 'D_99', title: '回声洞', body: '' }]),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    }
    if (url.includes('/contributors?')) {
      return new Response(JSON.stringify([{ login: 'lrbkdgw' }]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    if (url.includes('/discussions/99/comments')) {
      return new Response(JSON.stringify(savedComments), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    if (url.includes('hitokoto.cn')) {
      hitokotoSeq += 1
      return new Response(
        JSON.stringify({
          id: hitokotoSeq,
          hitokoto: `一言测试语句 #${hitokotoSeq}`,
          from: '星野集',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    }
    if (url === '/api/echo' && init?.method === 'POST') {
      const payload = JSON.parse(String(init.body || '{}'))
      return new Response(
        JSON.stringify({
          comment: {
            id: 'DC_NEW_1',
            body: payload.text,
            createdAt: new Date().toISOString(),
            authorLogin: null,
            authorAssociation: 'NONE',
          },
          recognized: true,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    }
    return new Response('{}', { status: 404 })
  }

  const container = dom.window.document.getElementById('root')
  const reactRoot = createRoot(container)
  dom.window.HTMLCanvasElement.prototype.getContext = (kind) =>
    kind === '2d' ? makeMock2dContext([], []) : null

  try {
    // 模拟用户在设置页选择了动态背景「樱花」，即便此前某篇文章留下 ::set-background[0] 覆盖，回声洞也必须展示用户自己选择的背景
    setAnimatedScene('sakura')
    setAnimatedSceneOverride('none')

    reactRoot.render(
      React.createElement(
        MemoryRouter,
        { initialEntries: ['/toolbox'] },
        React.createElement(
          ThemeProvider,
          null,
          React.createElement(
            AuthProvider,
            null,
            React.createElement(
              BackgroundProvider,
              null,
              React.createElement(ToastProvider, null, React.createElement(App)),
            ),
          ),
        ),
      ),
    )

    await new Promise((r) => setTimeout(r, 120))

    // 1) 顶栏存在「百宝箱」页签，页面中仅展示「回声洞」模块入口
    const header = container.querySelector('header.site-header')
    assert.ok(header, '/toolbox 页面应正常渲染顶部导航栏')
    assert.match(header.textContent || '', /百宝箱/, '顶部导航栏应包含「百宝箱」页签')

    const echoLink = container.querySelector('a[href="/toolbox/echo"]')
    assert.ok(echoLink, '百宝箱页面应包含指向 /toolbox/echo 的「回声洞」入口')
    assert.match(echoLink.textContent || '', /回声洞/)

    // 2) 点击进入回声洞：完全独占全屏，展示用户选择的背景，没有任何多余按键，底部只有一条横线和一个箭头发送按钮
    echoLink.click()
    await new Promise((r) => setTimeout(r, 120))

    assert.equal(container.querySelectorAll('header').length, 0, '回声洞页面不应渲染顶栏 <header>')
    assert.equal(container.querySelectorAll('footer').length, 0, '回声洞页面不应渲染底栏 <footer>')
    assert.ok(container.querySelector('canvas'), '回声洞页面应完整渲染用户选择的动态背景画布（忽略文章级覆盖）')

    const fullscreenRoot = container.querySelector('[data-echo-cave-fullscreen]')
    assert.ok(fullscreenRoot, '应渲染独占全屏的回声洞容器')
    assert.match(fullscreenRoot.className, /\bbg-transparent\b/, '全屏容器应透明透出用户所选背景')

    const allButtons = [...container.querySelectorAll('button')]
    assert.equal(allButtons.length, 1, '整个回声洞页面必须严格只有一个发送按钮，没有任何其他按键')
    assert.ok(allButtons[0].querySelector('svg'), '发送按钮应为箭头图标')
    assert.equal(allButtons[0].textContent?.trim(), '', '箭头发送按钮不应残留多余文字')

    const allInputs = [...container.querySelectorAll('input')]
    assert.equal(allInputs.length, 1, '底部必须只有一条独立输入横线')
    assert.match(allInputs[0].className, /\bborder-b\b/, '输入控件应为底部横线样式')
    assert.match(allInputs[0].className, /\bborder-0\b/, '输入控件不应有四周边框盒')

    // 3) 验证 v2 双通道消散引擎（FBM 分形侵蚀场 + WebGL2 双 Pass GPU 着色器管线 + Canvas2D 28 层 Thanos Dust 兜底）
    const sampleN = echoAshMod.fbm2D(1.25, 2.75, 42, 3)
    assert.ok(sampleN >= 0 && sampleN <= 1, `fbm2D 应归一化在 [0,1]，实际 ${sampleN}`)
    const sampleN2 = echoAshMod.fbm2D(1.26, 2.75, 42, 3)
    assert.ok(Math.abs(sampleN - sampleN2) < 0.05, 'fbm2D 相邻采样应保持平滑连续以形成丝带状风场')

    // 验证 40,000+ 亚像素墨点自动按 32,768 安全分片、无方向噪声斑块脱离阈值分布与右上扬升风场向量
    const syntheticW = 400
    const syntheticH = 120
    const syntheticPixels = new Uint8ClampedArray(syntheticW * syntheticH * 4)
    for (let i = 0; i < 40_000; i += 1) {
      syntheticPixels[i * 4] = 24
      syntheticPixels[i * 4 + 1] = 24
      syntheticPixels[i * 4 + 2] = 27
      syntheticPixels[i * 4 + 3] = 255
    }
    const field = echoAshMod.buildAshParticleField(syntheticPixels, syntheticW, syntheticH, 2, 2026)
    assert.equal(field.blockSize, 1, '常规与长句墨点均应保持 1px 亚像素级精细颗粒度')
    assert.equal(field.particleCount, 40_000, '所有可见墨点纹素均应无遗漏转换为独立微粒')
    assert.equal(field.chunks.length, 2, '超过 32,768 微粒时应按 Safari Metal 安全上限自动分片')
    assert.equal(field.chunks[0].count, 32_768)
    assert.equal(field.chunks[1].count, 7_232)
    // 脱离阈值必须无方向性：整幅阈值图应铺满脱离时间窗（噪声斑块先后起飘），
    // 且左、右三分之一的平均脱离时刻应接近——绝不允许再出现左->右横扫的「光带」
    {
      let thrMin = 255
      let thrMax = 0
      let leftSum = 0
      let leftN = 0
      let rightSum = 0
      let rightN = 0
      for (let ty = 0; ty < field.thresholdHeight; ty += 1) {
        for (let tx = 0; tx < field.thresholdWidth; tx += 1) {
          const v = field.thresholdMap[ty * field.thresholdWidth + tx]
          if (v < thrMin) thrMin = v
          if (v > thrMax) thrMax = v
          if (tx < field.thresholdWidth / 3) {
            leftSum += v
            leftN += 1
          } else if (tx >= (2 * field.thresholdWidth) / 3) {
            rightSum += v
            rightN += 1
          }
        }
      }
      assert.ok(
        thrMax - thrMin > 60,
        `脱离阈值应经分位归一化铺满整个时间窗形成有机斑块，实际范围 ${thrMin}..${thrMax}`,
      )
      const leftMean = leftSum / leftN
      const rightMean = rightSum / rightN
      assert.ok(
        Math.abs(leftMean - rightMean) < 18,
        `脱离时刻不得有左->右（或右->左）方向性横扫：左侧均值 ${leftMean.toFixed(1)} vs 右侧均值 ${rightMean.toFixed(1)}（字节尺度 1..82）`,
      )
    }
    assert.ok(field.chunks[0].data[3] > 0 && field.chunks[0].data[4] < 0, '粒子流线速度场应向右上方自然飘升')

    // 验证 WebGL2 双 Pass GPU 着色器管线（GLSL 全部 attribute / uniform 严格对齐、首帧 progress===0 零接缝交接与零显存泄漏）
    {
      const glCanvas = dom.window.document.createElement('canvas')
      const livePrograms = new Set()
      const liveShaders = new Set()
      const liveBuffers = new Set()
      const liveVaos = new Set()
      const liveTextures = new Set()
      const progressHistory = []
      const drawCalls = []
      let lostCalled = false
      let idSeq = 1

      glCanvas.getContext = (kind) => {
        if (kind !== 'webgl2') return null
        return {
          VERTEX_SHADER: 0x8b31,
          FRAGMENT_SHADER: 0x8b30,
          COMPILE_STATUS: 0x8b81,
          LINK_STATUS: 0x8b82,
          ARRAY_BUFFER: 0x8892,
          STATIC_DRAW: 0x88e4,
          FLOAT: 0x1406,
          BLEND: 0x0be2,
          ONE: 1,
          ONE_MINUS_SRC_ALPHA: 0x0303,
          COLOR_BUFFER_BIT: 0x4000,
          TEXTURE0: 0x84c0,
          TEXTURE1: 0x84c1,
          TEXTURE_2D: 0x0de1,
          TEXTURE_WRAP_S: 0x2802,
          TEXTURE_WRAP_T: 0x2803,
          TEXTURE_MIN_FILTER: 0x2801,
          TEXTURE_MAG_FILTER: 0x2800,
          CLAMP_TO_EDGE: 0x812f,
          LINEAR: 0x2601,
          NEAREST: 0x2600,
          UNPACK_PREMULTIPLY_ALPHA_WEBGL: 0x9241,
          UNPACK_ALIGNMENT: 0x0cf5,
          RGBA: 0x1908,
          R8: 0x8229,
          RED: 0x1903,
          UNSIGNED_BYTE: 0x1401,
          TRIANGLE_STRIP: 0x0005,
          POINTS: 0x0000,
          createShader(type) {
            const sh = { id: idSeq++, type, src: '' }
            liveShaders.add(sh)
            return sh
          },
          shaderSource(sh, src) {
            sh.src = src
          },
          compileShader(sh) {
            assert.match(sh.src, /^#version 300 es/, 'WebGL2 着色器必须声明 #version 300 es')
          },
          getShaderParameter() {
            return true
          },
          deleteShader(sh) {
            liveShaders.delete(sh)
          },
          createProgram() {
            const prog = { id: idSeq++, shaders: [] }
            livePrograms.add(prog)
            return prog
          },
          attachShader(prog, sh) {
            prog.shaders.push(sh.src)
          },
          linkProgram() {},
          getProgramParameter() {
            return true
          },
          deleteProgram(prog) {
            livePrograms.delete(prog)
          },
          getUniformLocation(prog, name) {
            const combined = prog.shaders.join('\n')
            assert.ok(
              new RegExp(`uniform\\s+\\w+\\s+${name}\\b`).test(combined),
              `着色器未声明 uniform "${name}"`,
            )
            return { name }
          },
          createVertexArray() {
            const vao = { id: idSeq++ }
            liveVaos.add(vao)
            return vao
          },
          deleteVertexArray(vao) {
            liveVaos.delete(vao)
          },
          bindVertexArray() {},
          createBuffer() {
            const buf = { id: idSeq++ }
            liveBuffers.add(buf)
            return buf
          },
          deleteBuffer(buf) {
            liveBuffers.delete(buf)
          },
          bindBuffer() {},
          bufferData() {},
          enableVertexAttribArray() {},
          vertexAttribPointer(_idx, size, _type, _norm, stride, offset) {
            if (stride > 0) {
              assert.equal(stride, 36, '粒子交错顶点缓冲步长必须严格为 9 * 4 = 36 字节')
              assert.ok(offset + size * 4 <= 36, '顶点属性偏移不得越界')
            }
          },
          createTexture() {
            const tex = { id: idSeq++ }
            liveTextures.add(tex)
            return tex
          },
          deleteTexture(tex) {
            liveTextures.delete(tex)
          },
          activeTexture() {},
          bindTexture() {},
          texParameteri() {},
          pixelStorei() {},
          texImage2D() {},
          enable() {},
          blendFunc() {},
          viewport() {},
          clearColor() {},
          clear() {},
          useProgram() {},
          uniform1f(loc, v) {
            if (loc?.name === 'u_progress') progressHistory.push(v)
          },
          uniform1i() {},
          uniform2f() {},
          uniform3f() {},
          drawArrays(mode, _first, count) {
            drawCalls.push({ mode, count })
          },
          getExtension(name) {
            return name === 'WEBGL_lose_context' ? { loseContext: () => { lostCalled = true } } : null
          },
        }
      }

      const glCtrl = echoAshMod.attachEchoAshCanvas(glCanvas)
      assert.equal(glCtrl.backend, 'webgl2', '支持 WebGL2 时应自动启用 GPU 粒子着色器后端')
      assert.equal(liveShaders.size, 0, '链接完成后临时 Shader 对象应立即释放')
      assert.equal(livePrograms.size, 1, '应编译 GPU 粒子流线着色器程序（底图由原 DOM 零位移承载并均匀淡出交接）')

      await new Promise((r) => setTimeout(r, 1150))
      const liveSentenceEl = fullscreenRoot.querySelector('[data-echo-sentence]')
      assert.ok(liveSentenceEl, '首句 DOM 节点应已就绪可供 GPU 快照测试')
      const spawned = glCtrl.disintegrateFromElement(liveSentenceEl)
      assert.ok(spawned > 50, `WebGL2 后端应生成充足亚像素粒子，实际 ${spawned}`)
      assert.equal(progressHistory[0], 0, '首帧 u_progress 必须严格等于 0 以实现原字迹 100% 零接缝交接')
      assert.equal(
        Number(liveSentenceEl.style.opacity),
        1,
        '首帧原 DOM 必须为 100% 满不透明无损原位显示（粒子此时不可见），彻底杜绝首帧任何像素瞬移',
      )
      assert.equal(
        liveSentenceEl.style.maskImage ?? '',
        '',
        '不得再使用任何方向性遮罩横扫原句（左->右光带已被移除）',
      )
      assert.ok(drawCalls.some((d) => d.mode === 0x0000 && d.count === spawned), '应执行 GPU POINTS 亚像素粒子绘制')

      glCtrl.destroy()
      assert.equal(liveSentenceEl.style.opacity, '', 'destroy() 后应彻底还原原 DOM 节点消散样式')
      assert.equal(liveSentenceEl.style.filter, '', 'destroy() 后应彻底还原原 DOM 节点滤镜样式')
      assert.equal(liveTextures.size, 0, 'destroy() 后所有 GPU 纹理必须零泄漏释放')
      assert.equal(liveBuffers.size, 0, 'destroy() 后所有 GPU 缓冲必须零泄漏释放')
      assert.equal(liveVaos.size, 0, 'destroy() 后所有 VAO 必须零泄漏释放')
      assert.equal(livePrograms.size, 0, 'destroy() 后所有 GPU Program 必须零泄漏释放')
      assert.equal(lostCalled, true, 'destroy() 后应主动归还 WebGL 上下文')
    }

    const ashCanvas = fullscreenRoot.querySelector('canvas[data-echo-ash-canvas]')
    assert.ok(ashCanvas, '回声洞应挂载全屏骨灰消散粒子画布')

    const reverseFlips = []
    const prematureMountFlashes = []
    const antiFlashObserver = new dom.window.MutationObserver((mutations) => {
      for (const m of mutations) {
        if (
          m.type === 'attributes' &&
          m.attributeName === 'data-char-shown' &&
          m.oldValue === 'true' &&
          m.target.getAttribute('data-char-shown') === 'false'
        ) {
          reverseFlips.push(m.target.textContent)
        }
        if (m.type === 'childList') {
          for (const node of m.addedNodes) {
            if (node.nodeType === 1 && node.matches?.('[data-echo-sentence]')) {
              const shownOnMount = node.querySelectorAll('[data-char-shown="true"]').length
              if (shownOnMount > 0) {
                prematureMountFlashes.push(shownOnMount)
              }
            }
          }
        }
      }
    })
    antiFlashObserver.observe(fullscreenRoot, {
      attributes: true,
      attributeOldValue: true,
      childList: true,
      subtree: true,
    })

    const firstSentenceText = fullscreenRoot.querySelector('p')?.textContent?.trim()
    assert.ok(firstSentenceText, '首句应正常显示')
    assert.equal(
      fullscreenRoot.querySelectorAll('[data-char-shown="true"]').length,
      fullscreenRoot.querySelectorAll('[data-char-shown]').length,
      '首句应在点击前已完整显现',
    )

    // 点击切换到下一句：阶段一（0 ~ ASH_EXIT_STAGE_MS）原句 DOM 保持原位零瞬移，均匀淡出交接后由粒子按噪声斑块无方向整句化开，下一句尚未登场
    fullscreenRoot.click()
    await Promise.resolve()
    const exitingWrap = fullscreenRoot.querySelector('[data-echo-exiting="true"]')
    assert.ok(exitingWrap, '点击后应立即进入骨灰消散退场阶段（data-echo-exiting="true"）')
    const exitingSentence = fullscreenRoot.querySelector('[data-echo-sentence]')
    assert.ok(exitingSentence, '退场期间原 DOM 节点保持原位挂载并均匀淡出交接，彻底根绝 Canvas 重绘造成的瞬移与横扫光带')
    assert.equal(
      exitingSentence.querySelector('p')?.textContent?.trim(),
      firstSentenceText,
      '退场阶段舞台上仍为正在蚕食退场的上一句，下一句绝不应提前出现',
    )
    assert.equal(Number(exitingSentence.style.opacity), 1, '点击首帧原句 DOM 为 100% 无损原位显示')
    assert.equal(ashCanvas.dataset.ashActive, 'true', '点击瞬间骨灰粒子画布应立即激活飞出细灰')
    assert.ok(
      Number(ashCanvas.dataset.ashParticles || '0') > 50,
      `应从上一句采样生成充足的骨灰粒子，实际粒子数：${ashCanvas.dataset.ashParticles}`,
    )

    // 退场中途（200ms）：原句 DOM 已无延迟均匀淡出交接给粒子（交接窗约 187ms 内完成），且下一句仍未提前登场
    await new Promise((r) => setTimeout(r, 200))
    assert.notEqual(
      Number(exitingSentence.style.opacity),
      1,
      '点击后应立即开始均匀消散交接，无任何停顿等待',
    )
    assert.equal(
      fullscreenRoot.querySelector('[data-echo-exiting]')?.getAttribute('data-echo-exiting'),
      'true',
      '骨灰消散退场尚未结束时不应提前显示下一句',
    )

    // 阶段二：等待骨灰消散下场完成（ASH_EXIT_STAGE_MS），下一句正式登场并从第 1 字起逐字浮现
    await new Promise((r) => setTimeout(r, echoAshMod.ASH_EXIT_STAGE_MS - 200 + 35))
    assert.equal(fullscreenRoot.querySelector('[data-echo-exiting]')?.getAttribute('data-echo-exiting'), 'false')
    const secondSentenceText = fullscreenRoot.querySelector('p')?.textContent?.trim()
    assert.ok(secondSentenceText && secondSentenceText !== firstSentenceText, '退场完成后应切换显示全新的下一句')
    const allSpansInitial = fullscreenRoot.querySelectorAll('[data-char-shown]')
    const shownInitial = fullscreenRoot.querySelectorAll('[data-char-shown="true"]')
    assert.ok(allSpansInitial.length > 2, '回声句子应拆分为独立字符节点以逐字显现')
    assert.ok(
      shownInitial.length >= 1 && shownInitial.length < allSpansInitial.length,
      `下一句登场初期应处于逐字浮现过程中（已显 ${shownInitial.length} / 总计 ${allSpansInitial.length}）`,
    )
    await new Promise((r) => setTimeout(r, 1150))
    assert.equal(
      fullscreenRoot.querySelectorAll('[data-char-shown="true"]').length,
      fullscreenRoot.querySelectorAll('[data-char-shown]').length,
      '逐字动画结束后整句字符应全部显现',
    )

    // 验证连续切换 12 句（含快速连点加速残灰立即呈上下一句）：严格无重复、无首帧闪现、无回退消失
    const clickedHistory = []
    for (let i = 0; i < 12; i++) {
      // 第 1 击触发当前句化灰退场，紧接第 2 击验证快速连点可加速残灰并立即呈上下一句
      fullscreenRoot.click()
      await Promise.resolve()
      fullscreenRoot.click()
      await Promise.resolve()
      assert.equal(
        fullscreenRoot.querySelectorAll('[data-char-shown="true"]').length,
        0,
        `第 ${i + 1} 次切换新句挂载首帧必须严格从 0 字开始显现`,
      )
      await new Promise((r) => setTimeout(r, 30))
      clickedHistory.push(fullscreenRoot.querySelector('p')?.textContent?.trim())
    }
    assert.equal(
      new Set(clickedHistory).size,
      clickedHistory.length,
      `连续切换 12 句不应出现任何重复句子，实际序列：${JSON.stringify(clickedHistory)}`,
    )
    assert.equal(
      prematureMountFlashes.length,
      0,
      `新句子挂载首帧不应有任何字符提前显现，实际异常：${JSON.stringify(prematureMountFlashes)}`,
    )
    assert.equal(
      reverseFlips.length,
      0,
      `任何字符显现后绝不应回退消失（true -> false），实际异常：${JSON.stringify(reverseFlips)}`,
    )
    antiFlashObserver.disconnect()

    // 4) 在底部横线输入内容并点击箭头按钮：同样先让旧句化灰下场，再逐字浮现刚发送的新回声
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      dom.window.HTMLInputElement.prototype,
      'value',
    ).set
    allInputs[0]._valueTracker?.setValue('')
    nativeInputValueSetter.call(allInputs[0], '今晚的风很轻')
    allInputs[0].dispatchEvent(new dom.window.Event('input', { bubbles: true }))
    allInputs[0].dispatchEvent(new dom.window.Event('change', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 25))

    allButtons[0].click()
    await new Promise((r) => setTimeout(r, 60))

    assert.equal(allInputs[0].value, '', '发送成功后底部横线应清空')
    assert.equal(ashCanvas.dataset.ashActive, 'true', '发送新回声时上一句同样应先化灰消散退场')
    await new Promise((r) => setTimeout(r, echoAshMod.ASH_EXIT_STAGE_MS + 40))
    assert.equal(
      fullscreenRoot.querySelector('p')?.textContent?.trim(),
      '今晚的风很轻',
      '上一句化灰下场后应显示刚写入 Discussions 的回声',
    )
    assert.equal(
      container.querySelectorAll('button').length,
      1,
      '发送成功后全页仍应严格保持仅有一个发送按钮',
    )
  } finally {
    reactRoot.unmount()
    await new Promise((r) => setTimeout(r, 35))
    dom.window.close()
    Object.assign(globalThis, prevGlobals)
  }
})

test('双栏编辑器滚动同步引擎（#101）：全层级源码行区间标注、闭合/展开折叠框与双向严格互逆映射', async () => {
  const harnessEntry = join(root, 'node_modules/.cache/scroll-sync-unit-harness.tsx')
  const { mkdirSync, writeFileSync } = await import('node:fs')
  mkdirSync(dirname(harnessEntry), { recursive: true })
  writeFileSync(
    harnessEntry,
    `
      import React from 'react'
      import { createRoot } from 'react-dom/client'
      import { renderToStaticMarkup } from 'react-dom/server'
      import { MemoryRouter, Routes, Route } from 'react-router-dom'
      import { Markdown } from '../../src/components/Markdown'
      import { parseFrontmatter } from '../../src/lib/frontmatter'
      import {
        collectScrollSyncAnchors,
        createBidirectionalScrollMapper,
        isHiddenInsideClosedDetails,
        rebuildTextareaLineMirror,
      } from '../../src/lib/scrollSync'
      import { ThemeProvider } from '../../src/lib/theme'
      import { FontProvider } from '../../src/lib/font'
      import { BackgroundProvider } from '../../src/lib/background'
      import { AuthProvider } from '../../src/lib/auth'
      import { ToastProvider } from '../../src/components/Toast'
      import { Layout } from '../../src/components/Layout'
      import Editor from '../../src/pages/Editor'
      import Home from '../../src/pages/Home'
      import { VersionCompare } from '../../src/components/VersionCompare'
      import { splitMarkdownBlocks, diffMarkdownHunks, renderedDiffSummary } from '../../src/lib/diff'
      import { saveLocalPost, deleteLocalPost } from '../../src/lib/posts'
      import { siteConfig } from '../../src/lib/config'
      export {
        React,
        createRoot,
        renderToStaticMarkup,
        MemoryRouter,
        Routes,
        Route,
        Markdown,
        parseFrontmatter,
        collectScrollSyncAnchors,
        createBidirectionalScrollMapper,
        isHiddenInsideClosedDetails,
        rebuildTextareaLineMirror,
        ThemeProvider,
        FontProvider,
        BackgroundProvider,
        AuthProvider,
        ToastProvider,
        Layout,
        Editor,
        Home,
        VersionCompare,
        splitMarkdownBlocks,
        diffMarkdownHunks,
        renderedDiffSummary,
        saveLocalPost,
        deleteLocalPost,
        siteConfig,
      }
    `,
    'utf8',
  )

  const bundled = await build({
    entryPoints: [harnessEntry],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    plugins: [viteRawImports],
    loader: {
      '.css': 'empty',
      '.jpg': 'dataurl',
      '.png': 'dataurl',
      '.svg': 'dataurl',
      '.md': 'text',
      '.css': 'empty',
    },
    define: {
      'process.env.NODE_ENV': '"production"',
      __STARLOG_OFFLINE__: 'false',
    },
  })
  const { pathToFileURL } = await import('node:url')
  const bundlePath = join(dirname(harnessEntry), 'scroll-sync-unit-bundle.mjs')
  writeFileSync(bundlePath, bundled.outputFiles[0].text, 'utf8')

  class LightMessageChannel {
    constructor() {
      const p1 = { onmessage: null, close() {} }
      const p2 = {
        onmessage: null,
        postMessage(data) {
          setTimeout(() => p1.onmessage?.({ data }), 0)
        },
        close() {},
      }
      p1.postMessage = (data) => {
        setTimeout(() => p2.onmessage?.({ data }), 0)
      }
      this.port1 = p1
      this.port2 = p2
    }
  }

  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'https://blog-apa.pages.dev/',
    pretendToBeVisual: true,
  })
  const prevGlobals = {
    window: globalThis.window,
    document: globalThis.document,
    DOMParser: globalThis.DOMParser,
    HTMLElement: globalThis.HTMLElement,
    MessageChannel: globalThis.MessageChannel,
  }
  globalThis.window = dom.window
  globalThis.document = dom.window.document
  globalThis.DOMParser = dom.window.DOMParser
  globalThis.HTMLElement = dom.window.HTMLElement
  globalThis.MessageChannel = LightMessageChannel

  try {
    const {
      React,
      renderToStaticMarkup,
      Markdown,
      parseFrontmatter,
      createBidirectionalScrollMapper,
      isHiddenInsideClosedDetails,
    } = await import(pathToFileURL(bundlePath).href)

    // 1) 验证所有自定义块级指令与嵌套容器都输出精确的首尾源行号 [data-source-line .. data-source-line-end]
    const allSyntaxMd = [
      '## 顶部标题',                         // L1
      '',                                    // L2
      ':::warning[闭合的 6 行折叠框]',       // L3
      '隐藏段一',                             // L4
      '',                                    // L5
      '隐藏段二',                             // L6
      ':::',                                 // L7
      '',                                    // L8
      ':::info[展开的折叠框]{open}',         // L9
      '展开段一',                             // L10
      '',                                    // L11
      '- 框内列表项 A',                       // L12
      '  - 嵌套子项 A1',                      // L13
      '',                                    // L14
      '```cpp',                              // L15
      'int x = 1;',                          // L16
      'int y = 2;',                          // L17
      '```',                                 // L18
      ':::',                                 // L19
      '',                                    // L20
      '::show_begin{演示}{n:Z=2[1,5,1]}',    // L21
      '当前 *&show(n)*&',                     // L22
      '::show_end',                          // L23
      '',                                    // L24
      '::begin_ui-ccs',                      // L25
      'create_point:(0,0);',                 // L26
      'create_line:(x^2);',                  // L27
      '::end_ui-ccs',                        // L28
      '',                                    // L29
      '::begin_ui-graph[dag]',               // L30
      '3',                                   // L31
      '1 2 5',                               // L32
      '::end_ui-graph',                      // L33
    ].join('\n')

    const renderedHtml = renderToStaticMarkup(
      React.createElement(Markdown, { content: allSyntaxMd, sourceLineMarkers: true }),
    )
    const host = dom.window.document.createElement('div')
    host.innerHTML = renderedHtml

    const closedDetails = host.querySelector('details.callout-warning')
    assert.ok(closedDetails && !closedDetails.open, '闭合折叠框应处于未展开状态')
    assert.equal(closedDetails.dataset.sourceLine, '3', '闭合折叠框起始行应为 3')
    assert.equal(closedDetails.dataset.sourceLineEnd, '7', '闭合折叠框结束行应精确覆盖闭合 ::: 第 7 行')
    for (const inner of closedDetails.querySelectorAll('[data-source-line]')) {
      assert.equal(isHiddenInsideClosedDetails(inner, host), true, '闭合折叠框内部节点应识别为隐藏态')
    }

    const openDetails = host.querySelector('details.callout-info')
    assert.ok(openDetails && openDetails.open, '展开折叠框应处于 open 状态')
    const innerCode = openDetails.querySelector('div.group.relative')
    assert.equal(innerCode?.dataset.sourceLine, '15', '展开折叠框内代码块起始行应为 15')
    assert.equal(innerCode?.dataset.sourceLineEnd, '18', '展开折叠框内代码块结束行应为 18')

    const showBox = host.querySelector('.show-box')
    assert.equal(showBox?.dataset.sourceLine, '21')
    assert.equal(showBox?.dataset.sourceLineEnd, '23')

    const ccsBox = host.querySelector('.ui-ccs-box:not(.ui-graph-box)')
    assert.equal(ccsBox?.dataset.sourceLine, '25')
    assert.equal(ccsBox?.dataset.sourceLineEnd, '28')

    const graphBox = host.querySelector('.ui-graph-box')
    assert.equal(graphBox?.dataset.sourceLine, '30')
    assert.equal(graphBox?.dataset.sourceLineEnd, '33')

    // 2) 验证真实长文（含大量展开折叠框与 12 个闭合题解折叠框）不再丢失锚点
    for (const [postFile, minExpectedBlocks, minMaxLine] of [
      ['oi-dp-skill-1.md', 60, 215],
      ['smsky-2026冬令营-problem_set.md', 15, 530],
      ['hoyoverser-skill-guess.md', 70, 150],
    ]) {
      const { content } = parseFrontmatter(readFileSync(join(root, 'content/posts', postFile), 'utf8'))
      const postHost = dom.window.document.createElement('div')
      postHost.innerHTML = renderToStaticMarkup(
        React.createElement(Markdown, { content, sourceLineMarkers: true }),
      )
      const visibleBlocks = [...postHost.querySelectorAll('[data-source-line]')].filter(
        (el) => el.tagName !== 'SPAN' && !isHiddenInsideClosedDetails(el, postHost),
      )
      const visibleSet = new Set(visibleBlocks)
      const activeLeaves = visibleBlocks.filter((el) => {
        if (el.tagName === 'DETAILS' && !el.open) return true
        for (const d of el.querySelectorAll('[data-source-line]')) {
          if (visibleSet.has(d)) return false
        }
        return true
      })
      const maxCoveredLine = Math.max(...activeLeaves.map((e) => Number(e.dataset.sourceLineEnd)))
      assert.ok(
        activeLeaves.length >= minExpectedBlocks,
        `${postFile} 应提取至少 ${minExpectedBlocks} 个有效叶级锚点块，实际 ${activeLeaves.length}`,
      )
      assert.ok(
        maxCoveredLine >= minMaxLine,
        `${postFile} 锚点应覆盖至文章末尾（>= ${minMaxLine} 行），实际 ${maxCoveredLine}`,
      )
    }

    // 3) 验证极端非对称高度下的双向映射精度与严格可逆性（含短编辑区 + 多大图长预览区）
    const asymmetricAnchors = [
      { ta: 0, pv: 0 },
      { ta: 120, pv: 520 },
      { ta: 260, pv: 1180 },
      { ta: 420, pv: 1320 },
      { ta: 620, pv: 2150 },
      { ta: 760, pv: 2600 },
    ]
    const shortEditorMapper = createBidirectionalScrollMapper(asymmetricAnchors, {
      taScrollHeight: 760,
      taClientHeight: 600, // maxTa = 160（过去 filter(a.ta < maxTa) 会删掉 5/6 篇文章锚点！）
      pvScrollHeight: 2600,
      pvClientHeight: 600, // maxPv = 2000
    })
    assert.equal(shortEditorMapper.editorToPreview(0), 0, '顶部必须严格 0 <-> 0 对齐')
    assert.equal(shortEditorMapper.editorToPreview(160), 2000, '底部必须严格 maxTa <-> maxPv 对齐')
    assert.equal(shortEditorMapper.previewToEditor(0), 0, '反向顶部必须严格 0 <-> 0 对齐')
    assert.equal(shortEditorMapper.previewToEditor(2000), 160, '反向底部必须严格 maxPv <-> maxTa 对齐')

    // 中点视线对齐检验：r = 0.5（taScrollTop = 80 -> 视口中线 y_E = 380），对应预览焦点 y_P ≈ 1285 -> pvScrollTop ≈ 985（绝不提前飞到底部 2000！）
    const midPv = shortEditorMapper.editorToPreview(80)
    assert.ok(
      Math.abs(midPv - 985) < 5,
      `短编辑区滚至中点时右侧预览应对齐视口中心内容（约 985px），而非提前冲到底部，实际 ${midPv}`,
    )

    // 全区间 400 个采样点验证严格单调递增与正逆往返误差 < 0.05px
    let prevMappedPv = -1
    for (let step = 0; step <= 400; step++) {
      const sTa = (step / 400) * 160
      const sPv = shortEditorMapper.editorToPreview(sTa)
      assert.ok(sPv >= prevMappedPv - 1e-6, `正向映射必须严格单调不减：step=${step}`)
      prevMappedPv = sPv
      const roundTripTa = shortEditorMapper.previewToEditor(sPv)
      assert.ok(
        Math.abs(roundTripTa - sTa) < 0.05,
        `双向滚动映射必须严格互逆（误差 < 0.05px）：输入 ${sTa} -> 预览 ${sPv} -> 反推 ${roundTripTa}`,
      )
    }
  } finally {
    dom.window.close()
    Object.assign(globalThis, prevGlobals)
  }
})

test('双栏编辑器真实 DOM 双向联动交互（#101）：浏览右侧同步左侧、折叠框开合重对齐、防死循环与开关控制', async () => {
  const harnessEntry = join(root, 'node_modules/.cache/editor-scroll-dom-harness.tsx')
  const { mkdirSync, writeFileSync } = await import('node:fs')
  mkdirSync(dirname(harnessEntry), { recursive: true })
  writeFileSync(
    harnessEntry,
    `
      import React from 'react'
      import { createRoot } from 'react-dom/client'
      import { MemoryRouter } from 'react-router-dom'
      import { ThemeProvider } from '../../src/lib/theme'
      import { FontProvider } from '../../src/lib/font'
      import { BackgroundProvider } from '../../src/lib/background'
      import { AuthProvider } from '../../src/lib/auth'
      import { ToastProvider } from '../../src/components/Toast'
      import { writeEditorScrollSync } from '../../src/lib/editorSettings'
      import { STORAGE_KEYS } from '../../src/lib/config'
      import App from '../../src/App'
      export {
        React,
        createRoot,
        MemoryRouter,
        ThemeProvider,
        FontProvider,
        BackgroundProvider,
        AuthProvider,
        ToastProvider,
        writeEditorScrollSync,
        STORAGE_KEYS,
        App,
      }
    `,
    'utf8',
  )

  const bundled = await build({
    entryPoints: [harnessEntry],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    plugins: [viteRawImports],
    loader: {
      '.css': 'empty',
      '.jpg': 'dataurl',
      '.png': 'dataurl',
      '.svg': 'dataurl',
      '.md': 'text',
      '.css': 'empty',
    },
    define: {
      'process.env.NODE_ENV': '"production"',
      __STARLOG_OFFLINE__: 'true',
    },
  })
  const { pathToFileURL } = await import('node:url')
  const bundlePath = join(dirname(harnessEntry), 'editor-scroll-dom-bundle.mjs')
  writeFileSync(bundlePath, bundled.outputFiles[0].text, 'utf8')

  class LightMessageChannel10 {
    constructor() {
      const p1 = { onmessage: null, close() {} }
      const p2 = {
        onmessage: null,
        postMessage(data) {
          setTimeout(() => p1.onmessage?.({ data }), 0)
        },
        close() {},
      }
      p1.postMessage = (data) => {
        setTimeout(() => p2.onmessage?.({ data }), 0)
      }
      this.port1 = p1
      this.port2 = p2
    }
  }

  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'https://blog-apa.pages.dev/',
    pretendToBeVisual: true,
  })

  const prevGlobals = {
    window: globalThis.window,
    document: globalThis.document,
    localStorage: globalThis.localStorage,
    sessionStorage: globalThis.sessionStorage,
    HTMLElement: globalThis.HTMLElement,
    SVGElement: globalThis.SVGElement,
    Node: globalThis.Node,
    MutationObserver: globalThis.MutationObserver,
    ResizeObserver: globalThis.ResizeObserver,
    matchMedia: globalThis.matchMedia,
    requestAnimationFrame: globalThis.requestAnimationFrame,
    cancelAnimationFrame: globalThis.cancelAnimationFrame,
    fetch: globalThis.fetch,
    DOMParser: globalThis.DOMParser,
    CustomEvent: globalThis.CustomEvent,
    Event: globalThis.Event,
    MessageChannel: globalThis.MessageChannel,
    BroadcastChannel: globalThis.BroadcastChannel,
  }

  dom.window.MessageChannel = LightMessageChannel10
  dom.window.BroadcastChannel = undefined
  globalThis.MessageChannel = LightMessageChannel10
  globalThis.BroadcastChannel = undefined
  globalThis.window = dom.window
  globalThis.document = dom.window.document
  globalThis.localStorage = dom.window.localStorage
  globalThis.sessionStorage = dom.window.sessionStorage
  globalThis.HTMLElement = dom.window.HTMLElement
  globalThis.SVGElement = dom.window.SVGElement
  globalThis.Node = dom.window.Node
  globalThis.MutationObserver = dom.window.MutationObserver
  globalThis.DOMParser = dom.window.DOMParser
  globalThis.CustomEvent = dom.window.CustomEvent
  globalThis.Event = dom.window.Event
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  dom.window.matchMedia = () => ({
    matches: false,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
  })
  globalThis.matchMedia = dom.window.matchMedia
  const activeRafIds = new Set()
  dom.window.requestAnimationFrame = (cb) => {
    const id = setTimeout(() => {
      activeRafIds.delete(id)
      cb(performance.now())
    }, 16)
    activeRafIds.add(id)
    return id
  }
  dom.window.cancelAnimationFrame = (id) => {
    activeRafIds.delete(id)
    clearTimeout(id)
  }
  globalThis.requestAnimationFrame = dom.window.requestAnimationFrame
  globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame
  dom.window.scrollTo = () => {}
  dom.window.HTMLCanvasElement.prototype.getContext = () => null
  globalThis.fetch = async () => new Response('{}', { status: 404 })

  const {
    React,
    createRoot,
    MemoryRouter,
    ThemeProvider,
    FontProvider,
    BackgroundProvider,
    AuthProvider,
    ToastProvider,
    writeEditorScrollSync,
    App,
  } = await import(pathToFileURL(bundlePath).href)

  // 构造一篇含：40 段闭合折叠框 + 巨幅坐标系图 + 展开折叠框长题解 的真实测试文稿
  const docLines = []
  docLines.push('## 第一节：引言')
  docLines.push('')
  docLines.push(':::warning[题面与数据范围（闭合长折叠框）]')
  for (let i = 1; i <= 20; i++) {
    docLines.push(`题面描述第 ${i} 段`)
    docLines.push('')
  }
  docLines.push(':::')
  docLines.push('')
  docLines.push('::begin_ui-ccs')
  docLines.push('create_point:(0,0);')
  docLines.push('create_line:(x^2-2);')
  docLines.push('::end_ui-ccs')
  docLines.push('')
  docLines.push(':::success[详细推导与代码（展开态折叠框）]{open}')
  for (let i = 1; i <= 30; i++) {
    docLines.push(`推导步骤第 ${i} 段：利用单调队列维护凸包斜率优化。`)
    docLines.push('')
  }
  docLines.push(':::')
  const markdownDoc = docLines.join('\n')

  writeEditorScrollSync(true)
  const container = dom.window.document.getElementById('root')
  const reactRoot = createRoot(container)

  try {
    reactRoot.render(
      React.createElement(
        MemoryRouter,
        { initialEntries: ['/editor'] },
        React.createElement(
          ThemeProvider,
          null,
          React.createElement(
            AuthProvider,
            null,
            React.createElement(
              FontProvider,
              null,
              React.createElement(
                BackgroundProvider,
                null,
                React.createElement(ToastProvider, null, React.createElement(App)),
              ),
            ),
          ),
        ),
      ),
    )

    await new Promise((r) => setTimeout(r, 120))

    const ta = container.querySelector('textarea.editor-textarea')
    const mirror = container.querySelector('div.editor-textarea[aria-hidden="true"]')
    const pv = container.querySelector('[data-yield-ignore]')
    assert.ok(ta && mirror && pv, '双栏编辑器应同时挂载 textarea、隐藏镜像层与右侧预览容器')
    assert.match(
      ta.parentElement.className,
      /\boverflow-hidden\b/,
      '左侧容器必须裁剪隐藏镜像层溢出高度，防止撑高整页 window 滚动条',
    )

    // 写入测试 Markdown 正文
    const nativeTaSetter = Object.getOwnPropertyDescriptor(
      dom.window.HTMLTextAreaElement.prototype,
      'value',
    ).set
    nativeTaSetter.call(ta, markdownDoc)
    ta.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 240))

    // 为 JSDOM 赋予真实的浏览器盒模型排版尺寸（模拟真实 1080p 分栏：视口高 600px，左行高 24px，右块按真实高度堆叠）
    const LINE_H = 24
    const PAD = 20
    const totalLines = markdownDoc.split('\n').length
    const taScrollH = PAD * 2 + totalLines * LINE_H
    Object.defineProperty(ta, 'clientWidth', { configurable: true, get: () => 560 })
    Object.defineProperty(ta, 'clientHeight', { configurable: true, get: () => 600 })
    Object.defineProperty(ta, 'scrollHeight', { configurable: true, get: () => taScrollH })
    Object.defineProperty(mirror, 'scrollHeight', { configurable: true, get: () => taScrollH })

    const installMirrorLineMetrics = () => {
      for (const lineDiv of mirror.querySelectorAll('div[data-l]')) {
        const lineNo = Number(lineDiv.dataset.l)
        Object.defineProperty(lineDiv, 'offsetTop', {
          configurable: true,
          get: () => PAD + (lineNo - 1) * LINE_H,
        })
        Object.defineProperty(lineDiv, 'offsetHeight', {
          configurable: true,
          get: () => LINE_H,
        })
      }
    }

    // 动态计算右侧预览 DOM 每个块的真实流式纵向布局（闭合折叠框仅 46px 高；展开后内部每段各占高度；ui-ccs 画布占 420px）
    let currentPvScrollH = 1200
    const layoutPreviewDom = () => {
      const prose = pv.querySelector('.prose')
      let cursorY = PAD
      const boxMap = new Map()
      const layoutChildren = (parent) => {
        for (const child of parent.children) {
          if (child.tagName === 'DETAILS' && !child.open) {
            const top = cursorY
            const h = 46
            boxMap.set(child, { top, height: h })
            cursorY += h + 16
            continue
          }
          const top = cursorY
          if (child.classList.contains('ui-ccs-box')) {
            const h = 420
            boxMap.set(child, { top, height: h })
            cursorY += h + 24
            continue
          }
          if (child.children.length > 0 && (child.tagName === 'DETAILS' || child.classList.contains('callout-content'))) {
            layoutChildren(child)
            boxMap.set(child, { top, height: Math.max(28, cursorY - top) })
            cursorY += 12
            continue
          }
          const h = child.tagName === 'SUMMARY' ? 44 : 38
          boxMap.set(child, { top, height: h })
          cursorY += h + 14
        }
      }
      if (prose) layoutChildren(prose)
      currentPvScrollH = cursorY + PAD
      pv.getBoundingClientRect = () => ({
        top: 80,
        bottom: 680,
        left: 600,
        right: 1160,
        width: 560,
        height: 600,
        x: 600,
        y: 80,
        toJSON: () => ({}),
      })
      for (const [el, box] of boxMap.entries()) {
        el.getBoundingClientRect = () => ({
          top: 80 + box.top - pv.scrollTop,
          bottom: 80 + box.top + box.height - pv.scrollTop,
          left: 620,
          right: 1140,
          width: 520,
          height: box.height,
          x: 620,
          y: 80 + box.top - pv.scrollTop,
          toJSON: () => ({}),
        })
      }
    }

    Object.defineProperty(pv, 'clientHeight', { configurable: true, get: () => 600 })
    Object.defineProperty(pv, 'scrollHeight', { configurable: true, get: () => currentPvScrollH })

    // 拦截镜像 innerHTML 写入后立即挂载每行真实 offsetTop/offsetHeight
    const origInnerHtmlDesc = Object.getOwnPropertyDescriptor(dom.window.Element.prototype, 'innerHTML')
    Object.defineProperty(mirror, 'innerHTML', {
      configurable: true,
      get() {
        return origInnerHtmlDesc.get.call(this)
      },
      set(v) {
        origInnerHtmlDesc.set.call(this, v)
        installMirrorLineMetrics()
      },
    })
    installMirrorLineMetrics()
    layoutPreviewDom()

    // 追踪真实浏览器的异步 scroll 回声，验证绝无乒乓死循环！
    let taScrollWrites = 0
    let pvScrollWrites = 0
    let taTopVal = 0
    let pvTopVal = 0
    Object.defineProperty(ta, 'scrollTop', {
      configurable: true,
      get: () => taTopVal,
      set: (v) => {
        taTopVal = v
        taScrollWrites += 1
      },
    })
    Object.defineProperty(pv, 'scrollTop', {
      configurable: true,
      get: () => pvTopVal,
      set: (v) => {
        pvTopVal = v
        pvScrollWrites += 1
      },
    })

    // 1) 左 -> 右：滚过 40 行闭合折叠框（Line 45 在左侧 y ≈ 1100，在右侧因折叠框闭合仅在 y ≈ 82）
    taTopVal = 960
    taScrollWrites = 0
    pvScrollWrites = 0
    ta.dispatchEvent(new dom.window.Event('scroll'))
    assert.equal(pvScrollWrites, 1, '左侧滚动应精确写入右侧 scrollTop 一次')
    // 模拟浏览器因 pv.scrollTop 被程序修改而异步派发回声 scroll 事件 -> 必须零回写 ta！
    pv.dispatchEvent(new dom.window.Event('scroll'))
    assert.equal(taScrollWrites, 0, '程序同步触发的预览回声 scroll 绝不应反向改写左侧编辑区（零乒乓抖动）')
    assert.ok(
      pvTopVal > 50 && pvTopVal < 500,
      `经过 40 行闭合折叠框后右侧应精准停在折叠框下方坐标系处（而非按行数误滚至千余像素外），实际 pv.scrollTop=${pvTopVal}`,
    )

    // 2) 右 -> 左（Issue #101 核心需求 1：浏览右侧预览时左侧编辑区同步滚动！）
    const maxPv = currentPvScrollH - 600
    const maxTa = taScrollH - 600
    pvTopVal = maxPv * 0.72
    taScrollWrites = 0
    pvScrollWrites = 0
    pv.dispatchEvent(new dom.window.Event('wheel', { bubbles: true }))
    pv.dispatchEvent(new dom.window.Event('scroll'))
    assert.equal(taScrollWrites, 1, '浏览右侧预览时必须同步驱动左侧编辑区滚动')
    // 模拟浏览器异步派发左侧 ta 的回声 scroll 事件 -> 必须零回写 pv！
    ta.dispatchEvent(new dom.window.Event('scroll'))
    assert.equal(pvScrollWrites, 0, '左侧回声 scroll 事件绝不应反向篡改右侧预览滚动位置')
    const syncedTaAt72 = taTopVal
    assert.ok(
      syncedTaAt72 > maxTa * 0.55 && syncedTaAt72 < maxTa * 0.95,
      `浏览右侧 72% 处展开题解时左侧编辑区应精确跟随至对应源码段落，实际 ta.scrollTop=${syncedTaAt72} / maxTa=${maxTa}`,
    )

    // 滚至右侧最底部 -> 左侧同步精准见底；滚回右侧最顶部 -> 左侧同步精准归零
    pvTopVal = maxPv
    pv.dispatchEvent(new dom.window.Event('scroll'))
    assert.ok(Math.abs(taTopVal - maxTa) < 1, `右侧触底时左侧应精准触底：${taTopVal} vs ${maxTa}`)

    pvTopVal = 0
    pv.dispatchEvent(new dom.window.Event('scroll'))
    assert.ok(Math.abs(taTopVal) < 1, `右侧回顶时左侧应精准归零：${taTopVal}`)

    // 3) 动态展开 40 行闭合折叠框：触发 toggle 后锚点立即更新并重新对齐左侧源码位置
    const closedCallout = pv.querySelector('details.callout-warning')
    pvTopVal = 260
    pv.dispatchEvent(new dom.window.Event('scroll'))
    const taBeforeOpen = taTopVal
    closedCallout.open = true
    layoutPreviewDom()
    closedCallout.dispatchEvent(new dom.window.Event('toggle'))
    const taAfterOpen = taTopVal
    assert.ok(
      taAfterOpen < taBeforeOpen - 400,
      `展开 40 行折叠框后同一预览位置对应折叠框内部前段源码（行号显著前移）：展开前 ${taBeforeOpen} vs 展开后 ${taAfterOpen}`,
    )

    // 4) 关闭「编辑器滚动同步」个人设置后，左右两侧各自独立滚动互不干扰；重新开启后立即恢复联动
    writeEditorScrollSync(false)
    await new Promise((r) => setTimeout(r, 30))
    taScrollWrites = 0
    pvScrollWrites = 0
    pvTopVal = 500
    pv.dispatchEvent(new dom.window.Event('scroll'))
    assert.equal(taScrollWrites, 0, '关闭同步滚动开关后浏览右侧不应再改动左侧滚动条')
    taTopVal = 400
    ta.dispatchEvent(new dom.window.Event('scroll'))
    assert.equal(pvScrollWrites, 0, '关闭同步滚动开关后滚动左侧不应再改动右侧滚动条')

    writeEditorScrollSync(true)
    await new Promise((r) => setTimeout(r, 30))
    pvTopVal = 600
    pv.dispatchEvent(new dom.window.Event('scroll'))
    assert.equal(taScrollWrites, 1, '重新开启同步滚动开关后浏览右侧应立即恢复同步')
  } finally {
    writeEditorScrollSync(true)
    reactRoot.unmount()
    await new Promise((r) => setTimeout(r, 40))
    for (const id of activeRafIds) clearTimeout(id)
    activeRafIds.clear()
    dom.window.close()
    Object.assign(globalThis, prevGlobals)
  }
})

/* ------------------- 11–13. Issues #104 / #105 / #106 & 离线 CI 回归测试 ------------------- */
async function loadSharedAppBundle() {
  const { pathToFileURL } = await import('node:url')
  const sharedPath = join(root, 'node_modules/.cache/scroll-sync-unit-bundle.mjs')
  return import(pathToFileURL(sharedPath).href)
}

function setupJsdomTestEnv(url = 'https://blog-apa.pages.dev/') {
  class LightMC {
    constructor() {
      const p1 = { onmessage: null, close() {} }
      const p2 = {
        onmessage: null,
        postMessage(data) {
          setTimeout(() => p1.onmessage?.({ data }), 0)
        },
        close() {},
      }
      p1.postMessage = (data) => {
        setTimeout(() => p2.onmessage?.({ data }), 0)
      }
      this.port1 = p1
      this.port2 = p2
    }
  }
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url,
    pretendToBeVisual: true,
  })
  const prevGlobals = {}
  for (const key of [
    'window', 'document', 'navigator', 'HTMLElement', 'HTMLInputElement', 'HTMLTextAreaElement',
    'Element', 'Node', 'SVGElement', 'Event', 'KeyboardEvent', 'CustomEvent', 'MutationObserver',
    'DOMParser', 'localStorage', 'sessionStorage', 'getComputedStyle',
    'ResizeObserver', 'matchMedia', 'requestAnimationFrame', 'cancelAnimationFrame',
    'fetch', 'MessageChannel', 'BroadcastChannel', 'IntersectionObserver',
  ]) {
    prevGlobals[key] = globalThis[key]
  }
  const activeRafIds = new Set()
  dom.window.requestAnimationFrame = (cb) => {
    const id = setTimeout(() => {
      activeRafIds.delete(id)
      cb(performance.now())
    }, 16)
    activeRafIds.add(id)
    return id
  }
  dom.window.cancelAnimationFrame = (id) => {
    activeRafIds.delete(id)
    clearTimeout(id)
  }
  dom.window.scrollTo = () => {}
  dom.window.HTMLElement.prototype.scrollIntoView = function () {}
  dom.window.HTMLCanvasElement.prototype.getContext = () => null
  dom.window.matchMedia = () => ({
    matches: false,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
  })
  dom.window.MessageChannel = LightMC
  dom.window.BroadcastChannel = undefined

  for (const key of [
    'window', 'document', 'navigator', 'HTMLElement', 'HTMLInputElement', 'HTMLTextAreaElement',
    'Element', 'Node', 'SVGElement', 'Event', 'KeyboardEvent', 'CustomEvent', 'MutationObserver',
    'DOMParser', 'localStorage', 'sessionStorage', 'getComputedStyle',
    'matchMedia', 'requestAnimationFrame', 'cancelAnimationFrame',
    'MessageChannel', 'BroadcastChannel',
  ]) {
    Object.defineProperty(globalThis, key, {
      value: dom.window[key],
      configurable: true,
      writable: true,
    })
  }
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  globalThis.fetch = async () => new Response('{}', { status: 404 })

  return {
    dom,
    cleanup() {
      for (const id of activeRafIds) clearTimeout(id)
      activeRafIds.clear()
      dom.window.close()
      for (const [k, v] of Object.entries(prevGlobals)) {
        Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true })
      }
    },
  }
}

test('issue #104：全屏编辑与吸顶页头、Ctrl+K / 斜杠搜索快捷键及弹层 Esc 互不冲突', async () => {
  const env = setupJsdomTestEnv('https://blog-apa.pages.dev/admin/new')
  const {
    React,
    createRoot,
    MemoryRouter,
    Routes,
    Route,
    ThemeProvider,
    FontProvider,
    BackgroundProvider,
    AuthProvider,
    ToastProvider,
    Layout,
    Editor,
  } = await loadSharedAppBundle()

  const rootEl = env.dom.window.document.getElementById('root')
  const reactRoot = createRoot(rootEl)

  try {
    reactRoot.render(
      React.createElement(
        MemoryRouter,
        { initialEntries: ['/admin/new'] },
        React.createElement(
          AuthProvider,
          null,
          React.createElement(
            ThemeProvider,
            null,
            React.createElement(
              FontProvider,
              null,
              React.createElement(
                BackgroundProvider,
                null,
                React.createElement(
                  ToastProvider,
                  null,
                  React.createElement(
                    Routes,
                    null,
                    React.createElement(
                      Route,
                      { element: React.createElement(Layout) },
                      React.createElement(Route, {
                        path: '/admin/new',
                        element: React.createElement(Editor),
                      }),
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    )
    await new Promise((r) => setTimeout(r, 80))

    // 1) 非全屏态：<main> 不得携带 z-10 创建层叠上下文陷阱；Ctrl+K 在编辑框内只插入链接而不弹搜索框
    const mainEl = rootEl.querySelector('main')
    assert.ok(mainEl && !/\bz-10\b/.test(mainEl.className), '<main> 不应携带 z-10 层叠上下文')
    assert.ok(rootEl.querySelector('header.site-header'), '常规编辑态应保留顶部导航栏')

    const ta = rootEl.querySelector('textarea.editor-textarea')
    assert.ok(ta, '应挂载编辑器正文 textarea')
    ta.focus()
    ta.dispatchEvent(
      new env.dom.window.KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true, cancelable: true }),
    )
    await new Promise((r) => setTimeout(r, 30))
    assert.equal(
      env.dom.window.document.querySelector('[role="dialog"]'),
      null,
      '编辑器内按下 Ctrl+K 插入链接时不应误触发全站搜索弹层',
    )
    assert.ok(ta.value.includes('[链接文字](https://)'), 'Ctrl+K 应正常插入 Markdown 链接语法')

    // 2) 进入全屏态：吸顶页头与页脚彻底隐藏、锁定底层滚动、`/` 与 `Ctrl+K` 均不弹搜索框
    const enterFsBtn = rootEl.querySelector('button[title="全屏编辑 (Esc 退出)"]')
    assert.ok(enterFsBtn, '应找到全屏编辑按钮')
    enterFsBtn.click()
    await new Promise((r) => setTimeout(r, 40))

    assert.equal(rootEl.querySelector('header.site-header'), null, '全屏编辑态应隐藏吸顶页头，避免与标题栏重叠')
    assert.equal(rootEl.querySelector('footer'), null, '全屏编辑态应隐藏页脚')
    assert.equal(env.dom.window.document.documentElement.dataset.editorFullscreen, 'true')
    assert.equal(env.dom.window.document.documentElement.style.overflow, 'hidden')

    env.dom.window.dispatchEvent(
      new env.dom.window.KeyboardEvent('keydown', { key: '/', bubbles: true, cancelable: true }),
    )
    await new Promise((r) => setTimeout(r, 25))
    assert.equal(env.dom.window.document.querySelector('[role="dialog"]'), null, '全屏编辑时按 `/` 不应弹出搜索框')

    // 3) 全屏态打开 LaTeX 符号框后按 Esc：只关闭符号框，不连带退出全屏；再按 Esc 才退出全屏并恢复页头
    ta.focus()
    ta.dispatchEvent(
      new env.dom.window.KeyboardEvent('keydown', { key: 'ArrowUp', shiftKey: true, bubbles: true, cancelable: true }),
    )
    await new Promise((r) => setTimeout(r, 35))
    assert.ok(
      env.dom.window.document.querySelector('[role="dialog"][aria-label="插入 LaTeX 符号"]'),
      'Shift + ↑ 应在全屏态正常打开 LaTeX 符号选择框',
    )

    env.dom.window.dispatchEvent(
      new env.dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    )
    await new Promise((r) => setTimeout(r, 35))
    assert.equal(
      env.dom.window.document.querySelector('[role="dialog"][aria-label="插入 LaTeX 符号"]'),
      null,
      '第一次 Esc 应关闭 LaTeX 符号框',
    )
    assert.ok(
      rootEl.querySelector('button[title="退出全屏 (Esc)"]'),
      '关闭子对话框时不应连带退出全屏编辑',
    )

    env.dom.window.dispatchEvent(
      new env.dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    )
    await new Promise((r) => setTimeout(r, 40))
    assert.ok(rootEl.querySelector('header.site-header'), '退出全屏后应立即恢复顶部导航栏')
    assert.equal(env.dom.window.document.documentElement.style.overflow, '')
  } finally {
    reactRoot.unmount()
    await new Promise((r) => setTimeout(r, 30))
    env.cleanup()
  }
})

test('issue #105：历史版本渲染对比保持多行容器块完整并支持分栏/折叠/跳转', async () => {
  const { readFileSync } = await import('node:fs')
  const env = setupJsdomTestEnv('https://blog-apa.pages.dev/posts/dp-note')
  const {
    React,
    createRoot,
    VersionCompare,
    splitMarkdownBlocks,
    diffMarkdownHunks,
    renderedDiffSummary,
    parseFrontmatter,
  } = await loadSharedAppBundle()

  const dpPostRaw = readFileSync(join(root, 'content/posts/oi-dp-skill-1.md'), 'utf8')
  const dpContent = parseFrontmatter(dpPostRaw).content

  // 1) 真实长文 oi-dp-skill-1.md 切块验证：嵌套 :::info / ::::info、::begin_ui-ccs 等绝不被内部空行撕裂出裸 `:::`
  const blocks = splitMarkdownBlocks(dpContent)
  for (const blk of blocks) {
    assert.ok(
      !/^:{3,}\s*$/.test(blk.text.trim()),
      `容器闭合行不应被切碎为孤立块：L${blk.start}-${blk.end}: ${blk.text}`,
    )
  }

  // `::cute-table{tuack}` + 空行 + 管道表格必须合为同一块
  const tableBlocks = splitMarkdownBlocks(
    '::cute-table{tuack}\n\n| 列 A | 列 B |\n| --- | --- |\n| 1 | 2 |\n',
  )
  assert.equal(tableBlocks.length, 1, '::cute-table 属性头与紧邻表格应合并为单一渲染块')

  // 2) Hunk 配对与 VersionCompare 真实组件交互验证
  const baseMd = [
    '---',
    'title: "DP 优化笔记"',
    'date: "2026-10-20"',
    '---',
    '',
    '导言第一段保持不变。',
    '',
    '导言第二段保持不变。',
    '',
    ':::info[例题 1]{open}',
    '',
    '朴素状态转移时间复杂度为 $O(n^2)$。',
    '',
    ':::',
    '',
    '这段旧备注将被移除。',
  ].join('\n')

  const nextMd = [
    '---',
    'title: "DP 优化笔记"',
    'date: "2026-10-23"',
    '---',
    '',
    '导言第一段保持不变。',
    '',
    '导言第二段保持不变。',
    '',
    ':::info[例题 1]{open}',
    '',
    '斜率优化后单次转移时间复杂度降为 $O(\\log n)$。',
    '',
    ':::',
    '',
    ':::success[新增总结]{open}',
    '',
    '总时间复杂度 $O(n \\log n)$。',
    '',
    ':::',
  ].join('\n')

  const hunks = diffMarkdownHunks(
    parseFrontmatter(baseMd).content,
    parseFrontmatter(nextMd).content,
  )
  const summary = renderedDiffSummary(hunks)
  assert.equal(summary.unchangedBlocks, 2, '前两段未改动块应精确归入 equal hunk')
  assert.equal(summary.totalChanges, 1, '相邻旧块替换与新增应合并为结构化变更组')
  assert.equal(summary.modified, 1)

  globalThis.fetch = async (input) => {
    const url = String(input)
    if (url.includes('sha-old')) {
      return new Response(
        JSON.stringify({
          sha: 'sha-old-7654321',
          encoding: 'base64',
          content: Buffer.from(baseMd, 'utf8').toString('base64'),
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    }
    if (url.includes('sha-new')) {
      return new Response(
        JSON.stringify({
          sha: 'sha-new-1234567',
          encoding: 'base64',
          content: Buffer.from(nextMd, 'utf8').toString('base64'),
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    }
    throw new Error(`unexpected fetch: ${url}`)
  }

  const rootEl = env.dom.window.document.getElementById('root')
  const reactRoot = createRoot(rootEl)
  try {
    reactRoot.render(
      React.createElement(VersionCompare, {
        slug: 'dp-note',
        path: 'content/posts/dp-note.md',
        versions: [
          {
            sha: 'sha-new-1234567',
            message: 'Upd：斜率优化复杂度',
            committedAt: '2026-10-23T08:00:00Z',
            author: { name: 'Author' },
          },
          {
            sha: 'sha-old-7654321',
            message: 'Init：初版笔记',
            committedAt: '2026-10-20T08:00:00Z',
            author: { name: 'Author' },
          },
        ],
        onClose: () => {},
      }),
    )
    await new Promise((r) => setTimeout(r, 90))

    assert.equal(
      rootEl.querySelectorAll('.overflow-y-auto').length,
      1,
      'VersionCompare 应只保留单一纵向滚动容器，杜绝双层嵌套滚动条',
    )
    assert.ok(rootEl.textContent.includes('修改段落'), '应展示配对后的「修改段落」语义卡片')
    assert.ok(rootEl.querySelectorAll('details.callout').length >= 2, '新旧两侧折叠框均应完整渲染而非碎裂')
    assert.ok(rootEl.querySelectorAll('.katex').length >= 2, '新旧两侧 KaTeX 数学公式均应完整渲染')

    const expandGapBtn = Array.from(rootEl.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('展开此处未变更的 2 段内容'),
    )
    assert.ok(expandGapBtn, '默认应将多段未变更内容折叠为可展开分隔条')
    expandGapBtn.click()
    await new Promise((r) => setTimeout(r, 30))
    assert.ok(rootEl.textContent.includes('导言第一段保持不变。'), '点击后应原地展开未修改段落上下文')
  } finally {
    reactRoot.unmount()
    await new Promise((r) => setTimeout(r, 30))
    env.cleanup()
  }
})

test('issue #106 & offline CI：首页下滑自动加载更多 + main 更新自动同步离线版与 Release', async () => {
  const { readFileSync } = await import('node:fs')
  const env = setupJsdomTestEnv('https://blog-apa.pages.dev/')

  const observers = []
  class MockIntersectionObserver {
    constructor(callback, options) {
      this.callback = callback
      this.options = options
      this.elements = new Set()
      observers.push(this)
    }
    observe(el) {
      this.elements.add(el)
    }
    unobserve(el) {
      this.elements.delete(el)
    }
    disconnect() {
      this.elements.clear()
    }
  }
  globalThis.IntersectionObserver = MockIntersectionObserver
  env.dom.window.IntersectionObserver = MockIntersectionObserver

  const {
    React,
    createRoot,
    MemoryRouter,
    AuthProvider,
    Home,
    saveLocalPost,
    deleteLocalPost,
    siteConfig,
  } = await loadSharedAppBundle()

  const totalExpected = siteConfig.postsPerPage * 2 + 3
  const createdSlugs = []
  for (let i = 1; i <= totalExpected; i += 1) {
    const slug = `auto-scroll-test-${String(i).padStart(2, '0')}`
    createdSlugs.push(slug)
    saveLocalPost({
      slug,
      title: `自动加载测试文章 #${i}`,
      date: '2026-10-23',
      summary: '测试下滑自动加载下一页',
      tags: ['测试'],
      draft: false,
      content: '正文内容',
    })
  }

  const rootEl = env.dom.window.document.getElementById('root')
  const reactRoot = createRoot(rootEl)

  try {
    reactRoot.render(
      React.createElement(
        MemoryRouter,
        { initialEntries: ['/'] },
        React.createElement(AuthProvider, null, React.createElement(Home)),
      ),
    )
    await new Promise((r) => setTimeout(r, 60))

    const countCards = () => rootEl.querySelectorAll('article').length
    assert.equal(countCards(), siteConfig.postsPerPage, '首屏初始应展示第一页文章数量')
    assert.ok(
      rootEl.querySelector('[data-infinite-scroll-sentinel]'),
      '存在未展示文章时应挂载底部自动加载哨兵节点',
    )

    // 模拟用户向下滑动触发 IntersectionObserver 进入视口预加载区间 -> 自动加载第 2 页
    const activeObs = observers.find((o) => o.elements.size > 0)
    assert.ok(activeObs, 'IntersectionObserver 应已监听底部哨兵节点')
    activeObs.callback([{ isIntersecting: true, target: Array.from(activeObs.elements)[0] }])
    await new Promise((r) => setTimeout(r, 50))
    assert.equal(
      countCards(),
      siteConfig.postsPerPage * 2,
      '向下滑动触发视口相交后应无需点击按钮自动加载第 2 页',
    )

    // 继续滑动触发 scroll 兜底监听 -> 自动加载第 3 页直至全部 25 篇加载完成
    const sentinel = rootEl.querySelector('[data-infinite-scroll-sentinel]')
    sentinel.getBoundingClientRect = () => ({
      top: env.dom.window.innerHeight - 20,
      bottom: env.dom.window.innerHeight + 20,
      left: 0,
      right: 100,
      width: 100,
      height: 40,
    })
    env.dom.window.dispatchEvent(new env.dom.window.Event('scroll'))
    await new Promise((r) => setTimeout(r, 50))
    assert.equal(countCards(), totalExpected, '继续下滑应自动加载剩余全部第 3 页文章')
    assert.ok(
      rootEl.textContent.includes(`已加载全部 ${totalExpected} 篇文章`),
      '全部加载完后应展示底部完成提示',
    )

    // 校验 GitHub Actions 工作流不变量
    const offlineYml = readFileSync(join(root, '.github/workflows/offline.yml'), 'utf8')
    const deployYml = readFileSync(join(root, '.github/workflows/deploy.yml'), 'utf8')
    assert.ok(
      !offlineYml.includes("if: steps.commit.outputs.changed == 'true'"),
      'Release 步骤不得因 PR 已预构建 offline/index.html 而被跳过',
    )
    assert.ok(
      offlineYml.includes('--latest') && offlineYml.includes('refs/tags/offline'),
      'offline.yml 应同步更新 offline 标签并发布 Latest Release',
    )
    assert.ok(
      deployYml.includes('vite.offline.config.ts'),
      'deploy.yml 应实时构建离线单文件版以确保 Pages 下载文件与当前提交一致',
    )
  } finally {
    for (const s of createdSlugs) deleteLocalPost(s)
    reactRoot.unmount()
    await new Promise((r) => setTimeout(r, 30))
    env.cleanup()
  }
})





/* -------------------------------------------------------------------------- */
/*  issue #126 / #127 / #128 / #129 / #130 / #112：本轮新增模块的行为与约定      */
/* -------------------------------------------------------------------------- */

const settingsSnapshotMod = await importTsModule('src/lib/settingsSnapshot.ts')
const backgroundImageMod = await importTsModule('src/lib/backgroundImage.ts')
const scrollSyncMod = await importTsModule('src/lib/scrollSync.ts')
const scrollLockMod = await importTsModule('src/lib/scrollLock.ts')
const lanDocMod = await importTsModule('src/lib/lanDoc.ts')
const lanSyncMod = await importTsModule('src/lib/lanSync.ts')
const lanHubMod = await import(new URL('./offline-hub.mjs', import.meta.url))

test('account settings preserve independent device edits and round-trip site layout', () => {
  const { collectSyncedSettings, mergeSettingsForSave, mergeRemoteSettings, parseSettingsDiscussionBody, renderSettingsDiscussionBody } = settingsSnapshotMod
  const remote = {
    version: 2, login: 'reader', updatedAt: 200,
    values: { themeMode: 'dark', siteLayout: 'galaxy' },
    stamps: { themeMode: 150, siteLayout: 120 },
  }
  const local = {
    version: 2, login: 'reader', updatedAt: 300,
    values: collectSyncedSettings({ colorTheme: 'ocean', themeMode: 'light', siteLayout: 'classic' }).values,
    stamps: { colorTheme: 280, themeMode: 20, siteLayout: 30 },
  }
  assert.equal(local.values.siteLayout, 'classic')
  const merged = mergeSettingsForSave(local, remote)
  const parsed = parseSettingsDiscussionBody(renderSettingsDiscussionBody('reader', merged), 'reader')
  assert.deepEqual(parsed.values, { themeMode: 'dark', siteLayout: 'galaxy', colorTheme: 'ocean' })
  assert.deepEqual(parsed.stamps, { themeMode: 150, siteLayout: 120, colorTheme: 280 })
  const restored = mergeRemoteSettings({
    remote: parsed.values, remoteUpdatedAt: 0, remoteStamps: parsed.stamps, localStamps: { themeMode: 170 },
  })
  assert.deepEqual(restored.keepLocal, ['themeMode'])
  assert.equal(restored.apply.siteLayout, 'galaxy')
})

test('LAN collaboration retries unconfirmed edits before replacing local text', async () => {
  const { createLanSession } = lanSyncMod
  const { textToBlocks, applyRemoteOps } = lanDocMod
  let state = { blocks: textToBlocks('Original', 'peer'), rev: 1, peers: [] }
  let posts = 0
  const shown = []
  let finish
  const delivered = new Promise((resolve) => { finish = resolve })
  const session = createLanSession({
    room: 'retry', name: 'writer', retryMs: 10, quietMs: 1000,
    handlers: {
      onPeers() {},
      onStatus() {},
      onText(text) {
        shown.push(text)
        if (text.includes('Latest version')) finish()
      },
    },
  }, {
    async request(route, options) {
      if (route === '/api/ops') {
        posts++
        if (posts === 1) throw new Error('Disconnected')
        state = { ...state, rev: state.rev + 1, blocks: applyRemoteOps(state.blocks, options.body.ops).blocks }
      }
      return state
    },
    subscribe() { return () => {} },
  })
  try {
    await session.join()
    session.pushLocalText('First version')
    await session.flush()
    session.pushLocalText('Latest version')
    let timer
    try {
      await Promise.race([delivered, new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Queued edit was not uploaded')), 1500)
      })])
    } finally {
      clearTimeout(timer)
    }
    assert.equal(posts, 3)
    assert.deepEqual(shown, ['Original', 'Latest version'])
  } finally {
    session.leave()
  }
})

test('issue #129 & #130：设置快照只走 Discussion，仓库里不留任何设置文件', () => {
  const {
    SYNCED_SETTINGS,
    collectSyncedSettings,
    mergeRemoteSettings,
    parseSettingsDiscussionBody,
    renderSettingsDiscussionBody,
    settingsDiscussionMarker,
    settingsDiscussionTitle,
    SETTINGS_VALUE_LIMIT,
    syncedSettingLabel,
    measureChars,
  } = settingsSnapshotMod

  // 白名单：需求里点名的「颜色 / 字号」必须在内，凭据与本地数据必须在门外
  const names = SYNCED_SETTINGS.map((spec) => spec.name)
  for (const required of ['font', 'background', 'backgroundImage', 'colorTheme', 'themeMode', 'animatedBackground', 'repository']) {
    assert.ok(names.includes(required), `${required} 应当参与云同步`)
  }
  // token / 草稿 / 本机文章这些绝不能上传；editorLineNumbers 是撤掉的功能，白名单里也不该留空位
  for (const forbidden of ['token', 'gh-token', 'drafts', 'local-posts', 'update-queue', 'offlineBundle', 'editorLineNumbers']) {
    assert.ok(!names.includes(forbidden), `${forbidden} 绝不能被同步`)
  }
  assert.equal(syncedSettingLabel('colorTheme'), '配色主题')

  // 收集：合法值进快照，过大 / 非法值只留本机并给出原因
  const huge = 'x'.repeat(SETTINGS_VALUE_LIMIT + 10)
  const collected = collectSyncedSettings({
    colorTheme: 'sakura',
    font: { families: ['Noto Sans SC'], sizePercent: 105 },
    backgroundImage: { enabled: true, url: huge, fit: 'cover', dim: 20, fixed: true },
    themeMode: 'nonsense',
  })
  assert.equal(collected.values.colorTheme, 'sakura')
  assert.equal(collected.values.font.sizePercent, 105)
  assert.ok(!('backgroundImage' in collected.values), '超限的背景图不应上传')
  assert.match(collected.skipped.backgroundImage, /仅保存在本机/)
  assert.match(collected.skipped.themeMode, /不合法/)

  // 渲染 / 解析成环；未知键与非法值在解析时被丢掉
  const snapshot = { version: 1, login: 'lrbkdgw', updatedAt: 1_700_000_000_000, values: collected.values, skipped: collected.skipped }
  const body = renderSettingsDiscussionBody('lrbkdgw', snapshot)
  assert.ok(body.includes(settingsDiscussionMarker('lrbkdgw')), '正文里要有定位标记')
  assert.equal(settingsDiscussionTitle('lrbkdgw'), '⚙️ @lrbkdgw 的博客设置', '标题要一眼看出是哪个账号的')
  assert.ok(body.includes('@lrbkdgw') && body.includes('不会写进仓库'), '正文要说明这是谁的设置、存在哪')
  const parsed = parseSettingsDiscussionBody(body, 'lrbkdgw')
  assert.ok(parsed, '渲染出的正文必须能解析回来')
  assert.equal(parsed.values.colorTheme, 'sakura')
  assert.deepEqual(parsed.skipped, collected.skipped)
  assert.equal(parsed.updatedAt, snapshot.updatedAt)
  assert.equal(parseSettingsDiscussionBody(body, 'someone-else'), null, '别人的账号不能认领这条讨论')
  assert.equal(parseSettingsDiscussionBody('没有代码块的正文', 'lrbkdgw'), null)
  assert.equal(
    parseSettingsDiscussionBody('```json\n{"version":1,"login":"lrbkdgw","updatedAt":1,"values":{"colorTheme":"sakura","password":"hunter2"}}\n```', 'lrbkdgw')
      .values.password,
    undefined,
    '白名单外的键不能灌回本地',
  )

  // 逐条时间戳合并：本机更新过的项保留本机值
  const merged = mergeRemoteSettings({
    remote: { colorTheme: 'sakura', font: { sizePercent: 90 } },
    remoteUpdatedAt: 1000,
    localStamps: { colorTheme: 1500 },
  })
  assert.deepEqual(merged.keepLocal, ['colorTheme'])
  assert.deepEqual(Object.keys(merged.apply), ['font'])
  assert.deepEqual(merged.fresh, ['font'])

  // 讨论正文被改坏时按「远端没有设置」处理，绝不半个状态
  assert.equal(measureChars({ a: 1 }), 7)

  /* ---- 静态约定：仓库里不能再出现设置文件，也不能再有写设置的代码路径 ---- */
  assert.ok(!existsSync(join(root, '.starlog')), '仓库里不应再保留 .starlog/settings/** 目录')
  const githubSrc = readFileSync(join(root, 'src/lib/github.ts'), 'utf8')
  for (const gone of ['saveGithubFontPreference', 'saveGithubBackgroundPreference', 'buildFontPreferenceFile', 'enqueueSettingsSync']) {
    assert.ok(!githubSrc.includes(gone), `github.ts 里不该再有 ${gone}()`)
  }
  assert.ok(githubSrc.includes('createDiscussion'), '快照要靠 Discussion 写入')
  assert.ok(githubSrc.includes('updateDiscussion'), '已有讨论要就地更新，而不是每次新建')
  // 读旧文件只允许出现在「迁移」语境里：写入用的 contents API 不该出现在设置代码块中
  const settingsBlock = githubSrc.slice(githubSrc.indexOf('DISCUSSION_SETTINGS_MARKER') >= 0 ? githubSrc.indexOf('export interface SettingsDiscussion') : githubSrc.indexOf('settingsDiscussionTitle'))
  assert.ok(!/contents\/.+settings/.test(settingsBlock), '设置相关代码不得拼仓库 contents 路径')
  const settingsPage = readFileSync(join(root, 'src/pages/SettingsPage.tsx'), 'utf8')
  assert.ok(settingsPage.includes('SettingsSyncCard'), '设置页要挂载统一的同步卡片')
  assert.ok(
    !/保存到 GitHub 账号[\s\S]{0,80}onClick/.test(settingsPage),
    '各分区里散落的「保存到 GitHub 账号」按钮要删干净',
  )
  const updateQueue = readFileSync(join(root, 'src/lib/updateQueue.ts'), 'utf8')
  assert.ok(!updateQueue.includes('export function enqueueSettingsSync'), '待更新队列不再接收设置类条目')
  const readme = readFileSync(join(root, 'README.md'), 'utf8')
  assert.ok(readme.includes('设置云同步'), 'README 要写清新机制')
  assert.ok(
    !/\.starlog\/settings\/(font|background)-preferences\/<login>\.json`，\s*\\?$/.test(readme) &&
      !readme.includes('统一更新时写入仓库的 `.starlog/settings/'),
    'README 不能再描述「设置写进仓库」',
  )
})

test('issue #126：背景图来源、白名单与铺法偏好', () => {
  const {
    BACKGROUND_IMAGE_DIR,
    buildBackgroundImageChoices,
    fileNameFromUrl,
    normalizeBackgroundImage,
    normalizeBackgroundImageUrl,
    pickImageEntries,
    resolveBackgroundImage,
    DEFAULT_BACKGROUND_IMAGE,
    LOCAL_BACKGROUND_IMAGE_LIMIT,
  } = backgroundImageMod

  assert.equal(BACKGROUND_IMAGE_DIR, 'user_upload/background_image', '目录名是 issue #126 点名的路径')

  // 只接受 data:image 与 http(s)，其他一律丢掉
  assert.equal(normalizeBackgroundImageUrl(' https://cdn.example.com/a.png '), 'https://cdn.example.com/a.png')
  assert.equal(normalizeBackgroundImageUrl('data:image/png;base64,iVBORw0KGgo='), 'data:image/png;base64,iVBORw0KGgo=')
  for (const bad of ['', '   ', 'javascript:alert(1)', 'url(https://evil)', '/local/path.png', 'https://a" onclick="x', 'https://a\nx']) {
    assert.equal(normalizeBackgroundImageUrl(bad), '', `${bad} 不该被接受`)
  }
  assert.equal(normalizeBackgroundImageUrl(`data:image/png;base64,${'A'.repeat(LOCAL_BACKGROUND_IMAGE_LIMIT + 1)}`), '', '超限的 data URI 要拒绝')

  // 目录列表 → 可选项：只要图片、按名字排序、label 去掉扩展名
  const choices = buildBackgroundImageChoices([
    { name: 'zz-snow.png', type: 'file' },
    { name: 'README.md', type: 'file' },
    { name: 'nest', type: 'dir' },
    { name: 'aa-mist.jpg', type: 'file' },
  ])
  assert.deepEqual(choices.map((item) => item.name), ['aa-mist.jpg', 'zz-snow.png'])
  assert.equal(choices[0].label, 'aa-mist')
  assert.ok(choices[0].url.includes('/user_upload/background_image/aa-mist.jpg'), '仓库图片要指向 raw 地址下的原路径')
  assert.deepEqual(pickImageEntries([{ name: 'a.gif' }, { name: 'b.txt' }]), ['a.gif'], 'type 缺省时按扩展名判断')

  // 中文与空格文件名要能被编码，展示名要还原
  const spaced = buildBackgroundImageChoices([{ name: '夜 色.jpg', type: 'file' }])[0]
  assert.ok(spaced.url.includes(encodeURIComponent('夜 色.jpg')), '文件名要逐段 encode，避免空格截断')
  assert.equal(fileNameFromUrl(spaced.url), '夜 色.jpg')

  // 偏好归一化：非法值回默认，enabled 必须有可用地址
  const pref = normalizeBackgroundImage({ enabled: true, url: 'javascript:alert(1)', fit: 'weird', dim: 999, fixed: 0 })
  assert.equal(pref.enabled, false, '地址非法时整层不该启用')
  assert.equal(pref.fit, 'cover')
  assert.equal(pref.dim, 80)
  assert.equal(pref.fixed, false)
  assert.equal(normalizeBackgroundImage(null).enabled, DEFAULT_BACKGROUND_IMAGE.enabled)

  // 站点默认背景：没选过才回退，选过就以读者为准
  const picked = { ...DEFAULT_BACKGROUND_IMAGE, enabled: true, url: 'data:image/png;base64,AAA=', source: 'local', updatedAt: 5 }
  assert.equal(resolveBackgroundImage(picked).url, picked.url)
  const untouched = normalizeBackgroundImage(null)
  const resolved = resolveBackgroundImage(untouched)
  assert.equal(resolved.enabled, false, 'config 里没填默认图时保持关闭（githubConfig.defaultBackgroundImage 为空）')
})

test('issue #127：「末段可滚到顶」的留白算术（行号栏已按站长要求撤掉）', () => {
  const { computeScrollPastEndPadding, countTextLines, rebuildTextareaLineMirror } = scrollSyncMod

  // 行数口径：状态栏的「N 行」与 textarea 的换行符一致，行尾换行也算一个真实可编辑的空行
  assert.equal(countTextLines(''), 1)
  assert.equal(countTextLines('a\nb'), 2)
  assert.equal(countTextLines('a\nb\n'), 3, '行尾换行是一个真实可编辑的空行')
  assert.equal(countTextLines('a\r\nb'), 2, 'CRLF 要按一行算')

  // 留白 = 视口高 - 一行行高 - 上内边距；不够长时为 0（不硬撑出空白）
  assert.equal(computeScrollPastEndPadding(600, 28, 20), 552)
  assert.equal(computeScrollPastEndPadding(600, 28, 0), 572)
  assert.equal(computeScrollPastEndPadding(20, 28, 20), 0)
  assert.equal(computeScrollPastEndPadding(600, 0, 0), 0, '行高度量还没拿到时不加留白')

  /* ---- 静态约定：留白接在 DOM 上，镜像层仍是双栏联动的地基 ---- */
  const editorSrc = readFileSync(join(root, 'src/pages/Editor.tsx'), 'utf8')
  assert.ok(editorSrc.includes('computeScrollPastEndPadding'), '尾部留白走同一个算术函数')
  assert.ok(/paddingBottom/.test(editorSrc), '留白要写到 textarea 的 paddingBottom 上')
  assert.ok(editorSrc.includes('useEditorScrollPastEnd'), '留白要能在设置里开关')
  assert.ok(editorSrc.includes('rebuildTextareaLineMirror'), '按行定位仍要靠镜像层（textarea 不暴露行盒）')
  assert.ok(/const invalidateMirror = useCallback/.test(editorSrc), '要有统一的镜像层作废入口')
  assert.ok(
    editorSrc.includes("addEventListener('starlog:settings-changed', invalidateMirror)"),
    '换字体 / 改字号会改折行，设置变更时要作废重测（否则联动按旧行位置算）',
  )
  assert.ok(
    /mirrorBuiltTextRef\.current = null[\s\S]{0,160}cachedMapperRef\.current = null/.test(editorSrc),
    '作废要同时清掉镜像层与滚动映射缓存',
  )

  /* ---- 行号栏要撤干净：半截接线（样式、开关、同步白名单、度量）都不该留下 ---- */
  // 注释里允许提到旧写法，比对前先剥掉注释
  const css = readFileSync(join(root, 'src/styles/index.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
  for (const token of ['.editor-gutter', '.editor-textarea-with-gutter', 'editor-gutter-line']) {
    assert.ok(!css.includes(token), `${token} 应随行号栏一起删掉`)
  }
  const leftovers = [
    ['src/pages/Editor.tsx', 'lineNumbers'],
    ['src/lib/editorSettings.ts', 'editorLineNumbers'],
    ['src/pages/SettingsPage.tsx', '编辑区显示行号'],
    ['src/lib/settingsSnapshot.ts', 'editorLineNumbers'],
    ['src/lib/scrollSync.ts', 'collectLineMetrics'],
  ]
  for (const [file, needle] of leftovers) {
    assert.ok(
      !readFileSync(join(root, file), 'utf8').includes(needle),
      `${file} 里不该残留 ${needle}：功能撤了就要连开关、样式与同步白名单一起撤`,
    )
  }

  const settingsSrc = readFileSync(join(root, 'src/pages/SettingsPage.tsx'), 'utf8')
  for (const label of ['编辑区末尾留白', '双栏自动同步滚动']) {
    assert.ok(settingsSrc.includes(label), `设置页里应有「${label}」相关开关文案`)
  }
  // 留白与联动都只是偏好，不进仓库：写在 settingsStore 的个人键上
  const editorSettings = readFileSync(join(root, 'src/lib/editorSettings.ts'), 'utf8')
  assert.ok(editorSettings.includes('useFlag'), '两个编辑器开关共用同一个开关工厂')
  assert.ok(!editorSettings.includes('api.github.com'), '开关只写本机，不直连任何接口')
  void rebuildTextareaLineMirror
})

test('issue #128：滚动条槽位固定 + 弹层滚动锁不顶页面 + 背景层按需加载', async () => {
  const { isPageScrollLocked, lockPageScroll } = scrollLockMod
  // scrollLock 读的是全局 document / window，所以用与其他用例同一套 JSDOM 环境
  const env = setupJsdomTestEnv('https://example.com/settings')
  try {
    const { document } = env.dom.window
    const html = document.documentElement
    assert.equal(isPageScrollLocked(), false, '初始未锁')
    const unlockA = lockPageScroll()
    const unlockB = lockPageScroll()
    assert.equal(document.body.style.overflow, 'hidden', '锁定时 body 不滚动')
    assert.equal(html.style.overflow, 'hidden', 'html 也要一起锁，否则 iOS / 部分内核仍能滚页')
    unlockA()
    assert.equal(isPageScrollLocked(), true, '还有第二个持有者时不能提前解锁')
    assert.equal(document.body.style.overflow, 'hidden')
    unlockB()
    assert.equal(isPageScrollLocked(), false, '引用计数归零后要恢复')
    assert.equal(document.body.style.overflow, '', '恢复成脚本接管前的值，而不是写死 auto')
    // 反复锁 / 解不泄漏计数
    for (let i = 0; i < 5; i += 1) lockPageScroll()()
    assert.equal(isPageScrollLocked(), false)
  } finally {
    env.cleanup()
  }

  /* ---- 位移抖动：槽位常驻 + 所有会锁滚动的地方都走同一个 refcount ---- */
  const css = readFileSync(join(root, 'src/styles/index.css'), 'utf8')
  const shellHtml = readFileSync(join(root, 'index.html'), 'utf8')
  assert.match(
    shellHtml,
    /['"]html,\s*body\s*\{[^}]*scrollbar-gutter:\s*stable[^}]*\}['"]/,
    'html 与 body 都要固定预留滚动条槽位（只写一处时，锁滚动的内核仍会跳）',
  )
  assert.ok(
    shellHtml.includes("gutterStyle.id = 'starlog-scroll-gutter'"),
    '注入的那条样式要有 id，方便排查；也不要顺手写成 <style> 标签（会被 Vite 抽成独立 CSS 资源）',
  )
  // 视口级规则不能进共享样式表：src/styles/index.css 会被插件编译成预览样式，
  // 跟着进宿主页面就会缩窄插件预览，并让「真实浏览器排版对照」测试误报（CI 上真挂过）。
  assert.ok(!/scrollbar-gutter\s*:/.test(css), 'scrollbar-gutter 只写在 index.html，不写进 src/styles/index.css')
  assert.ok(!/overflow-y:\s*scroll/.test(css), '不要用 overflow-y: scroll 硬占位（锁滚时会留一条空白槽）')
  for (const file of ['src/components/SearchDialog.tsx', 'src/components/LatexPicker.tsx', 'src/pages/Editor.tsx']) {
    const src = readFileSync(join(root, file), 'utf8')
    assert.ok(src.includes('lockPageScroll'), `${file} 的弹层 / 全屏要用引用计数的滚动锁`)
    assert.ok(
      !/document\.body\.style\.overflow\s*=\s*['"]hidden['"]/.test(src),
      `${file} 不该再直接改写 body 的 overflow`,
    )
  }

  /* ---- 首屏：装饰背景从入口 chunk 里拆出去 ---- */
  const layout = readFileSync(join(root, 'src/components/Layout.tsx'), 'utf8')
  assert.ok(/lazy\(\(\)\s*=>\s*import\('\.\/AnimatedBackdrop'\)/.test(layout), '动态背景改为按需加载')
  assert.ok(layout.includes('Suspense'), '拆出去的图层要有 Suspense 兜底')
  const main = readFileSync(join(root, 'src/main.tsx'), 'utf8')
  assert.ok(main.indexOf('<ToastProvider') < main.indexOf('<SettingsSyncProvider'), '同步卡片依赖 toast，Provider 顺序不能反')
  assert.ok(main.indexOf('<SettingsSyncProvider') < main.indexOf('<FontProvider'), '字体 / 背景要在同步层之下才能收到恢复事件')
  const postsSrc = readFileSync(join(root, 'src/lib/posts.ts'), 'utf8')
  assert.ok(
    /let repoPostsCache/.test(postsSrc) && /let aggregateCache/.test(postsSrc),
    '仓库文章解析与公开列表聚合都要有缓存，切页时不重复解析',
  )
  assert.ok(/repoPostsBySlug/.test(postsSrc), '按 slug 查文章要走索引，不能每次线性扫全表')
  const viteConfig = readFileSync(join(root, 'vite.config.ts'), 'utf8')
  assert.ok(!viteConfig.includes('inlineDynamicImports'), '线上构建保持分包，不能把一切塞进入口')
})

test('issue #112：局域网协作的段落合并、会话去抖与中心协议一致', async () => {
  const {
    applyRemoteOps,
    blocksToText,
    liveBlocks,
    planLocalChange,
    resequence,
    splitParagraphs,
    textToBlocks,
  } = lanDocMod
  const { createLanSession, normalizeHubUrl } = lanSyncMod

  // 切段：行内换行留在同一段，连续空行合并成一个分隔
  assert.deepEqual(splitParagraphs('a\nb\n\n\nc\n'), ['a\nb', 'c'])
  assert.deepEqual(splitParagraphs('   \n\n  '), [])
  const codeBlock = '```js\nlet x = 1\n\nlet y = 2\n```'
  assert.deepEqual(splitParagraphs(codeBlock), [codeBlock], '代码块内部的空行不能被切开')
  assert.deepEqual(
    splitParagraphs('前\n\n::begin_ui-ccs\ncreate_point:A:(1,2);\n\ncreate_line:(x);\n::end_ui-ccs\n\n后'),
    ['前', '::begin_ui-ccs\ncreate_point:A:(1,2);\n\ncreate_line:(x);\n::end_ui-ccs', '后'],
    '容器块整体算一段，内部空行不切分',
  )
  assert.deepEqual(splitParagraphs('a\n\n```\n\n```\n\nb'), ['a', '```\n\n```', 'b'], '未闭合的围栏只在闭合后恢复切分')
  assert.deepEqual(splitParagraphs('    let x = 1\n\n    let y = 2'), ['    let x = 1', '    let y = 2'], '缩进要保留')

  const blocks = textToBlocks('第一段\n第二行\n\n第二段', '甲')
  assert.equal(liveBlocks(blocks).length, 2)
  assert.equal(blocksToText(blocks), '第一段\n第二行\n\n第二段', '切分与拼回要保持内容不变')

  // 只改一段 → 只发一条 put；新增一段 → 插到相邻段之间
  const plan = planLocalChange(blocks, '第一段\n第二行改过了\n\n第二段\n\n\n第三段', '甲')
  assert.equal(plan.puts.length, 2, '改动 + 新增各一条')
  assert.equal(plan.dels.length, 0)
  assert.equal(plan.kept, 1, '没动的那段不该上行')
  const inserted = plan.blocks.filter((block) => block.text === '第三段')[0]
  assert.ok(inserted.seq > Math.max(...blocks.map((block) => block.seq)), '新段落排在最后')

  // 删掉一段 → 打墓碑，而不是把后面的段落挪位
  const deletePlan = planLocalChange(blocks, '第一段\n第二行\n\n', '甲')
  assert.equal(deletePlan.dels.length, 1)
  assert.equal(liveBlocks(deletePlan.blocks).length, 1)

  // 后写覆盖先写；被覆盖的那一条要能被界面数出来
  const remote = applyRemoteOps(blocks, [
    { id: blocks[0].id, kind: 'put', text: '乙改的', v: 2, by: '乙', ts: Date.now() + 1000 },
  ])
  assert.equal(remote.blocks.find((block) => block.id === blocks[0].id).text, '乙改的')
  assert.equal(remote.conflicts.length, 1, '覆盖本地内容要记一次冲突')
  // 旧的（乱序到达的）改动不能把新内容顶掉
  const stale = applyRemoteOps(remote.blocks, [{ id: blocks[0].id, kind: 'put', text: '旧稿', v: 1, by: '丙', ts: 1 }])
  assert.equal(stale.blocks.find((block) => block.id === blocks[0].id).text, '乙改的')

  // 删除是终局的：别人的旧 put 不能让段落复活
  const afterDelete = applyRemoteOps(deletePlan.blocks, deletePlan.dels)
  const revive = applyRemoteOps(afterDelete.blocks, [{ id: deletePlan.blocks[1].id, kind: 'put', text: '复活', v: 1, by: '乙', ts: 1 }])
  assert.equal(liveBlocks(revive.blocks).length, 1)

  // seq 挤在一起时中心重排，顺序保持不变
  const squeezed = resequence([
    { id: 'b1', text: '1', seq: 5, v: 1, by: '甲', ts: 1 },
    { id: 'b2', text: '2', seq: 5, v: 1, by: '甲', ts: 1 },
    { id: 'b3', text: '3', seq: 5.5, v: 1, by: '甲', ts: 1 },
  ])
  assert.deepEqual(liveBlocks(squeezed).map((block) => block.text), ['1', '2', '3'])
  assert.ok(squeezed.every((block, index) => index === 0 || block.seq > squeezed[index - 1].seq), '重排后严格递增')

  // 中心地址：允许省略协议与路径尾巴，但只认 http(s)
  assert.equal(normalizeHubUrl('192.168.1.20:8787'), 'http://192.168.1.20:8787')
  assert.equal(normalizeHubUrl('http://192.168.1.20:8787/'), 'http://192.168.1.20:8787')
  assert.equal(normalizeHubUrl('http://192.168.1.20:8787/api'), 'http://192.168.1.20:8787')
  assert.equal(normalizeHubUrl('https://hub.lan:8787'), 'https://hub.lan:8787')
  for (const bad of ['', 'ftp://192.168.1.20', 'javascript:alert(1)', 'notaurl!!', 'http:///api', 'http:// 空格']) {
    assert.throws(() => normalizeHubUrl(bad), /中心地址/, `不该接受 ${bad}`)
  }
  // 主机名允许 .local / .lan 这类局域网解析，也接受 IPv6 字面量
  assert.equal(normalizeHubUrl('http://nas.local:8787'), 'http://nas.local:8787')
  assert.equal(normalizeHubUrl('http://192.168.1.20'), 'http://192.168.1.20', '默认端口不用写出来')

  /* ---- 会话层：去抖上行 + 输入期不被远端顶掉光标 ---- */
  // 一个「迷你中心」：状态与真 hub 一样按 (v, ts) 后写覆盖先写，能直接复用前端那套合并函数
  const store = []
  let storeRev = 0
  const sent = []
  let onEvent = null
  const commit = (ops, by) => {
    const applied = applyRemoteOps(store, ops)
    store.length = 0
    store.push(...resequence(applied.blocks))
    storeRev += 1
    return { rev: storeRev, blocks: store.map((block) => ({ ...block })), peers: [{ name: by, at: 0 }] }
  }
  const fakeTransport = {
    async request(path, init) {
      const body = init?.body ?? {}
      if (path === '/api/join') return { rev: storeRev, blocks: store.map((block) => ({ ...block })), peers: [] }
      if (path === '/api/ops') {
        sent.push(...body.ops.map((op) => ({ ...op })))
        return commit(body.ops, body.name)
      }
      if (path === '/api/state') return { rev: storeRev, blocks: store.map((block) => ({ ...block })), peers: [] }
      return { ok: true }
    },
    subscribe(_path, handler) {
      onEvent = handler
      return () => {
        onEvent = null
      }
    },
  }
  let lastText = null
  let lastConflicts = null
  let lastStatus = null
  const handlers = {
    onText: (text, meta) => {
      lastText = text
      lastConflicts = meta.conflicts
    },
    onStatus: (next) => {
      lastStatus = next
    },
    onPeers: () => {},
  }
  /** 另一台设备写一段：先落到中心，再推给本页（和真 hub 的顺序一致） */
  const peerWrites = (who, text) => {
    const created = textToBlocks(text, who, Date.now() + 10_000)
    const ops = liveBlocks(created).map((block) => ({
      id: block.id,
      kind: 'put',
      text: block.text,
      seq: block.seq,
      v: block.v,
      by: who,
      ts: block.ts,
    }))
    commit(ops, who)
    onEvent({ type: 'doc', by: who, rev: storeRev, ops })
    return created
  }

  const session = createLanSession({ room: '机房', name: '甲', handlers, quietMs: 5 }, fakeTransport)
  // 与页面一致：先 seed 再 join —— 空房间时 join 会把整篇作为初始文档全量上行
  session.seed('我的第一段\n\n我的第二段')
  await session.join()
  assert.equal(liveBlocks(store).length, 2, '空房间拿到初始全文')
  const pushedAtJoin = sent.length
  session.pushLocalText('我的第一段改\n\n我的第二段')
  assert.equal(sent.length, pushedAtJoin, '还在去抖窗口内，不应立刻发出')
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 40))
  assert.equal(sent.length, pushedAtJoin + 1, '去抖窗口结束后只发这一条改动')
  assert.ok(sent.some((op) => op.text === '我的第一段改'), '改动的段落要上行')
  assert.equal(liveBlocks(store).length, 2, '中心只有甲的两段')
  assert.equal(liveBlocks(store).map((block) => block.text).join('\n\n'), '我的第一段改\n\n我的第二段')

  // 乙在甲「正在输入」期间写了两段：甲的编辑区不能被打断（否则光标会跳），
  // 但冲刷之后必须把它们并回来 —— 尤其不能当成「甲删掉了它们」上行。
  const before = lastText
  session.pushLocalText('我的第一段改\n\n我的第二段\n\n甲又补了一句')
  peerWrites('乙', '乙的临时段落')
  peerWrites('乙', '乙又写了一段')
  assert.equal(lastText, before, '正在输入时不能把远端内容硬塞回编辑区')
  await session.flush()
  assert.ok(lastText.includes('甲又补了一句'), '冲刷后本地内容要上行')
  assert.ok(lastText.includes('乙的临时段落'), '输入期间收到的远端段落必须并回来，不能当成被删掉')
  assert.ok(lastText.includes('乙又写了一段'), '远端后写的段落也要出现在合并结果里')
  assert.ok(liveBlocks(store).some((block) => block.text === '乙又写了一段'), '中心不能被甲的冲刷抹掉乙的段落')
  assert.equal(lastStatus, 'online', '同步完成后回到已连接状态')
  Array.isArray(lastConflicts)
  session.leave()

  /* ---- 真跑一个中心进程：两个客户端 + SSE 广播，与前端语义对齐 ---- */
  const { server } = lanHubMod.createLanHub({ room: 't1', file: join(root, 'offline/index.html'), onLog: () => {} })
  await new Promise((resolvePromise) => server.listen(0, '127.0.0.1', resolvePromise))
  const port = server.address().port
  const base = `http://127.0.0.1:${port}`
  const api = async (path, payload) => {
    const res = await fetch(base + path, payload ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) } : undefined)
    const json = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(`${res.status} ${json.error ?? ''}`)
    return json
  }
  try {
    // SSE 先挂上，才能收到另一台设备提交的广播帧
    const stream = await fetch(`${base}/api/events?room=t1&name=丙`)
    const reader = stream.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    /** 帧超时兜底：拿不到就失败，不能让测试挂在长连接上 */
    const withTimeout = (promise) =>
      Promise.race([promise, new Promise((resolvePromise) => setTimeout(() => resolvePromise(null), 4000))])
        .then((frame) => {
          assert.ok(frame, '4 秒内没等到期望的帧')
          return frame
        })
    const nextFrame = (what, matcher = () => true) => withTimeout(readFrame(matcher), what)
    /** 只返回满足条件的那一帧（presence / doc / hello 会混在一条流里） */
    const readFrame = async (matcher = () => true) => {
      for (let i = 0; i < 40; i += 1) {
        const hit = buffer.indexOf('data: ')
        if (hit >= 0) {
          const end = buffer.indexOf('\n\n', hit)
          if (end >= 0) {
            const payload = buffer.slice(hit + 6, end)
            buffer = buffer.slice(end + 2)
            let frame = null
            try {
              frame = JSON.parse(payload)
            } catch {
              frame = null
            }
            if (frame && matcher(frame)) return frame
            continue
          }
        }
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
      }
      return null
    }
    const hello = await nextFrame('hello 首帧', (frame) => frame.type === 'hello')
    assert.equal(hello.type, 'hello', '连上先收到当前快照')
    assert.ok(Array.isArray(hello.blocks))

    const a = await api('/api/join', { room: 't1', name: '甲' })
    assert.equal(a.blocks.length, 0, '新房间是空的')
    const first = textToBlocks('甲的第一段\n\n甲的第二段', '甲')
    const afterPush = await api('/api/ops', {
      room: 't1',
      name: '甲',
      ops: liveBlocks(first).map((block) => ({ id: block.id, kind: 'put', text: block.text, seq: block.seq, v: block.v, by: '甲', ts: block.ts })),
    })
    assert.equal(afterPush.blocks.length, 2)
    const pushed = await nextFrame('甲提交的 doc 广播', (frame) => frame.type === 'doc')
    assert.ok(pushed, '另一台设备要收到 doc 广播')
    assert.equal(pushed.by, '甲')
    assert.equal(pushed.ops.length, 2)

    // 乙在只读快照上改第一段，甲的第二段不受影响
    const b = await api('/api/join', { room: 't1', name: '乙' })
    assert.equal(b.blocks.length, 2, '后进来的设备拿到全文')
    const changed = await api('/api/ops', {
      room: 't1',
      name: '乙',
      ops: [{ id: b.blocks[0].id, kind: 'put', text: '乙改了第一段', v: b.blocks[0].v + 1, by: '乙', ts: Date.now() + 2000 }],
    })
    assert.equal(changed.blocks.length, 2)
    assert.equal(changed.blocks.find((block) => block.id === b.blocks[0].id).text, '乙改了第一段')
    assert.equal(changed.blocks.find((block) => block.id === b.blocks[1].id).text, '甲的第二段', '另一段必须原样保留')

    // 陈旧写入被中心挡掉（与前端 isNewer 同一套判据）
    const stale = await api('/api/ops', { room: 't1', name: '丙', ops: [{ id: b.blocks[0].id, kind: 'put', text: '旧稿覆盖', v: 1, by: '丙', ts: 1 }] })
    assert.equal(stale.blocks.find((block) => block.id === b.blocks[0].id).text, '乙改了第一段', '旧版本号不能覆盖新内容')
    assert.equal(stale.rev, changed.rev, '没有实际改动就不该推进 rev')

    // 在线成员与删除段落
    const health = await api('/api/health')
    assert.ok(health.rooms.includes('t1'))
    assert.ok(health.peers >= 1, 'SSE / join 过的成员要能被统计到')
    const withDelete = await api('/api/ops', { room: 't1', name: '乙', ops: [{ id: b.blocks[1].id, kind: 'del', v: b.blocks[1].v + 1, by: '乙', ts: Date.now() + 3000 }] })
    assert.equal(withDelete.blocks.length, 1, '墓碑段落不出现在快照里')
    await nextFrame('删除段落的 doc 广播', (frame) => frame.type === 'doc')

    // 离线版产物仍能作为站点发出去（其他设备直接用浏览器加入）
    // 只读响应头就掐掉：22MB 的包没必要在测试里整份下完，也免得连接挂着不放
    const page = await new Promise((resolvePromise) => {
      const req = httpRequest(`${base}/`, (res) => {
        resolvePromise({ status: res.statusCode ?? 0, type: String(res.headers['content-type'] ?? '') })
        res.destroy()
      })
      req.on('error', () => resolvePromise({ status: 0, type: '' }))
    })
    assert.equal(page.status, 200, '中心要能把离线 HTML 提供给局域网里的其他设备')
    assert.equal(page.type.split(';')[0], 'text/html')
    await reader.cancel().catch(() => {})
  } finally {
    // SSE 是长连接，不断开就 close 不掉
    server.closeAllConnections?.()
    await new Promise((resolvePromise) => server.close(() => resolvePromise(null)))
  }

  /* ---- 静态约定：入口只在离线版出现，产物里不含任何公网端点 ---- */
  const appSrc = readFileSync(join(root, 'src/App.tsx'), 'utf8')
  assert.ok(appSrc.includes('toolbox/lan'), '路由要挂上')
  const toolboxSrc = readFileSync(join(root, 'src/pages/Toolbox.tsx'), 'utf8')
  assert.ok(/OFFLINE && \([\s\S]*toolbox\/lan/.test(toolboxSrc), '卡片只在离线版出现（issue #112：仅实现在离线版）')
  const lanPage = readFileSync(join(root, 'src/pages/LanEdit.tsx'), 'utf8')
  assert.ok(lanPage.includes('scripts/offline-hub.mjs'), '页面上要写清中心怎么跑')
  const hubSrc = readFileSync(join(root, 'scripts/offline-hub.mjs'), 'utf8')
  for (const forbidden of ['api.github.com', 'raw.githubusercontent', 'fonts.googleapis.com', 'https://registry', 'github.com/login']) {
    assert.ok(!hubSrc.includes(forbidden), `中心不该引用 ${forbidden}`)
  }
  assert.ok(hubSrc.includes("'0.0.0.0'"), '默认要监听局域网地址')
  assert.ok(hubSrc.includes('text/event-stream'), 'SSE 广播是必需的')
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  assert.equal(pkg.scripts.hub, 'node scripts/offline-hub.mjs', '要有一条省心的启动命令')
})

test('issue #112 追加：房间码 + 中心自动发现（加入者只输 6 位数字）', async () => {
  const { discoverHub, formatRoomCode, hubCandidates, normalizeHubUrl, normalizeRoomCode, parseLanInvite } =
    lanSyncMod
  const { createLanHub, lanInviteUrl } = lanHubMod

  // 房间码：只认 6 位数字，展示时固定 3-3 分组
  assert.equal(normalizeRoomCode('483-902'), '483902')
  assert.equal(normalizeRoomCode(' 483 902 '), '483902')
  assert.equal(normalizeRoomCode(483902), '483902')
  assert.equal(formatRoomCode('483902'), '483-902')
  for (const bad of ['', '12', '48390', '4839021', 'abc-abc', '机房协作']) {
    assert.equal(normalizeRoomCode(bad), '', `${bad} 不是房间码`)
  }

  // 加入链接：查询串在 hash 里（HashRouter），hub 可以省略
  const invite = parseLanInvite('hub=http%3A%2F%2F192.168.1.20%3A8787&room=483-902')
  assert.deepEqual(invite, { hub: 'http://192.168.1.20:8787', room: '483-902', code: '483902' })
  assert.equal(parseLanInvite('room=483902').hub, '', '链接里没写 hub 时留空，由页面用当前站点补')
  assert.equal(parseLanInvite('tab=1'), null, '与本功能无关的查询串返回 null，免得乱自动连接')
  assert.equal(parseLanInvite('?room=机房协作').code, '', '填的是房间名时 code 为空')
  assert.equal(parseLanInvite('?room=机房协作').room, '机房协作')
  assert.equal(parseLanInvite(''), null)
  assert.equal(
    lanInviteUrl('192.168.1.20', 8787, '483902'),
    'http://192.168.1.20:8787/#/toolbox/lan?room=483-902',
    '中心打印的链接必须能被路由直接接住',
  )
  assert.ok(
    lanInviteUrl('192.168.1.20', 8787, '483902', { withHub: true }).includes('hub=http'),
    '--with-hub 时才把中心地址也写进链接',
  )

  // 候选顺序：手填 > 当前站点 > 记忆；非 http 与重复都要被滤掉
  assert.deepEqual(
    hubCandidates({
      manual: 'http://10.0.0.5:8787/',
      currentOrigin: 'http://192.168.1.20:8787',
      history: ['http://10.0.0.5:8787', 'http://nas.local:8787'],
    }),
    ['http://10.0.0.5:8787', 'http://192.168.1.20:8787', 'http://nas.local:8787'],
  )
  assert.deepEqual(
    hubCandidates({ currentOrigin: 'file://', history: ['null', 'http://a:1', 'http://a:1'] }),
    ['http://a:1'],
    'file:// 打开的离线文件没有 origin 可用',
  )

  // 发现：不可达的候选跳过、没有这个码的候选跳过、命中就停
  const probes = []
  const found = await discoverHub('483-902', ['http://a:1', 'http://b:2', 'http://c:3'], async (url) => {
    probes.push(url)
    if (url.includes('//a:1')) throw new Error('连接被拒绝')
    if (url.includes('//b:2')) return { ok: true, rooms: [{ code: '111222', name: '别人的房间' }] }
    return { ok: true, rooms: [{ code: '483902', name: '机房协作', rev: 3, peers: 2 }] }
  })
  assert.equal(found.hub, 'http://c:3')
  assert.equal(found.room.name, '机房协作')
  assert.deepEqual(probes, ['http://a:1/api/rooms?code=483902', 'http://b:2/api/rooms?code=483902', 'http://c:3/api/rooms?code=483902'])
  assert.equal(await discoverHub('', ['http://a:1'], async () => ({ rooms: [] })), null, '没填码不去乱猜')
  assert.equal(await discoverHub('999999', [], async () => ({ rooms: [] })), null)

  /* ---- 中心侧：启动就把房间建好、按码加入、错码 404 ---- */
  const { server, rooms } = createLanHub({
    code: '483902',
    room: '机房四人',
    file: join(root, 'offline/index.html'),
    onLog: () => {},
  })
  await new Promise((resolvePromise) => server.listen(0, '127.0.0.1', resolvePromise))
  const base = `http://127.0.0.1:${server.address().port}`
  const api = async (path, payload) => {
    const res = await fetch(base + path, payload ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) } : undefined)
    const json = await res.json().catch(() => ({}))
    return { status: res.status, json }
  }
  try {
    // 房间是启动时就存在的（否则加入者扫描时会「谁都没有」）
    const listed = await api('/api/rooms')
    assert.equal(listed.status, 200)
    const mine = listed.json.rooms.find((item) => item.code === '483902')
    assert.ok(mine, '启动参数里的 --code 要真的用上')
    assert.equal(mine.name, '机房四人')
    assert.equal(typeof mine.chars, 'number')
    const filtered = await api('/api/rooms?code=483902')
    assert.deepEqual(filtered.json.rooms.map((item) => item.code), ['483902'])
    assert.deepEqual((await api('/api/rooms?code=123456')).json.rooms, [], '只查不建')
    assert.equal((await api('/api/rooms?code=abc')).status, 200, '非数字 code 也不报错，返回全量')

    const joined = await api('/api/join', { code: '483902', name: '乙' })
    assert.equal(joined.status, 200)
    assert.equal(joined.json.code, '483902', '快照要带房间码，页面才知道显示什么')
    assert.ok(joined.json.peers.some((peer) => peer.name === '乙'))
    assert.equal((await api('/api/join', { code: '999999', name: '丙' })).status, 404, '错码不能凭空开出新房间')

    // 6 位数字当房间名提交时会沿用这个码；其他名字则自动分配一个
    const byName = await api('/api/join', { room: '机房四人', name: '甲' })
    assert.equal(byName.json.code, '483902', '同一个房名要落回同一个房间')
    const fresh = await api('/api/join', { room: '另一个房间', name: '甲' })
    assert.match(fresh.json.code, /^[1-9]\d{5}$/, '新房间自动分配 6 位码')
    assert.notEqual(fresh.json.code, '483902')
    const byCodeName = await api('/api/join', { room: '135-790', name: '甲' })
    assert.equal(byCodeName.json.code, '135790', '把码当房名填也不该换码')
    assert.equal(byCodeName.json.name, '房间 135-790')

    // state / leave 都认房间码
    const state = await api('/api/state?code=135790')
    assert.equal(state.json.code, '135790')
    const left = await api('/api/leave', { code: '135790', name: '甲' })
    assert.equal(left.json.ok, true)
    assert.ok(!(await api('/api/state?code=135790')).json.peers.some((peer) => peer.name === '甲'), '离开后不再算在线')

    // 中心给的码与 --code 冲突时不会撞车
    const taken = await api('/api/join', { room: '483902', name: '甲' })
    assert.equal(taken.json.code, '483902', '已存在的码直接复用同一个房间')
    // 房间表是模块级的（同一进程里多个中心实例共用），所以按名字核对而不是数总量
    assert.equal(rooms.get('机房四人').code, '483902')
    assert.match(rooms.get('另一个房间').code, /^[1-9]\d{5}$/, '没指定码时随机分配')
    assert.equal(rooms.get('135-790').code, '135790', '码当房名提交时同一个房间，不再新建')
  } finally {
    server.closeAllConnections?.()
    await new Promise((resolvePromise) => server.close(() => resolvePromise(null)))
  }

  // 会话层要把中心的房间码透出来（页面靠它显示大号房间码）
  assert.equal(
    await createSessionWithCode(lanSyncMod, '483902'),
    '483-902',
    'session.getRoomCode() 要能在 join 之后拿到中心给的码，页面才知道显示什么',
  )

  /* ---- 静态约定：页面以房间码为主入口，中心地址降为兜底 ---- */
  const lanPage = readFileSync(join(root, 'src/pages/LanEdit.tsx'), 'utf8')
  assert.ok(lanPage.includes('discoverHub'), '页面要先做中心自动发现')
  assert.ok(lanPage.includes('parseLanInvite'), '要能直接吃中心打印的加入链接')
  assert.ok(lanPage.includes('starlog:lan-hubs'), '连过的中心要记住')
  assert.ok(lanPage.includes('复制加入链接'), '发起者要能一键把链接发出去')
  assert.ok(lanPage.includes('<details'), '手填地址收进「高级」里，不做默认路径')
  const hubSrc = readFileSync(join(root, 'scripts/offline-hub.mjs'), 'utf8')
  assert.ok(hubSrc.includes('--open') && hubSrc.includes('--code'), '帮助里要写清这两个参数')
  assert.ok(hubSrc.includes('spawn'), '--open 用系统默认浏览器打开')
  assert.ok(hubSrc.includes('formatRoomCode(room.code)'), '启动横幅要打印房间码')
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  assert.equal(pkg.scripts.hub, 'node scripts/offline-hub.mjs')
})

/** 会话层拿中心房间码的最小验证（不真起进程，用假 transport）。 */
async function createSessionWithCode(lanSync, code) {
  const transport = {
    async request(path) {
      if (path === '/api/join') return { rev: 0, code, name: '机房四人', blocks: [], peers: [] }
      return { rev: 0, code, name: '机房四人', blocks: [], peers: [] }
    },
    subscribe() {
      return () => {}
    },
  }
  const session = lanSync.createLanSession(
    { room: code, name: '甲', handlers: { onText: () => {}, onStatus: () => {}, onPeers: () => {} }, quietMs: 1 },
    transport,
  )
  await session.join()
  return lanSync.formatRoomCode(session.getRoomCode())
}
