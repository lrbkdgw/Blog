# 离线版（单文件）— 自动生成目录

这里的 `index.html` 是**整个博客的离线版**：一个自包含的 HTML 文件，双击就能用，
不需要服务器、不需要联网（同步功能除外）。

> ⚠️ **不要手工编辑 `index.html`，也不要在这里加别的文件。**
> 它由 `.github/workflows/offline.yml` 在每次相关改动后覆盖提交；手工改的内容会在下一次构建时消失。

## 下载 / 使用

- 从这个仓库的 Releases（tag `offline`）下载 `starlog-offline-latest.html`；
- 或直接把本目录的 `index.html` 拷到本地（U 盘、网盘、邮件附件都行）；
- 用 Chrome / Edge / Firefox 正常窗口打开。文件名随意，`file://` 下即用。

打开后顶部会显示「离线版」徽标；有未同步的文章时徽标上会带待同步数量。

## 本地重新构建

```bash
npm ci
npm run build:offline     # vite build --config vite.offline.config.ts && node scripts/verify-offline.mjs
# 产物：dist-offline/index.html
cp dist-offline/index.html offline/index.html
```

自检脚本（`scripts/verify-offline.mjs`）会硬检查这些容易「静默坏掉」的问题：

- 产物目录里是否只有一个 HTML（多出来的文件离线打开必然 404）；
- 是否残留指向文件的相对引用、是否还有 `type="module"`（`file://` 下会被 CORS 拦死）；
- 内联脚本能否被 JS 引擎真正解析（历史上 `String.replace` 的 `$&` 替换模式破坏过产物）；
- KaTeX 样式/字体、highlight.js 配色是否都在文件内；
- `content/posts/` 里每一篇文章是否都进了这个文件。

## 相关实现

| 位置 | 作用 |
| --- | --- |
| `vite.offline.config.ts` | 离线构建入口（`__STARLOG_OFFLINE__ = true`、base `./`、iife、关闭 public 拷贝） |
| `scripts/vite-plugin-single-html.mjs` | 把 JS/CSS/图标/字体全部内联成一个文件，并在构建期断言结果 |
| `src/lib/runtime.ts` | `OFFLINE` 判定、网络可用性、站点地址与 OAuth 中转地址 |
| `src/lib/offlineStorage.ts` | IndexedDB ↔ localStorage 两级本机存储 + 写镜像 + 落盘确认 |
| `src/lib/offlineLibrary.ts` | 内置文章、墓碑删除、本机版本历史 |
| `src/lib/offlineSync.ts` | 「同步到线上」的计划与执行（复用待更新队列批量提交） |
| `src/components/OfflineSyncPanel.tsx` | 管理页 `?tab=sync` 的同步面板 |
| `src/components/StorageGuard.tsx` | 存储不可用时拦住页面，绝不假装保存成功 |

功能范围与限制见仓库根目录 README 的「📴 离线版」一节。
