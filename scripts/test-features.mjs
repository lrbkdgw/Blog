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
const uiWidgetsMod = await importTsModule('src/lib/uiWidgets.ts')
const uiGraphMod = await importTsModule('src/lib/uiGraph.ts')
const postsMod = await importTsModule('src/lib/posts.ts')
const mdSourceMod = await importTsModule('src/lib/markdownSource.ts')

function makeMock2dContext(strokeSink, drawSink) {
  const stack = []
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
    _tx: 0,
    _ty: 0,
    _rot: 0,
    createLinearGradient: () => ({ addColorStop() {} }),
    createRadialGradient: () => ({ addColorStop() {} }),
    createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
    putImageData() {},
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

    const adjustBtn = [...container.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('调整模式'),
    )
    assert.ok(adjustBtn, '编辑器模式下 GraphPlane 应渲染「调整模式」按钮')
    adjustBtn.click()
    await new Promise((r) => setTimeout(r, 25))

    const svg = container.querySelector('.ui-graph-box svg[role="application"]')
    svg.getBoundingClientRect = () => ({ left: 0, top: 0, width: 680, height: 420, right: 680, bottom: 420 })
    svg.setPointerCapture = () => {}

    // 读取节点 1 当前屏幕坐标并拖拽到新的目标坐标 (490, 90)
    const node1El = container.querySelector('[data-node-id="1"]')
    const matchT = node1El.getAttribute('transform').match(/translate\(([-\d.]+),([-\d.]+)\)/)
    const startSX = Number(matchT[1])
    const startSY = Number(matchT[2])
    const Ptr = dom.window.PointerEvent || dom.window.MouseEvent

    svg.dispatchEvent(new Ptr('pointerdown', { bubbles: true, button: 0, clientX: startSX, clientY: startSY, pointerId: 1 }))
    await new Promise((r) => setTimeout(r, 15))
    svg.dispatchEvent(new Ptr('pointermove', { bubbles: true, clientX: 490, clientY: 90, pointerId: 1 }))
    await new Promise((r) => setTimeout(r, 15))
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

    reactRoot.unmount()
    await new Promise((r) => setTimeout(r, 30))
  } finally {
    dom.window.close()
    Object.assign(globalThis, prevGlobals)
  }
})

