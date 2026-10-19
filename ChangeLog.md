# 更新日志 · ChangeLog

## 2026-10-19 · 修复 issue #70 / #71：LaTeX 符号插入不再跳到文末、页头上划后渐变让位

| 模型信息 | |
| --- | --- |
| 模型名称 | Arena.ai Agent Mode（平台多模型动态调度，包括但不限于 Claude、ChatGPT、Gemini、Grok、Qwen、Kimi 等） |
| 模型版本号 | 未公开（由 Arena.ai 平台调度，不提供具体底层模型版本） |
| 知识库截止时间 | 未公开（依所调度的底层模型而定，平台未公开统一口径） |

### 背景

仓库里两个未填正文的 issue：

- **#70**「使用搜索 LaTeX 功能后会异常跳转到文章末尾。」
- **#71**「任意界面上划到顶部后就应消失，避免挡住页面选择栏。」（与提出者确认后明确为：
  正文上划穿过含「首页 / 归档」等按钮的那一条页头之后，页头自己渐变消失，不要挡住视野）

#70 的成因不在符号选择框，而在「改完受控 textarea 的 value 之后怎么把光标放回去」：
React 把新 `value` 写回 `<textarea>` 时，浏览器按规范把光标挪到**文本末尾**（只有元素处于
聚焦态时 React 才会代为保存 / 恢复选区）。而工具栏与符号选择框的旧写法是
`ta.focus()` 再 `ta.setSelectionRange(...)`——`focus()` 为了「把光标滚进视野」，
会先把整页拽到文末，随后 `setSelectionRange` 只是把光标挪回去，页面却停在底部。
评论输入框里的 LaTeX 插入是同一套写法，因此一并修。

### 新增

- `src/lib/caret.ts`：两个小工具，把上面这条顺序固定下来，避免各处再各写一遍。
  - `focusWithoutScroll(el)`：`el.focus({ preventScroll: true })`，老浏览器不认识该选项时
    `try/catch` 退回普通 `focus()`；
  - `restoreCaret(ta, start, end)`：先 `setSelectionRange`（并夹紧到 `[0, value.length]`，
    防止长度已变时传入越界偏移）再以 `preventScroll` 聚焦，最后比对前后 `window.scrollX/Y`，
    若这两步把页面滚走了就用 `behavior:'instant'` 还原——textarea 自身滚动保留，光标仍在视野内。

### 调整

- `src/pages/Editor.tsx`：`applyAction()`（工具栏加粗 / 斜体 / 链接 / 代码块 / 数学公式 /
  交互展示框与 LaTeX 符号插入的共同出口）改为 `restoreCaret(...)`；符号选择框 `onClose` 里的
  `requestAnimationFrame(() => ta.focus())` 改为 `focusWithoutScroll(ta)`。
- `src/components/Comments.tsx`：评论框的 `insertLatexSymbol` / 选择框 `onClose` 同样处理。
- `src/components/Layout.tsx`：页头改为滚动驱动自动隐藏——`headerRef.current.offsetHeight || 64`
  之上再留 16px 作为隐藏阈值，恢复阈值比它低 32px 形成迟滞（惯性滚动与滚轮微抖不会来回闪），
  `offsetHeight` 用 `||` 而非 `??` 是为了在布局不可用（打印、隐藏容器、单测环境）时阈值不塌成 0
  而把页头永久藏起来。隐藏态为 `pointer-events-none -translate-y-full opacity-0` +
  `transition-[transform,opacity] duration-300`，并有 `motion-reduce:transition-none`；
  同时给 `<header>` 加 `inert={hidden}`，避免焦点 Tab 进看不见的导航。
  判据只看滚动位置、不看滚动方向（避免阅读途中忽然多出一条横杠），移动端菜单展开时不隐藏，
  监听用 `requestAnimationFrame` 合帧。搜索弹层自带 `body` 滚动锁，不受影响。

### 修复

- #70 使用 LaTeX 符号选择框（以及所有工具栏插入操作）后页面被滚到文末。
- #71 页头在正文滚过之后仍然占住顶部一条视野。

### 验证

- `npx tsc --noEmit`（站点）与插件 `tsc --noEmit` 均无错误；`npm run build` 通过。
- `npm run build:offline` 自检通过（3.01 MB，10/10 内置文章），`offline/index.html` 已同步重建。
- jsdom 行为回归（针对离线产物，与线上同一套代码）10 项全绿：
  页头在顶部可见 → 滚到 500px 消失且 `inert` + `pointer-events-none` 且有过渡类 → 60px 处
  因迟滞保持隐藏 → 回 0 恢复 → 75px（阈值 80 之内）不误隐；
  编辑器内先输入 400 字并把光标放到 100，再用工具栏打开符号框搜 `pm` 回车 →
  `\pm` 恰好插在 100、光标停在 103、调用序列为 `setSelectionRange → focus({preventScroll:true})`、
  全程没有 `window.scrollTo`。
- `npm run extension:test`：61 通过 / 0 失败 / 4 跳过（插件 `out/` 重新构建后与提交内容一致）。


## 2026-10-19 · 离线版改为「完全不联网」：只用本机字体，移除全部在线功能

| 模型信息 | |
| --- | --- |
| 模型名称 | Arena.ai Agent Mode（平台多模型动态调度，包括但不限于 Claude、ChatGPT、Gemini、Grok、Qwen、Kimi 等） |
| 模型版本号 | 未公开（由 Arena.ai 平台调度，不提供具体底层模型版本） |
| 知识库截止时间 | 未公开（依所调度的底层模型而定，平台未公开统一口径） |

### 背景

上一版离线文件里仍保留着若干在线能力：GitHub Device Flow 授权、「同步到线上」直推仓库、
云端字体预热、把站内图片改写成线上站点地址。本次按要求收敛为：

> 本地版本只能使用本地字体，去掉所有在线功能；**完全不联网**，只提供「保存到本地」和
> 「保存到在线网站的本地文章中」两种落地方式。

于是离线版的定位变成：一个自包含的阅读器 + 编辑器，零网络请求；
与线上站点之间只通过**文章包文件**交接，不在离线文件里提交仓库。

### 新增

- `hasNetwork()` 在离线构建里恒为 `false`：所有「先判断再请求」的路径（字体、账号偏好、评论、
  远端历史）直接走本机实现，不会「先试一下再失败」。
- `github.ts` 增加**唯一请求出口** `net()`：离线构建里抛错说明原因；同时把端点常量改为
  `OFFLINE ? '' : 'https://api.github.com'`（含 `/graphql`），`oauthConfig.clientId` 与
  Google Fonts 端点同样在离线构建里置空 —— 压缩器会把它们整段消掉，产物中根本不存在这些字符串。
- `src/lib/offlineBundle.ts`：`countLocalContent()`（本机文章 / 草稿 / 暂存图片统计）与
  `exportBundleFile(slugs?)`（导出单篇或全部本机文章的文章包）；`applyImport()` 新增 `alsoQueue`，
  线上站点导入时可顺带把每篇加入待更新队列（离线版忽略该参数）。
- 新组件 `src/components/BundleImportDialog.tsx`：拖拽 / 选择文章包 → 逐篇「新增 / 覆盖 / 跳过」计划
  （三种同名策略：覆盖 / 跳过 / 另存为新文章）→ 确认后写入本地文章列表；解析失败明确报错，不猜格式。
- 新组件 `src/components/OfflineExportPanel.tsx`（管理页 `?tab=export`，两种构建都可见）：
  离线版用它勾选并导出，线上站点用它导入；不再显示任何授权入口。
- 编辑器离线模式提供两个出口：「保存到本机」（写本机文章库）与
  「保存到在线网站的本地文章」（先写本机文章库并确认落盘，再生成这一篇的文章包文件）。
- `scripts/verify-offline.mjs` 新增第 8 组硬检查：产物中出现 `api.github.com`、`/graphql`、
  `login/device/code`、`login/oauth/access_token`、`fonts.googleapis.com`、`fonts.gstatic.com`
  或 OAuth Client ID 任意一项即构建失败，并在报错里给出两种正确修法。

### 调整

- **删除** `src/lib/offlineSync.ts`、`src/components/OfflineSyncPanel.tsx`、`src/lib/useOnlineStatus.ts`：
  离线版不再有「同步到线上」这条需要网络的通道。
- 回退上一轮为「离线 Device Flow」改动的站点侧代码：`functions/login/[[path]].ts` 与
  `oauth-relay/worker.js` 恢复到改动前的状态（离线版不再调用它们，未部署的中继留在仓库里只会误导）；
  `src/lib/config.ts` 的 `relayUrl` 注释改为「站点默认不带轮询中继，需要时由部署者自行准备」。
- `src/lib/runtime.ts` 重写：移除 `getSiteBaseUrl()` / `getOAuthRelayUrl()`；
  `resolveOfflineImageSrc()` 改为「远程与站内图片一律解析为空」，由渲染处显示
  「离线版不加载远程图片」说明（`Markdown.tsx` 的 `img`、`PostCard` / `PostPage` 的封面），
  不再把图片地址改写到线上站点。
- 离线版 UI 去掉全部在线入口：页头 `UserMenu`（登录 / 头像 / 退出）在 `OFFLINE` 下不渲染，
  移动端菜单改为「管理 / 写文章」；`/login` 在离线版显示「离线版没有在线登录」说明页而非授权按钮；
  设置页的「GitHub 连接」「目标仓库」「外观偏好同步」三块在离线版隐藏，安全说明改为离线口径；
  管理页页头的「未连接 GitHub，点此连接」改为「内容保存在这台设备的浏览器里」，
  队列标签在离线版隐藏「更新所选 / 全部更新」按钮并说明图片随文章包导出；
  页脚在离线版不再输出 GitHub / RSS 外链，署名行改为「离线单文件版（不联网）」。
- 字体：`requestCloudFont()` 在离线版直接抛错（消息说明「只用本机已安装的字体」），
  `warmFontFamilies()` 在离线版只为**本机缺失**的字体名打一条 info 日志；
  设置页字体 / 背景 / 个性化三处说明文案按离线口径改写。
- 内置文章的「删除」语义简化：删除 `deletedSeedSlugs / recordSeedDeletion / clearSeedDeletion /
  resetSeedDeletions` 与 `starlog:offline-deleted`（这套状态只为「提交删除到仓库」而存在），
  只保留本机墓碑 `hideSeedPost` 与新的 `resetSeedHidden()`；`getRepoPosts()` 仅按墓碑过滤。
  `updateQueue.flushUpdateQueue()` 相应删除离线分支（离线版走不到），
  `post-publish` 成功后的「本地草稿与仓库一致则清除」恢复为仅线上行为。
- 措辞与文档：README「📴 离线版」整节重写（支持范围表、文章包三步交接流程图、图片与字体策略、
  自检端点检查）、`offline/README.md`、`.github/offline-release-notes.md`、
  站内帮助页「离线版（单文件）」小节、`AI_README.md` 第 3 步补「不得在 `OFFLINE` 分支引入请求，
  端点检查失败要改代码而不是删检查」（本条即规则修改的登记）。

### 修复

- `PostCard` 的封面离线守卫最初被当成文本插入 JSX 子节点（渲染出字面量且 `OFFLINE` 未被引用），
  改为在组件内先算 `coverSrc` 再条件渲染整个封面链接；`PostPage` 同类问题用局部变量消除
  `article.cover` 的可空类型歧义。
- 离线版管理页与设置页仍残留「同步到线上 / 连接 GitHub」入口与文案（共 6 处），逐一按新语义改写，
  避免指向已删除的 `?tab=sync` 标签。

### 修复

- CI `extension.yml`（check 名 `verify`）在 `npm --prefix vscode_extensions/v1 run typecheck`
  报 `TS2304: Cannot find name '__STARLOG_OFFLINE__'`（`src/lib/runtime.ts` 两处）：插件 tsconfig 的
  `include` 只有自己的 `src`，却顺着 import 复用了站点 `src/lib`，拿不到 `src/offline-globals.d.ts`
  里的全局声明。改为在 `vscode_extensions/v1/tsconfig.json` 的 `include` 中显式带上该声明文件，
  并把 `src/offline-globals.d.ts` 注释里写错的文件名（`vite.config.offline.ts` → `vite.offline.config.ts`）改正。
  根因是本地验证矩阵漏了这一步：`npm run extension:test` 只做 build + `node --test`，不跑 tsc；
  已在 `AI_README.md`「建议的更新流程」第 3 步补上这条红线。

### 验证

- `npx tsc --noEmit` 与 `npm --prefix vscode_extensions/v1 run typecheck` 均无错误；
  `npm run build`（线上版）通过。
- `npm run build:offline` 通过：产物 3.01 MB，内联 CSS 1.49 MB / 内联 JS 1.50 MB / `@font-face` 20 条 /
  10 篇内置文章齐全；第 8 组端点检查全绿（先失败过一次——`/graphql` 字面量残留，补上 `GRAPHQL` 常量后置空后通过）。
- 用 jsdom 以 `file://` 加载产物，并把 `fetch` / `WebSocket` / `EventSource` 全部插桩计数：
  首页 → 文章页 → 管理页 → `?tab=export` → 编辑器 → 登录页 → 设置页全程**出网调用 0 次**；
  未注入任何云端字体 `<style>`；登录页显示离线说明、设置页三块在线卡片缺席、
  编辑器出现两个保存出口、导出按钮空列表时给出「本机还没有写过的文章可导出」而非静默。
- 在 jsdom 里对**离线产物**做了文章包往返实测：预置一篇本机文章 → 「导出全部本机文章」捕获 Blob
  并解析出 `starlog-offline-bundle v1 / 1 篇`（正文含 `$` 与 `</script>` 等风险字符仍完整）→
  在「导入离线文章包」对话框里选择同一文件 → 切到「另存为新文章」导入 →
  本机文章库出现 `roundtrip-demo-imported-20261019`，全程出网调用仍为 0 次。
- `npm run extension:test`：61 通过 / 0 失败 / 4 跳过（未改插件代码）。


## 2026-10-19 · 离线单文件版：断网可用、写作可用、联网后一键同步回线上站点

| 模型信息 | |
| --- | --- |
| 模型名称 | Arena.ai Agent Mode（平台多模型动态调度，包括但不限于 Claude、ChatGPT、Gemini、Grok、Qwen、Kimi 等） |
| 模型版本号 | 未公开（由 Arena.ai 平台调度，不提供具体底层模型版本） |
| 知识库截止时间 | 未公开（依所调度的底层模型而定，平台未公开统一口径） |

### 背景

需求：推出本站点的**离线版本**，结构为单个 HTML 文件，支持除「必须联网」以外的全部功能；
联网后可以把离线期间写的所有文章**一键导入**线上站点
（`blog-apa.pages.dev` 或 `lrbkdgw.github.io/Blog`）的文章列表。

两条设计约束在实现过程中被明确固化下来：

1. **同步不新建通道**——复用站点原有的 GitHub Device Flow 授权与「待更新队列」批量提交，
   不引入 postMessage 中转页、不写第二套上传逻辑；
2. **任何降级都不静默**——存储不可用、资源无法内联、文章没进包，一律变成可见错误或直接构建失败，
   绝不允许「提示保存成功但其实没存」。

### 新增

- **运行时开关与站点感知**：`src/lib/runtime.ts` 提供 `OFFLINE`（由构建期 `__STARLOG_OFFLINE__` 决定）、
  `hasNetwork()`、`getSiteBaseUrl()`、`resolveOfflineImageSrc()`、`getOAuthRelayUrl()`；
  线上构建在 `vite.config.ts` 里固定 `__STARLOG_OFFLINE__ = 'false'`，两版共用一套源码。
- **两级本机存储**：`src/lib/offlineStorage.ts` 用 IndexedDB（库 `starlog-offline`）为主、
  `localStorage` 为冗余与降级后端，`window.localStorage` 被替换为「内存镜像 + 写回」的 shim，
  使既有同步读写代码无需改语义；写操作 200ms 去抖，关键路径必须 `await flushStorage()`；
  两级都不可用时后端判为 `none` 并拒绝一切写入。
- **存储护栏**：`src/components/StorageGuard.tsx`（离线专用，包在 App 外层）——
  `backend === 'none'` 时整页拦住并给出可执行解决办法（含「下载当前内容」）；
  有错误或未落盘改动时显示顶部横幅，并每 4s 尝试确认落盘。
- **离线文章库**：`src/lib/offlineLibrary.ts`（墓碑删除 / 已提交删除记录 / 本机版本快照）、
  `src/lib/postHistory.ts`（版本列表与正文读取，区分「仓库版本」与「本机版本」）、
  `src/lib/posts.ts` 的 `saveLocalPostRaw / localPostExists / postFingerprint / serializePost` 等；
  `content/posts/*.md` 在构建时通过 `import.meta.glob(..., { query: '?raw' })` 打进文件。
- **同步到线上**：`src/lib/offlineSync.ts`（`planOfflineSync / stageOfflineSync / runOfflineSync`）
  把选中的离线文章（含暂存图片）写进**既有**待更新队列，再调用 `flushUpdateQueue()` 一次提交；
  成功后记录内容指纹，内置文章的「删除墓碑」转换为已提交删除记录，避免墓碑累积。
  面板为 `src/components/OfflineSyncPanel.tsx`，挂在管理页 `?tab=sync`；
  页头新增「离线版」徽标（`Layout.tsx` 的 `OfflineBadge`，带待同步数量，移动端菜单同项）。
- **离线设置**：`src/components/OfflineSettingsCard.tsx`（设置页离线板块）——存储后端与占用、
  线上站点地址与 OAuth 中转地址覆盖、导出 / 导入离线档案、导出文章包、立即落盘。
- **单文件构建**：`vite.offline.config.ts`（`base: './'`、iife + `inlineDynamicImports`、
  `assetsInlineLimit` 设为极大值、关闭 `copyPublicDir` 与 modulepreload）
  + 自研插件 `scripts/vite-plugin-single-html.mjs`：把 JS / CSS / `public/` 图标全部内联，
  漏网的资源转成 data URI 并回写引用，移除 manifest / preconnect / modulepreload 链接。
- **构建后自检**：`scripts/verify-offline.mjs` 硬检查——产物目录只有一个 HTML、无残留相对引用、
  无 `type="module"`、内联脚本能被 JS 引擎解析、CSS 含 `.katex` / `hljs-` / `@font-face` 且 `url()` 全部内联、
  `content/posts/` 每篇文章都在文件里；体积超过 48 MB 直接失败，> 25 MB 提示。
  脚本入口：`npm run build:offline`、`npm run verify:offline`、`npm run preview:offline`。
- **发布链路**：`.github/workflows/offline.yml`——构建 → 自检 → 把产物提交回 `offline/index.html`
  （提交信息带 `[skip ci]`，避免与 Pages 部署互相触发）→ 更新滚动 Release（tag `offline`）→ 附 artifact；
  `deploy.yml` 在站点构建前把 `offline/index.html` 放进 `public/offline/`，让线上站点可直接下载离线文件；
  新增 `offline/README.md` 与 `.github/offline-release-notes.md`。
- **离线写作体验**：`Editor.tsx` 的 `saveAndFlush()` 统一处理 ⌘S / 保存草稿 / 自动保存 / 离线发布——
  先写入、再 `await flushStorage()`、最后用 `localPostExists()` 回读确认，**确认之后才提示成功**；
  内容未变且距上次写入 < 50ms 时按去重跳过（返回 `deduped`，不算失败）；
  加密文章尚未解锁时 `written: false`，调用方不得当成已保存；
  图片选择改为离线暂存进队列（上限 32 MB/张，线上仍为 3.2 MB）。
- **评论**：离线模式下列表不请求 GitHub，提交写入本机笔记（`appendLocalComment`），
  可删除自己的条目，未登录也能写（不 gate 在 `canPublish` 上）。
- OAuth 中转从 `file://` 可用：`functions/login/[[path]].ts` 与 `oauth-relay/worker.js` 补 CORS 头与
  `OPTIONS` 预检，`github.ts` 的 `oauthRelay()` 在 `relayUrl` 为空时回退到离线配置 / 用户设置。

### 调整

- `main.tsx` 先初始化存储再渲染（`boot()` 内 `await initOfflineStorage()`），并按协议选择路由：
  `file://` 下用 `HashRouter`（无服务端 rewrite），线上仍用 `BrowserRouter`；provider 顺序为
  Theme → Auth → Font → Background → Toast → StorageGuard → App。
- `Admin.tsx`：主标签新增 `sync`，离线时隐藏 PR 标签与远端拉取，删除内置文章改为写墓碑并给出「去同步」入口，
  列表计数拆成「文件内置 / 离线文章库 / 草稿」，顶部显示墓碑与已提交删除的说明条（可一键清除记录）。
- `Posts.tsx` / `PostPage.tsx` / `VersionCompare.tsx` 改用 `lib/postHistory` 与统一的文章来源，
  版本改名只在能提交仓库时入队。
- `font.tsx`：无网络时不再触发 Google Fonts 的 warm-up（直接返回并留一条 info 日志），避免离线打开时的无谓失败。
- `updateQueue.ts`：`flushUpdateQueue` 的前置条件改为「有网络 + 有令牌」；
  提交成功后清理本地正文的逻辑只在 `!OFFLINE` 时执行，离线模式改为把墓碑转成已提交删除记录，
  使「离线文章库与仓库内容一致」时不会静默丢掉本机内容、也不会累积墓碑。
- `settingsStore.ts` / `config.ts`：离线相关设置项与 `offlineConfig` 收敛到一处；
  删除被否决方案留下的死配置（`importPath`、`maxPostMessageBytes`）。
- `offlineBundle.ts`：`applyImport()` 必须显式接收导入包（原先读模块内缓存的「最近一次 plan」，
  调用顺序一变就静默丢图片与偏好），并删除 `prepareImportPlan` / `optionsBundleHint`。

### 修复

- **离线产物内联脚本被破坏**：插件把脚本插入 HTML 时用 `html.replace('</body>', scriptTag)`，
  代码里的 `$&` / `` $` `` 被当成替换模式展开，产物「构建成功但语法错误」。
  改为函数形式的替换，并在插件与自检脚本里各加一道 `vm.Script` 语法校验。
- **JS chunk 内容为空**：Rollup 的 chunk 把代码放在 `.code`、asset 才在 `.source`，
  只读 `.source` 会安静地内联进一个空脚本；改为按类型取值，取不到就报错，并断言内联 JS 长度。
- **误报「有改动尚未确认写入磁盘」**：`reportError()` 会把 `dirty` 置真，而 `file://` 下降级到
  localStorage 属于正常提示；且 localStorage 后端下 `persist()` 不会重试真实写入，dirty 永不清除。
  现在 `dirty` 只由「待落盘队列 + 失败键集合」推导（`syncDirty()`），localStorage 后端也会真正确认落盘。
- 内联脚本的转义补齐 `<!--`（HTML escaped 状态会吃掉闭合标签），自检不再用「数 `<script>` 标签」这种
  会被文章正文里的 `<script>` 字符串误伤的判断。
- `Comments.tsx` 在放开离线评论条件后出现 6 处可空访问（TS18047），通过把 `currentAuthor` 放在
  `&&` 链末位让类型收窄，并给 `@login` 加可选守卫。
- `vite.offline.config.ts` 去掉多余的 `loadEnv` / `envPrefix` 与 `VITE_OFFLINE`（源码只用到
  `import.meta.env.BASE_URL`），改由 `define` 单点控制离线开关。
- `workflow` 的 YAML：Release 资产改为固定名 `starlog-offline-latest.html`（滚动 tag 上用带哈希的
  文件名会让资产无限堆积）；步骤名中的 `（tag: offline）` 需加引号，否则 YAML 把「: 」当成映射分隔符。

### 验证

- `npx tsc --noEmit` 无错误；`npm run build` 通过（站点版，2287 modules，`index.js` 511.94 kB / gzip 200.34 kB）。
- `npm run build:offline` 通过，产物 `dist-offline/index.html` 3.03 MB（内联 CSS 1.49 MB、内联 JS 1.52 MB、
  data URI 1.07 MB / 42 个、`@font-face` 20 条、内置文章 10/10），`node scripts/verify-offline.mjs` 全项通过。
- 用 jsdom 以 `file:///…/starlog-offline.html` 真实加载产物做冒烟测试：
  首页列出内置文章、`#/posts/hello-starlog` 渲染出 2 个代码块 / 10 个 `code`、
  KaTeX 公式 21 个节点、管理页 `?tab=sync` 面板与编辑器页均正常挂载，控制台无错误；
  在没有 IndexedDB 且 `localStorage` 为不透明来源的环境里，页面按设计**拦住并给出解决办法**（而非静默丢数据），
  补上 localStorage 后写入正常、误报横幅消失。
- `npm ci --prefix vscode_extensions/v1` + `npm run extension:test`：65 项中 61 通过、0 失败、4 跳过
  （需要浏览器环境的用例）；本次未改动插件代码，结果与基线一致。
- 三份 workflow（`offline.yml` / `deploy.yml` / `extension.yml`）用 `js-yaml` 解析通过，
  并确认 `deploy.yml` 中「放离线文件」一步排在 `npm run build` **之前**（否则不会进入 `dist/`）。
- 站内帮助页 `content/about.md` 新增「离线版（单文件）」小节：能做什么、文章存在哪、为什么要导出离线档案、
  联网后从哪儿同步；`.github/workflows/offline.yml` 的触发路径因此从 `content/posts/**` 放宽到 `content/**`
  （`about.md` 等站内内容同样会被打进离线文件）。
- `AI_README.md` 的更新流程补充第 3 步的离线验证要求（本条即按「规则修改需登记」记录）。
- 已知未处理（按要求暂缓）：自定义字体走 Google Fonts，离线时回退到系统字体；`content/posts/` 中的远程图片在断网时不显示。


## 2026-10-19 · 处理 issue #63 / #64 / #65 / #66：透明页头、队列 diff、渲染差异与外观同步

| 模型信息 | |
| --- | --- |
| 模型名称 | Arena.ai Agent Mode（平台多模型动态调度，包括但不限于 Claude、ChatGPT、Gemini、Grok、Qwen、Kimi 等） |
| 模型版本号 | 未公开（由 Arena.ai 平台调度，不提供具体底层模型版本） |
| 知识库截止时间 | 未公开（依所调度的底层模型而定，平台未公开统一口径） |

### 背景
同一天集中处理四个 open issue：

- **#63**：删除任意页面下滑时顶部出现的整条不透明黑色 / 白色条。
- **#64**：在「待更新队列」中点击对应的更新请求，可以查看它相对仓库当前文件的 diff。
- **#65**：历史版本对比中的「渲染对比」改为只显示较新版本，并用颜色标出新增与删除内容。
- **#66**：动态背景与配色（含明暗模式）也要能同步到 GitHub；同时删除设置页里「只保存在本设备」的两段说明。

### 新增
- **#64 · 待更新队列的 diff 预览**：新增 `src/components/QueueDiff.tsx` 与共用的 `src/components/DiffView.tsx`。
  - 点击队列行（或右侧新增的「diff」按钮）打开预览：读取仓库当前文件作为原始版本，与队列里的待提交内容做行级 diff；新建文件会标注「仓库中尚无此文件」。
  - 覆盖全部队列类型：文章更新 / 删除 / 发表申请、账号偏好文件、版本名称 JSON；版本名称会先按本次改名意图合并出「更新后」的 JSON 再比较。
  - 图片上传条目显示本地暂存预览、预计文件大小与最终地址；发表申请会提示同时删除的旧文件与「不会直接写默认分支」。
  - 预览不会写入仓库，失败只影响预览本身，队列条目保持原样。
- **#66 · 账号外观同步**：配色主题、明暗模式、渐变背景与动态背景现在可以一起保存到 GitHub。
  - 账号外观偏好文件（`.starlog/settings/background-preferences/<login>.json`）升级到 `version: 3`，新增 `colorTheme` / `themeMode` / `animatedBackground` 字段；旧 `version: 2` 文件仍可读取。
  - 登录同一账号时自动恢复这四项偏好；本地账号缓存也扩展为记住整套外观，网络不可用时先用缓存。
  - 设置页新增「外观偏好同步」板块，提供「同步外观到 GitHub」按钮与加载 / 已排队 / 已同步状态；操作仍先进入待更新队列。
  - `animatedBackground.ts` 新增 `normalizeAnimatedBackground` / `setAnimatedBackgroundPreference`，供账号恢复整体替换偏好并通知所有视图。
- 抽取 `DiffView.tsx` 的 `DiffTable` / `DiffRow`，让历史版本对比与队列 diff 使用同一套行号、增删配色与上下文折叠。

### 调整
- **#63 · 页头保持完全透明**：删除 `Layout.tsx` 中滚动状态与 `data-scrolled` 属性；
  `styles/index.css` 的 `.site-header` 不再铺底色、不再使用毛玻璃、不再描边或投影。
  页面内容与动态背景会原样从导航文字下滚过，任意页面下滑都不会出现整条白带 / 黑带；
  移动端展开的菜单面板仍保留独立浮层底色以保证可读。
- **#65 · 渲染对比改为单栏差异**：`diff.ts` 新增 `renderedDiffBlocks`，按 Markdown 块（空行分隔，围栏代码块内不切）比较两个版本；
  「渲染对比」只渲染较新版本，新增块标绿、被删除的旧块标红并带「已删除」标签，代码围栏、列表与表格不会被截断。
  渲染前会去掉 frontmatter；工具栏补充新增 / 已删除图例与行数统计。
- 设置页按要求删除两段说明：「主题色阶通过 CSS 变量注入……不会写入仓库」与「动态背景仅保存在本设备，不会同步到 GitHub……」；
  原先「背景渐变与透明度」里的单独 GitHub 保存入口合并到新的「外观偏好同步」板块。
- README 同步更新：页头透明说明（issue #63）、队列 diff 入口、渲染对比新行为、账号外观同步文件格式与 FAQ；
  功能表中「并排渲染效果」改为「较新版本的渲染差异」。站内帮助页 `content/about.md` 也补充了队列 diff、渲染差异与外观同步的说明。

### 修复
- 恢复账号外观偏好时，`setBackground` 的身份会随强度状态变化而重建，触发恢复 effect 清理并把远程结果误判为「已取消」；
  改为通过 ref 读取当前强度，使回调身份稳定，账号偏好（含本次新增的主题 / 动态背景）能可靠恢复。
- 版本名称的队列 diff 在没有实际变化时不再显示成整文件删除，而是按「未修改」处理。

### 验证
- `npm ci` 安装依赖；`npm run build`（`tsc --noEmit` + `vite build`）通过。
- 用 `esbuild` 打包 `src/lib/diff.ts` 后运行块级渲染 diff 断言：新增段落 / 删除段落 / 修改代码围栏 / 列表项修改均正确分块，代码围栏保持完整、未被空行截断。
- 未改动 VS Code 扩展的构建入口，未重新打包插件。

## 2026-10-19 · 处理 issue #59 / #60（替代实现，取代 PR #61 的版本）：文首排版指令与 LaTeX 符号选择框

| 模型信息 | |
| --- | --- |
| 模型名称 | Arena.ai Agent Mode（平台多模型动态调度，包括但不限于 Claude、ChatGPT、Gemini、Grok、Qwen、Kimi 等） |
| 模型版本号 | 未公开（由 Arena.ai 平台调度，不提供具体底层模型版本） |
| 知识库截止时间 | 未公开（依所调度的底层模型而定，平台未公开统一口径） |

### 背景
同一天的两个 open issue 被两个并行会话各自独立实现：PR #61 先合入并关闭了 issue，
本条目是并行完成的另一份实现，经对比后以本实现取代其代码（#61 的记录保留在 Git
历史与 PR 中）。与 #61 相比，本实现的实质差异：字体样式除 CSS 变量外还写容器级
`font-family`（只写变量时，生成的 CSS 里 `font-family: var(--font-sans)` 只在
`html` 上求值、正文段落靠继承，内层覆盖变量并不会让正文换字体）；多条字体指令
组成优先级回退列表而非只取第一条；指令字体本机没有时预热 Google Fonts；
选择框支持评论框、最近使用与 280 个符号；VS Code 插件升 2.1.0 并新增
「插入 LaTeX 符号…」命令；帮助页与插件测试同步补齐。
原始需求：
- **#59**：新增 Markdown 语法 #3——文章开头用 `::set-font[<name>]` / `::set-code-font[<name>]` / `::set-background[<id>]` 强制本文字体、代码字体与阅读时的背景（id 范围 0–5），同一指令写多个时越早出现的优先级越高。
- **#60**：`Shift + ↑` 打开 LaTeX 符号选择框，可以搜索并选择，每个符号支持多种别名（如 `\pm` 的「正负 / 加减」；`\oplus` 的「异或」）。

### 新增
- **文首排版指令**（issue #59），解析集中在新的纯函数模块 `src/lib/articleDirectives.ts`：
  - 只有位于文章最开头（可夹空行、正文开始前）的连续指令行有效；正文后、代码围栏、展示框 / 折叠框内的同形文字均不触发，教程里用围栏展示语法是安全的。
  - `::set-font` / `::set-code-font` 可多条或逗号分隔多个字体名：越早出现的优先级越高、后面的作回退，最后接站点默认字体栈；字体名校验与偏好设置一致（坏名字静默丢弃，不整篇报错）。`::set-background` 的 id 固定映射为 0 无 · 1 樱花 · 2 粒子星链 · 3 雪花 · 4 暴雨 · 5 竹林（`ARTICLE_BACKGROUND_SCENES`，后续场景只许追加编号），多条时第一个合法编号生效。
  - 指令行在渲染预处理中整体移除（编辑器双栏行号映射保持），也不再进入自动摘要、字数与阅读时长；「直接复制源码」原样保留，洛谷 / 基本源码与 MPE 静态兼容输出都会移除。
  - 字体以作用域 CSS 变量 + 容器 `font-family` 的形式作用于本文区域（文章页含标题区、编辑器预览、版本对比、VS Code 插件预览；评论传 `applyDirectives={false}`，他人的内容不能改排版）；指定的字体本机没有时复用 `font.tsx` 新抽出的 `warmFontFamilies` 在后台尝试 Google Fonts。
  - 背景在 `animatedBackground.ts` 新增内存级覆盖 `setAnimatedSceneOverride`：文章页 / 编辑器声明、离开清除，Layout 的背景层读取「覆盖 ?? 个人场景」，参数仍用读者为该场景保存的值；不写 localStorage / 队列 / GitHub，个人偏好原封不动。
- **LaTeX 符号选择框**（issue #60），符号目录在新模块 `src/lib/latexSymbols.ts`，站内编辑器、评论输入框与 VS Code 插件共用：
  - 收录 280 个符号（结构 / 希腊字母 / 运算 / 关系 / 集合与逻辑 / 箭头 / 大型运算符 / 函数 / 其他九类），每个带中文与英文多类别名、KaTeX 预览源码、实际插入文本与插入后的光标偏移（例如 `\frac{}{}` 光标落在分子处、矩阵 / 分段环境光标落在中间空行）。
  - 站内选择框 `src/components/LatexPicker.tsx`：搜索同时匹配命令（忽略反斜杠与大小写）与别名，命令完全一致 / 前缀优先；分类标签浏览、方向键移动（左右在搜索词首尾边界时不抢夺文本编辑）、Enter / 点击插入回打开时的光标位置、Esc 关闭；KaTeX 预览带模块级缓存，翻开即显；最近用过的 18 个符号记在本机并独立成页。
  - 编辑器 `Shift + ↑` 与工具栏 Ω 按钮、评论框 `Shift + ↑` 与「LaTeX 符号」按钮均可打开；输入法组合中不拦截；编辑器全屏时 Esc 先关选择框而不是退全屏。
- **VS Code 插件升级到 2.1.0 并重新打包 VSIX**：
  - 新增命令「插入 LaTeX 符号…」（`starlog.insertLatexSymbol`，Markdown 编辑器 `Shift + ↑`）：QuickPick 以字形 + 命令为标签、别名为描述，可搜「正负 / 异或」；插入后光标规则与站内一致。
  - 文首字体指令在内置预览正文中与博客一致生效（只认本机字体、插件不联网），背景指令在预览中仅移除；新增 `setfont` / `setcodefont` / `setbackground` 代码片段、注入语法高亮与语法示例新章节。
- 文档同步：`README.md` 新增「文章排版指令」整节（含编号表、作用范围、实现说明）并更新功能表 / 快捷键表 / FAQ / 目录结构 / 字体维护提示 / 插件版本；站内帮助页 `content/about.md` 新增「文章开头排版指令」小节、LaTeX 选择框说明与快捷键行；设置 → 动态背景 增加一行编号说明。

### 调整
- 默认字体栈三常量与字体栈拼接逻辑从 `font.tsx` 抽到新的纯模块 `src/lib/fontStacks.ts`（`font.tsx` re-export 保持引用兼容），使文章字体指令与 VS Code 插件共用一份拼栈规则；README 的「三份副本」维护提示随之改为指向该模块。行为无变化：偏好设置（issue #54 的正文 / 代码独立优先级）与首屏脚本均未改动。

### 验证
- `npm run build`（`tsc --noEmit` + `vite build`）通过。
- 21 项定向逻辑检查（把三个纯模块打包到 Node 里跑断言）全部通过：文首边界 / 字体优先级与去重 / 背景取第一个合法 id 与 0 合法 / 非法值忽略 / frontmatter 与 CRLF 的 strip / 复制转换三态；别名搜索命中 issue 的两个示例（「正负」「加减」→ `\pm`、「异或」→ `\oplus`，且 `\veebar` 也在结果中）、命令搜索大小写与前缀排序、`\frac` / `\sqrt[n]` / `\left(` 的插入光标；280 个符号的 KaTeX 预览以 `throwOnError: true` 逐个渲染无一失败。
- VS Code 插件：`npm ci --prefix vscode_extensions/v1` 后 `typecheck` 通过；`npm run extension:test` 全部通过——65 项里 61 项通过、4 项真实浏览器测试因本机未设 `BROWSER_EXECUTABLE_PATH` 跳过（新增的指令同款 DOM 对照、解析 / 转换与别名搜索断言均在通过之列）；`npm run extension:package` 生成 `starlog-markdown-2.1.0.vsix`。

## 2026-10-17 · 优化樱花与粒子星链，新增雪花 / 暴雨 / 竹林

| 模型信息 | |
| --- | --- |
| 模型名称 | OpenAI Codex（GPT-6） |
| 模型版本号 | GPT-6；具体部署版本未公开 |
| 知识库截止时间 | 未公开（当前运行环境未提供，不推测） |

### 新增
- 雪花：六角雪晶、三层景深、柔焦近景雪片与远山雪坡；雪日 / 蓝调雪夜双配色，5 项参数。
- 暴雨：三层雨丝、积水涟漪、雾中树影与流动雨雾；阴雨白昼 / 冷调雨夜双配色，5 项参数，闪电默认关闭。
- 竹林：预绘竹竿、竹节与叶簇，分层随风摆动、林间薄雾与斜射光；晨光 / 月夜双配色，5 项参数。
- 设置页加入新场景及对应图标、描述、参数和本场景恢复默认入口。

### 调整
- 樱花补充带缺口的花瓣形态、两侧花枝与五瓣花簇；减轻暗角，保持阅读区域清爽。
- 星链使用空间分桶搜索连线邻居，数据脉冲从实际相邻节点选择路径；继续保留无随机噪点的画面。
- 新场景复用后台暂停与减少动态效果策略，使用离屏贴图、粒子上限、批量雨丝绘制；未新增项目依赖。
- README 同步五种场景、深浅效果、可调参数、渲染文件位置及性能说明。

### 修复
- 花瓣大小立即作用于已有花瓣，不再要等重新生成后才改变大小。
- 星链脉冲不再穿过未连接的节点；浅色连线使用压深的主题色。
- 配色主题变化时星链立即重建颜色贴图，同时保留节点位置。
- 鼠标移出页面或窗口失焦后清除吸引点；卸载时取消待处理的尺寸更新，避免过期回调。
- 初始化和尺寸更新后立即绘制背景，即使页面当前处于后台也有完整静态帧。

### 验证
- `tsc --noEmit` 和 `vite build` 通过（等同项目 build 脚本的两项检查）。
- 真实 Skia Canvas：5 场景 × 2 明暗，共 10 组；每组连续渲染 90 帧，另检查配色切换、零参数、390×844 手机视口及高密度 / 反向风参数，全部通过。
- 5 个场景的生命周期检查通过：减少动态效果不启动动画、DPR 上限 1.5、隐藏页暂停 / 返回恢复、取消待处理的尺寸更新、移除全部监听。
- 本地浏览器验证设置页五个入口、雪花大小即时调整、深浅切换、星链主题换色；控制台无警告或错误。
- 修改未涉及 VS Code 扩展渲染或共享样式，无需重新打包扩展。

## 2026-10-16 · 处理 issue #53 / #54 / #55：页头底色跟随主题、代码字体独立设置、去掉空的动态背景推荐（本次）

| 模型信息 | |
| --- | --- |
| 模型名称 | Arena.ai Agent Mode（平台多模型动态调度，包括但不限于 Claude、ChatGPT、Gemini、Grok、Qwen、Kimi 等） |
| 模型版本号 | 未公开（由 Arena.ai 平台调度，不提供具体底层模型版本） |
| 知识库截止时间 | 未公开（依所调度的底层模型而定，平台未公开统一口径） |

### 背景
一次处理三个 open issue：
- **#53**：任意页面下滑后，顶部变成一条与页面脱节的实色带——深色模式发黑，浅色模式发白（作者补充：什么模式、什么主题都会）。
- **#54**：代码字体要能单独设置；默认字体改为正文 `Google Sans` → `Noto Sans CJK SC`、代码 `Cascadia Code`。
- **#55**：设置页弹出的「某主题适合搭配动态背景某场景」提示，场景可能是空的。
另外顺手修了排查过程中发现的几个相关问题（浏览器顶栏颜色、首屏闪烁、云端字体假死）。

### 修复
- **#53 吸顶页头变成白 / 黑带**。三个成因一起处理：
  1. 滚动后的底色写死 `bg-white/75` 与 `dark:bg-ink-950/75`，而页面底色是跟着配色主题
     （10 套 `--theme-surface-*`）、自定义渐变背景色与动态背景变的，两者永远对不上；
  2. 未滚动时页头**完全没有** `background-color`，滚动时才加上 `bg-white/75`，`transition-all`
     于是从 `transparent`（即 `rgba(0,0,0,0)`，透明的**黑**）插值到半透明白——不做预乘插值的引擎
     会先经过一层灰黑；
  3. `transition-all` 还把 `backdrop-filter` 等无关属性一起拖进过渡。

  改法：新增 `--site-header-surface`（浅色取 `--theme-surface-light`，深色取 `--theme-surface-dark`），
  页头与移动端展开的菜单面板改用 `color-mix(in srgb, var(--site-header-surface) 78% / 95%, transparent)`，
  底色与页面底色**同源**；未滚动状态也写「同一个颜色、alpha = 0」，插值全程留在同色系里；
  过渡收窄为 `background-color / border-color / box-shadow`；不支持 `color-mix` 的浏览器有中性白 / 深色
  回退声明，不支持 `backdrop-filter` 的浏览器改用接近不透明的底色保证文字可读。
  实现从 `Layout.tsx` 的类名拼接移到 `src/styles/index.css` 的 `.site-header` / `.site-header-panel`。
- **#55 空的动态背景推荐提示**。`SettingsPage.tsx` 的判定是
  `selected?.scene && selected.scene !== animated.scene`，而「没有推荐场景」的主题存的是
  `scene: 'none'`——非空字符串，truthy。于是星野蓝 / 落日橙 / 森野绿 / 鎏金 / 墨白这 5 套主题
  在当前动态背景不是「无」时，都会弹出「『落日橙』适合搭配动态背景『无』」+「一键套用」。
  按 issue 要求整条提示移除；搭配建议本来就写在每张色卡的描述文字与 README 的主题表里，信息没有丢。
- **浏览器顶栏颜色**。`index.html` 原先是两个写死的 media 版 `<meta name="theme-color">`，只跟随系统的
  `prefers-color-scheme`：站内选了浅色而系统是深色时，手机浏览器顶栏就是 `#0d1017` 一条黑带（反之白带），
  而且完全不知道 10 套配色主题的存在。改为单个 meta，由 `ThemeProvider` 按**实际生效**的明暗 + 当前配色主题
  读 `--theme-surface-*` 写入；首屏脚本先按明暗写一个兜底值。
- **首屏闪烁两处**：① 首屏脚本把 `starlog:theme === 'system'` 当成浅色（`stored === 'dark'`），
  系统深色的用户会先闪一下白底，现在 `system` 与任何非法值都跟随系统；
  ② README 一直声称「首屏脚本会在 React 启动前写入 `<html data-starlog-theme>`」，但代码里并没有这一步，
  换肤用户首屏会闪一下默认「星野蓝」——补上 `THEME_IDS` 白名单与写入逻辑，文档与实现现在一致。
- **CI 的 `verify` 作业从 PR #45 起一直是红的**（与本次三个 issue 无关，但它挡住了本次改动的验证）：
  步骤「博客构建与扩展类型检查」里的 `npm --prefix vscode_extensions/v1 run typecheck` 会顺着 import
  拉进博客的 `src/lib/posts.ts` 与 `src/lib/versionNames.ts`，这两个文件用了 Vite 专属的
  `import.meta.glob`，而插件 tsconfig 的 `types` 只有 `node` / `vscode`，于是报
  `TS2339: Property 'glob' does not exist on type 'ImportMeta'`。给插件 tsconfig 补上 `vite/client`
  即可（vite 装在仓库根目录，插件的 `build.mjs` 本来就依赖根目录的 postcss / tailwindcss，
  向上解析是既有约定而非新增耦合）。这两个文件运行时早有 try/catch 兜底，本次只补类型声明。
- **改字体时假死**。`setFonts()` 会为本机没有的字体逐个 `await requestCloudFont()`，每个最多等 5 秒，
  而 `fonts.googleapis.com` 在部分网络下根本连不通，失败后又只是静默忽略——表现就是「点了没反应」。
  改为并行发起、不阻塞提交，字体到位后浏览器自己重排。

### 新增
- **代码字体独立设置（#54）**：`FontPreference` 增加 `monoFamilies`，`FontCtx` 的
  `setFonts / addFont / removeFont / moveFont` 都增加 `target: 'sans' | 'mono'` 参数（默认 `sans`，
  旧调用方式不变）；`applyToDocument` 相应写入 `--font-mono` 与 `data-font-mono-family`；
  `resetFont()` 同时清空两组并把字号恢复 100%。
- **设置页**：抽出可复用的 `FontPriorityEditor`，正文与代码各渲染一份（输入 + 本机字体候选 +
  推荐预设 chips + 优先级列表 + 上下调序 / 移除 + **实时样例行**）；两组各有自己的预设
  （`PRESET_SANS_FONTS` / `PRESET_MONO_FONTS`）。
- **README** 新增「🔤 字体与字号」章节：默认字体栈表、自定义方式、账号偏好文件格式，
  以及「默认字体栈有三份副本（index.css / font.tsx / index.html），改动要同步」的维护提示。

### 调整
- **默认字体栈（#54）**：`--font-sans` 改为 `Google Sans → Noto Sans CJK SC → Noto Sans SC → 系统无衬线`，
  `--font-mono` 改为 `Cascadia Code → 系统等宽`；`src/lib/font.tsx` 导出 `SANS_FALLBACK` /
  `SERIF_FALLBACK` / `MONO_FALLBACK`，用户自定义字体缺字形时回退到同一套默认栈（以前回退栈里
  没有 Google Sans / Noto Sans CJK SC / Cascadia Code，与 CSS 默认值不一致）。
- **账号字体偏好文件升到 `version: 3`**：多一个 `monoFamily` 字段；`fetchGithubFontPreference()`
  兼容只有 `family` 的 v2 旧文件（代码字体回落默认栈），并且 `family` / `monoFamily` 只要有一个非空就算有效。
- 仓库内 `@lrbkdgw` 的偏好文件同步为 v3：原先代码字体被混在正文列表里
  （`"Google Sans, Noto Sans CJK SC, Cascadia Code"`），现在拆成 `family` 与 `monoFamily` 两项。
- `font.tsx` 的本地偏好读取增加 `parseFamilies()`，统一兼容 `families` 数组 / 单个 `family` 字符串 /
  `monoFamilies` / `monoFamily` 四种历史写法；`splitFamilies()` 提出为导出函数供账号恢复复用。
- `themes.ts` 的 `scene` / `sceneName` 现在只作为文档元数据（README 主题表的「建议搭配」列），
  不再驱动任何界面提示。
- **合并 main（PR #57：新增雪花 / 暴雨 / 竹林三种动态背景）**：`SettingsPage.tsx` 自动合并成功
  （新增的场景选项 / 图标与本次的字体编辑器、移除推荐提示互不重叠）；README 功能表取 main 的
  「五种场景」描述 + 本次的「🔤 排版偏好」行；ChangeLog 两条新条目按日期倒序并列保留
  （2026-10-17 在上、本次 2026-10-16 在下）。

### 验证
- `npm run build`（`tsc --noEmit && vite build`）通过（7.3s）；`tsc` 的 `noUnusedLocals` 同时确认
  移除推荐提示后没有留下未使用的导入（`Sparkles` 已删）。
- 检查构建产物 CSS：`.site-header[data-scrolled=true]` 同时含中性回退值与 `color-mix(...)`，
  `@supports not (backdrop-filter…)` 分支与 `.dark` 分支都按预期生成。
- `npm --prefix vscode_extensions/v1 run typecheck` 由**失败转为通过**（修 CI 前它在 HEAD 上就已经报错）。
- `npm run extension:test`：61 项 —— 57 通过、4 跳过（需要 `BROWSER_EXECUTABLE_PATH`，本地无 Chromium）、0 失败。
  插件复用同一份 `src/styles/index.css`，新增的 `.site-header*` 规则会被作用域化到
  `.markdown-extension-preview` 下（预览里没有页头，属于无害的死规则），`body` / `:root` / `.dark`
  与渐变背景开关的既有契约未变。
- `vscode_extensions/v1/out/extension.js`、`out/preview.js` 保持仓库原样未提交：实测在 HEAD 上重新构建
  这两个文件也会变（只是压缩后的标识符重命名），差异来自构建环境而非本次改动；博客 CSS 走的是
  已被 `.gitignore` 忽略的 `out/preview.css`。

## 2026-10-16 · 两种动态背景都适配深色 / 浅色 · 去掉粒子星链的噪点（上一轮）

| 模型信息 | |
| --- | --- |
| 模型名称 | Arena.ai Agent Mode（平台多模型动态调度，包括但不限于 Claude、ChatGPT、Gemini、Grok、Qwen、Kimi 等） |
| 模型版本号 | 未公开（由 Arena.ai 平台调度，不提供具体底层模型版本） |
| 知识库截止时间 | 未公开（依所调度的底层模型而定，平台未公开统一口径） |

### 背景
剩下两种场景此前各自绑定一种基调（樱花＝浅色场景、粒子星链＝深色场景），场景一开就会把整站的明暗
**临时顶掉**。这轮改成：明暗完全由用户（或「跟随系统」）决定，**两种场景自己各备深浅两套配色**。

### 改动
- **樱花**：新增「夜樱」。浅色＝白昼（近白粉调天空、左上角逆光暖斑、花簇与奶白散景），
  深色＝夜樱（深紫夜色、淡粉月光、更饱和的洋红 / 淡紫散景、更重的暗角）。
  花瓣贴图不分明暗；散景在浅色底上改用**正常合成**——加色会把大片浅色直接推成白团（实测过）。
- **粒子星链**：新增「浅色星图」。深色沿用 `lighter` 加色发光；浅色改用正常合成，
  主题色按 HSL 压深成墨色画点与连线（浅底上加色等于看不见），节点半径与不透明度单独调过，
  光晕与星芒强度降到 45%；浅色底上暗角减到 0.1、网格加深到 0.09。
- **去掉粒子星链的噪点**：删除背景里 500×面积系数的随机微粒以及 `paintGrain` 颗粒噪点
  （深色底上会被读成噪点，浅色底上只会显脏）。同一片画面区域的「相邻像素差」平均从 **2.93 降到 0.17**。
  颗粒噪点只在「浅色底 + 樱花」这一种情况下保留（大面积极浅的底色容易显糊）。
- **去掉基调覆盖机制**：`SceneSpec.tone`、`SceneTone`、`sceneToneOf()` 与 `ThemeCtx.toneOverridden`
  一并移除，`ThemeProvider` 不再读取动态背景；设置页「明暗被场景临时覆盖」的提示文案删除。
- **切换不打断动画**：`Renderer` 新增可选方法 `setTone(dark)`，`AnimatedBackdrop` 订阅 `useTheme().theme`，
  明暗变化时只重建与配色相关的贴图（天幕、散景、光晕、星芒），花瓣与光点的位置、速度保持不变；
  「减少动态效果」下会同步重绘静态帧。
- README / 设置页说明同步：「深色场景 / 浅色场景」的说法改成「两种场景都适配深色与浅色」。

### 验证
- `npm run build`（`tsc --noEmit && vite build`）通过。
- 预览钻机在真实 2D 上下文（Skia，1280×720）里渲染 **2 场景 × 2 明暗 = 4 张图**，`errors 0`：
  樱花浅色 61ms / 深色 60ms，粒子星链浅色 83ms / 深色 91ms（首帧含烘焙）。
- 另跑「运行时切换明暗」用例（先渲染再 `setMode`）：两种场景都能就地换成另一套配色，`errors 0`。
- 高频能量（相邻像素差均值，260×260 中心区域）：粒子星链 2.93 → 0.17（深色），浅色 0.85。

## 2026-10-16 · 动态背景收敛为「樱花 / 粒子星链」两种场景（上一轮）

| 模型信息 | |
| --- | --- |
| 模型名称 | Arena.ai Agent Mode（平台多模型动态调度，包括但不限于 Claude、ChatGPT、Gemini、Grok、Qwen、Kimi 等） |
| 模型版本号 | 未公开（由 Arena.ai 平台调度，不提供具体底层模型版本） |
| 知识库截止时间 | 未公开（依所调度的底层模型而定，平台未公开统一口径） |

### 背景
动态背景此前有 8 种场景，按需求收敛为 2 种：**只保留「樱花」与「粒子星链」**，
「雨夜 / 阳光 / 星空 / 极光 / 飘雪 / 海浪」六个场景连同上一轮为它们做的重做一起移除。
10 套配色主题全部保留，只重新指派了「建议搭配场景」。

### 移除
- `src/components/AnimatedBackdrop.tsx`：删除 `createRain` / `createSunshine` / `createStars` /
  `createAurora` / `createSnow` / `createWaves` 六个渲染器及其专用工具（`NEON`、`smearSprites` /
  `smearFor` / `buildSmearSprites`、`project3` / `focal`、`buildCity(w, h)`、`paintWalls`、
  `reflectionLayer`、`buildSea` / `dash` / `trough` / `warmSeaLayer` 等），以及只被它们使用的共享工具
  （`createDeferred`、`makeNoise2D`、`mixHue`、`makeSoftDot`、`soften`、`makeSoftColumn`、`makeSoftStreak`）。
  `createRenderer()` 只在 `sakura` / `network` 之间分发；文件从约 3600 行降到 807 行，注释与分节标题一并清理。
- `src/lib/animatedBackground.ts`：`SceneId` 收敛为 `'none' | 'sakura' | 'network'`，
  `SCENES` 只保留两条（樱花、粒子星链，各 5 项参数）。旧的本地偏好若存的是已移除场景，
  `normalizePreference` 会把它回退为「无」，不会报错；参数滑块、延迟重建等公共逻辑保持不变。
- `src/pages/SettingsPage.tsx`：场景选择只剩「无 / 樱花 / 粒子星链」三格（等宽排布），
  清掉不再使用的图标导入，底部说明改写为「深色场景（粒子星链）…浅色场景（樱花）…」，
  卡片描述从「八种动态场景…」改为「两种动态场景（樱花、粒子星链）」。
- `src/lib/themes.ts`：10 套主题全部保留。「建议搭配场景」重新指派——深海青 / 极光紫 / 绯红 /
  赛博霓虹 → 粒子星链，樱花粉 → 樱花，落日橙 / 森野绿 / 鎏金 → 无（原建议的雨夜 / 阳光 / 海浪 / 星空已不存在），
  「深海青」的描述同步改写。
- `src/components/Layout.tsx`、`src/lib/theme.tsx`：把注释里列举的旧场景名（雨夜 / 星空等）改成现存的例子。
- `README.md`：功能表、主题建议表、动态背景场景表、目录树注释同步为两种场景；
  删除上一轮针对已移除场景的「重做手段 / 性能对比」两大段，改为一小段说明（旧偏好会回退为「无」）。

### 验证
- `npm run build`（`tsc --noEmit && vite build`）通过（6.8s）。
- 预览钻机里把两种场景各渲染成 IMG（1280×720、真实 2D 上下文 / Skia）：樱花、粒子星链均正常出图，
  `errors 0`；首帧（含贴图烘焙）60ms / 99ms。
- `tsc` 的 `noUnusedLocals` 同时充当死代码检查：只被删场景使用的工具都被逐一标出并清掉；
  全仓库 grep 已无六种场景的残留引用。

## 2026-10-16 · 五个背景场景按真实照片再做一轮（上一轮，本轮已移除）

| 模型信息 | |
| --- | --- |
| 模型名称 | Arena.ai Agent Mode（平台多模型动态调度，包括但不限于 Claude、ChatGPT、Gemini、Grok、Qwen、Kimi 等） |
| 模型版本号 | 未公开（由 Arena.ai 平台调度，不提供具体底层模型版本） |
| 知识库截止时间 | 未公开（依所调度的底层模型而定，平台未公开统一口径） |

### 背景
上一轮的画法（分层、fbm、低分辨率发光缓冲、烘焙贴图）本身没问题，但成图仍然「像画的」。
这次改成**先找参考、再重写**：用图片检索拿到真实的雨夜街拍（一点透视的霓虹巷道、青绿主调的车流雨夜）、
湖上极光（横贯画面的霞状绿光 + 地平线氧红 + 湖面镜像 + 远处树线）、落日海浪（太阳贴着海平线、
暖金碎光路、青绿透光的浪脊与白色浪花）与银河（亮带 + 暗尘带）照片，逐场景对着照片改写，
再用真实像素渲染出图逐张比对。

### 重写
- **雨夜**：整段重写为**针孔相机的一点透视街道**。世界坐标直接用「米」：视高 1.6m、街道半宽 3.1m、
  人行道到 4.3m、楼体进深 7m，`project3(X, z, Y)` 按 `x = vpX + f·X/z`、`y = horizon + f·(EYE − Y)/z` 投影，
  楼顶 / 楼层线 / 窗 / 招牌 / 路灯全部落在正确的透视位置（上一版把「深度」直接当屏幕比例用，
  楼顶被算到地平线以下，整条街读起来像梯子）。楼群贴紧排列、从远到近绘制，
  最靠近镜头的那栋当作「镜头旁的墙」处理（不画正面，否则会出现一块贴在画面边缘的巨大黑板）。
  湿路反光改为「预渲染横向柔边的光柱贴图 → 按亮度分三档宽度叠加 → 整体柔化 → 横向断口 + 自上而下淡出」，
  并只让最亮的十七盏灯产生倒影；新增消失点车辆灯光、店招灯箱与竖招牌、橱窗冰花。
- **极光**：竖条降级为「细纹」，主体改成一整团横贯画面的霞状光带；色彩 LUT 改成真实极光的氧绿色序
  （黄绿 → 绿 → 青），顶端单独叠一层氮的紫红花边；发光层缩放的系数**只允许大于 1**
  （小于 1 时画面边缘会露出没被盖住的矩形缝）；地平线氧红辉光加强、山脊补一道青绿轮廓光，
  湖面倒影单独叠一层极光绿光并把乘色改浅。
- **海浪**：天空改成日落色（上方保留蓝、地平线转暖），太阳压低到贴着海平线并收紧光晕；
  海面贴图改为**保留原生纵向分辨率**（只在横向压缩），浪脊高光用噪声阈值切成一段一段的虚线、
  浪谷单独压暗出体积，相位按 `t^1.22` 压缩，浪花改为远近两层都有；海水压暗到接近真实海面的青绿；
  新增「太阳一侧的暖色海面」与更亮的碎钻光路；近景泡沫爆点收小收淡。
- **星空**：银河亮带变窄，絮状结构改为**沿带方向拉长**的噪声（各向同性的噪声会立刻变成一朵云），
  暗尘带改为「沿带低频、跨带高频」的细纹，亮度做颗粒化；带内暗弱小星提到 1.1 万颗，
  全天星场从 420 颗提到 1500 颗，亮星星芒的门槛跟着上调。
- **阳光**：沿用上一轮的结构，只做微调（光晕与光尘的分布不变）。

### 修复
- **预览钻机的 canvas 代理会在每次 `getContext()` 时重置画布尺寸**，等价于清空内容：
  极光的「水面断口」与雨夜的倒影层原本都在同一个画布上二次取上下文，导致图层被清空、倒影整层消失。
  现在改成「一块画布只取一次 2D 上下文」，需要二次处理时先用 `paint()` 另开一块画布。
- 樱花 / 飘雪 / 粒子星链三个场景本轮未改动（粒子星链仍保留上一轮「去掉鼠标旁光圈」的结果）。

### 验证
- `npm run build`（`tsc --noEmit && vite build`）通过。
- 8 个场景在真实 2D 上下文（Skia，1280×720）里逐帧渲染出图，`errors 0`；
  首帧（含贴图烘焙）耗时：雨夜 60ms、阳光 60ms、星空 120–160ms、极光 155–175ms、海浪 620–750ms。
- `npm run extension:test`：57 通过 / 0 失败 / 4 跳过。
- 参照物为公开的真实照片（雨夜街拍、湖上极光、银河、落日海浪），不包含任何第三方素材或新增依赖。

## 2026-10-16 · 雨夜 / 阳光 / 星空 / 极光 / 海浪 五个场景重做（更早一轮，本轮已移除）

| 模型信息 | |
| --- | --- |
| 模型名称 | Arena.ai Agent Mode（平台多模型动态调度，包括但不限于 Claude、ChatGPT、Gemini、Grok、Qwen、Kimi 等） |
| 模型版本号 | 未公开（由 Arena.ai 平台调度，不提供具体底层模型版本） |
| 知识库截止时间 | 未公开（依所调度的底层模型而定，平台未公开统一口径） |

### 背景
上一轮把五个场景的逐帧开销压了下来，但画面本身仍然「不像真的」。这次按真实世界的成像规律重做，
画法参考公开项目的常见做法：Codrops《Rain & Water Effect Experiments》里的雨滴分层与「大大小小雨滴各一层」思路、
极光常见的「低分辨率发光缓冲 → 模糊 → 叠加（bloom）」做法，以及「把整片海按透视关系烘焙成一张可平铺贴图」的思路。

### 新增
- **值噪声 + 分形叠加（fbm）工具**：`makeNoise2D`，用于夜云、银河与暗尘、星云、积云、海面浪脊等所有有机纹理，
  只在建立贴图时计算一次。
- **柔和贴图工具**：`makeSoftDot`（高斯式衰减光斑）、`soften`（缩小再放大实现廉价模糊）、`makeSoftStreak`（两侧渐隐的柔化线条）。
- **延迟重建工具** `createDeferred`：星空 / 极光 / 海浪的重贴图推迟到参数停止变化 200ms 之后执行，
  拖动滑块时不再掉帧。

### 重做
- **雨夜**：夜云改为 fbm 形状并被城市灯光从下方照亮；天际线改为高低错落、带退台塔冠与航空警示灯的楼群，
  窗户按网格随机点亮并叠一层柔化辉光；街道补上湿光条纹、路灯暖色光池、**被水波打断的竖向灯光倒影**与地平线暗色水膜；
  雨丝分三层（烘焙的远景雨幕 + 中层细雨 + 近处虚化雨丝，斜率随风档切换）；
  落地涟漪改为柔光环 + 向上溅起的小水花；镜头前只保留极淡的散景光斑。
- **阳光**：天空改为「饱和蓝 → 地平线暖白」的散射渐变；云用 fbm 生成积云（顶部被阳光照亮、底部偏冷），
  并叠一层柔化副本做体积感与缓慢漂移；太阳光晕收紧（不再铺满全屏、不再爆白）；
  光尘改为只出现在向阳一侧的细小光点；远山与树林剪影带逆光轮廓光。
- **星空**：银河改为半分辨率逐像素烘焙的分形亮带（含暗尘带，银心偏暖、边缘偏蓝）并叠一层未模糊副本保住颗粒感；
  星云改为 fbm 形状并缩小、挪离银河带；星场按星等幂律分布（大量暗星 + 少数亮星），亮星带十字星芒与色温差异；
  新增三层起伏山脊剪影与山脊轮廓光。
- **极光**：整段重做。在 17% 分辨率的发光缓冲里逐像素累加发光量——沿帘幕方向的密度用 fbm 决定，
  竖直方向按高度着色（下缘主色/青绿 → 中部青 → 顶部氧红，48 级 LUT），下缘是一条锐利亮边，
  叠加后用色调映射 `1 - exp(-E)` 压缩，绝不爆白；放大贴图并叠一层模糊副本做辉光；
  地平线补上氧的暗红辉光，湖面倒影由天空层镜像 + 压暗 + 细条错位模拟波纹生成。
- **海浪**：整段重做。整片海按透视关系烘焙成一张可横向无缝平铺的贴图（浪脊保持水平、随距离改变密度与振幅，
  远处又短又密近乎平整、近处波长几百像素并带白色浪花，另有细碎皱褶提供「水感」）；
  近海再叠一层顶边渐隐的贴图与一条缓慢横移的大浪；太阳光路改为被波纹打碎的碎光柱；
  天空补上低垂层云与海平线细亮线。

### 性能
- 用真实 2D 上下文（Skia，`@napi-rs/canvas`）在 1280×720 下统计的逐帧绘图调用量（每秒）：
  雨夜 28817 → ~8400、阳光 7627 → ~1200、星空 5663 → ~1700、极光 4664 → ~1300、海浪 27063 → ~490。
- 首帧（含全部贴图烘焙）耗时：雨夜 / 阳光约 60ms，星空约 120ms，极光约 170ms，海浪约 110–200ms；
  参数变化时靠 `createDeferred` 延迟重建，拖动滑块过程中保持上一帧贴图。

### 验证
- 在沙箱里搭了一套**真实像素预览**：jsdom 提供 DOM、`@napi-rs/canvas`（Skia）提供真实 2D 上下文，
  把每个场景渲染成 PNG 逐张肉眼检查并迭代（1280×720 与 430×860 两种视口）。
- `tsc --noEmit` 与 `npm run build` 通过；`npm run extension:test`：61 项中 57 通过、0 失败、4 跳过（与改动前一致）。
- 8 个场景 × 4 组参数（默认 / 全最大 / 全最小 / 回到默认）完整跑 `setup → configure → step → draw`：0 报错。
- 五个场景的静态观感已在预览里逐张确认；真实浏览器中的帧率与动效仍需部署后人工过一遍。

---

## 2026-10-16 · 背景逐帧开销优化 · 粒子星链去光圈 · 主题开启后收起明暗按钮

| 模型信息 | |
| --- | --- |
| 模型名称 | Arena.ai Agent Mode（平台多模型动态调度，包括但不限于 Claude、ChatGPT、Gemini、Grok、Qwen、Kimi 等） |
| 模型版本号 | 未公开（由 Arena.ai 平台调度，不提供具体底层模型版本） |
| 知识库截止时间 | 未公开（依所调度的底层模型而定，平台未公开统一口径） |

### 新增
- **噪点瓦片**（`paintGrain`）：噪点从「遍历整屏每 2 像素随机打点」改成缓存的 128×128 噪点瓦片 + `repeat` 填充，
  深浅两种瓦片各缓存一份。背景重建（切换场景、拖动参数、切换主题色）不再卡顿，画面细密度基本不变。
- **雨丝贴图**（`makeStreakSprite`）：按斜率烘焙 5 档「发光雨丝」贴图（尾部渐隐 + 亮头光点），
  降雨方向由「横飘 / 下落」的真实速度比决定；另加 `makeGlassDropSprite` 与 4–11 颗贴在「玻璃」上缓慢下滑的近景雨珠。
- **整圈光束贴图**（`makeRayRingSprite`）：阳光的体积光束烘焙成一张整圈贴图，每帧旋转两层（一快一慢、尺寸不同）叠加。

### 调整
- **雨夜**：背景里烘焙 900 条静态细雨作为远景雨幕；动态雨滴目标数由 320 降到 170（每滴现在是一整条带辉光的雨丝），
  落地涟漪上限 90 → 70；动态雨滴只在 `step` 里更新位置，`draw` 里逐滴一次 `drawImage`。
- **阳光**：动态光尘上限 240 → 150，远处再烘焙 220 个静态光尘；光束贴图只在「光束强度」档位变化时重建（`rayKey` 判等）。
- **星空**：远景暗星（约 460 颗/满屏，含极淡光晕）在重建背景时一次画好，逐帧只保留会闪烁、会漂移的亮星，
  数量约为原来的三分之一；流星尾迹改为旋转的贴图（不再逐帧 `createLinearGradient`）。
- **极光**：整段重写。每层帘幕烘焙成一张与屏幕等宽的**半分辨率**贴图（整数波数保证左右边缘同相位、横向无缝平铺），
  逐帧只做 2 次平移贴图 + 1 次压扁倒影；层与层之间保留各自的色相与流速，所以仍有「层层翻卷」的层次感；
  新增由「光线强度」参数控制的竖直光柱；倒影改为在地平线下方压扁同一张贴图。
- **海浪**：水面碎光改为一块可横向循环平铺的碎光毯（两次平移贴图），波峰采样步长按屏幕宽度自适应（>1600px 用 22px 采样）。
- **粒子星链**：按需求**删除鼠标旁边那圈 220px 的光圈**（`glowSoft` 贴图与相关绘制一并移除），
  指针仍保留对节点的吸引；节点自身的辉光与星芒照旧，画面其余部分未改动。
- **页头明暗切换按钮**：开启配色主题（`colorTheme !== DEFAULT_COLOR_THEME`，即不是默认的「星野蓝」）后，`ThemeToggle` 自动隐藏；
  明暗模式改为在「配色主题」面板底部和 **设置 → 配色主题** 里切换，切回默认主题后按钮恢复。
  设置页的说明文字同步补充了这一点。
- 全面复查了各场景的逐帧循环：循环内不再创建渐变、不逐帧重建贴图，绘制顺序与叠加模式（`screen` / `lighter`）保持不变。

### 性能与降级
- 用替身 2D 上下文统计的每秒绘图 API 调用次数（同机同环境、两次测量取较低值）：雨夜 28817 → ~6700、
  阳光 7627 → ~1850、星空 5663 → ~2130、极光 4664 → ~1020、海浪 27063 → ~18200；
  粒子星链按需求只删光圈、画法未动，数值维持在 ~15000 上下（与基线 14580 同级）。
- 单次「切换场景 / 拖到最大 / 最小 / 回到默认」的四轮参数切换总调用量：星空 145512 → 8368、
  粒子星链 66529 → 41650、海浪 50834 → 22578（噪点瓦片 + 静态烘焙的直接效果，切换与拖动参数不再卡顿）。
- 像素比上限 1.5、粒子数量按面积缩放、场景限帧、标签页隐藏暂停、「减少动态效果」只画一帧等既有降级策略全部保留。

### 验证
- `tsc --noEmit` 与 `npm run build`（`tsc --noEmit` + `vite build`）通过。
- `npm run extension:test`：61 项中 57 项通过、4 项跳过（跳过项需要真实浏览器），与改动前一致。
- 用替身 2D 上下文在 jsdom 中把 8 个场景 × 4 组参数（默认 / 全最大 / 全最小 / 回到默认）
  完整跑了一遍 `setup → configure → step → draw`：0 报错、0 未捕获异常。
- 沙箱内没有真实浏览器，观感与真实帧率仍需部署后人工确认。

---

## 2026-10-16 · 配色主题与华丽版动态背景

| 模型信息 | |
| --- | --- |
| 模型名称 | Arena.ai Agent Mode（平台多模型动态调度，包括但不限于 Claude、ChatGPT、Gemini、Grok、Qwen、Kimi 等） |
| 模型版本号 | 未公开（由 Arena.ai 平台调度，不提供具体底层模型版本） |
| 知识库截止时间 | 未公开（依所调度的底层模型而定，平台未公开统一口径） |

### 新增
- **10 套配色主题**：星野蓝（默认）、深海青、极光紫、樱花粉、落日橙、森野绿、绯红、鎏金、赛博霓虹、墨白。
  色阶改为 CSS 变量（`--brand-50…950`、`--theme-accent`、页面底色与氛围光），`tailwind.config.js` 的
  `brand-*` 用 `rgb(var(--brand-500) / <alpha-value>)` 引用，因此按钮、链接、标签、光晕、正文外框与
  动态背景会一起换色，组件中不需要任何主题分支。
- **页头配色色卡面板**（`src/components/ThemePicker.tsx`）：一眼看到全部主题，一键换肤并快捷切换明暗模式。
- **设置页「配色主题」区块**：主题说明、预览色卡、「深色更佳」提示，以及「一键套用推荐动态背景」。
- **明暗模式新增「跟随系统」**，并保留原有的浅色 / 深色切换。
- **新增 5 种动态背景场景**：极光、樱花、飘雪、粒子星链、海浪（连同原有雨夜 / 阳光 / 星空共 8 种），
  每种 5 项可调参数（在原 4 项基础上各补 1 项，如雨夜的光晕强度、阳光的镜头光斑、星空的银河浓度、
  极光的帘幕纹理、樱花的背景散景、飘雪的闪光、粒子星链的数据脉冲、海浪的浪花泡沫）。
- 极光、海浪、粒子星链读取当前配色主题的主色作画；粒子星链会朝鼠标聚拢并显示光标辉光。

### 调整（画面整体升级为「远景贴图 + 中景粒子 + 光效叠加」三层结构）
- **雨夜**：城市灯火与高楼剪影、湿漉漉的街道反光与积水光斑、三层雨丝（近处带辉光）、漂浮雾团、
  落地涟漪；雷电由「闪光」升级为带分叉的落地雷，含光晕、电流本体与整屏闪光。
- **阳光**：太阳本体与暖色光晕、两遍绘制的体积光束（宽柔光 + 窄亮芯）、沿光轴分布的镜头光斑与光圈环、
  光尘改为柔和散景并混入十字星芒、天空疏密噪点消除色带。
- **星空**：夜空贴图新增银河光带、三团彩色星云与暗弱小星；星星分三层并带色温差异，
  亮星带四芒星芒，流星增加头部光斑与电离尾迹，另加极缓慢视差漂移。
- **极光**：帘幕改为带竖纹（射线）的预渲染贴图，切片错开高度形成飘动；新增背景星空、
  地平线冷光与地面剪影，以及洒在地平线上的帘幕倒影。
- **樱花**：新增逆光暖色天空、远处花簇、缓慢漂移的粉色散景；花瓣按远近分三档清晰度（预渲染模糊贴图），
  并加入翻折明暗、阵风起伏。
- **飘雪**：新增雪后光晕、远处朦胧雪片、近处虚化的大雪花光斑与十字星芒、底部积雪反光、阵风。
- **粒子星链**：新增主题色星云、暗星、地平线辉光、技术网格与暗角；光点呼吸、连线按距离渐隐，
  新增沿线滑动的数据脉冲（含尾迹）与光标处辉光。
- **海浪**：新增天空云层与云隙光、海面纵向阳光碎光带、浪尖高光、浪花泡沫与水面闪烁碎光。
- 所有场景补齐暗角与细噪点（烘焙在背景贴图中，逐帧不产生开销），统一叠加 `screen` / `lighter` 光效。

### 说明
- 本次只改「配色主题」与「动态背景」两部分；此前实验过的 Magic UI 组件、首页 Hero、
  卡片聚光等界面改动**全部未保留**，仓库不引入 `clsx` / `tailwind-merge` 等新依赖。
- 动态背景设置页的场景网格由 4 列改为 3 列（8 个场景），场景说明与降级说明同步更新。
- VS Code 扩展同步共享样式并重新打包：版本 2.0.2，`out/preview.js`、`resources/mpe/*` 与
  `starlog-markdown-2.0.2.vsix` 更新，扩展的测试断言与 README 中的文件名一并同步
  （命令、设置项与渲染行为均无变化）。

### 性能与降级
- 远景（天空渐变、银河、灯火、光斑、暗角、噪点）一次性烘焙进离屏 canvas，每帧只贴一次图；
  光点、花瓣、星芒、散景、帘幕全部使用预渲染贴图 + `drawImage`，逐帧循环中不创建渐变。
- 极光帘幕的切片宽度定为 48px（倒影再用更粗的切片），把单帧 `drawImage` 次数控制在数百次以内。
- 保持像素比上限 1.5、粒子数量按面积缩放、场景各自限帧、标签页隐藏暂停；
  系统开启「减少动态效果」时只绘制一帧静态画面。
- 配色主题与动态背景只保存在本设备（`localStorage`），不会写入仓库；首屏脚本在 React 启动前
  写入 `<html data-starlog-theme>`，避免闪烁。

### 验证
- `npm run build`（`tsc --noEmit` + `vite build`）通过。
- `npm run extension:test`：61 项中 57 项通过、4 项跳过（跳过项需要真实浏览器），与改动前一致。
- 用替身 2D 上下文（假 canvas）在 jsdom 中把 8 个场景 × 4 组参数（默认 / 全最大 / 全最小 / 连续运行）
  完整跑了一遍 `setup → configure → step → draw`：共 51.9 万次绘图 API 调用，0 报错、0 未捕获异常。
- 未在真实浏览器中确认观感与帧率，建议部署后人工过一遍（尤其是雨夜 60fps 与极光 30fps 的流畅度）。

---

## 2026-10-16 · 历史版本名称同步到 GitHub（本次）

| 模型信息 | |
| --- | --- |
| 模型名称 | Arena.ai Agent Mode（平台多模型动态调度，包括但不限于 Claude、ChatGPT、Gemini、Grok、Qwen、Kimi 等） |
| 模型版本号 | 未公开（由 Arena.ai 平台调度，不提供具体底层模型版本） |
| 知识库截止时间 | 未公开（依所调度的底层模型而定，平台未公开统一口径） |

### 新增
- **修改历史版本名加入待更新队列并保存到 GitHub**：文章页“历史”面板中修改版本名称后，会加入「待更新队列」（新类型「版本名称」），统一更新时写入对应文章旁的 `content/posts/{slug}.versions.json`，构建后所有访客可见；未更新前名称先在本浏览器立即生效。恢复默认（留空保存）会删除对应名称。
- 同一篇文章的多次改名合并为一条队列条目，同 sha 以最新名称为准；批量更新时与文章、图片、设置合并为一次 Git 提交、一次部署。
- 更新到仓库时以仓库现有名称映射为底叠加本次改名，不覆盖其他设备/协作者保存的名称；名称映射无实际变化时不产生提交。

### 调整
- 历史版本列表与版本对比中的名称显示优先级：本地名称 → 仓库名称 → 提交信息（即更新该 Git 记录展示的名字）。
- 删除文章时会一并清理文章旁的 `*.versions.json`（存在才删除，清理失败不影响文章删除）。
- README：同步更新历史版本、待更新队列、目录结构与手工写文件相关章节。

### 验证
- `npm run build`（`tsc --noEmit` + `vite build`）通过。
- 用临时 `*.versions.json` 验证 `import.meta.glob` 打包链路：名称映射成功进入构建产物。
- 未对真实 GitHub 仓库做端到端测试（需要真实授权）。

---

## 2026-10-15 · 动态背景：雨夜、阳光、星空（本次）

| 模型信息 | |
| --- | --- |
| 模型名称 | Arena.ai Agent Mode（平台多模型动态调度，包括但不限于 Claude、ChatGPT、Gemini、Grok、Qwen、Kimi 等） |
| 模型版本号 | 未公开（由 Arena.ai 平台调度，不提供具体底层模型版本） |
| 知识库截止时间 | 未公开（依所调度的底层模型而定，平台未公开统一口径） |

### 新增
- **动态背景**：雨夜、阳光、星空三个场景，显示在站点内容之下。
- **设置页“动态背景”**：可切换场景，并调节各场景参数（如雨量、下落速度、风向、雷电；光照、光束、光尘；星星数量、闪烁、流星等），支持恢复默认值。
- 深色场景（雨夜、星空）临时使用深色配色以保证可读性，关闭背景后恢复用户原有的明暗设置。

### 性能与体验
- 像素比上限 1.5；粒子数量随屏幕面积调整；背景与光晕预先绘制。
- 标签页隐藏时暂停动画；系统开启“减少动态效果”时只显示静态画面。
- 动态背景仅保存在本设备，不同步到 GitHub。

### 验证
- `tsc --noEmit`、`vite build`、`lint` 通过。
- 未在真实浏览器中做视觉与帧率测试，需部署后人工确认。

---

## 2026-10-15 · 处理剩余 Bug（本次）

| 模型信息 | |
| --- | --- |
| 模型名称 | Arena.ai Agent Mode（平台多模型动态调度，包括但不限于 Claude、ChatGPT、Gemini、Grok、Qwen、Kimi 等） |
| 模型版本号 | 未公开（由 Arena.ai 平台调度，不提供具体底层模型版本） |
| 知识库截止时间 | 未公开（依所调度的底层模型而定，平台未公开统一口径） |

### 修复
- **图片与文章分开提交**：批量更新时，若所选文章引用了队列中尚未上传的图片，该图片会自动一并提交，避免文章指向不存在的图片。
- **“发表申请”路径修改 slug 留下重复文章**：PR 中同时删除旧路径文件（旧文件不存在时自动跳过）。
- **非管理员通过 PR 更新已有文章失败**：写入已存在的文件时未带 `sha`，GitHub 返回 422。现会先读取基础分支上的 sha。
- **Fork 尚未就绪即建分支**：新建 Fork 是异步的，原先失败被静默吞掉。现在建分支遇到 404/422 会短暂重试（最多约 12 秒）。
- **PR 失败留下孤立分支**：写入或创建 PR 失败时，会删除刚创建的分支。
- **已成功提交却被误报为失败**：提交成功后的本地收尾（记录发布时间、删除已同步草稿）若因存储空间不足失败，原先会把整次提交标记为失败，导致重复提交。现改为尽力而为，不影响结果。

### 验证
- `tsc --noEmit`、`vite build` 通过；VS Code 扩展 `npm test` 57 项全部通过。
- 用模拟的 GitHub 接口验证：Fork 重试、带 sha 更新、同分支删除旧文件、PR 失败后清理分支；批量更新自动带上被引用的图片。
- 未对真实 GitHub 仓库做端到端测试（需要真实授权）。

---

## 2026-10-15 · 全面检查与修复（本次）

| 模型信息 | |
| --- | --- |
| 模型名称 | Arena.ai Agent Mode（平台多模型动态调度，包括但不限于 Claude、ChatGPT、Gemini、Grok、Qwen、Kimi 等） |
| 模型版本号 | 未公开（由 Arena.ai 平台调度，不提供具体底层模型版本） |
| 知识库截止时间 | 未公开（依所调度的底层模型而定，平台未公开统一口径） |

### 修复
- **评论 / 文章原始 HTML 未净化（安全）**：`Markdown.tsx` 使用 `rehype-raw` 后未过滤，评论区任何人都能插入 `<iframe>`、`<form>`、全屏遮罩等内容用于钓鱼。新增 `rehype-sanitize`（基于默认规则，仅放行折叠框、展示框、表格包裹所需的标签与属性），脚本、事件属性、`style` 与 iframe/form 均被移除；KaTeX 与代码高亮在净化之后添加，不受影响。
- **发布后本地草稿残留并覆盖仓库版本**：本地草稿优先于仓库文章显示，发布成功后草稿却不会删除。现在仅当草稿内容与已提交内容完全一致时才删除，之后又有新修改的草稿会保留。
- **修改 slug 后仓库中留下重复文章**：直接发布时若 slug 变化，旧路径的文章现在会一并加入删除。
- **分支 / 文章目录可在设置中修改**：站点只读取构建时配置的分支与目录，本地改写会导致“发布成功但看不到”。现改为只读，`owner` / `repo` 仍可覆盖。
- **GitHub 错误被误判为“文件不存在”**：`getSha` 吞掉了所有错误（鉴权失效、网络故障等），删除文章时会误报“远程仓库中不存在这篇文章”。现在只有 404 视为不存在，其他错误原样抛出。
- **frontmatter 换行丢失**：摘要中的换行写入 YAML 时未转义，读回后被折叠为空格。现已转义 `\n`、`\r`、`\t`。
- **加密文章在公开列表显示 1970 年**：占位日期现不再展示（卡片与归档均隐藏，归档归入“其他”）。
- **单条损坏数据导致整个列表失效**：本地草稿与待更新队列中结构损坏的条目会被跳过，不再影响其他文章。
- **OAuth 中转请求体大小按字符计算**：改为按字节计算，中文等多字节内容不会被低估（`oauth-relay/worker.js` 与 `functions/login/[[path]].ts`）。

### 调整
- README：补充原始 HTML 净化说明，以及分支 / 文章目录不可在本地修改的原因。
- 依赖：新增 `rehype-sanitize@^6`。

### 验证
- `tsc --noEmit`、`vite build` 通过；VS Code 扩展 `npm test` 57 项全部通过。
- 服务端渲染验证：恶意 HTML 被过滤；折叠框、展示框、公式、代码高亮保留；首页列出文章。
- 未在真实浏览器中做端到端验证（沙箱限制）。

---

## 2026-10-15 · 修复生产构建中仓库文章不显示的问题（本次）

| 模型信息 | |
| --- | --- |
| 模型名称 | Arena.ai Agent Mode（平台多模型动态调度，包括但不限于 Claude、ChatGPT、Gemini、Grok、Qwen、Kimi 等） |
| 模型版本号 | 未公开（由 Arena.ai 平台调度，不提供具体底层模型版本） |
| 知识库截止时间 | 未公开（依所调度的底层模型而定，平台未公开统一口径） |

### 修复
- **仓库文章在生产环境全部不显示**：`src/lib/posts.ts` 原先用 `typeof import.meta.glob === 'function'` 作为守卫读取 `content/posts/*.md`。Vite 生产构建只替换 `import.meta.glob(...)` 调用本身，守卫在浏览器中恒为假，导致所有已提交的文章（首页、归档、标签、搜索、文章页、管理后台）都读不到，只能看到浏览器本地草稿。开发服务器不受影响，因此此前未被发现。
- 修复方式：改为直接调用 `import.meta.glob`，并用 `try/catch` 兜底（非 Vite 环境返回空对象），行为与原设计意图一致。

### 验证
- `tsc --noEmit` 与 `vite build` 通过；生产构建产物中已不再包含该守卫，文章映射直接用于读取。
- 服务端渲染与模块加载验证：仓库内 8 篇文章均能正确读取。
- 未在真实浏览器中做端到端验证（沙箱限制），合并部署后需在线上页面确认。

---

## 2026-10-15 · 文档与 AI 协作约定

| 模型信息 | |
| --- | --- |
| 模型名称 | Arena.ai Agent Mode（平台多模型动态调度，包括但不限于 Claude、ChatGPT、Gemini、Grok、Qwen、Kimi 等） |
| 模型版本号 | 未公开（由 Arena.ai 平台调度，不提供具体底层模型版本） |
| 知识库截止时间 | 未公开（依所调度的底层模型而定，平台未公开统一口径） |

### 新增
- 新增 [`AI_README.md`](AI_README.md)：AI 协作维护规范——约定每次更新必须同步维护 README.md 与 ChangeLog.md，且 ChangeLog 条目必须注明模型名称、模型版本号与知识库截止时间（含条目模板与更新流程）。
- 新建本更新日志 [`ChangeLog.md`](ChangeLog.md)。

### 调整
- README.md 同步「待更新队列」「历史版本命名与渲染对比」的行为说明（简介、写作流程、加密文章、FAQ、目录结构），并新增「文档与维护约定」一节。

---

## 2026-10-15 · 待更新队列、历史版本命名与渲染对比、若干修复（PR #43）

| 模型信息 | |
| --- | --- |
| 模型名称 | Arena.ai Agent Mode（平台多模型动态调度，包括但不限于 Claude、ChatGPT、Gemini、Grok、Qwen、Kimi 等） |
| 模型版本号 | 未公开（由 Arena.ai 平台调度，不提供具体底层模型版本） |
| 知识库截止时间 | 未公开（依所调度的底层模型而定，平台未公开统一口径） |

### 新增
- **待更新队列**：内容管理界面「发表申请」右侧新增队列页。所有需要更新仓库的操作（发布/删除文章、上传图片、发表申请 PR、账号偏好同步）不再立即生效，先保存在本机；可勾选部分更改一次批量更新或全部更新，文件类更改合并为一次 Git 提交（一次部署），失败条目保留可重试。图片暂存本地并在站内预览中自动使用暂存数据。
- **历史版本命名**：历史版本列表可为任一版本修改显示名称（本地保存，优先于提交信息显示，可恢复默认）。
- **历史版本渲染对比**：版本对比新增「源码对比 / 渲染对比」切换，渲染模式并排展示两个版本的完整渲染效果。

### 调整
- 编辑器「发布到 GitHub / 申请发表」改为「加入更新队列」，统一更新时才真正提交；同文章多次更改只保留最新意图。
- 设置页字体/背景「保存到 GitHub 账号」改为入队，统一更新后同步；登录恢复偏好时不再用旧远程版本覆盖队列中未更新的更改。

### 修复
- 修复 `useEffect` 依赖对象引用不稳定导致仓库权限接口在 Admin/编辑器中反复请求（新增 `useRepoTarget` 稳定订阅）。
- 修复 GitHub contents API 路径与 ref 未按段编码（分支名含 `/`、文件名含空格等会请求失败）。
- 修复超过 1MB 的远程文件 contents API 不返回内容的问题（回退 `download_url`）。
- 修复畸形百分号编码导致文章锚点跳转、折叠框标题渲染崩溃。
- 修复 Toast 站内跳转链接误用 `target=_blank` 新标签页打开。
- 修复 VS Code 插件等非 Vite 打包环境中 `import.meta.glob` 加载即抛错（发布记录逻辑独立为 `publishTimes.ts`，并对 glob 加 typeof 守卫）。

### 验证
- `npm run build`（tsc + vite）通过。
- `npm run extension:test`：61 项测试全部通过（57 pass / 4 skip / 0 fail）。

---

## 更早的变更

在本日志建立之前完成的更新（当时未记录模型信息，一并补录于此供追溯），完整过程见
[Pull Requests](https://github.com/lrbkdgw/Blog/pulls?q=is%3Apr) 与 git 提交记录：

| 日期 | PR | 内容 |
| --- | --- | --- |
| 2026-10-11 | [#42](https://github.com/lrbkdgw/Blog/pull/42) | 重写 VS Code 插件：Markdown 语法拓展与博客同源渲染 |
| 2026-10-06 | [#41](https://github.com/lrbkdgw/Blog/pull/41) | fix(content): restore encrypted post tags |
| 2026-10-06 | [#40](https://github.com/lrbkdgw/Blog/pull/40) | 加密文章不再加密标签 |
| 2026-10-06 | [#39](https://github.com/lrbkdgw/Blog/pull/39) | 编辑器：滚动对齐与全屏改进、加密草稿修复与元数据保护、长文输入性能优化 |
