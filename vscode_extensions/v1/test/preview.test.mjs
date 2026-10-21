import test from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { close, core, preview, render, setInput, settle, update } from './helpers.mjs'

const interactive = [
  '## 正文',
  '',
  '::show_begin{同步渲染}{n:Z=3[1,9,1]; name:S=初始[0,40]}',
  '值 *&show(n)*&，平方 *&hs(n^2)*&。',
  '',
  '| n | n² |',
  '| - | - |',
  '| *&show(n)*& | *&hs(n^2)*& |',
  '',
  '$$',
  'x_{*&show(n)*&}=*&hs(n^2)*&',
  '$$',
  '',
  '`code *&show(n)*&`',
  '',
  '```cpp',
  'int n = *&show(n)*&;',
  '```',
  '',
  '*&n:{3,**三个**;4,$x^4$;5,**五个**}*&',
  '',
  '*&show(name)*&',
  '::show_end',
].join('\n')

test('滑动条同步更新正文、表格、KaTeX、行内代码、代码块与映射 Markdown', async (t) => {
  const { dom, document, errors } = await preview(interactive)
  t.after(() => close(dom))
  const range = document.querySelector('input[type="range"]')
  const number = document.querySelector('input[type="number"]')
  assert.ok(range && number)
  await setInput(dom, range, '4')
  const body = document.querySelector('.show-box-content')
  assert.match(body.textContent, /值 4，平方 16/)
  assert.equal(number.value, '4')
  assert.deepEqual([...body.querySelectorAll('tbody td')].map((cell) => cell.textContent), ['4', '16'])
  assert.equal(body.querySelector('code:not(.hljs)').textContent, 'code 4')
  assert.equal(body.querySelector('pre code').textContent, 'int n = 4;\n')
  assert.ok(body.querySelector('pre .hljs-number'))
  assert.equal(body.querySelector('.katex-display annotation').textContent, 'x_{4}=16')
  assert.equal(body.querySelectorAll('.katex').length, 2) // 映射的公式也重新按 Markdown 渲染。
  assert.equal(body.querySelector('.katex-error'), null)
  await setInput(dom, number, '5')
  assert.equal(range.value, '5')
  assert.match(body.querySelector('strong').textContent, /五个/)
  assert.deepEqual(errors, [])
})

test('字符串替换等价于替换 Markdown 源码，长度与数字边界沿用博客规则', async (t) => {
  const { dom, document, errors } = await preview(interactive)
  t.after(() => close(dom))
  const text = document.querySelector('input:not([type])')
  await setInput(dom, text, '**加粗**')
  assert.ok([...document.querySelectorAll('.show-box-content strong')].some((node) => node.textContent === '加粗'))
  await setInput(dom, text, '$e^{i\\pi}$')
  assert.ok([...document.querySelectorAll('.show-box-content annotation')].some((node) => node.textContent === 'e^{i\\pi}'))
  const number = document.querySelector('input[type="number"]')
  await setInput(dom, number, '99')
  assert.equal(number.value, '9')
  assert.match(document.querySelector('.show-box-content').textContent, /值 9/)
  assert.deepEqual(errors, [])
})

test('相同预览刷新隔离 morphdom，保持 React root 与当前变量值且仍可交互', async (t) => {
  const { dom, document, errors } = await preview(interactive)
  t.after(() => close(dom))
  const mount = document.querySelector('.markdown-extension-mount')
  await setInput(dom, document.querySelector('input[type="range"]'), '5')
  await update(dom, interactive)
  assert.equal(document.querySelector('.markdown-extension-mount'), mount)
  assert.equal(document.querySelector('input[type="number"]').value, '5')
  await setInput(dom, document.querySelector('input[type="range"]'), '4')
  assert.equal(document.querySelector('pre code').textContent, 'int n = 4;\n')
  assert.deepEqual(errors, [])
})

test('修改变量定义后恢复新默认值；切换文档不串用状态', async (t) => {
  const { dom, document, errors } = await preview(interactive)
  t.after(() => close(dom))
  await setInput(dom, document.querySelector('input[type="range"]'), '5')
  await update(dom, interactive.replace('n:Z=3', 'n:Z=2'))
  assert.equal(document.querySelector('input[type="number"]').value, '2')
  await setInput(dom, document.querySelector('input[type="range"]'), '8')
  await update(dom, interactive.replace('n:Z=3', 'n:Z=2'), 'file:///workspace/other.md')
  assert.equal(document.querySelector('input[type="number"]').value, '2')
  assert.deepEqual(errors, [])
})

test('重复展示框相互独立；Q 仅在 faster_set 时有滑动条', async (t) => {
  const box = '::show_begin{变量}{n:Z=1[0,9,1]; q:Q=0[0,1,0.1]; r:Q=0[0,1,0.1]{faster_set}}\n*&show(n)*&\n::show_end'
  const { dom, document, errors } = await preview(box + '\n\n' + box)
  t.after(() => close(dom))
  const boxes = document.querySelectorAll('.show-box')
  assert.equal(boxes.length, 2)
  assert.equal(boxes[0].querySelectorAll('input[type="range"]').length, 2)
  await setInput(dom, boxes[0].querySelector('input[type="number"]'), '6')
  assert.equal(boxes[0].querySelector('.show-box-content').textContent, '6')
  assert.equal(boxes[1].querySelector('.show-box-content').textContent, '1')
  assert.deepEqual(errors, [])
})

test('预览刷新后的折叠框、行号、博客复制代码按钮可用', async (t) => {
  const source = '---\ntitle: 测试\n---\n\n:::info[数学 $x^2$]{open}\n内容\n:::\n\n```js\nconst x = 1;\n```'
  const { dom, document, errors } = await preview(source)
  t.after(() => close(dom))
  const copied = []
  Object.defineProperty(dom.window.navigator, 'clipboard', { value: { writeText: async (text) => copied.push(text) } })
  const callout = document.querySelector('details')
  assert.ok(callout.open)
  assert.ok(callout.querySelector('summary .katex'))
  callout.open = false
  await update(dom, source)
  assert.equal(document.querySelector('details').open, false)
  assert.equal(document.querySelector('details').getAttribute('data-line'), '4')
  document.querySelector('button[aria-label="复制代码"]').click()
  await settle()
  assert.deepEqual(copied, ['const x = 1;\n'])
  assert.ok(document.querySelector('button .lucide-check'))
  assert.deepEqual(errors, [])
})

test('监听 VS Code 深浅主题而不是复制编辑器配色', async (t) => {
  const { dom, document, errors } = await preview('正文', 'vscode-dark')
  t.after(() => close(dom))
  assert.ok(document.documentElement.classList.contains('dark'))
  document.body.classList.replace('vscode-dark', 'vscode-light')
  await settle()
  assert.equal(document.documentElement.classList.contains('dark'), false)
  document.body.classList.replace('vscode-light', 'vscode-high-contrast')
  await settle()
  assert.equal(document.documentElement.classList.contains('dark'), true)
  assert.deepEqual(errors, [])
})

test('真实 morphdom 更新只管理模型入口，创建/编辑/删除展示框不会触碰 React 正文', async (t) => {
  const base = '## 开始\n\n正文 $x^2$。\n\n```cpp\nint a = 1;\n```\n\n## 结尾'
  const box = '::show_begin{新建变量}{n:Z=3[1,9,1]}\n值 *&show(n)*&\n::show_end'
  const { dom, document, errors } = await preview(base)
  t.after(() => close(dom))
  const mount = document.querySelector('.markdown-extension-mount')
  const nativeBody = document.querySelector('.markdown-body')
  assert.equal(nativeBody.contains(mount), false)
  assert.ok(nativeBody.classList.contains('markdown-extension-source'))
  assert.equal(document.querySelectorAll('#开始').length, 1)

  for (let i = 0; i < 3; ++i) {
    await update(dom, base + '\n\n' + box)
    assert.equal(document.querySelectorAll('.show-box').length, 1)
    assert.equal(document.querySelector('.markdown-extension-mount'), mount)
    await setInput(dom, document.querySelector('input[type="range"]'), '5')
    await update(dom, base + '\n\n' + box)
    assert.equal(document.querySelector('input[type="number"]').value, '5')
    await update(dom, base)
    assert.equal(document.querySelector('.show-box'), null)
    assert.match(mount.textContent, /开始[\s\S]*结尾/)
    assert.ok(mount.querySelector('.katex'))
    assert.ok(mount.querySelector('.hljs-type'))
    assert.equal(nativeBody.querySelector('.markdown-extension-mount'), null)
    assert.equal(nativeBody.querySelector('.code-line'), null)
    const nativeLines = dom.window.nativeCodeLineElements
    assert.ok(nativeLines.every((element) => element.isConnected && document.querySelector('.markdown-extension-host').contains(element)))
    assert.equal(nativeLines[0].getAttribute('data-line'), '0')
    assert.equal(nativeLines.at(-1).getAttribute('data-line'), String(base.split('\n').length))
    assert.deepEqual(errors, [])
  }
  await update(dom, '')
  assert.equal(mount.textContent, '')
  await update(dom, base)
  assert.match(mount.textContent, /结尾/)
  assert.deepEqual(errors, [])
})

test('预览模型的渐变默认关闭，参数开关实时应用且不重置展示框变量', async (t) => {
  const { dom, document, errors } = await preview(interactive)
  t.after(() => close(dom))
  const enabled = () => document.body.classList.contains('markdown-extension-gradient-background')
  assert.equal(enabled(), false)
  await setInput(dom, document.querySelector('input[type="range"]'), '5')
  await update(dom, interactive, 'file:///workspace/demo.md', { enableGradientBackground: true })
  assert.equal(enabled(), true)
  document.body.className = 'vscode-dark' // 原生主题更新可能重写 body 的全部类。
  await settle()
  assert.equal(enabled(), true)
  assert.ok(document.documentElement.classList.contains('dark'))
  assert.equal(document.querySelector('input[type="number"]').value, '5')
  await update(dom, interactive, 'file:///workspace/demo.md', { enableGradientBackground: false })
  assert.equal(enabled(), false)
  assert.equal(document.querySelector('input[type="number"]').value, '5')
  assert.deepEqual(errors, [])
})

test('延迟插入原生预览正文也能挂载；原生模型消失时清理 React 容器并恢复回退内容', async (t) => {
  const { dom, document, errors } = await preview('开始')
  t.after(() => close(dom))
  document.querySelector('.markdown-body').innerHTML = '<p>原生回退</p>'
  await settle()
  assert.equal(document.querySelector('.markdown-extension-host'), null)
  assert.equal(document.querySelector('.markdown-body').classList.contains('markdown-extension-source'), false)
  assert.equal(document.querySelector('.markdown-body').textContent, '原生回退')
  document.querySelector('.markdown-body').innerHTML = render(interactive) // 不发更新事件，模拟延迟插入。
  await settle()
  assert.equal(document.querySelectorAll('.markdown-extension-host').length, 1)
  assert.ok(document.querySelector('input[type="range"]'))
  assert.deepEqual(errors, [])
})

test('choose/select/yes-no 联动显示 1-based 值、inline/block 条件与动态 KaTeX', async (t) => {
  const source = [
    '::begin_ui-choose[meals][可多选][more 1 2]',
    '[A]',
    '苹果',
    '[B]',
    '香蕉',
    '::end_ui-choose',
    '',
    '选择编号：<<fruit>>',
    '<IF:<<fruit>> >= 2,**已选第二项！** $x^2$>',
    '',
    '::begin_ui-select[fruit][search]',
    '苹果',
    '香蕉',
    '::end_ui-select',
    '',
    '::begin_ui-if[tasks][lined]',
    '阅读题目',
    '::nex',
    '检查答案',
    '::end_ui-if',
    '',
    '::IF[<<tasks-1>> == 1]',
    '**已完成阅读。**',
    '::IF_END',
    '',
    '$x_{<<fruit>>}$',
  ].join('\n')
  const { dom, document, errors } = await preview(source)
  t.after(() => close(dom))

  const choose = document.querySelector('.ui-choose-box')
  const dropdown = document.querySelector('.ui-select-widget select')
  const checklist = document.querySelector('.ui-if-box')
  assert.ok(choose && dropdown && checklist)
  assert.equal(choose.querySelectorAll('input[type="checkbox"]').length, 2)
  assert.equal(choose.querySelectorAll('input[type="checkbox"]:checked').length, 1)
  assert.ok(document.querySelector('.ui-select-widget input[type="search"]'))
  assert.equal(document.querySelector('.ui-if-content'), null)
  assert.equal(document.querySelector('.ui-choose-box input[type="checkbox"]:checked').getAttribute('aria-label'), 'meals-1')

  dropdown.value = '2'
  dropdown.dispatchEvent(new dom.window.Event('change', { bubbles: true }))
  await settle()
  assert.match(document.querySelector('.markdown-extension-mount').textContent, /选择编号：2/)
  assert.match(document.querySelector('.markdown-extension-mount').textContent, /已选第二项/)
  assert.equal([...document.querySelectorAll('strong')].find((node) => node.textContent === '已选第二项！')?.textContent, '已选第二项！')
  assert.ok([...document.querySelectorAll('.katex annotation')].some((node) => node.textContent === 'x^2'))
  assert.equal([...document.querySelectorAll('.katex annotation')].find((node) => node.textContent.startsWith('x_{'))?.textContent, 'x_{2}')

  await setInput(dom, document.querySelector('.ui-select-widget input[type="search"]'), 'Ban')
  assert.equal([...dropdown.options].filter((option) => option.value !== '').map((option) => option.textContent).join(','), '香蕉')

  const mealOptions = choose.querySelectorAll('input[type="checkbox"]')
  mealOptions[1].click()
  await settle()
  assert.equal(choose.querySelectorAll('input[type="checkbox"]:checked').length, 2)
  checklist.querySelector('input[type="checkbox"]').click()
  await settle()
  assert.equal(document.querySelector('.ui-if-content strong')?.textContent, '已完成阅读。')
  assert.match(checklist.querySelector('label span.relative').className, /line-through/)
  assert.deepEqual(errors, [])
})

test('ui-write 数字 / 文本 / 滑块输入更新引用与条件 Markdown，merge 控件同排渲染', async (t) => {
  const source = [
    '吃了 ::ui-write[number][R 0 1 4] 根香蕉。',
    '',
    '::ui-write[Name][len 2 8][new][name 姓名]',
    '',
    '::ui-write[Left][R 0 0 10][new][name 左值]',
    '',
    '::ui-write[Right][R 0 0 10][new][name 右值][merge]',
    '',
    '::ui-write[Ti][R 0 0 3][set 1][new][name Ti][faster]',
    '',
    '当前值：<<number>>，姓名：<<Name>>。',
    '<IF:$<number> \\le <Ti>$,**条件成立** $x^2$>',
  ].join('\n')
  const { dom, document, errors } = await preview(source)
  t.after(() => close(dom))

  const number = document.querySelector('input[data-ui-write-input="number"]')
  const name = document.querySelector('input[data-ui-write-input="Name"]')
  const slider = document.querySelector('input[data-ui-write-input="Ti"]')
  assert.ok(number && name && slider)
  assert.equal(number.type, 'number')
  assert.equal(name.type, 'text')
  assert.equal(slider.type, 'range')
  assert.equal(document.querySelector('.ui-write-row')?.querySelectorAll('[data-ui-write-input]').length, 2)
  assert.equal([...document.querySelectorAll('strong')].some((node) => node.textContent === '条件成立'), false)

  await setInput(dom, number, '2')
  await setInput(dom, name, '小明')
  await setInput(dom, slider, '3')
  const text = document.querySelector('.markdown-extension-mount').textContent
  assert.match(text, /当前值：2，姓名：小明/)
  assert.equal([...document.querySelectorAll('strong')].find((node) => node.textContent === '条件成立')?.textContent, '条件成立')
  assert.ok([...document.querySelectorAll('.katex annotation')].some((node) => node.textContent === 'x^2'))
  assert.deepEqual(errors, [])
})

test('文章编辑器图调整模式拖动节点并把序列化坐标回写到原图源码', async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="mount"></div></body></html>', {
    pretendToBeVisual: true,
    url: 'https://editor.test/',
  })
  const globals = ['window', 'document', 'Element', 'HTMLElement', 'Node', 'IS_REACT_ACT_ENVIRONMENT']
  const previous = new Map(globals.map((key) => [key, { exists: key in globalThis, value: globalThis[key] }]))
  globalThis.window = dom.window
  globalThis.document = dom.window.document
  globalThis.Element = dom.window.Element
  globalThis.HTMLElement = dom.window.HTMLElement
  globalThis.Node = dom.window.Node
  globalThis.IS_REACT_ACT_ENVIRONMENT = true

  let root
  const changes = []
  try {
    root = core.mountCoordinateGraphForTest(
      document.querySelector('#mount'),
      'point A 0 0\npoint B 100 0\nA B 5',
      7,
      (line, body) => changes.push({ line, body }),
    )
    await settle()
    const box = document.querySelector('.ui-graph-box')
    const svg = box.querySelector('svg')
    const button = box.querySelector('button[aria-pressed]')
    assert.ok(button && svg)
    button.click()
    await settle()
    const node = box.querySelector('[data-graph-node="A"]')
    const [startX, startY] = node.getAttribute('transform').match(/translate\(([-\d.]+) ([-\d.]+)\)/).slice(1).map(Number)
    const pointer = (type, target, x, y) => {
      const event = new dom.window.MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y })
      Object.defineProperty(event, 'pointerId', { value: 1 })
      target.dispatchEvent(event)
    }
    pointer('pointerdown', node, startX, startY)
    await settle()
    pointer('pointermove', svg, startX + 50, startY - 30)
    await settle()
    pointer('pointerup', svg, startX + 50, startY - 30)
    await settle()

    assert.equal(changes.length, 1)
    assert.equal(changes[0].line, 7)
    assert.match(changes[0].body, /^point A [\d.-]+ [\d.-]+/)
    assert.match(changes[0].body, /^point B 100 0/m)
    assert.match(changes[0].body, /A B 5/)
    assert.ok(Number(node.getAttribute('data-graph-x')) > 0)
    assert.ok(Number(node.getAttribute('data-graph-y')) > 0)
  } finally {
    if (root) root.unmount()
    dom.window.close()
    for (const [key, state] of previous) {
      if (state.exists) globalThis[key] = state.value
      else delete globalThis[key]
    }
  }
})

test('直角坐标系 ui-ccs 极简无上下栏、未悬浮不显示点坐标、悬浮端点/交点显示坐标并支持拖拽缩放与展示框联动', async (t) => {
  const ccsDoc = [
    '::begin_ui-ccs',
    'create_point:(1,4);',
    'create_line:(-3,0),(3,0);',
    'create_line:(0,-3),(2,3),[color=red];',
    'create_line:(x^2-1);',
    '::end_ui-ccs',
    '',
    '::show_begin{动态抛物线}{k:Z=1[-3,3,1]}',
    '::begin_ui-ccs',
    'create_line:(*&show(k)*&*x^2);',
    '::end_ui-ccs',
    '::show_end',
  ].join('\n')
  const { dom, document, errors } = await preview(ccsDoc)
  t.after(() => close(dom))

  const boxes = document.querySelectorAll('.ui-ccs-box')
  assert.equal(boxes.length, 2)

  // 1. 删除上下显示框：容器内仅保留中间的纯坐标系 SVG
  assert.equal(boxes[0].children.length, 1)
  assert.equal(boxes[0].firstElementChild.tagName.toLowerCase(), 'svg')

  const firstSvg = boxes[0].querySelector('svg[role="application"]')
  assert.ok(firstSvg)

  // 2. 单点未悬浮时不显示坐标文字，也不显示悬浮气泡
  assert.equal(boxes[0].querySelector('[data-ccs-kind="point"] text'), null)
  assert.equal(boxes[0].querySelector('[data-ccs-tooltip]'), null)

  const initialCenterX = Number(firstSvg.getAttribute('data-center-x'))
  const initialCenterY = Number(firstSvg.getAttribute('data-center-y'))
  const initialUnits = Number(firstSvg.getAttribute('data-units-per-px'))
  const toClientX = (wx) => 340 + (wx - initialCenterX) / initialUnits
  const toClientY = (wy) => 210 - (wy - initialCenterY) / initialUnits
  const PointerEvt = dom.window.PointerEvent || dom.window.MouseEvent

  // 3. 悬浮到单点 (1, 4) 显示坐标
  firstSvg.dispatchEvent(new PointerEvt('pointermove', { bubbles: true, clientX: toClientX(1), clientY: toClientY(4), pointerId: 1 }))
  await settle()
  assert.equal(boxes[0].querySelector('[data-ccs-tooltip] text')?.textContent, '(1, 4)')

  // 4. 悬浮到线段端点 (2, 3) 显示端点坐标
  firstSvg.dispatchEvent(new PointerEvt('pointermove', { bubbles: true, clientX: toClientX(2), clientY: toClientY(3), pointerId: 1 }))
  await settle()
  assert.equal(boxes[0].querySelector('[data-ccs-tooltip] text')?.textContent, '(2, 3)')

  // 5. 悬浮在线上（远离特殊点处，如 (2.4, 0.2) 靠近水平线段 (-3,0)->(3,0)）显示线上最近点 (2.4, 0)
  firstSvg.dispatchEvent(new PointerEvt('pointermove', { bubbles: true, clientX: toClientX(2.4), clientY: toClientY(0.2), pointerId: 1 }))
  await settle()
  assert.equal(boxes[0].querySelector('[data-ccs-tooltip]')?.getAttribute('data-ccs-snap'), 'line')
  assert.equal(boxes[0].querySelector('[data-ccs-tooltip] text')?.textContent, '(2.4, 0)')

  // 6. 即使指针恰好落在直线上（(0.85, 0) 到直线距离为 0px），靠近交点 (1, 0) 时仍优先磁吸至特殊交点 (1, 0)
  firstSvg.dispatchEvent(new PointerEvt('pointermove', { bubbles: true, clientX: toClientX(0.85), clientY: toClientY(0), pointerId: 1 }))
  await settle()
  assert.equal(boxes[0].querySelector('[data-ccs-tooltip]')?.getAttribute('data-ccs-snap'), 'special')
  assert.equal(boxes[0].querySelector('[data-ccs-tooltip] text')?.textContent, '(1, 0)')

  // 7. 悬浮到抛物线 y=x^2-1 与 Y 轴交点 (0, -1) 显示精确交点坐标
  firstSvg.dispatchEvent(new PointerEvt('pointermove', { bubbles: true, clientX: toClientX(0), clientY: toClientY(-1), pointerId: 1 }))
  await settle()
  assert.equal(boxes[0].querySelector('[data-ccs-tooltip] text')?.textContent, '(0, -1)')

  // 8. 移开到远离线条与点的空白区域后隐藏坐标气泡
  firstSvg.dispatchEvent(new PointerEvt('pointermove', { bubbles: true, clientX: toClientX(-4), clientY: toClientY(4), pointerId: 1 }))
  await settle()
  assert.equal(boxes[0].querySelector('[data-ccs-tooltip]'), null)

  // 8. 指针拖拽平移、滚轮缩放与双击复位
  firstSvg.dispatchEvent(new PointerEvt('pointerdown', { bubbles: true, button: 0, clientX: 200, clientY: 200, pointerId: 1 }))
  await settle()
  firstSvg.dispatchEvent(new PointerEvt('pointermove', { bubbles: true, clientX: 320, clientY: 140, pointerId: 1 }))
  await settle()
  firstSvg.dispatchEvent(new PointerEvt('pointerup', { bubbles: true, clientX: 320, clientY: 140, pointerId: 1 }))
  await settle()
  assert.ok(Number(firstSvg.getAttribute('data-center-x')) < initialCenterX)
  assert.ok(Number(firstSvg.getAttribute('data-center-y')) < initialCenterY)

  firstSvg.dispatchEvent(new dom.window.WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -120, clientX: 340, clientY: 210 }))
  await settle()
  assert.ok(Number(firstSvg.getAttribute('data-units-per-px')) < initialUnits)

  firstSvg.dispatchEvent(new dom.window.MouseEvent('dblclick', { bubbles: true }))
  await settle()
  assert.equal(Number(firstSvg.getAttribute('data-center-x')), initialCenterX)
  assert.equal(Number(firstSvg.getAttribute('data-units-per-px')), initialUnits)

  // 9. 展示框滑块联动更新嵌套坐标系函数图像
  const beforePath = boxes[1].querySelector('[data-ccs-kind="function"] path').getAttribute('d')
  await setInput(dom, document.querySelector('.show-box input[type="range"]'), '3')
  const afterPath = document.querySelectorAll('.ui-ccs-box')[1].querySelector('[data-ccs-kind="function"] path').getAttribute('d')
  assert.notEqual(afterPath, beforePath)
  assert.deepEqual(errors, [])
})

