/**
 * 运行环境判定：线上站点版 vs 离线单文件版。
 *
 * 离线版把整个站点（含全部内置文章、KaTeX 字体与代码高亮样式）打包进一个
 * `index.html`，由 `npm run build:offline` 生成，双击即可在 `file://` 下运行。
 * 它在线上版的基础上做了三件事：
 *
 *   1. 路由改用 hash（`file://` 下 History API 的路径不可用）；
 *   2. 「发布」写入本机离线文章库（IndexedDB，回退 localStorage），而不是 GitHub 待更新队列；
 *   3. 所有依赖网络的能力（评论、账号偏好同步、Git 历史版本、云端字体）自动降级为本机实现，
 *      联网时仍可用「同步到线上」把全部离线文章导入线上站点的本地文章列表。
 *
 * 本模块刻意不引用 React，方便被非 React 环境（VS Code 扩展的 esbuild 打包）间接引入。
 */
import { offlineConfig } from './config'
import { readPersonalSetting } from './settingsStore'

/** 是否为离线单文件版（构建时确定） */
export const OFFLINE: boolean =
  typeof __STARLOG_OFFLINE__ !== 'undefined' && __STARLOG_OFFLINE__ === true

/** 浏览器是否报告在线（`navigator.onLine` 缺失时按在线处理，让请求自己失败） */
export function hasNetwork(): boolean {
  if (typeof navigator === 'undefined') return true
  return navigator.onLine !== false
}

/** 离线版里线上站点的基础地址：站内绝对路径（`/uploads/x.png`）与「同步到线上」都以此为准 */
export function getSiteBaseUrl(): string {
  const stored = readPersonalSetting<string>('offlineSiteBase')
  const candidate = (typeof stored === 'string' && stored.trim()) || offlineConfig.assetBaseUrl
  if (!candidate) return ''
  return candidate.replace(/\/+$/, '')
}

/**
 * 解析文章 / 封面里的图片地址。
 *
 * 离线版没有站点服务器，`/uploads/xxx.png` 这类站内绝对路径会指向 `file:///uploads/…`
 * 而必然加载失败；因此把这类路径改写到「线上站点地址」（默认值见 `offlineConfig`，
 * 可在「设置 → 离线版」中修改）。联网时图片照常显示，data: 与外链地址原样返回。
 */
export function resolveOfflineImageSrc(src: string): string {
  if (!OFFLINE || !src) return src
  if (/^(https?:|data:|blob:)/i.test(src)) return src
  const base = getSiteBaseUrl()
  if (!base) return src
  return `${base}/${src.replace(/^\/+/, '')}`
}

/**
 * 离线版做 Device Flow 授权时的 OAuth 中转地址。
 *
 * 线上站点留空即可（同源走 Pages Function）；`file://` 下「同源」不成立，
 * 必须指向一个带 CORS 头的中转（默认取 `offlineConfig.oauthRelayUrl`，可在站内覆盖）。
 */
export function getOAuthRelayUrl(): string {
  if (!OFFLINE) return ''
  const stored = readPersonalSetting<string>('offlineOAuthRelayUrl')
  return (typeof stored === 'string' && stored.trim()) || offlineConfig.oauthRelayUrl
}

/** 离线版的站名后缀，用于 <title> 与页头徽标 */
export const OFFLINE_BADGE = '离线版'
