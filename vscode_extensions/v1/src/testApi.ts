/** 仅供测试使用，不引入 vscode。参考输出直接来自博客组件，不经过宿主桥接。 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Markdown } from '../../../src/components/Markdown'

export function renderReference(content: string): string {
  return renderToStaticMarkup(createElement(Markdown, { content, sourceLineMarkers: true }))
}

export { extendMarkdownIt } from './markdownIt'
export { renderBlogPreview, addSourceLineMarkers } from './render'
export { readPreviewModel, previewUrlTransform } from './preview/model'
export { transformMarkdown, renderShowBox, convertMergeMarkersForMpe } from './core/transform'
export { convertMarkdownForCopy } from './core/sourceConvert'
export { evaluateShowFormula, parseShowVariables, renderShowContent } from './core/showBox'
export { parseArticleDirectives, stripArticleDirectives } from './core/articleDirectives'
export {
  parseCoordinatePlane,
  compilePlaneExpression,
  planeContentBounds,
  nicePlaneStep,
  formatPlaneNumber,
  parsePlaneColor,
  DEFAULT_PLANE_COLOR,
} from './core/coordinatePlane'
export { LATEX_SYMBOLS, latexSymbolInsert, searchLatexSymbols } from './core/latexSymbols'
export { stripMarkdown, countWords, excerpt, extractToc } from './core/posts'
export { installHeaderYield, LIST_SCOPE_ATTR, YIELD_REFRESH_EVENT } from './core/headerYield'
