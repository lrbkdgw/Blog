import { build } from 'esbuild'
import { JSDOM } from 'jsdom'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const blogRoot = resolve(root, '../..')
const require = createRequire(import.meta.url)
export const MarkdownIt = require('markdown-it')

const result = await build({
  absWorkingDir: root,
  entryPoints: ['src/testApi.ts'],
  bundle: true,
  write: false,
  platform: 'node',
  format: 'cjs',
  jsx: 'automatic',
  loader: { '.css': 'empty' },
  define: { 'process.env.NODE_ENV': '"production"' },
  target: ['es2020'],
  logLevel: 'silent',
})
const shim = { exports: {} }
new Function('module', 'exports', 'require', result.outputFiles[0].text)(shim, shim.exports, require)
export const core = shim.exports

export function engine() {
  return core.extendMarkdownIt(new MarkdownIt({ html: true }))
}

export function render(source, documentUri = 'file:///workspace/demo.md') {
  return engine().render(source, { currentDocument: { toString: () => documentUri } })
}

export function documentOf(html) {
  return new JSDOM('<!doctype html><html><body>' + html + '</body></html>').window.document
}

export function blogMarkup(html) {
  const doc = documentOf(html)
  const mount = doc.querySelector('.markdown-extension-mount')
  for (const node of mount.querySelectorAll('[data-line]')) {
    node.removeAttribute('data-line')
    node.classList.remove('code-line')
    if (!node.className) node.removeAttribute('class')
  }
  return mount.innerHTML
}

const script = readFileSync(join(root, 'out/preview.js'), 'utf8')
export const settle = () => new Promise((resolve) => setTimeout(resolve, 15))

export async function preview(source, className = 'vscode-light') {
  const errors = []
  const dom = new JSDOM(`<!doctype html><html><body class="${className}"><main class="markdown-body">${render(source)}</main></body></html>`, {
    runScripts: 'outside-only',
    pretendToBeVisual: true,
    url: 'https://preview.test/workspace/demo.md',
    beforeParse(window) {
      window.TextEncoder = TextEncoder
      window.TextDecoder = TextDecoder
      window.acquireVsCodeApi = () => { throw new Error('内置预览已占用此 API') }
      window.addEventListener('error', (event) => errors.push(event.error))
    },
  })
  if (dom.window.document.readyState === 'loading') {
    await new Promise((resolve) => dom.window.addEventListener('load', resolve, { once: true }))
  }
  dom.window.eval(script)
  await settle()

  // 模拟 VS Code 在捕获阶段之后执行的 DOM 更新。
  dom.window.addEventListener('message', (event) => {
    if (event.data?.type !== 'updateContent') return
    dom.window.document.querySelector('.markdown-body').innerHTML = event.data.content
    dom.window.dispatchEvent(new dom.window.CustomEvent('vscode.markdown.updateContent'))
  })
  return { dom, document: dom.window.document, errors }
}

export async function setInput(dom, input, value) {
  const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set
  setter.call(input, value)
  input.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
  input.dispatchEvent(new dom.window.Event('change', { bubbles: true }))
  await settle()
}

export async function update(dom, source, documentUri = 'file:///workspace/demo.md') {
  dom.window.dispatchEvent(new dom.window.MessageEvent('message', {
    data: { type: 'updateContent', source: documentUri, content: render(source, documentUri) },
  }))
  await settle()
}

export function close(dom) {
  dom.window.dispatchEvent(new dom.window.Event('beforeunload'))
  dom.window.close()
}
