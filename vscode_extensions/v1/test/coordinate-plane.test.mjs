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

test('Markdown 渲染出可交互的 SVG 坐标系：点、折线、函数与图例齐全', () => {
  const doc = documentOf(core.renderReference(ccsSource))
  const section = doc.querySelector('section.not-prose')
  assert.ok(section)
  // 标题栏里的 lucide 图标也是 svg，用 role=img 定位坐标系本体
  const svg = section.querySelector('svg[role="img"]')
  assert.ok(svg)
  assert.equal(svg.querySelectorAll('circle').length, 1)
  assert.equal(svg.querySelectorAll('polyline').length, 1)
  // 箭头 marker 内含一条 path，外加一条函数图像 path
  assert.equal(svg.querySelectorAll('path').length, 2)
  assert.match(section.textContent, /平面直角坐标系/)
  assert.match(section.textContent, /y = x\^2/)
  assert.match(section.textContent, /拖动平移/)
  assert.ok(svg.querySelector('marker'))
  assert.match(svg.textContent, /x/)
  assert.match(svg.textContent, /0/)
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
  assert.equal(section.querySelectorAll('svg[role="img"] circle').length, 1)
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
  assert.equal(doc2.querySelectorAll('.show-box svg[role="img"] circle').length, 1)
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
