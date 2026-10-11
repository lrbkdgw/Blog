/** 直接挂载博客组件，而不是修改已渲染的占位 span。 */
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { Markdown } from '../../../../src/components/Markdown'
import '../../../../src/styles/index.css'
import '../../media/preview.css'
import { previewUrlTransform, readPreviewModel } from './model'
import type { PreviewModel } from './model'

interface MountedPreview {
  mount: HTMLDivElement
  root: Root
  encoded: string
  model: PreviewModel
}

const previews = new Map<string, MountedPreview>()

function syncTheme(): void {
  const classes = document.body.classList
  const dark = classes.contains('vscode-dark') || classes.contains('vscode-high-contrast')
  const root = document.documentElement
  if (root.classList.contains('dark') !== dark) root.classList.toggle('dark', dark)
  if (!root.classList.contains('markdown-extension-active')) root.classList.add('markdown-extension-active')
  if (!classes.contains('markdown-extension-active')) classes.add('markdown-extension-active')
}

/** 对博客自己的行号作宿主适配；展示框内部不伪造正文行号。 */
function decorate(preview: MountedPreview): void {
  for (const element of preview.mount.querySelectorAll<HTMLElement>('[data-source-line]')) {
    const line = Number(element.getAttribute('data-source-line'))
    if (line > 0) {
      element.classList.add('code-line')
      element.setAttribute('data-line', String(line - 1 + preview.model.lineOffset))
    }
  }
  for (const link of preview.mount.querySelectorAll<HTMLAnchorElement>('a[href]')) {
    link.setAttribute('data-href', link.getAttribute('href') || '')
  }
  for (const image of preview.mount.querySelectorAll<HTMLImageElement>('img[src]')) {
    const src = image.getAttribute('src') || ''
    const original = Object.keys(preview.model.resourceMap).find((key) => preview.model.resourceMap[key] === src)
    image.setAttribute('data-src', original ?? src)
  }
  // 新版 VS Code 会给 pre 加自己的复制按钮。博客已经有同款按钮，不显示第二个。
  for (const button of preview.mount.querySelectorAll('.code-block-copy-button')) button.remove()
}

function reconcile(): void {
  const active = new Set<string>()
  const occurrences = new Map<string, number>()
  for (const wrapper of document.querySelectorAll<HTMLElement>('.markdown-extension-preview[data-markdown-model]')) {
    const model = readPreviewModel(wrapper)
    if (!model) continue
    const occurrence = occurrences.get(model.documentUri) ?? 0
    occurrences.set(model.documentUri, occurrence + 1)
    const key = `${model.documentUri}\u0000${occurrence}`
    const encoded = wrapper.getAttribute('data-markdown-model') || ''
    active.add(key)

    let preview = previews.get(key)
    if (!preview) {
      const mount = document.createElement('div')
      mount.className = 'markdown-extension-mount'
      preview = { mount, root: createRoot(mount), encoded: '', model }
      previews.set(key, preview)
    }
    if (preview.mount.parentElement !== wrapper) wrapper.replaceChildren(preview.mount)
    if (preview.encoded !== encoded) {
      preview.encoded = encoded
      preview.model = model
      // 同一个 React root 更新，ShowBox 的状态/重置规则与博客完全相同。
      flushSync(() => preview.root.render(
        <Markdown content={model.content} sourceLineMarkers urlTransform={previewUrlTransform(model)} />,
      ))
    }
    decorate(preview)
  }

  for (const [key, preview] of previews) {
    if (!active.has(key)) {
      preview.root.unmount()
      previews.delete(key)
    }
  }
}

/**
 * VS Code 用 morphdom 更新预览。先把 React 持有的节点移出 DOM，更新后再接回，
 * 防止它直接改写 React 的节点（导致交互失效或 NotFoundError）。不重新创建 root，
 * 相同源码刷新时交互状态不会丢失；源码修改后遵循博客的重置规则。切换文档则销毁旧 root。
 * 不调用 acquireVsCodeApi：内置预览已占用该 API，第二次调用会抛错。
 */
window.addEventListener('message', (event: MessageEvent) => {
  if (event.data?.type === 'updateContent') {
    for (const preview of previews.values()) preview.mount.remove()
  }
}, true)

window.addEventListener('vscode.markdown.updateContent', reconcile)

function start(): void {
  syncTheme()
  reconcile()
  const contentObserver = new MutationObserver(reconcile)
  contentObserver.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['data-markdown-model'],
  })
  const themeObserver = new MutationObserver(syncTheme)
  themeObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] })
  window.addEventListener('beforeunload', () => {
    contentObserver.disconnect()
    themeObserver.disconnect()
    for (const preview of previews.values()) preview.root.unmount()
    previews.clear()
  }, { once: true })
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start, { once: true })
} else {
  start()
}
