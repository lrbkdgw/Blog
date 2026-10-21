import test from 'node:test'
import assert from 'node:assert/strict'
import { close, preview, render, setInput, settle, update } from './helpers.mjs'

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

test('表单交互与条件映射（#82）及图论画布（#83）实时响应式交互、焦点保持与拖拽缩放', async (t) => {
  const fullDoc = [
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
    '水果选择：',
    '::begin_ui-select[Fruit][search]',
    '香蕉',
    '苹果',
    '葡萄',
    '::end_ui-select',
    '',
    '::begin_ui-if[CheckList][lined]',
    '完成热身题',
    '::nex',
    '写出正解',
    '::end_ui-if',
    '',
    '我今天要吃 ::ui-write[Number][R 0 1 4] 根香蕉！',
    '',
    '::ui-write[Name][len 2 4][new][name 名字]',
    '::ui-write[Tag][set 极客][len 1 6][new][merge][name 头衔]',
    '',
    '::ui-write[Ti][R 0 0 3][new][name 已经吃的香蕉][faster]',
    '',
    '选号：<<a_new_choose>>｜水果：<<Fruit>>｜勾选：<<CheckList-1>>｜目标：<number>',
    '',
    '<IF:$<number> \\le <Ti>$,你真棒！><IF:$<number> \\leq 2 \\times <Ti>$,还不错！>',
    '',
    '::IF[$<CheckList-1> == 1$]',
    '### 热身已完成',
    '::IF_END',
    '',
    '::begin_ui-graph[dag]',
    '5',
    '1 2 10',
    '2 3 5',
    '::end_ui-graph',
  ].join('\n')

  const { dom, document, errors } = await preview(fullDoc)
  t.after(() => close(dom))

  // 1. 验证初始状态：未选时 choose 为 0，Number 为 1（被 [1,4] 夹紧），Ti 为 0，下拉默认第 1 项，merge 共用一行 2 列
  assert.match(document.body.textContent, /选号：0｜水果：1｜勾选：0｜目标：1/)
  assert.doesNotMatch(document.body.textContent, /你真棒！|还不错！|热身已完成/)
  const mergedRow = document.querySelector('.ui-write-row')
  assert.equal(mergedRow.children.length, 2)

  // 2. 点击选择框第 1 项与第 4 项（more 1 2），再点第 2 项不会超出上限 2
  const chooseButtons = document.querySelector('[data-ui-id="a_new_choose"]').querySelectorAll('[role="checkbox"]')
  assert.equal(chooseButtons.length, 4)
  assert.ok(chooseButtons[3].querySelector('.katex')) // [$\sum$] 渲染了 KaTeX
  chooseButtons[0].click()
  await settle()
  chooseButtons[3].click()
  await settle()
  chooseButtons[1].click() // 已达上限 2，不应被选中
  await settle()
  assert.match(document.body.textContent, /选号：1, 4/)

  // 3. 勾选 lined 是否框第 1 项：<<CheckList-1>> 变为 1，划线动画元素存在且 ::IF 块实时出现
  const ifItem = document.querySelector('[data-ui-id="CheckList"]').querySelector('[role="checkbox"]')
  assert.ok(document.querySelector('.ui-if-lined .ui-if-strike-bar'))
  ifItem.click()
  await settle()
  assert.match(document.body.textContent, /勾选：1/)
  assert.match(document.body.textContent, /热身已完成/)

  // 4. 拖动 faster 滑块 Ti 到 2，同时修改行内填空框 Number 为 2：输入框不丢焦点，且 <IF:$<number> \le <Ti>$,你真棒！> 实时生效！
  await setInput(dom, document.querySelector('input[type="range"]'), '2')
  const inlineInput = document.querySelector('span[data-ui-id="Number"] input')
  inlineInput.focus()
  await setInput(dom, inlineInput, '2')
  assert.equal(document.activeElement, document.querySelector('span[data-ui-id="Number"] input'))
  assert.match(document.body.textContent, /目标：2/)
  assert.match(document.body.textContent, /你真棒！/)
  assert.match(document.body.textContent, /还不错！/)

  // 5. 图论画布：孤立点 5 + 未显式声明但由边自动创建的 1, 2, 3 共 4 个点，dag 有向箭头存在，且支持滚轮缩放与双击复位
  const graphBox = document.querySelector('.ui-graph-box.ui-ccs-box')
  assert.ok(graphBox)
  assert.equal(graphBox.querySelectorAll('[data-node-id]').length, 4)
  assert.equal(graphBox.querySelectorAll('[data-graph-arrow]').length, 2)
  const graphSvg = graphBox.querySelector('svg[role="application"]')
  const initUnits = Number(graphSvg.getAttribute('data-units-per-px'))
  graphSvg.dispatchEvent(new dom.window.WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -120, clientX: 340, clientY: 210 }))
  await settle()
  assert.ok(Number(graphSvg.getAttribute('data-units-per-px')) < initUnits)
  graphSvg.dispatchEvent(new dom.window.MouseEvent('dblclick', { bubbles: true }))
  await settle()
  assert.equal(Number(graphSvg.getAttribute('data-units-per-px')), initUnits)

  assert.deepEqual(errors, [])
})


