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
const uiChoicesMod = await importTsModule('src/lib/uiChoices.ts')
const uiWriteMod = await importTsModule('src/lib/uiWrite.ts')
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
/*             4. 交互选择 / 条件表达式 / 图与源码往返测试                     */
/* -------------------------------------------------------------------------- */

test('交互选择配置、1-based 值引用、条件公式白名单求值与图节点坐标源码往返', () => {
  const choose = uiChoicesMod.parseUiChoiceConfig(
    'choose',
    'meal',
    '今天吃什么',
    'more 1 2',
    '[A]\n香蕉好吃！\n[B]\n我！\n爱！\n[$\\sum$]\n计算题！',
  )
  assert.equal(choose.options.length, 3)
  assert.equal(choose.minCount, 1)
  assert.equal(choose.maxCount, 2)
  assert.deepEqual(uiChoicesMod.initialUiChoiceValue(choose), [1])
  assert.deepEqual(uiChoicesMod.normalizeSelectedIndexes([3, 2, 2, 0], 3, [1]), [2, 3])
  const fencedChoose = uiChoicesMod.parseUiChoiceConfig(
    'choose',
    'fenced',
    '代码示例',
    '',
    '[A]\n```markdown\n[B]\n::end_ui-choose\n```\n选项内容\n[B]\n第二项',
  )
  assert.equal(fencedChoose.options.length, 2)
  assert.match(fencedChoose.options[0].content, /\[B\]\n::end_ui-choose/)

  const checklist = uiChoicesMod.parseUiChoiceConfig('if', 'tasks', '', 'lined', '先读题\n::nex\n再检查')
  assert.equal(checklist.lined, true)
  assert.equal(checklist.options.length, 2)
  const fencedChecklist = uiChoicesMod.parseUiChoiceConfig(
    'if',
    'fenced-tasks',
    '',
    '',
    '第一项\n```markdown\n::nex\n::end_ui-if\n```\n::nex\n第二项',
  )
  assert.equal(fencedChecklist.options.length, 2)
  assert.match(fencedChecklist.options[0].content, /::nex\n::end_ui-if/)
  assert.deepEqual(uiChoicesMod.initialUiChoiceValue(checklist), [false, false])
  const values = { number: [2], Ti: [3], tasks: [true, false] }
  assert.equal(uiChoicesMod.formatUiReference('number', values), '2')
  assert.equal(uiChoicesMod.formatUiReference('tasks-1', values), '1')
  assert.equal(uiChoicesMod.formatUiReference('tasks-2', values), '0')
  assert.equal(uiChoicesMod.evaluateUiCondition('$<number> \\le <Ti>$', values), true)
  assert.equal(uiChoicesMod.evaluateUiCondition('$<number> \\times 2 == <Ti>$', values), false)
  assert.equal(uiChoicesMod.evaluateUiCondition('(<number> & 1) == 0', values), true)
  assert.equal(uiChoicesMod.evaluateUiCondition('globalThis.process.exit()', values), false)
  assert.equal(uiChoicesMod.evaluateUiCondition('1 / 0 > 0', values), false)
  assert.equal(
    uiChoicesMod.resolveUiMathReferences('x_{<<number>>} + <Ti>', values),
    'x_{2} + 3',
  )

  const graphSource = [
    'point isolated',
    'A B 5 10 20',
    'C A -3 4 6',
    'point B 30 40',
    '# keep this comment',
  ].join('\n')
  const graph = uiGraphMod.parseUiGraph(graphSource, 'dag')
  assert.equal(graph.directed, true)
  assert.deepEqual(graph.nodes.map((node) => node.id), ['isolated', 'A', 'B', 'C'])
  assert.deepEqual(graph.edges.map(({ from, to, weight }) => ({ from, to, weight })), [
    { from: 'A', to: 'B', weight: '5' },
    { from: 'C', to: 'A', weight: '-3' },
  ])
  assert.deepEqual(graph.nodes.find((node) => node.id === 'B') && {
    x: graph.nodes.find((node) => node.id === 'B').x,
    y: graph.nodes.find((node) => node.id === 'B').y,
  }, { x: 30, y: 40 })
  assert.deepEqual(graph.nodes.find((node) => node.id === 'A') && {
    x: graph.nodes.find((node) => node.id === 'A').x,
    y: graph.nodes.find((node) => node.id === 'A').y,
  }, { x: 4, y: 6 })
  const laidOut = uiGraphMod.layoutUiGraphNodes(graph.nodes)
  const transform = uiGraphMod.computeUiGraphTransform(laidOut)
  assert.ok(transform.scale > 0)
  assert.equal(uiGraphMod.uiGraphToSvg(laidOut[0], transform).x >= 0, true)

  const positionedBody = uiGraphMod.formatUiGraphPositions(graphSource, [
    { id: 'isolated', x: 0, y: 0 },
    { id: 'A', x: 50.25, y: -12 },
    { id: 'B', x: 100, y: 20 },
    { id: 'C', x: -30, y: 70 },
  ])
  assert.match(positionedBody, /^point isolated 0 0/m)
  assert.match(positionedBody, /^point A 50.25 -12/m)
  assert.match(positionedBody, /A B 5 10 20/)
  assert.match(positionedBody, /# keep this comment/)
  const reparsed = uiGraphMod.parseUiGraph(positionedBody, 'dag')
  assert.deepEqual(reparsed.nodes.find((node) => node.id === 'B') && {
    x: reparsed.nodes.find((node) => node.id === 'B').x,
    y: reparsed.nodes.find((node) => node.id === 'B').y,
  }, { x: 100, y: 20 })

  const article = [
    '## 图与交互语法',
    '',
    '::begin_ui-graph[dag]',
    graphSource,
    '::end_ui-graph',
    '',
    '```markdown',
    '::begin_ui-graph[dag]',
    '```',
  ].join('\n')
  const replaced = uiGraphMod.replaceUiGraphBodyAtLine(article, 3, positionedBody)
  assert.ok(replaced.includes(`::begin_ui-graph[dag]\n${positionedBody}\n::end_ui-graph`))
  assert.equal(uiGraphMod.replaceUiGraphBodyAtLine(article, 900, 'bad'), article)
  assert.doesNotMatch(postsMod.excerpt(article), /ui-graph|isolated|A B 5/)
  assert.equal(
    postsMod.excerpt('正文 <IF:$<number> \\le <Ti>$,条件内容不进入摘要> 完毕'),
    '正文 完毕',
  )
  assert.equal(postsMod.excerpt([
    '正文',
    '::IF[1 == 1]',
    '外层条件',
    '::IF[2 == 2]',
    '嵌套条件',
    '::IF_END',
    '外层剩余条件',
    '::IF_END',
    '结束',
  ].join('\n')), '正文 结束')
  assert.deepEqual(postsMod.extractToc([
    '## 可见标题',
    '::begin_ui-choose[id][title]',
    '[A]',
    '## 控件内部标题',
    '::end_ui-choose',
    '::IF[1 == 1]',
    '## 条件内部标题',
    '::IF_END',
    '## 之后的标题',
  ].join('\n')).map((item) => item.text), ['可见标题', '之后的标题'])

  const copy = mdSourceMod.convertMarkdownForCopy([
    '::begin_ui-graph[dag]',
    'A B 5 10 20',
    '::end_ui-graph',
    '',
    '::begin_ui-choose[meal][选择][more 1 2]',
    '[A]',
    '苹果',
    '::end_ui-choose',
    '',
    '::begin_ui-select[fruit][search]',
    '苹果',
    '香蕉',
    '::end_ui-select',
    '',
    '::begin_ui-if[tasks][lined]',
    '读题',
    '::nex',
    '检查',
    '::end_ui-if',
    '',
    '<<meal>> <IF:$<number> \\le 2$,答对！>',
  ].join('\n'), 'basic')
  assert.doesNotMatch(copy, /::begin_ui-(?:graph|choose|select|if)|::end_ui-|::nex/)
  assert.match(copy, /A → B（权重 5）/)
  assert.match(copy, /今天吃什么|选择/)
  assert.match(copy, /【meal】/)
  assert.ok(copy.includes('当 $<number> \\le 2$ 成立时：答对！'))

  const fencedCopy = mdSourceMod.convertMarkdownForCopy([
    '::begin_ui-choose[fenced][代码题]',
    '[A]',
    '```markdown',
    '[not-an-option]',
    '::end_ui-choose',
    '```',
    '选项说明',
    '::end_ui-choose',
    '',
    '::IF[1 == 1]',
    '```markdown',
    '::IF_END',
    '```',
    '条件说明',
    '::IF_END',
  ].join('\n'), 'luogu')
  assert.match(fencedCopy, /\[not-an-option\]/)
  assert.match(fencedCopy, /::end_ui-choose/)
  assert.match(fencedCopy, /::IF_END/)
  assert.match(fencedCopy, /条件说明/)
})

test('填空框语法、数值与长度约束、默认值、行布局及静态源码降级', () => {
  const inlineSource = '吃了 ::ui-write[number][R 0 1 4] 根香蕉'
  const token = uiWriteMod.parseUiWriteToken(inlineSource, inlineSource.indexOf('::ui-write'))
  assert.ok(token)
  assert.equal(token.id, 'number')
  assert.deepEqual(token.options, ['R 0 1 4'])
  assert.equal(inlineSource.slice(token.start, token.end), '::ui-write[number][R 0 1 4]')

  const real = uiWriteMod.parseUiWriteConfig('number', ['R 2 0.5 4', 'set 1.25'])
  assert.equal(real.mode, 'real')
  assert.equal(real.decimalPlaces, 2)
  assert.equal(real.minValue, 0.5)
  assert.equal(real.maxValue, 4)
  assert.equal(real.initialValue, 1.25)
  assert.equal(uiWriteMod.validateUiWriteRealValue('2.25', real), null)
  assert.match(uiWriteMod.validateUiWriteRealValue('0.25', real), /不能小于/)
  assert.match(uiWriteMod.validateUiWriteRealValue('1.234', real), /小数/)
  assert.equal(uiWriteMod.validateUiWriteRealValue('', real), null)

  const text = uiWriteMod.parseUiWriteLine('::ui-write[Name][len 2 4][new][name 姓名]')
  assert.ok(text)
  const textConfig = uiWriteMod.parseUiWriteConfig(text.id, text.options)
  assert.equal(textConfig.mode, 'text')
  assert.equal(textConfig.minLength, 2)
  assert.equal(textConfig.maxLength, 4)
  assert.equal(textConfig.newLine, true)
  assert.equal(textConfig.name, '姓名')

  const slider = uiWriteMod.parseUiWriteConfig('Ti', ['R 0 0 3', 'set 1', 'new', 'name 已吃的香蕉', 'faster'])
  assert.equal(slider.faster, true)
  assert.equal(slider.initialValue, 1)
  assert.deepEqual(slider.errors, [])
  const merge = uiWriteMod.parseUiWriteConfig('right', ['R 0 0 10', 'new', 'name 右值', 'merge'])
  assert.equal(merge.merge, true)
  assert.match(uiWriteMod.parseUiWriteConfig('bad', ['faster']).errors.join(' '), /必须与 R 和 new 一起使用/)
  assert.match(uiWriteMod.parseUiWriteConfig('bad', ['name 标题']).errors.join(' '), /name 必须与 new/)

  const values = { number: 2, Ti: 3, empty: '' }
  assert.equal(uiChoicesMod.formatUiReference('number', values), '2')
  assert.equal(uiChoicesMod.formatUiReference('empty', values), '')
  assert.equal(uiChoicesMod.evaluateUiCondition('$<number> \\le <Ti>$', values), true)
  assert.equal(uiChoicesMod.evaluateUiCondition('<<empty>> == 0', values), false)

  const copied = mdSourceMod.convertMarkdownForCopy(
    '内联 ::ui-write[number][R 0 1 4]。\n\n::ui-write[Name][len 2 4][new][name 姓名]\n\n`::ui-write[code]`',
    'luogu',
  )
  assert.match(copied, /内联 ________。/)
  assert.match(copied, /\*\*姓名\*\*：________/)
  assert.match(copied, /`::ui-write\[code\]`/)
  assert.equal(mdSourceMod.convertMarkdownForCopy('`<<value>>` <<value>>', 'luogu'), '`<<value>>` 【value】')
  assert.doesNotMatch(postsMod.excerpt('正文 ::ui-write[number][R 0 1 4]'), /ui-write|number/)
})
