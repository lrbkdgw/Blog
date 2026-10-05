/** 仅供测试使用的聚合入口（不依赖 vscode 模块）。 */
export { extendMarkdownIt } from './markdownIt'
export { transformMarkdown, renderShowBox, convertMergeMarkersForMpe } from './core/transform'
export { convertMarkdownForCopy } from './core/sourceConvert'
export { evaluateShowFormula, formatDirectionalRound, parseShowVariables, renderShowContent } from './core/showBox'
