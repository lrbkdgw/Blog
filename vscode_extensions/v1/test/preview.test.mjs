import test from 'node:test'
import assert from 'node:assert/strict'
import { close, preview, setInput, settle, update } from './helpers.mjs'

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
