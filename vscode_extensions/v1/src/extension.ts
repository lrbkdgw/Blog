/**
 * Markdown 语法拓展 · VS Code 扩展入口。
 *
 * 导出 `extendMarkdownIt` 给内置 Markdown 预览；同时注册命令，用于：
 *   - 向 Markdown Preview Enhanced 安装 / 卸载静态兼容支持；
 *   - 插入展示框 / 折叠框 / Tuack 表格模板与 LaTeX 符号（可按别名搜索）；
 *   - 把当前文档转换（复制）为洛谷源码或基本 Markdown。
 */

import * as vscode from 'vscode'
import { extendMarkdownIt } from './markdownIt'
import { convertMarkdownForCopy, type MarkdownCopyTarget } from './core/sourceConvert'
import {
  LATEX_SYMBOLS,
  latexCategoryName,
  latexSymbolInsert,
  type LatexSymbol,
} from './core/latexSymbols'
import {
  MPE_EXTENSION_ID,
  enableExtendedTableSyntax,
  installMpeSupport,
  installedParserVersion,
  isMpeInstalled,
  uninstallMpeSupport,
  type MpeScope,
} from './mpeSetup'

const STATE_PROMPTED = 'starlog.mpePrompted'

function currentMarkdownEditor(): vscode.TextEditor | undefined {
  const editor = vscode.window.activeTextEditor
  if (editor && editor.document.languageId === 'markdown') return editor
  void vscode.window.showWarningMessage('请先打开一个 Markdown 文件。')
  return undefined
}

async function pickScope(): Promise<MpeScope | undefined> {
  const hasWorkspace = Boolean(vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length)
  const picks: Array<vscode.QuickPickItem & { scope: MpeScope }> = [
    { label: '全局（~/.crossnote）', description: '对所有项目生效，推荐', scope: 'global' },
    { label: '当前工作区（.crossnote）', description: hasWorkspace ? '只对本仓库生效' : '需要先打开文件夹', scope: 'workspace' },
  ]
  const picked = await vscode.window.showQuickPick(picks, { title: '安装到哪里？', placeHolder: '选择 Markdown Preview Enhanced 配置目录' })
  return picked ? picked.scope : undefined
}

async function runInstall(context: vscode.ExtensionContext, scope?: MpeScope): Promise<void> {
  const target = scope || (await pickScope())
  if (!target) return
  try {
    const result = installMpeSupport(context, target)
    const switched = await enableExtendedTableSyntax()
    const notes = [`已写入 ${result.directory}`]
    if (result.parserBackup) notes.push(`原有 parser.js 已备份为 ${result.parserBackup}`)
    if (switched) notes.push('已开启 MPE 的「扩展表格语法」以支持单元格合并')
    const action = await vscode.window.showInformationMessage(
      'Markdown Preview Enhanced 静态兼容支持已安装：' + notes.join('；') + '。重新打开 MPE 预览即可生效。',
      '打开配置目录',
    )
    if (action === '打开配置目录') {
      await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(result.directory))
    }
  } catch (error) {
    void vscode.window.showErrorMessage('安装失败：' + String(error instanceof Error ? error.message : error))
  }
}

async function runUninstall(): Promise<void> {
  const target = await pickScope()
  if (!target) return
  try {
    const directory = uninstallMpeSupport(target)
    void vscode.window.showInformationMessage('已从 ' + directory + ' 移除本扩展写入的 MPE 支持。')
  } catch (error) {
    void vscode.window.showErrorMessage('移除失败：' + String(error instanceof Error ? error.message : error))
  }
}

async function copyConverted(target: MarkdownCopyTarget, label: string): Promise<void> {
  const editor = currentMarkdownEditor()
  if (!editor) return
  const selection = editor.selection
  const source = selection.isEmpty ? editor.document.getText() : editor.document.getText(selection)
  await vscode.env.clipboard.writeText(convertMarkdownForCopy(source, target))
  void vscode.window.showInformationMessage('已复制' + label + '到剪贴板。')
}

async function insertSnippet(snippet: vscode.SnippetString): Promise<void> {
  const editor = currentMarkdownEditor()
  if (!editor) return
  await editor.insertSnippet(snippet)
}

/**
 * 插入 LaTeX 符号（与博客站内编辑器 Shift + ↑ 的选择框同一份符号目录）：
 * QuickPick 可按命令或任意别名过滤（「正负」→ \pm、「异或」→ \oplus），
 * 选好后把符号插入光标处并按目录里登记的 cursor 把光标放到空参数里。
 */
async function insertLatexSymbol(): Promise<void> {
  const editor = currentMarkdownEditor()
  if (!editor) return
  interface SymbolPick extends vscode.QuickPickItem {
    symbol: LatexSymbol
  }
  const picks: SymbolPick[] = LATEX_SYMBOLS.map((symbol) => ({
    label: symbol.glyph ? `${symbol.glyph}  ${symbol.command}` : symbol.command,
    description: symbol.aliases.slice(0, 3).join(' · '),
    detail: `${latexCategoryName(symbol.category)} · ${symbol.aliases.join(' · ')}`,
    symbol,
  }))
  const picked = await vscode.window.showQuickPick(picks, {
    title: '插入 LaTeX 符号',
    placeHolder: '搜索命令或别名，如 pm、正负、异或、积分…',
    matchOnDescription: true,
    matchOnDetail: true,
  })
  if (!picked) return
  const { text, selectionStart, selectionEnd } = latexSymbolInsert(picked.symbol)
  const selection = editor.selection
  const startOffset = editor.document.offsetAt(selection.start)
  await editor.edit((builder) => builder.replace(selection, text))
  const cursorStart = editor.document.positionAt(startOffset + selectionStart)
  const cursorEnd = editor.document.positionAt(startOffset + selectionEnd)
  editor.selection = new vscode.Selection(cursorStart, cursorEnd)
}

async function insertCallout(): Promise<void> {
  const types = ['info', 'note', 'tip', 'success', 'warning', 'error', 'danger']
  const picked = await vscode.window.showQuickPick(types, { title: '折叠框类型' })
  if (!picked) return
  await insertSnippet(
    new vscode.SnippetString(
      ':::' + picked + '[${1:标题}]${2:{open\\}}\n$0\n:::\n',
    ),
  )
}

async function maybePromptForMpe(context: vscode.ExtensionContext): Promise<void> {
  if (!vscode.workspace.getConfiguration('starlog').get<boolean>('mpe.promptForSetup', false)) return
  if (!isMpeInstalled()) return
  if (installedParserVersion('global') || installedParserVersion('workspace')) return
  if (context.globalState.get<boolean>(STATE_PROMPTED)) return
  const action = await vscode.window.showInformationMessage(
    '检测到 Markdown Preview Enhanced。完整同款交互请使用内置 Markdown 预览；是否另外安装 MPE 静态兼容支持？',
    '安装（全局）',
    '以后再说',
    '不再提示',
  )
  if (action === '安装（全局）') await runInstall(context, 'global')
  if (action === '不再提示') await context.globalState.update(STATE_PROMPTED, true)
}

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('starlog.preview.enableGradientBackground')) {
        // 官方 Markdown 命令清理渲染缓存并刷新已打开的预览；无需重新加载窗口。
        void vscode.commands.executeCommand('markdown.api.reloadPlugins')
      }
    }),
    vscode.commands.registerCommand('starlog.setupMpe', () => runInstall(context)),
    vscode.commands.registerCommand('starlog.setupMpeGlobal', () => runInstall(context, 'global')),
    vscode.commands.registerCommand('starlog.setupMpeWorkspace', () => runInstall(context, 'workspace')),
    vscode.commands.registerCommand('starlog.removeMpe', () => runUninstall()),
    vscode.commands.registerCommand('starlog.copyAsLuogu', () => copyConverted('luogu', '洛谷源码')),
    vscode.commands.registerCommand('starlog.copyAsBasic', () => copyConverted('basic', '基本 Markdown 源码')),
    vscode.commands.registerCommand('starlog.insertShowBox', () =>
      insertSnippet(
        new vscode.SnippetString(
          '::show_begin{${1:标题}}{${2:a:Z=1[-5,5,1]}}\n$0\n::show_end\n',
        ),
      ),
    ),
    vscode.commands.registerCommand('starlog.insertCallout', () => insertCallout()),
    vscode.commands.registerCommand('starlog.insertLatexSymbol', () => insertLatexSymbol()),
    vscode.commands.registerCommand('starlog.insertTuackTable', () =>
      insertSnippet(
        new vscode.SnippetString(
          '::cute-table{tuack}\n\n| ${1:表头} | ${2:表头} |\n| :-: | :-: |\n| ${3:内容} | < |\n| ^ | ${4:内容} |\n$0\n',
        ),
      ),
    ),
    vscode.commands.registerCommand('starlog.openCheatsheet', async () => {
      const uri = vscode.Uri.joinPath(context.extensionUri, 'samples', 'syntax-demo.md')
      const document = await vscode.workspace.openTextDocument(uri)
      await vscode.window.showTextDocument(document, { preview: false })
      await vscode.commands.executeCommand('markdown.showPreviewToSide')
    }),
  )

  void maybePromptForMpe(context)

  return {
    extendMarkdownIt(md: any) {
      return extendMarkdownIt(md, (documentUri) => ({
        enableGradientBackground: vscode.workspace.getConfiguration(
          'starlog', documentUri ? vscode.Uri.parse(documentUri) : undefined,
        ).get<boolean>('preview.enableGradientBackground', false),
      }))
    },
    /** 方便其他扩展/脚本复用的转换函数。 */
    convertMarkdownForCopy,
    mpeExtensionId: MPE_EXTENSION_ID,
  }
}

export function deactivate() {
  /* 无需清理 */
}
