'use strict'

const vscode = require('vscode')

const TYPES = 'info、note、tip、success、warning、error、danger'
const docs = [
  [/::show_begin/i, '**交互展示框**：`::show_begin{标题}{变量定义}`，并以 `::show_end` 结束。变量支持 `Z`、`Q`、`S`；数值范围为 `[最小,最大,步长]`。'],
  [/::show_end/i, '**交互展示框结束标记**。'],
  [/cute-table/i, '**Tuack 表格**：令紧随其后的 Markdown 表格显示为三线表。'],
  [/^\s*:{3,}(?:info|note|tip|success|warning|error|danger)/i, `**折叠提示框**：类型为 ${TYPES}；可追加 \`{open}\` 默认展开。`],
  [/\*&show\(/i, '**变量占位符**：替换为交互展示框变量的当前值。'],
  [/\*&hs\(/i, '**表达式占位符**：计算仅包含数值变量和 `+ - * / ^ ( )` 的表达式。'],
  [/&\*(?:floor|ceil)\(/i, '**定向取整**：第二个参数为保留位数（-100 到 100 的整数）。'],
  [/\*&[^:*&{}()\s]+:\{/i, '**变量映射**：`*&变量:{键,内容;键,内容}*&`。']
]

function isEnabled() {
  return vscode.workspace.getConfiguration('starlogBlogMarkdown').get('diagnostics.enabled', true)
}

function diagnosticsFor(document) {
  if (document.languageId !== 'markdown' || !isEnabled()) return []
  const result = []
  const showStack = []
  const callouts = []
  let fence = null
  for (let lineNo = 0; lineNo < document.lineCount; lineNo++) {
    const text = document.lineAt(lineNo).text
    const marker = text.match(/^\s*(`{3,}|~{3,})/)
    if (marker) {
      if (!fence) fence = marker[1][0]
      else if (fence === marker[1][0]) fence = null
      continue
    }
    if (fence) continue
    if (/^\s*::show_begin/i.test(text)) {
      if (!/^\s*::show_begin\{[^}]*\}\{.*\}\s*$/i.test(text)) {
        result.push(diag(document, lineNo, '展示框应写为 ::show_begin{标题}{变量定义}。'))
      } else showStack.push(lineNo)
      continue
    }
    if (/^\s*::show_end\s*$/i.test(text)) {
      if (!showStack.length) result.push(diag(document, lineNo, '没有与此标记匹配的 ::show_begin。'))
      else showStack.pop()
      continue
    }
    const open = text.match(/^\s*(:{3,})(info|note|tip|success|warning|error|danger)(?:\[[^\]]*\])?(?:\{open\})?\s*$/i)
    if (open) { callouts.push({ line: lineNo, count: open[1].length }); continue }
    const close = text.match(/^\s*(:{3,})\s*$/)
    if (close && callouts.length) {
      const top = callouts[callouts.length - 1]
      if (close[1].length >= top.count) callouts.pop()
      else result.push(diag(document, lineNo, `内层提示框需要至少 ${top.count} 个冒号关闭。`))
    }
    if (/^\s*:{3,}[a-z]+/i.test(text) && !open) {
      result.push(diag(document, lineNo, `未知或格式错误的提示框；支持：${TYPES}。`))
    }
    for (const match of text.matchAll(/&\*(floor|ceil)\(([^)]*)\)&\*/g)) {
      const args = match[2].split(',')
      if (args.length !== 2) result.push(diag(document, lineNo, `${match[1]} 需要两个参数：数值与位数。`, vscode.DiagnosticSeverity.Warning, match.index, match[0].length))
      else if (/^-?\d+$/.test(args[1].trim()) && Math.abs(Number(args[1])) > 100) result.push(diag(document, lineNo, '取整位数应在 -100 到 100 之间。', vscode.DiagnosticSeverity.Warning, match.index, match[0].length))
    }
  }
  for (const line of showStack) result.push(diag(document, line, '展示框缺少 ::show_end。'))
  for (const item of callouts) result.push(diag(document, item.line, '提示框缺少对应的冒号结束行。'))
  return result
}

function diag(document, line, message, severity = vscode.DiagnosticSeverity.Error, start = 0, length) {
  const text = document.lineAt(line).text
  return new vscode.Diagnostic(new vscode.Range(line, start, line, length == null ? text.length : start + length), message, severity)
}

function activate(context) {
  const collection = vscode.languages.createDiagnosticCollection('starlog-blog-markdown')
  const update = document => collection.set(document.uri, diagnosticsFor(document))
  vscode.workspace.textDocuments.forEach(update)
  context.subscriptions.push(collection)
  context.subscriptions.push(vscode.workspace.onDidOpenTextDocument(update))
  context.subscriptions.push(vscode.workspace.onDidChangeTextDocument(event => update(event.document)))
  context.subscriptions.push(vscode.workspace.onDidCloseTextDocument(document => collection.delete(document.uri)))
  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(event => {
    if (event.affectsConfiguration('starlogBlogMarkdown')) vscode.workspace.textDocuments.forEach(update)
  }))
  context.subscriptions.push(vscode.languages.registerHoverProvider({ language: 'markdown' }, {
    provideHover(document, position) {
      const line = document.lineAt(position.line).text
      const entry = docs.find(([pattern]) => pattern.test(line))
      return entry ? new vscode.Hover(new vscode.MarkdownString(entry[1])) : undefined
    }
  }))
}

function deactivate() {}
module.exports = { activate, deactivate, diagnosticsFor }
