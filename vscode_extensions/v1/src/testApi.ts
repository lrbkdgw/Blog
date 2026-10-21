/** 仅供测试使用，不引入 vscode。参考输出直接来自博客组件，不经过宿主桥接。 */
import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { CoordinateGraph } from '../../../src/components/CoordinateGraph'
import { Markdown, preprocessMarkdown, preprocessMarkdownDetailed } from '../../../src/components/Markdown'

export function renderReference(content: string): string {
  return renderToStaticMarkup(createElement(Markdown, { content, sourceLineMarkers: true }))
}

export { extendMarkdownIt } from './markdownIt'
export { preprocessMarkdown, preprocessMarkdownDetailed }

export function mountCoordinateGraphForTest(
  container: Element,
  body: string,
  sourceLine: number,
  onSourceChange: (line: number, body: string) => void,
) {
  const root = createRoot(container)
  root.render(createElement(CoordinateGraph, {
    body,
    extra: 'dag',
    sourceLine,
    allowAdjust: true,
    onSourceChange,
  }))
  return root
}
export { renderBlogPreview, addSourceLineMarkers } from './render'
export { readPreviewModel, previewUrlTransform } from './preview/model'
export { transformMarkdown, renderShowBox, convertMergeMarkersForMpe } from './core/transform'
export { convertMarkdownForCopy, convertUiCcsToMarkdown } from './core/sourceConvert'
export { evaluateShowFormula, parseShowVariables, renderShowContent } from './core/showBox'
export {
  compileCcsExpression,
  findNearestPointOnUiCcsLines,
  findNearestUiCcsSpecialPoint,
  findUiCcsSpecialPoints,
  parseUiCcs,
  renderStaticUiCcsSvg,
  resolveUiCcsHoverTarget,
} from './core/uiCcs'
export { parseArticleDirectives, stripArticleDirectives } from './core/articleDirectives'
export { LATEX_SYMBOLS, latexSymbolInsert, searchLatexSymbols } from './core/latexSymbols'
