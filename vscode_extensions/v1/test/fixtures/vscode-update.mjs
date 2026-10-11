/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See https://github.com/microsoft/vscode/blob/main/LICENSE.txt
 *--------------------------------------------------------------------------------------------*/

/**
 * VS Code 内置预览的更新协议测试桥接（不随 VSIX 发布）。
 * 更新分支参考 Microsoft VS Code / MIT：
 * https://github.com/microsoft/vscode/blob/main/extensions/markdown-language-features/preview-src/index.ts
 * 保留实际 morphdom、文档切换、更新事件及事件之后的复制按钮处理；省略脚本执行。
 */
import morphdom from 'morphdom'

function areNodesEqual(a, b) {
  if (a.nodeType !== b.nodeType || a.nodeName !== b.nodeName || a.nodeValue !== b.nodeValue) return false
  if (a.nodeType === Node.ELEMENT_NODE) {
    const attributes = (element) => [...element.attributes]
      .filter((attribute) => !['data-line', 'open'].includes(attribute.name))
      .map((attribute) => [attribute.name, attribute.value]).sort()
    if (JSON.stringify(attributes(a)) !== JSON.stringify(attributes(b))) return false
  }
  return a.childNodes.length === b.childNodes.length && [...a.childNodes].every((node, index) => areNodesEqual(node, b.childNodes[index]))
}

let documentResource = 'file:///workspace/demo.md'
window.nativePreviewUpdates = 0
window.addEventListener('message', (event) => {
  const data = event.data
  if (data?.type !== 'updateContent') return
  const root = document.querySelector('.markdown-body')
  const newRoot = new DOMParser().parseFromString(data.content, 'text/html').querySelector('.markdown-body')
  if (!root || !newRoot) throw new Error('内置预览更新缺少 markdown-body')

  if (data.source !== documentResource) {
    documentResource = data.source
    root.replaceWith(newRoot)
  } else {
    morphdom(root, newRoot, {
      childrenOnly: true,
      onBeforeElUpdated(fromEl, toEl) {
        if (areNodesEqual(fromEl, toEl)) {
          const fromLines = fromEl.querySelectorAll('[data-line]')
          const toLines = toEl.querySelectorAll('[data-line]')
          for (let i = 0; i < fromLines.length; ++i) {
            if (toLines[i]) fromLines[i].setAttribute('data-line', toLines[i].getAttribute('data-line'))
          }
          return false
        }
        if (fromEl.tagName === 'DETAILS' && toEl.tagName === 'DETAILS' && fromEl.hasAttribute('open')) {
          toEl.setAttribute('open', '')
        }
        return true
      },
    })
  }

  window.dispatchEvent(new CustomEvent('vscode.markdown.updateContent'))
  // 内置 scroll-sync 按 DOM 顺序缓存行号，不会在编辑器→预览方向过滤隐藏节点。
  window.nativeCodeLineElements = [...document.getElementsByClassName('code-line')]
  // VS Code 在 updateContent 事件之后继续修改页面，插件不能假定该事件是更新终点。
  for (const pre of document.querySelectorAll('pre')) {
    if (!pre.querySelector('.code-block-copy-button')) {
      const button = document.createElement('button')
      button.className = 'code-block-copy-button'
      pre.appendChild(button)
    }
  }
  ++window.nativePreviewUpdates
})
