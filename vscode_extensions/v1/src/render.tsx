/** VS Code 只负责宿主适配；Markdown、ShowBox、KaTeX 与高亮全部来自博客。 */
import { renderToStaticMarkup } from 'react-dom/server'
import { defaultUrlTransform } from 'react-markdown'
import { Markdown } from '../../../src/components/Markdown'
import { parseFrontmatter } from '../../../src/lib/frontmatter'
import type { PreviewModel } from './preview/model'

export interface RenderOptions {
  documentUri?: string
  resolveImage?: (url: string) => string
  resourceRoot?: string
}

/** 保留博客块级行号，同时提供 VS Code 的 0 基 code-line 锚点。 */
export function addSourceLineMarkers(html: string, lineOffset: number): string {
  return html.replace(/<[a-z][^>]*\bdata-source-line="(\d+)"[^>]*>/gi, (tag, line: string) => {
    const withClass = /\bclass="/.test(tag)
      ? tag.replace(/\bclass="([^"]*)"/, 'class="$1 code-line"')
      : tag.replace(/>$/, ' class="code-line">')
    return withClass.replace(/>$/, ` data-line="${Number(line) - 1 + lineOffset}">`)
  })
}

export function renderBlogPreview(source: string, options: RenderOptions = {}): string {
  const normalized = source.replace(/\r\n?/g, '\n')
  const { content } = parseFrontmatter(normalized)
  const prefix = normalized.slice(0, normalized.length - content.length)
  const resourceMap: Record<string, string> = Object.create(null)
  const resolveImage = options.resolveImage ?? ((url: string) => url)
  const lineOffset = (prefix.match(/\n/g) || []).length

  const html = renderToStaticMarkup(
    <Markdown
      content={content}
      sourceLineMarkers
      urlTransform={(url, key) => {
        const safe = defaultUrlTransform(url)
        if (key !== 'src' || !safe) return safe
        const resolved = resolveImage(safe)
        resourceMap[safe] = resolved
        return resolved
      }}
    />,
  )

  const model: PreviewModel = {
    content,
    lineOffset,
    documentUri: options.documentUri ?? '',
    resourceMap,
    resourceRoot: options.resourceRoot ?? '/',
  }
  // encodeURIComponent 不含双引号或 HTML 标签；源码不能逃逸出 data 属性。
  const encoded = encodeURIComponent(JSON.stringify(model))
  return `<div class="markdown-extension-preview" data-markdown-model="${encoded}"><div class="markdown-extension-mount">${addSourceLineMarkers(html, lineOffset)}</div></div>\n`
}
