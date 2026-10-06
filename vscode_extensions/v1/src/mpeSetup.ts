/**
 * 与 Markdown Preview Enhanced（MPE）的集成。
 *
 * MPE 不会加载其他扩展注册的 markdown-it 插件，但它支持「扩展解析器」：
 * 读取 `~/.crossnote/parser.js`（全局）或工作区 `.crossnote/parser.js`，
 * 在解析前后调用其中的钩子；同时读取同目录下的 `style.less` 作为预览样式。
 *
 * 这里把扩展自带的 `resources/mpe/parser.js` 与 `resources/mpe/style.less`
 * 安装到对应目录：parser.js 整体托管（覆盖前自动备份），style.less 则只
 * 替换我们自己的标记区块，用户已有的样式会原样保留。
 */

import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import * as vscode from 'vscode'

export const MPE_EXTENSION_ID = 'shd101wyy.markdown-preview-enhanced'

const BEGIN_MARK = '/* ===== starlog-markdown:begin ===== */'
const END_MARK = '/* ===== starlog-markdown:end ===== */'
const PARSER_MARK = 'starlog-markdown:parser'

export type MpeScope = 'global' | 'workspace'

export function crossnoteDirectory(scope: MpeScope): string | undefined {
  if (scope === 'global') return path.join(os.homedir(), '.crossnote')
  const folder = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0]
  if (!folder || folder.uri.scheme !== 'file') return undefined
  return path.join(folder.uri.fsPath, '.crossnote')
}

function readIfExists(file: string): string | undefined {
  try {
    return fs.readFileSync(file, 'utf8')
  } catch {
    return undefined
  }
}

function mergeStyle(existing: string | undefined, block: string): string {
  const wrapped = BEGIN_MARK + '\n' + block.trim() + '\n' + END_MARK + '\n'
  if (!existing || existing.indexOf(BEGIN_MARK) < 0) {
    return (existing ? existing.replace(/\s+$/, '') + '\n\n' : '') + wrapped
  }
  const start = existing.indexOf(BEGIN_MARK)
  const end = existing.indexOf(END_MARK)
  if (end < start) return existing.replace(/\s+$/, '') + '\n\n' + wrapped
  return existing.slice(0, start) + wrapped + existing.slice(end + END_MARK.length).replace(/^\n/, '')
}

export interface InstallResult {
  directory: string
  parserBackup?: string
  styleMerged: boolean
}

export function installMpeSupport(context: vscode.ExtensionContext, scope: MpeScope): InstallResult {
  const directory = crossnoteDirectory(scope)
  if (!directory) throw new Error('当前没有打开本地工作区文件夹，无法安装工作区级 MPE 支持。')

  const parserSource = path.join(context.extensionPath, 'resources', 'mpe', 'parser.js')
  const styleSource = path.join(context.extensionPath, 'resources', 'mpe', 'style.less')
  const parser = fs.readFileSync(parserSource, 'utf8')
  const style = fs.readFileSync(styleSource, 'utf8')

  fs.mkdirSync(directory, { recursive: true })

  const parserTarget = path.join(directory, 'parser.js')
  const existingParser = readIfExists(parserTarget)
  let parserBackup: string | undefined
  if (existingParser !== undefined && existingParser.indexOf(PARSER_MARK) < 0 && existingParser.trim()) {
    parserBackup = parserTarget + '.bak-' + Date.now()
    fs.writeFileSync(parserBackup, existingParser, 'utf8')
  }
  fs.writeFileSync(parserTarget, parser, 'utf8')

  const styleTarget = path.join(directory, 'style.less')
  const existingStyle = readIfExists(styleTarget)
  fs.writeFileSync(styleTarget, mergeStyle(existingStyle, style), 'utf8')

  return { directory, parserBackup, styleMerged: existingStyle !== undefined }
}

export function uninstallMpeSupport(scope: MpeScope): string {
  const directory = crossnoteDirectory(scope)
  if (!directory) throw new Error('当前没有打开本地工作区文件夹。')

  const parserTarget = path.join(directory, 'parser.js')
  const existingParser = readIfExists(parserTarget)
  if (existingParser !== undefined && existingParser.indexOf(PARSER_MARK) >= 0) {
    fs.unlinkSync(parserTarget)
  }

  const styleTarget = path.join(directory, 'style.less')
  const existingStyle = readIfExists(styleTarget)
  if (existingStyle && existingStyle.indexOf(BEGIN_MARK) >= 0) {
    const start = existingStyle.indexOf(BEGIN_MARK)
    const end = existingStyle.indexOf(END_MARK)
    const cleaned =
      end >= start
        ? existingStyle.slice(0, start) + existingStyle.slice(end + END_MARK.length).replace(/^\n/, '')
        : existingStyle
    fs.writeFileSync(styleTarget, cleaned.replace(/^\s+/, ''), 'utf8')
  }

  return directory
}

/** 已安装的 parser.js 是否就是当前版本。 */
export function installedParserVersion(scope: MpeScope): string | undefined {
  const directory = crossnoteDirectory(scope)
  if (!directory) return undefined
  const content = readIfExists(path.join(directory, 'parser.js'))
  if (!content || content.indexOf(PARSER_MARK) < 0) return undefined
  const match = content.match(/starlog-markdown:parser\s+v([0-9a-zA-Z.\-]+)/)
  return match ? match[1] : 'unknown'
}

export function isMpeInstalled(): boolean {
  return Boolean(vscode.extensions.getExtension(MPE_EXTENSION_ID))
}

/**
 * Blog 的 `<`（向左合并）在 MPE 里依赖「扩展表格语法」才能生成 colspan，
 * 安装时顺手把这个开关打开。
 */
export async function enableExtendedTableSyntax(): Promise<boolean> {
  const configuration = vscode.workspace.getConfiguration('markdown-preview-enhanced')
  if (configuration.get<boolean>('enableExtendedTableSyntax')) return false
  await configuration.update('enableExtendedTableSyntax', true, vscode.ConfigurationTarget.Global)
  return true
}
