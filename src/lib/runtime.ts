/**
 * 运行环境判定：线上站点版 vs 离线单文件版。
 *
 * 离线版把整个站点（含全部内置文章、KaTeX 字体与代码高亮样式）打包进一个
 * `index.html`，由 `npm run build:offline` 生成，双击即可在 `file://` 下运行。
 *
 * 它与线上版的差异只有三条：
 *
 *   1. **不访问互联网**：`hasNetwork()` 恒为 `false`，`github.ts` 的请求出口在离线构建里
 *      直接抛错，端点字符串（api.github.com / Google Fonts / OAuth）经构建期常量替换后
 *      根本不会出现在产物中——`scripts/verify-offline.mjs` 会硬检查这一点。
 *      因此没有在线登录、在线评论、远端历史版本、PR 流程，也不请求云端字体与远程图片。
 *      唯一的主动连接能力是 issue #112 的局域网协作：用户交换连接码后才建立 WebRTC 点对点
 *      DataChannel，`iceServers` 为空，不经过互联网、STUN / TURN 或外部信令服务。
 *   2. **路由用 hash**：`file://` 下没有服务端 rewrite，History API 的路径不可用。
 *   3. **写作与阅读都在本机**：文章读写走 `offlineStorage`（IndexedDB，降级 localStorage），
 *      评论变成本机笔记，历史版本用本机快照。要把内容带到线上站点，用「导出文章包」→
 *      在线上站点「导入离线文章包」写入该站点的本地文章列表，再由站点自己的待更新队列提交。
 *
 * 本模块刻意不引用 React，方便被非 React 环境（VS Code 扩展的 esbuild 打包）间接引入。
 */

/** 是否为离线单文件版（构建时确定） */
export const OFFLINE: boolean =
  typeof __STARLOG_OFFLINE__ !== 'undefined' && __STARLOG_OFFLINE__ === true

/**
 * 是否可以使用依赖互联网的在线能力。
 *
 * 离线版的在线功能按设计**不访问互联网**，所以即使设备其实连着网也返回 `false`：
 * 这样所有「先判断再请求」的路径（字体、账号偏好、评论、历史版本）都会直接走本机实现，
 * 而不是先试一下再失败。真正的请求出口另有硬拦截（见 `github.ts` 的 `net()`）。
 */
export function hasNetwork(): boolean {
  if (OFFLINE) return false
  if (typeof navigator === 'undefined') return true
  return navigator.onLine !== false
}

/** 离线版里禁止联网的统一说明文案（错误提示与界面提示共用，措辞保持一致） */
export const OFFLINE_NO_NETWORK_HINT = '离线版不会访问互联网'

/**
 * 解析离线版中的图片地址。
 *
 * 离线文件没有站点服务器：站内绝对路径（`/uploads/x.png`）会指向 `file:///uploads/…` 必然失败，
 * 远程地址（`https://…`）则意味着联网。两者都返回空串，由渲染处显示「图片未随离线文件提供」，
 * 而不是留下一个注定失败或偷偷联网的请求。本机暂存过的图片（编辑器里插入的）在调用本函数之前
 * 就已经被 `updateQueue.resolvePendingImageSrc` 换成了 data URI，`data:` / `blob:` 原样通过。
 */
export function resolveOfflineImageSrc(src: string): string {
  if (!OFFLINE || !src) return src
  if (/^(data:|blob:)/i.test(src)) return src
  return ''
}

/** 离线版的站名后缀，用于 <title> 与页头徽标 */
export const OFFLINE_BADGE = '离线版'
