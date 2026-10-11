/**
 * 内置预览的宿主桥接层。
 *
 * 不再让 markdown-it 重新实现博客语法。保留其原始 tokens 供 VS Code 的目录、
 * 链接分析和缓存使用，仅在整篇文档的 render 阶段调用博客的 React 渲染器。
 * renderInline 不受影响；本地图片仍经过 VS Code 自己的资源转换器。
 */
import type MarkdownIt from 'markdown-it'
import type Token from 'markdown-it/lib/token.mjs'
import { renderBlogPreview } from './render'
import type { RenderOptions } from './render'

interface RenderEnvironment {
  currentDocument?: { toString(): string }
  containingImages?: Set<string>
}

const extended = new WeakSet<MarkdownIt>()

export function extendMarkdownIt(
  md: MarkdownIt,
  readConfiguration?: (documentUri: string) => Pick<RenderOptions, 'enableGradientBackground'>,
): MarkdownIt {
  if (extended.has(md)) return md
  extended.add(md)

  const sources = new WeakMap<Token[], string>()
  const originalSource = Symbol('markdown-extension-source')
  let TokenConstructor: typeof Token

  md.core.ruler.before('normalize', 'markdown_extension_source', (state) => {
    if (state.inlineMode) return
    TokenConstructor = state.Token
    // 必须在 normalize/frontmatter 等规则之前保存原文和原始行号。
    ;(state as unknown as Record<symbol, string>)[originalSource] = state.src
  })
  md.core.ruler.push('markdown_extension_remember', (state) => {
    if (!state.inlineMode) {
      sources.set(state.tokens, (state as unknown as Record<symbol, string>)[originalSource])
    }
  })

  const render = md.renderer.render.bind(md.renderer)
  md.renderer.render = (tokens, options, env: RenderEnvironment = {}) => {
    const source = sources.get(tokens)
    if (source === undefined) return render(tokens, options, env)

    const resolveImage = (url: string, imageEnv = env) => {
      // VS Code 在加载扩展后包装 image rule；调用时再读取，不能提前缓存。
      const image = new TokenConstructor('image', 'img', 0)
      image.attrSet('src', url)
      image.attrSet('alt', '')
      image.children = []
      md.renderer.rules.image?.([image], 0, options, imageEnv, md.renderer)
      return image.attrGet('src') ?? url
    }
    const documentUri = env.currentDocument?.toString() ?? ''
    return renderBlogPreview(source, {
      ...readConfiguration?.(documentUri),
      documentUri,
      resolveImage,
      // 根 URI 只是动态图片的解析基准，不应该注册成要监视的“图片”。
      resourceRoot: resolveImage('/', { ...env, containingImages: new Set<string>() }),
    })
  }

  return md
}
