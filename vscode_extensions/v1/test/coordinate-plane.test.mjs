import test from 'node:test'
import assert from 'node:assert/strict'
import { blogMarkup, core, documentOf, preview, render, settle } from './helpers.mjs'

/* ------------------------------- 解析层 ------------------------------- */

test('parseCoordinatePlane 解析点、折线与函数图像，颜色归一化为 hex', () => {
  const body = [
    'create_point:(2,3);',
    'create_line:(0,0),(4,4),[color=red];',
    'create_line:(7*x^2+6*x+90*x^3)',
  ].join('\n')
  const spec = core.parseCoordinatePlane(body)

  assert.equal(spec.errors.length, 0)
  assert.deepEqual(
    spec.points.map((p) => [p.x, p.y, p.color]),
    [[2, 3, core.DEFAULT_PLANE_COLOR]],
  )
  assert.equal(spec.polylines.length, 1)
  assert.deepEqual(spec.polylines[0].points, [
    { x: 0, y: 0 },
    { x: 4, y: 4 },
  ])
  assert.equal(spec.polylines[0].color, '#dc2626')
  assert.equal(spec.functions.length, 1)
  assert.equal(spec.functions[0].expression, '7*x^2+6*x+90*x^3')
})

test('create_line 单括号且无逗号视为函数，单坐标点按语法错误处理', () => {
  const spec = core.parseCoordinatePlane('create_line:(x^2);\ncreate_line:(1,2);')
  assert.equal(spec.functions.length, 1)
  assert.equal(spec.polylines.length, 0)
  assert.equal(spec.errors.length, 1)
  assert.match(spec.errors[0].message, /折线至少需要两个坐标点/)
})

test('坐标支持常量表达式，最后一条语句可省略分号且允许夹空行', () => {
  const spec = core.parseCoordinatePlane(
    '\n  create_point:((1+2)/3, 2^3);\n\ncreate_line:(-1,-1),(1.5,2.5)\n',
  )
  assert.equal(spec.errors.length, 0)
  assert.equal(spec.points[0].x, 1)
  assert.equal(spec.points[0].y, 8)
  assert.equal(spec.polylines[0].points[0].x, -1)
})

test('写坏的语句逐条记录错误且不影响其它语句', () => {
  const spec = core.parseCoordinatePlane(
    ['create_foo:(1,2);', 'create_point:(a,b);', 'create_point:(1,1);', 'create_line:(x+)'].join('\n'),
  )
  assert.equal(spec.points.length, 1)
  assert.equal(spec.errors.length, 3)
  assert.equal(spec.errors[0].statement, 1)
  assert.match(spec.errors[0].message, /无法识别/)
  assert.equal(spec.errors[1].statement, 2)
  assert.match(spec.errors[1].message, /坐标无法解析/)
  assert.equal(spec.errors[2].statement, 4)
})

test('parsePlaneColor 支持英文名、中文名与 hex，非法值回退默认色', () => {
  assert.equal(core.parsePlaneColor('red'), '#dc2626')
  assert.equal(core.parsePlaneColor('蓝'), '#2563eb')
  assert.equal(core.parsePlaneColor('#ff0000'), '#ff0000')
  assert.equal(core.parsePlaneColor('#abc'), '#aabbcc')
  assert.equal(core.parsePlaneColor('not-a-color'), core.DEFAULT_PLANE_COLOR)
  assert.equal(core.parsePlaneColor(undefined), core.DEFAULT_PLANE_COLOR)
})

test('compilePlaneExpression 处理幂、一元符号与除零间断', () => {
  const square = core.compilePlaneExpression('x^2')
  assert.equal(square(3), 9)
  assert.equal(square(-2.5), 6.25)
  const cubic = core.compilePlaneExpression('7*x^2+6*x+90*x^3')
  assert.equal(cubic(1), 103)
  // 幂运算右结合：2^(3^2) = 512
  assert.equal(core.compilePlaneExpression('2^3^2')(0), 512)
  assert.equal(core.compilePlaneExpression('-x+2')(3), -1)
  const reciprocal = core.compilePlaneExpression('1/x')
  assert.equal(reciprocal(2), 0.5)
  assert.equal(reciprocal(0), null)
  assert.equal(core.compilePlaneExpression('x+y'), null)
  assert.equal(core.compilePlaneExpression('x+'), null)
  assert.equal(core.compilePlaneExpression(''), null)
})

test('nicePlaneStep 走 1-2-5 序列，formatPlaneNumber 去掉浮点噪声', () => {
  assert.equal(core.nicePlaneStep(0.72), 1)
  assert.equal(core.nicePlaneStep(1.5), 2)
  assert.equal(core.nicePlaneStep(30), 50)
  assert.equal(core.nicePlaneStep(72), 100)
  assert.equal(core.formatPlaneNumber(0), '0')
  assert.equal(core.formatPlaneNumber(0.1 + 0.2), '0.3')
  assert.match(core.formatPlaneNumber(1e8), /e\+/)
})

test('planeContentBounds 只统计点与折线，忽略函数图像', () => {
  const spec = core.parseCoordinatePlane('create_point:(-2,1);\ncreate_line:(0,0),(3,-4);\ncreate_line:(x^2);')
  const bounds = core.planeContentBounds(spec)
  assert.deepEqual(bounds, { minX: -2, maxX: 3, minY: -4, maxY: 1 })
  assert.equal(core.planeContentBounds(core.parseCoordinatePlane('create_line:(x^2);')), null)
})

test('findPlaneIntersections：函数之间的交点（含两个根）', () => {
  const fns = [(x) => x, (x) => -x].map((fn) => ({ fn }))
  const one = core.findPlaneIntersections({ functions: fns, polylines: [], xMin: -5, xMax: 5 }, 0.01)
  assert.equal(one.length, 1)
  assert.ok(Math.abs(one[0].x) < 1e-8 && Math.abs(one[0].y) < 1e-8)

  const square = [{ fn: core.compilePlaneExpression('x^2') }, { fn: () => 1 }]
  const roots = core.findPlaneIntersections({ functions: square, polylines: [], xMin: -5, xMax: 5 }, 0.01)
  const xs = roots.map((p) => p.x).sort((a, b) => a - b)
  assert.equal(xs.length, 2)
  assert.ok(Math.abs(xs[0] + 1) < 1e-6 && Math.abs(xs[1] - 1) < 1e-6)
  assert.ok(roots.every((p) => Math.abs(p.y - 1) < 1e-6))
})

test('findPlaneIntersections：折线之间、函数与折线（含竖直线段）相交', () => {
  // 两条折线 (0,0)-(2,2) 与 (0,2)-(2,0) 交于 (1,1)
  const crossing = core.findPlaneIntersections(
    {
      functions: [],
      polylines: [[{ x: 0, y: 0 }, { x: 2, y: 2 }], [{ x: 0, y: 2 }, { x: 2, y: 0 }]],
      xMin: -5,
      xMax: 5,
    },
    0.01,
  )
  assert.equal(crossing.length, 1)
  assert.ok(Math.abs(crossing[0].x - 1) < 1e-9 && Math.abs(crossing[0].y - 1) < 1e-9)

  // 函数 y=0 与斜线段 (-2,2)-(2,-2)（即 y=-x）交于 (0,0)
  const fnLine = core.findPlaneIntersections(
    {
      functions: [{ fn: () => 0 }],
      polylines: [[{ x: -2, y: 2 }, { x: 2, y: -2 }]],
      xMin: -5,
      xMax: 5,
    },
    0.01,
  )
  assert.equal(fnLine.length, 1)
  assert.ok(Math.abs(fnLine[0].x) < 1e-8 && Math.abs(fnLine[0].y) < 1e-8)

  // 竖直线段 x=1（y 从 0 到 3）与函数 y=2x 交于 (1,2)
  const vertical = core.findPlaneIntersections(
    {
      functions: [{ fn: core.compilePlaneExpression('2*x') }],
      polylines: [[{ x: 1, y: 0 }, { x: 1, y: 3 }]],
      xMin: -5,
      xMax: 5,
    },
    0.01,
  )
  assert.equal(vertical.length, 1)
  assert.ok(Math.abs(vertical[0].x - 1) < 1e-8 && Math.abs(vertical[0].y - 2) < 1e-8)
})

test('findPlaneIntersections：容差内去重，间断函数不在无定义处造交点', () => {
  // 同一交点 (0,0) 被函数对与两组函数-折线对同时命中时，按容差合并为一个
  const merged = core.findPlaneIntersections(
    {
      functions: [{ fn: (x) => 2 * x }, { fn: (x) => -2 * x }],
      polylines: [[{ x: -1, y: -1 }, { x: 1, y: 1 }]],
      xMin: -5,
      xMax: 5,
    },
    0.05,
  )
  assert.equal(merged.length, 1)
  assert.ok(Math.abs(merged[0].x) < 1e-8 && Math.abs(merged[0].y) < 1e-8)

  // 函数与折线完全重合时，浮点噪声不得制造大量伪交点
  const coincident = core.findPlaneIntersections(
    {
      functions: [{ fn: (x) => x }],
      polylines: [[{ x: -1, y: -1 }, { x: 1, y: 1 }]],
      xMin: -5,
      xMax: 5,
    },
    0.05,
  )
  assert.ok(coincident.length <= 2, `重合曲线产生了 ${coincident.length} 个伪交点`)

  // 1/x 在 x=0 无定义：与 y=0 不应产生交点
  const reciprocal = core.findPlaneIntersections(
    { functions: [{ fn: core.compilePlaneExpression('1/x') }, { fn: () => 0 }], polylines: [], xMin: -5, xMax: 5 },
    0.01,
  )
  assert.equal(reciprocal.length, 0)
})

/* --------------------------- 博客 / 插件同款渲染 --------------------------- */

const ccsSource = [
  '## 坐标系',
  '',
  '::begin_ui-ccs',
  'create_point:(2,3);',
  'create_line:(0,0),(4,4),[color=red];',
  'create_line:(x^2);',
  '::end_ui-ccs',
].join('\n')

test('Markdown 渲染出简洁的 SVG 坐标系：未悬浮时不显示任何点坐标', () => {
  const doc = documentOf(core.renderReference(ccsSource))
  const section = doc.querySelector('section.not-prose')
  assert.ok(section)
  // 标题栏里的 lucide 图标也是 svg，用 role=img 定位坐标系本体
  const svg = section.querySelector('svg[role="img"]')
  assert.ok(svg)
  // 可见色点：1 个 create_point + 折线 2 个端点 + 1 个函数与折线交点 (1,1)
  const visibleDots = [...svg.querySelectorAll('circle')].filter((c) => c.getAttribute('fill') !== 'transparent')
  assert.equal(visibleDots.length, 4)
  // 每个交互点都有一个透明的大命中圆
  assert.ok(svg.querySelectorAll('circle[fill="transparent"]').length >= 4)
  assert.equal(svg.querySelectorAll('polyline').length, 1)
  // 箭头 marker 内含一条 path，外加一条函数图像 path
  assert.equal(svg.querySelectorAll('path').length, 2)
  // 函数表达式浮动标签仍在，独立标题栏 / 图例栏已移除
  assert.match(section.textContent, /y = x\^2/)
  assert.doesNotMatch(section.textContent, /平面直角坐标系/)
  assert.match(svg.getAttribute('aria-label'), /悬浮/)
  // 未悬浮：SVG 内不出现任何坐标文字
  assert.doesNotMatch(svg.textContent, /\(/)
  // 默认也没有坐标气泡
  assert.equal(section.querySelector('.plane-tooltip'), null)
  assert.ok(svg.querySelector('marker'))
  assert.match(svg.textContent, /x/)
  assert.match(svg.textContent, /0/)
  // 控件是一枚浮动工具条，不再占整行标题栏
  assert.equal(section.querySelectorAll('button[aria-label]').length, 3)
})

test('悬浮到声明点 / 交点时显示坐标气泡，移开后消失', async () => {
  const { dom, document } = await preview(ccsSource)
  const section = document.querySelector('section.not-prose')
  const svg = section.querySelector('svg[role="img"]')
  // 示例中的声明点 (2,3)：取最右侧的透明命中圆不便于定位，直接按可见点邻近查找
  const hitCircles = [...svg.querySelectorAll('circle[fill="transparent"]')]
  assert.ok(hitCircles.length >= 4)

  // React 的 onPointerEnter / onPointerLeave 由原生 pointerover / pointerout 合成
  const hover = (circle) => {
    circle.dispatchEvent(new dom.window.PointerEvent('pointerover', { bubbles: true, pointerId: 1 }))
  }
  const leave = (circle) => {
    circle.dispatchEvent(new dom.window.PointerEvent('pointerout', { bubbles: true, pointerId: 1 }))
  }

  // 悬浮声明点：它的可见色点 r=5，命中圆是其兄弟节点中的透明圆
  const declared = [...svg.querySelectorAll('circle')].find(
    (c) => c.getAttribute('fill') !== 'transparent' && c.getAttribute('r') === '5',
  )
  const declaredHit = declared.parentElement.querySelector('circle[fill="transparent"]')
  hover(declaredHit)
  await settle()
  let tip = section.querySelector('.plane-tooltip')
  assert.ok(tip)
  assert.match(tip.textContent, /\(2, 3\)/)
  leave(declaredHit)
  await settle()
  assert.equal(section.querySelector('.plane-tooltip'), null)

  // 悬浮交点：y=x² 与折线 y=x 在 (1,1) 相交，渲染为描边圆环
  const rings = [...svg.querySelectorAll('circle')].filter((c) => c.getAttribute('fill') !== 'transparent' && c.getAttribute('stroke') && c.getAttribute('r') === '3.5')
  assert.equal(rings.length, 1)
  const intersectionHit = rings[0].parentElement.querySelector('circle[fill="transparent"]')
  hover(intersectionHit)
  await settle()
  tip = section.querySelector('.plane-tooltip')
  assert.ok(tip)
  assert.match(tip.textContent, /\(1, 1\)/)
})

test('缩放按钮改变函数路径，复位按钮恢复', async () => {
  const { dom, document } = await preview(ccsSource)
  const section = document.querySelector('section.not-prose')
  assert.ok(section)
  const functionPath = () => section.querySelector('svg[role="img"] g[clip-path] path').getAttribute('d')
  const before = functionPath()
  const zoomIn = section.querySelector('button[aria-label="放大"]')
  zoomIn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
  await settle()
  assert.notEqual(functionPath(), before)
  section.querySelector('button[aria-label="复位视角"]').dispatchEvent(
    new dom.window.MouseEvent('click', { bubbles: true }),
  )
  await settle()
  assert.equal(functionPath(), before)
})

test('滚轮缩放与单指拖动平移都会改变视图', async () => {
  const { dom, document } = await preview(ccsSource)
  const plane = document.querySelector('section.not-prose svg[role="img"]')
  const wrap = document.querySelector('section.not-prose .cursor-grab')
  wrap.getBoundingClientRect = () => ({
    left: 0, top: 0, width: 820, height: 400, right: 820, bottom: 400, x: 0, y: 0, toJSON() {},
  })
  const pointX = () => plane.querySelector('g[clip-path] circle').getAttribute('cx')
  const before = pointX()

  wrap.dispatchEvent(new dom.window.WheelEvent('wheel', { deltaY: -120, bubbles: true, cancelable: true }))
  await settle()
  const afterWheel = pointX()
  assert.notEqual(afterWheel, before)

  const pointerId = 7
  wrap.dispatchEvent(new dom.window.PointerEvent('pointerdown', {
    pointerId, clientX: 400, clientY: 200, bubbles: true, cancelable: true,
  }))
  wrap.dispatchEvent(new dom.window.PointerEvent('pointermove', {
    pointerId, clientX: 300, clientY: 250, bubbles: true,
  }))
  await settle()
  assert.notEqual(pointX(), afterWheel)
  wrap.dispatchEvent(new dom.window.PointerEvent('pointerup', {
    pointerId, clientX: 300, clientY: 250, bubbles: true,
  }))
})

test('语法错误在渲染结果里给出逐条提示，且坐标系仍然画出', () => {
  const source = ['::begin_ui-ccs', 'create_foo:(1,2);', 'create_point:(1,1);', '::end_ui-ccs'].join('\n')
  const doc = documentOf(core.renderReference(source))
  const section = doc.querySelector('section.not-prose')
  assert.ok(section.querySelector('svg[role="img"]'))
  assert.match(section.textContent, /第 1 条语句/)
  assert.match(section.textContent, /无法识别/)
  const visible = [...section.querySelectorAll('svg[role="img"] circle')].filter(
    (c) => c.getAttribute('fill') !== 'transparent',
  )
  assert.equal(visible.length, 1)
})

test('代码围栏里的指令只展示源码，不会被执行成坐标系', () => {
  const source = ['```markdown', '::begin_ui-ccs', 'create_point:(1,1);', '::end_ui-ccs', '```'].join('\n')
  const doc = documentOf(core.renderReference(source))
  assert.equal(doc.querySelector('section.not-prose'), null)
  const code = doc.querySelector('pre code')
  assert.ok(code)
  assert.match(code.textContent, /::begin_ui-ccs/)
})

test('一篇文章里多个坐标系各自渲染且 clip id 不冲突，展示框内可嵌套', () => {
  const multi = [
    '::begin_ui-ccs', 'create_line:(x);', '::end_ui-ccs', '',
    '::begin_ui-ccs', 'create_line:(x^2);', '::end_ui-ccs',
  ].join('\n')
  const doc = documentOf(core.renderReference(multi))
  assert.equal(doc.querySelectorAll('section.not-prose').length, 2)
  const ids = [...doc.querySelectorAll('clipPath')].map((node) => node.id)
  assert.equal(new Set(ids).size, ids.length)

  const nested = [
    '::show_begin{嵌套}{}',
    '::begin_ui-ccs', 'create_point:(1,1);', '::end_ui-ccs',
    '::show_end',
  ].join('\n')
  const doc2 = documentOf(core.renderReference(nested))
  assert.ok(doc2.querySelector('.show-box svg[role="img"]'))
  const nestedDots = [...doc2.querySelectorAll('.show-box svg[role="img"] circle')].filter(
    (c) => c.getAttribute('fill') !== 'transparent',
  )
  assert.equal(nestedDots.length, 1)
})

test('空指令块仍画出坐标轴与提示；净化规则放行 data 属性但剥离事件属性', () => {
  const doc = documentOf(core.renderReference('::begin_ui-ccs\n::end_ui-ccs'))
  assert.ok(doc.querySelector('svg[role="img"]'))
  assert.match(doc.body.textContent, /create_point/)

  const evil = '<div data-ui-ccs="true" data-ui-ccs-spec="create_point:(1,1);" onclick="alert(1)"></div>'
  const doc2 = documentOf(core.renderReference(evil))
  assert.ok(doc2.querySelector('section.not-prose'))
  assert.equal(doc2.body.innerHTML.includes('onclick'), false)
})

test('未闭合的指令按普通文本保留，不吞掉后续正文', () => {
  const source = ['::begin_ui-ccs', 'create_point:(1,1);', '', '## 后面的正文'].join('\n')
  const doc = documentOf(core.renderReference(source))
  assert.equal(doc.querySelector('section.not-prose'), null)
  assert.ok(doc.querySelector('h2'))
  assert.match(doc.querySelector('h2').textContent, /后面的正文/)
})

test('markdown-it 内置预览与博客 React 组件输出同款 DOM', () => {
  const expected = documentOf(core.renderReference(ccsSource)).body.innerHTML
  const actual = blogMarkup(render(ccsSource))
  assert.equal(actual, expected)
})

test('摘要 / 字数 / 目录不收录坐标系指令原文，未闭合块不吞正文', () => {
  const source = [
    '## 标题',
    '',
    '::begin_ui-ccs',
    'create_point:(2,3);',
    'create_line:(x^2);',
    '::end_ui-ccs',
    '',
    '这是正文摘要内容。',
  ].join('\n')
  const plain = core.stripMarkdown(source)
  assert.doesNotMatch(plain, /create_point|create_line|begin_ui-ccs/)
  assert.match(plain, /这是正文摘要内容/)
  assert.equal(core.countWords('::begin_ui-ccs\ncreate_point:(1,1);\n::end_ui-ccs'), 0)
  assert.match(core.excerpt(source, 40), /这是正文摘要内容/)
  const toc = core.extractToc(source)
  assert.deepEqual(toc.map((item) => item.text), ['标题'])
})

/* --------------------- MPE 静态降级与洛谷 / 基本源码复制 --------------------- */

test('MPE 静态转换保留坐标系源码并给出交互提示', () => {
  const html = core.transformMarkdown(ccsSource)
  assert.match(html, /starlog-ccs/)
  assert.match(html, /平面直角坐标系/)
  assert.match(html, /create_point:\(2,3\)/)
  assert.doesNotMatch(html, /<svg/)
})

test('洛谷 / 基本源码把坐标系转成标题加代码围栏，直接复制原样保留', () => {
  const luogu = core.convertMarkdownForCopy(ccsSource, 'luogu')
  assert.doesNotMatch(luogu, /::begin_ui-ccs|::end_ui-ccs/)
  assert.match(luogu, /\*\*平面直角坐标系\*\*/)
  assert.match(luogu, /```text/)
  assert.match(luogu, /create_line:\(x\^2\)/)
  const basic = core.convertMarkdownForCopy(ccsSource, 'basic')
  assert.doesNotMatch(basic, /::begin_ui-ccs/)
  const direct = core.convertMarkdownForCopy(ccsSource, 'direct')
  assert.match(direct, /::begin_ui-ccs/)
})

test('坐标系正文含反引号围栏时，降级围栏自动加长不被截断', () => {
  const source = ['::begin_ui-ccs', '```', 'create_point:(1,1);', '```', '::end_ui-ccs'].join('\n')
  const luogu = core.convertMarkdownForCopy(source, 'luogu')
  assert.match(luogu, /````text/)
  assert.match(luogu, /````\n/)
  // 围栏外的普通文章不受影响
  const plain = core.convertMarkdownForCopy(
    ['::begin_ui-ccs', 'create_point:(1,1);', '::end_ui-ccs', '', '```js', 'x = 1', '```'].join('\n'),
    'luogu',
  )
  assert.match(plain, /```text/)
})
