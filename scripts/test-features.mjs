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
    plugins: [
      {
        name: 'vite-raw-md',
        setup(b) {
          b.onResolve({ filter: /\?raw$/ }, (args) => ({
            path: join(root, args.path.replace(/^\//, '').replace(/\?raw$/, '')),
          }))
        },
      },
    ],
    loader: {
      '.jpg': 'dataurl',
      '.png': 'dataurl',
      '.svg': 'dataurl',
      '.md': 'text',
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


