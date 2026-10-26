# 离线版（单文件）— 自动生成目录

这里的 `index.html` 是**整个博客的离线版**：一个自包含的 HTML 文件，双击就能用，
不需要服务器、不需要联网（同步功能除外）。

> ⚠️ **不要手工编辑 `index.html`，也不要在这里加别的文件。**
> 它由 `.github/workflows/offline.yml` 在每次相关改动后覆盖提交；手工改的内容会在下一次构建时消失。

## 下载 / 使用

- 从这个仓库的 Releases（tag `offline`）下载 `starlog-offline-latest.html`；
- 或访问线上站点的 `<站点地址>/offline/index.html` 直接下载；
- 或把本目录的 `index.html` 拷到本地（U 盘、网盘、邮件附件都行）。

用 Chrome / Edge / Firefox 正常窗口打开即可（`file://`，无需服务器）。普通阅读和写作不会访问互联网：
没有在线登录，不请求云端字体，也不加载远程图片。只有用户在编辑器中主动点「局域网协作」时，
才会用不经过 STUN/TURN 服务的 WebRTC 在同一局域网内与另一台设备直连。

打开后顶部有「离线版」徽标，进入「管理 → 离线文章包」可导出文章包给线上站点，或导入别的设备导出的包。

## 内容如何带到线上站点

```
本文件「导出文章包」 → *.starlog-import.json → 线上站点「管理 → 离线文章包 → 导入」
                      → 站点本地文章列表 → 待更新队列统一更新 → 一次 commit + 部署
```

编辑器里也有单篇捷径：「保存到在线网站的本地文章」= 先写入本机文章库（等落盘确认），
再为这一篇生成导入包。

## 局域网协作（点对点）

1. 两台设备都在同一个局域网中，分别用支持 WebRTC 的 Chrome、Edge 或 Firefox 打开离线文件。
2. 发起方打开编辑器，点标题栏的「局域网协作」图标，再选「发起协作」；把生成的连接码通过可信任的方式发给对方。
3. 对方在自己的编辑器中选「加入协作」，粘贴连接码并生成应答码，再把应答码发回发起方。
4. 发起方粘贴应答码并连接。连接成功后标题和正文会实时合并同步；加入方当前打开的文档会切换为发起方的文档。

连接码包含本次直连所需的局域网网络信息，只发给可信任的人。协作只支持两台设备一对一，
采用浏览器 WebRTC DataChannel + CRDT；不使用互联网信令、STUN/TURN 中继或服务端。
断开后双方仍可继续编辑各自的本机副本；需要保留更改时请分别保存到本机文章库。

## 本地重新构建

```bash
npm ci
npm run build:offline     # vite build --config vite.offline.config.ts && node scripts/verify-offline.mjs
# 产物：dist-offline/index.html
cp dist-offline/index.html offline/index.html
```

自检脚本（`scripts/verify-offline.mjs`）会硬检查这些容易「静默坏掉」的问题：

- 产物目录里是否只有一个 HTML（多出来的文件离线打开必然 404）；
- 是否残留指向文件的相对引用、是否还有 `type="module"`（`file://` 下模块脚本被 CORS 拦死）；
- 内联脚本能否被 JS 引擎真正解析（历史上 `String.replace` 的 `$&` 替换模式破坏过产物）；
- KaTeX 样式/字体、highlight.js 配色是否都在文件内；
- `content/posts/` 里每一篇文章是否都进了这个文件；
- **产物里是否混进了在线端点**：`api.github.com`、`/graphql`、`login/device/code`、
  `login/oauth/access_token`、`fonts.googleapis.com`、`fonts.gstatic.com`、OAuth Client ID——
  出现任意一个就说明某处在线能力没被离线开关切断，构建失败。

## 相关实现

| 位置 | 作用 |
| --- | --- |
| `vite.offline.config.ts` | 离线构建入口（`__STARLOG_OFFLINE__ = true`、base `./`、iife、关闭 public 拷贝） |
| `scripts/vite-plugin-single-html.mjs` | 把 JS/CSS/图标/字体全部内联成一个文件，并在构建期断言结果 |
| `src/lib/runtime.ts` | `OFFLINE` 判定、网络可用性、站点地址与 OAuth 中转地址 |
| `src/lib/offlineStorage.ts` | IndexedDB ↔ localStorage 两级本机存储 + 写镜像 + 落盘确认 |
| `src/lib/offlineLibrary.ts` | 内置文章、墓碑删除、本机版本历史 |
| `src/lib/offlineBundle.ts` | 文章包的收集 / 解析 / 计划 / 导入（离线版与站点之间唯一的搬运通道） |
| `src/components/OfflineExportPanel.tsx` | 离线版「管理 → 离线文章包」：勾选并导出、查看本机内容 |
| `src/components/BundleImportDialog.tsx` | 「导入离线文章包」对话框（线上站点与离线版本都用它） |
| `src/components/StorageGuard.tsx` | 存储不可用时拦住页面，绝不假装保存成功 |
| `src/components/LanCollaboration.tsx` | 显式启用的 WebRTC 点对点局域网协作（手动交换连接码） |

功能范围与限制见仓库根目录 README 的「📴 离线版」一节。
