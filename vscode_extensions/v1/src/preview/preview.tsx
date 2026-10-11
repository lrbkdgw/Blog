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
  /** 永远位于内置 markdown-body 的外面，不允许 morphdom 触碰 React 的节点。 */
  host: HTMLDivElement
  mount: HTMLDivElement
  endLine: HTMLDivElement
  root: Root
  encoded: string
  resources: string
  urlTransform: ReturnType<typeof previewUrlTransform>
  model: PreviewModel
}

const previews = new Map<string, MountedPreview>()
const sourceContainers = new Set<HTMLElement>()
let queued = false
let disposed = false
let enableGradientBackground = false

function syncTheme(): void {
  const classes = document.body.classList
  const dark = classes.contains('vscode-dark') || classes.contains('vscode-high-contrast')
  const root = document.documentElement
  if (root.classList.contains('dark') !== dark) root.classList.toggle('dark', dark)
  if (!root.classList.contains('markdown-extension-active')) root.classList.add('markdown-extension-active')
  if (!classes.contains('markdown-extension-active')) classes.add('markdown-extension-active')
  if (classes.contains('markdown-extension-gradient-background') !== enableGradientBackground) {
    classes.toggle('markdown-extension-gradient-background', enableGradientBackground)
  }
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
  preview.endLine.setAttribute('data-line', String(preview.model.lineOffset + preview.model.content.split('\n').length))
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
  const activeSources = new Set<HTMLElement>()
  const positions = new Map<HTMLElement, HTMLElement>()
  const occurrences = new Map<string, number>()
  let nextGradientBackground = false
  for (const wrapper of document.querySelectorAll<HTMLElement>('.markdown-extension-preview[data-markdown-model]')) {
    const model = readPreviewModel(wrapper)
    if (!model) continue
    const occurrence = occurrences.get(model.documentUri) ?? 0
    occurrences.set(model.documentUri, occurrence + 1)
    const key = `${model.documentUri}\u0000${occurrence}`
    const encoded = wrapper.getAttribute('data-markdown-model') || ''
    const resources = JSON.stringify([model.resourceRoot, model.resourceMap])
    active.add(key)
    if (active.size === 1) nextGradientBackground = model.enableGradientBackground

    let preview = previews.get(key)
    if (!preview) {
      const host = document.createElement('div')
      host.className = 'markdown-extension-preview markdown-extension-host'
      const mount = document.createElement('div')
      mount.className = 'markdown-extension-mount'
      const endLine = document.createElement('div')
      endLine.className = 'code-line'
      host.append(mount, endLine)
      preview = { host, mount, endLine, root: createRoot(mount), encoded: '', resources, urlTransform: previewUrlTransform(model), model }
      previews.set(key, preview)
    }

    const source = wrapper.closest<HTMLElement>('.markdown-body') ?? wrapper
    const position = positions.get(source) ?? source
    if (position.nextSibling !== preview.host) position.after(preview.host)
    positions.set(source, preview.host)
    preview.host.dir = source.dir || 'auto'
    activeSources.add(source)
    sourceContainers.add(source)
    source.classList.add('markdown-extension-source')
    // SSR 是脚本未加载时的回退。挂载后只保留模型，避免重复正文、标题 ID 和行号。
    if (wrapper.hasChildNodes()) wrapper.replaceChildren()
    // 原生 EOF 锚点位于隐藏入口中，保留会在正文锚点之前插入最大的行号，破坏滚动同步。
    for (const marker of source.querySelectorAll('.code-line')) {
      marker.classList.remove('code-line')
      marker.removeAttribute('data-line')
    }

    if (preview.encoded !== encoded) {
      if (preview.resources !== resources) {
        preview.resources = resources
        preview.urlTransform = previewUrlTransform(model)
      }
      preview.encoded = encoded
      preview.model = model
      // 稳定 URL 转换函数使背景/行号设置变化不重置展示框，相同源码刷新保持交互状态。
      flushSync(() => preview.root.render(
        <Markdown content={model.content} sourceLineMarkers urlTransform={preview.urlTransform} />,
      ))
    }
    decorate(preview)
  }

  enableGradientBackground = nextGradientBackground
  syncTheme()
  for (const [key, preview] of previews) {
    if (!active.has(key)) {
      preview.root.unmount()
      preview.host.remove()
      previews.delete(key)
    }
  }
  for (const source of sourceContainers) {
    if (!activeSources.has(source)) {
      source.classList.remove('markdown-extension-source')
      sourceContainers.delete(source)
    }
  }
}

/**
 * message 的 target 是 window。在 Chromium 中，同一目标上的捕获监听器不能抢在
 * 更早注册的内置监听器之前执行，临时拆卸 React mount 因而无法隔离 morphdom。
 * React 改为永久拥有 markdown-body 外的兄弟容器，内置预览只更新隐藏的模型入口。
 * 更新事件中同步发布新正文与行号，确保内置滚动同步随后缓存的是当前 DOM。
 * 微任务观察器兼容延迟插入，并清理事件之后内置预览添加的重复复制按钮。
 * 不调用 acquireVsCodeApi：内置预览已占用该 API，第二次调用会抛错。
 */
function queueReconcile(): void {
  if (queued || disposed) return
  queued = true
  queueMicrotask(() => {
    queued = false
    if (!disposed) reconcile()
  })
}

window.addEventListener('vscode.markdown.updateContent', reconcile)

function start(): void {
  syncTheme()
  const contentObserver = new MutationObserver(queueReconcile)
  contentObserver.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['data-markdown-model'],
  })
  const themeObserver = new MutationObserver(syncTheme)
  themeObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] })
  queueReconcile()
  window.addEventListener('beforeunload', () => {
    disposed = true
    contentObserver.disconnect()
    themeObserver.disconnect()
    window.removeEventListener('vscode.markdown.updateContent', reconcile)
    for (const preview of previews.values()) {
      preview.root.unmount()
      preview.host.remove()
    }
    previews.clear()
    for (const source of sourceContainers) source.classList.remove('markdown-extension-source')
    sourceContainers.clear()
  }, { once: true })
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start, { once: true })
} else {
  start()
}
