import { defaultUrlTransform } from 'react-markdown'
import type { UrlTransform } from 'react-markdown'

export interface PreviewModel {
  content: string
  lineOffset: number
  documentUri: string
  resourceMap: Record<string, string>
  /** VS Code 将工作区根目录转换成的 webview URI，用于动态生成的根路径图片。 */
  resourceRoot: string
}

export function readPreviewModel(element: Element): PreviewModel | undefined {
  try {
    const parsed: unknown = JSON.parse(decodeURIComponent(element.getAttribute('data-markdown-model') || ''))
    if (!parsed || typeof parsed !== 'object') return undefined
    const model = parsed as PreviewModel
    if (
      typeof model.content !== 'string' ||
      !Number.isInteger(model.lineOffset) || model.lineOffset < 0 ||
      typeof model.documentUri !== 'string' ||
      typeof model.resourceRoot !== 'string' ||
      !model.resourceMap || typeof model.resourceMap !== 'object' || Array.isArray(model.resourceMap) ||
      !Object.values(model.resourceMap).every((value) => typeof value === 'string')
    ) return undefined
    return model
  } catch {
    return undefined
  }
}

export function previewUrlTransform(model: PreviewModel): UrlTransform {
  return (url, key) => {
    const safe = defaultUrlTransform(url)
    if (key !== 'src' || !safe) return safe
    if (Object.prototype.hasOwnProperty.call(model.resourceMap, safe)) {
      return model.resourceMap[safe]
    }
    if (safe.startsWith('/') && !safe.startsWith('//') && /^https?:\/\//i.test(model.resourceRoot)) {
      return new URL(safe.slice(1), model.resourceRoot.replace(/\/?$/, '/')).toString()
    }
    return safe
  }
}
