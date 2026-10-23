# 星野笔记 · Starlog

一个托管在 **GitHub Pages** 上的静态博客，但支持**登录**和**在线编辑**：内置 Markdown 编辑器（含 KaTeX 数学公式与代码高亮），写完先加入本地**待更新队列**，再统一批量提交回仓库并自动重新部署。界面精致：**10 套配色主题**与 **5 种动态背景**（樱花 / 粒子星链 / 雪花 / 暴雨 / 竹林），深色模式与「跟随系统」开箱即用。

```
React 19 + TypeScript + Vite + Tailwind CSS + react-markdown + KaTeX
```

---

## ✨ 功能

| | |
| --- | --- |
| 📝 **在线编辑** | 分栏实时预览、工具栏、快捷键、LaTeX 符号选择框（Shift + ↑，按别名搜索）、滚动同步、自动保存草稿 |
| 🧮 **KaTeX 公式** | 行内 `$…$` 与独立 `$$…$$`，支持 `aligned`、矩阵、分段函数 |
| 🎨 **配色主题** | 10 套主题（星野蓝 / 深海青 / 极光紫 / 樱花粉 / 落日橙 / 森野绿 / 绯红 / 鎏金 / 赛博霓虹 / 墨白）+ 浅色 / 深色 / **跟随系统**，页头色卡一键换肤，全站配色与动态背景一起变 |
| 🌌 **动态背景** | 樱花 / 粒子星链 / 雪花 / 暴雨 / 竹林 五种场景，**各自适配深色与浅色**（白昼 / 夜樱、浅色星图 / 暗夜、雪日 / 雪夜、阴雨白昼 / 雨夜、晨光 / 月夜竹林）：飘落花瓣与散景、主题色光点与连线、鼠标吸引与数据脉冲…暴雨是雨云下的山湖（三层混合林、分带倒影、晶莹折射水珠与近景散景水珠、中央阅读净空区及雷光），每种 5 项参数可调，星链颜色跟随配色主题 |
| 🔤 **排版偏好** | **正文与代码字体分开**的多字体优先级（默认正文 Google Sans → Noto Sans CJK SC，代码 Cascadia Code）、80%–130% 全站字号、自定义渐变背景色与强度 |
| 🔐 **GitHub OAuth 授权** | 基于 Device Flow 极简一键登录，令牌仅保存在浏览器本地 |
| 🚀 **待更新队列** | 发布/删除文章、上传图片、发表申请、偏好同步、修改版本名称等仓库操作先保存在本地，可勾选部分或全部**一次批量更新**（合并为一次提交、一次部署） |
| 🔍 **全文搜索** | <kbd>⌘</kbd>/<kbd>Ctrl</kbd> + <kbd>K</kbd> 唤起，支持方向键选择 |
| ♾️ **首页自动加载** | 向下滑动到列表底部附近（提前 420px）自动加载下一页，并把新卡片就地淡入；同一位置保留「加载更多」按钮作为不支持 `IntersectionObserver` 时的回退，状态行实时显示「已显示 / 总篇数」 |
| 🏷️ **标签 / 归档** | 标签云、按年归档、置顶、草稿、阅读时长、自动目录 |
| 🧰 **百宝箱 · 回声洞** | 顶栏内置「百宝箱」页签；「回声洞」独占全屏、无多余按键、完整沿用用户所选配色/渐变/动态背景，点击屏幕时上一句先以真实字形像素化灰随风消散下场、再逐字浮现来自 GitHub Discussions 与 hitokoto 的不重复下一句，底部仅设一条独立横线与箭头发送按钮（每小时识别前 3 条 / 每天前 10 条，仓库贡献者不受限制） |
| 🖼️ **图片上传** | 图片先暂存本地待更新队列，统一更新时提交到仓库 `public/uploads/` 并插入链接 |
| 🕓 **历史版本** | 每次发布均保留 Git 提交版本；可浏览、查看、继续编辑、**自定义版本名称**（随待更新队列保存到 GitHub 对应文章下），并对比任意两个版本的**源码差异**或**渲染差异**：渲染对比把相邻的删除 / 新增块合并成「已修改」卡片，旧内容淡斜纹 + 删除线、新内容绿色高亮，可「仅显示改动」「显示已删除」并在改动之间一键跳转 |
| 🔒 **密码文章** | 标题与标签公开，正文与其他信息由浏览器 Web Crypto 加密；本设备成功解锁一次后可自动恢复 |
| 🎛️ **交互展示框** | Markdown 中可声明整数、有理数、字符串变量，实时计算并渲染展示内容 |
| 🧩 **表单交互与条件映射** | 支持选择框 `ui-choose`、行内下拉框 `ui-select`（支持 `search`）、是否框 `ui-if`（支持 `lined` 划线动画）、填空/滑块输入框 `ui-write`（支持 `merge` 同行并列），以及 `<<id>>` / `<id>` 最高优先级值替换、`<IF:<a>,<b>>` 与 `::IF[<a>]…::IF_END` KaTeX 条件渲染（issue #82） |
| 📐 **直角坐标系** | `::begin_ui-ccs … ::end_ui-ccs` 语法支持描点、多点折线与函数曲线（如 `create_line:(7*x^2+6*x+90*x^3);`），可拖拽平移、滚轮/双指缩放预览整个平面（issue #76） |
| 🕸️ **图论画布** | `::begin_ui-graph[<附加项>] … ::end_ui-graph` 延续直角坐标系同款视觉与拖拽平移/滚轮缩放交互，支持 `dag` 有向边、可选边权与坐标、未声明端点自动创建，并在站内编辑器中支持**「调整模式」**可视化拖拽节点并直接写回 Markdown 源码保存（issue #83） |
| 📄 **文章排版指令** | 文首 `::set-font` / `::set-code-font` / `::set-background` 强制本文的字体与动态背景，仅在阅读本文时生效 |
| 📱 **响应式** | 手机 / 平板 / 桌面均已适配，支持打印样式 |
| 🧭 **全透明页头 + 全站防冲突让路** | 页头不铺底色、不加毛玻璃、不描边、不投影，背景原样透出；**全站所有页面**滚进顶栏前在页头下沿下方提前沿多控制点 Hermite S 曲线柔和消融（`src/lib/headerYield.ts`，含深色模式感知明度伽马补偿），字不与导航打架、背景一像素不动（issue #53 / #63 / #71 / #78）。编辑器进入全屏时会在绘制前清掉按旧滚动位置算出的残留遮罩，全屏 / 搜索 / 符号框共用引用计数滚动锁，Esc 优先交给上层弹窗（issue #104） |
| 📴 **离线单文件版** | 整站打包成一个 HTML，**完全不联网**也能阅读与写作（含加密文章、本机版本历史）；`main` 每次影响产物的改动都会自动重建、提交 `offline/index.html` 并刷新 Releases 上的滚动 tag `offline`（固定下载地址）；要回线上用「文章包」导入（见「📴 离线版」） |

---

## 🚀 快速开始

### 1. 本地运行

```bash
npm install
npm run dev        # http://localhost:5173
```

其他命令：

```bash
npm run build      # 类型检查 + 生产构建到 dist/
npm test           # 运行全站特性测试与 VS Code 插件回归测试
npm run preview    # 本地预览构建产物
```

### 2. 部署

#### 路线 A：Cloudflare Pages（推荐，与 OAuth 中转一体化，最省事）

1. <https://dash.cloudflare.com> → **Workers & Pages** → **Create** → **Pages** → **Connect to Git**
2. 授权 Cloudflare 访问 GitHub，选择本仓库，构建设置：
   - Framework preset：**None**
   - Build command：`npm run build`
   - Build output directory：`dist`
3. 保存后即可：自动构建站点 + 仓库内置的 Pages Function（OAuth 同源中转）+ SPA 路由，无需任何环境变量
4. 之后每次 push 到 `main` 自动重新部署。站点地址为 `https://<project>.pages.dev`，可在 **Custom domains** 里绑定自己的域名

> 构建时会检测到 Cloudflare 环境并自动使用 base path `/`；线上 OAuth 中转与页面同源，`oauthConfig.relayUrl` 留空即可，**不需要**再单独部署 oauth-relay Worker。

#### 路线 B：GitHub Pages（默认路线）

1. 把代码推送到 GitHub 仓库的 `main` 分支
2. 打开仓库 **Settings → Pages**，把 **Source** 设为 **GitHub Actions**
3. 等待 `.github/workflows/deploy.yml` 跑完，站点就上线了

Workflow 会自动判断 base path：

- 仓库名是 `<用户名>.github.io` → base 为 `/`
- 其他仓库名（如本仓库 `Blog`）→ base 为 `/Blog/`

> 本地构建时默认使用 `/Blog/`，可以用环境变量覆盖：
> `VITE_BASE_PATH=/ npm run build`
>
> 此路线下 OAuth 中转需按下方「配置 OAuth 登录」单独部署 oauth-relay Worker。

---

## ⚙️ 配置

所有站点信息集中在 **`src/lib/config.ts`**：

```ts
export const siteConfig = {
  title: '星野笔记',
  titleEn: 'Starlog',
  description: '记录数学、代码与一些深夜里的胡思乱想。',
  author: { name: 'lrbkdgw', bio: '…', avatar: '' },
  social: { github: '…', email: '', twitter: '', rss: '' },
  postsPerPage: 6,
}

export const githubConfig = {
  owner: 'lrbkdgw',      // 你的 GitHub 用户名
  repo: 'Blog',          // 仓库名
  branch: 'main',
  postsDir: 'content/posts',
}
```

### 配置 OAuth 登录

GitHub 登录使用 **OAuth Device Flow（RFC 8628）**，不再手动创建、粘贴 Token。
由于 GitHub 的 OAuth 端点不支持浏览器跨域（CORS），前端需要一个极简中转
（不含任何机密，只做转发）。仓库同时内置了中转的两种形态，按部署路线自动对应：

| 部署路线 | OAuth 中转 | relayUrl |
| --- | --- | --- |
| **Cloudflare Pages** | 仓库内置 `functions/login/[[path]].ts`（同源，零配置） | **留空** |
| **GitHub Pages** | 独立部署的 [`oauth-relay/`](oauth-relay/README.md) Cloudflare Worker | 填 Worker 地址 |

**① 创建 OAuth App（一分钟，两条路线都需要）**

1. 打开 <https://github.com/settings/developers> → **OAuth Apps** → **New OAuth App**
2. 名字、主页随意填（Device Flow 用不到回调地址）
3. 创建后在设置页勾选 **Enable Device Flow**
4. 复制 **Client ID**（形如 `Ov23li…`，无需 Secret）

**② 仅 GitHub Pages 路线需要**：按 [`oauth-relay/README.md`](oauth-relay/README.md) 把中转 Worker 部署到 Cloudflare Workers（约两分钟，免费），得到形如 `https://xxx.workers.dev` 的地址。

**③ 填入配置**（任选其一）：

```ts
// src/lib/config.ts
export const oauthConfig = {
  clientId: 'Ov23li…',      // ① 的 Client ID（必填）
  scope: 'public_repo',     // 私有仓库改为 'repo'
  relayUrl: '',             // Cloudflare Pages 部署留空；GitHub Pages 部署填 ② 的地址
}
```

或走环境变量：本地用 `.env.local`（见 `.env.example`）；GitHub Pages 路线在仓库
**Settings → Secrets and variables → Actions → Variables** 中新增
`VITE_GITHUB_CLIENT_ID` 与 `VITE_OAUTH_RELAY_URL`；Cloudflare Pages 路线在
Pages 项目 **Settings → Environment variables** 中新增 `VITE_GITHUB_CLIENT_ID`。

---

## 🎨 配色主题与动态背景

### 配色主题

换肤入口有两个：**页头的调色盘图标**（点一下就换，面板底部还有明暗模式快捷切换）和 **设置 → 配色主题**（每套主题都带说明与预览色卡）。

下表「建议搭配」只是文档里的推荐，设置页不会再弹「某主题适合搭配某动态背景」的提示条——
有 5 套主题本来就没有推荐场景，那条提示会显示成「适合搭配动态背景『无』」（issue #55）。动态背景在 **设置 → 动态背景** 里自己选。

一旦开启配色主题（即不是默认的「星野蓝」），页头那个单独的**明暗切换按钮会自动收起**——明暗模式改为在「配色主题」面板底部或 **设置 → 配色主题** 里切换，页头不会再并排挤两个按钮。切回「星野蓝」按钮即恢复。

| 主题 | 英文名 | 气质 | 建议搭配 |
| --- | --- | --- | --- |
| 星野蓝 | Starlight | 默认主题，安静克制的蓝紫 | 无 |
| 深海青 | Ocean | 清透的青色，像海面反光 | 粒子星链 |
| 极光紫 | Aurora | 紫与青交错的极光（深色更佳） | 粒子星链 |
| 樱花粉 | Sakura | 柔和的粉色 | 樱花 |
| 落日橙 | Sunset | 傍晚的暖橙 | 无 |
| 森野绿 | Emerald | 雨林般的绿色 | 无 |
| 绯红 | Crimson | 饱和度高的红，链接与标签很有存在感 | 粒子星链 |
| 鎏金 | Gilt | 深色底上的金色描边（深色更佳） | 无 |
| 赛博霓虹 | Cyber | 洋红与青的霓虹对撞（深色更佳） | 粒子星链 |
| 墨白 | Monochrome | 几乎无彩色的灰度 | 无 |

**实现方式**：每套主题在 `src/styles/index.css` 里是一段 `[data-starlog-theme='…'] { … }` 色卡，
写入 `--brand-50…950`、`--theme-accent`、页面底色与两团氛围光；`tailwind.config.js` 中的
`brand-*` 用 `rgb(var(--brand-500) / <alpha-value>)` 引用这些变量。于是切换主题时，
按钮、链接、标签、光晕、正文外框、动态背景会一起换色，**组件代码里没有任何主题分支**。
`index.html` 的首屏脚本会在 React 启动前写入 `<html data-starlog-theme>`，避免闪一下再变色。
配色主题的判定在 `src/lib/theme.tsx` 里通过 `useTheme().colorTheme` 暴露，页头据此决定是否显示明暗切换按钮。

**页头完全透明（issue #63）**：吸顶页头不铺底色、不加毛玻璃、不描边、不投影，
页面内容与动态背景会原样从导航文字下面滚过；因此下滑时不会出现任何整条的白带 / 黑带，
不论浅色 / 深色、哪套配色主题或是否开启动态背景。移动端展开的菜单面板仍是独立的浮层，
用 `--site-header-surface`（浅色 = `--theme-surface-light`，深色 = `--theme-surface-dark`）
保证菜单可读。`<meta name="theme-color">` 由 `ThemeProvider` 按同一组变量写入，跟随**实际生效**
的明暗而不是系统的 `prefers-color-scheme`，手机地址栏不会再出现与站内明暗相反的黑条 / 白条。

**新增一套主题**：复制一段色卡改成自己的色阶 → 在 `src/lib/themes.ts` 的 `COLOR_THEMES`
里补一条（名称、描述、预览用色卡、建议场景）→ 在 `index.html` 的 `THEME_IDS` 数组里加上 id。

### 动态背景

五种场景均由 Canvas 绘制，每种提供 5 项参数，自动跟随浅色 / 深色 / 跟随系统模式。
在「设置 → 动态背景」选择场景、调整滑块，切换场景会保留各自的参数；偏好默认保存在本设备，登录 GitHub 后可随配色主题、明暗模式与渐变背景一起同步到账号（见下方「账号外观同步」）。

| 场景 | 浅色模式 | 深色模式 | 可调参数 |
| --- | --- | --- | --- |
| 樱花 | 白昼粉调天空、两侧花枝与五瓣花簇、暖色散景 | 夜樱、淡粉月光与紫色散景 | 花瓣数量、飘落速度、风向风力、花瓣大小、背景散景 |
| 粒子星链 | 墨色光点与连线的浅色星图 | 主题色辉光、星芒与数据脉冲 | 光点数量、连线距离、漂移速度、辉光强度、数据脉冲 |
| 雪花 | 清冷雪日、远山雪坡与蓝灰雪晶 | 蓝调雪夜、明亮雪晶与近景柔焦雪片 | 雪花数量、飘落速度、风向风力、雪花大小、回旋幅度 |
| 暴雨 | 阴雨白昼的雾面山湖：三层混合林、层间薄雾、浅蓝灰水面与斜雨 | 月夜山湖：云隙月光、林线剪影、分带倒影与涟漪、岸边暖灯 | 雨量、落雨速度、风向风力、雨雾强度、闪电亮度 |
| 竹林 | 晨光青竹、分层叶簇与斜射光 | 幽绿月夜、月光与林间薄雾 | 竹林密度、摇曳幅度、摇曳速度、林间薄雾、透光强度 |

暴雨的闪电默认关闭；调高「闪电亮度」后，每隔 8–18 秒出现一次雷光：云层与水面的亮度抬一下，
并附一道分叉闪电，全程约 0.5 秒，不做全屏白闪。

暴雨的画面由四层叠成（云与天光 → 三层远山 + 连片林冠 → 湖面倒影 + 柔焦水纹 → 光学梭形水滴、远景雨幕与涟漪），
两侧再压一组虚焦芦苇当前景。云是 512×224 的分形噪声贴图横向拉满天空，越靠地平线越薄；
林冠由固定种子的「低频成簇 × 高频树梢」生成，阔叶冠的十二团树冠按 `seed` 抖动，窄屏按 `pow(w/1440, .35)` 收一档树高；
倒影分 7 个横带贴回并逐带降低透明度，岸线只压一道很薄的水色，贴岸就能看见树影。
浅色模式在烘焙时整体提亮一档并加 15% 亮纱，保证正文压在山湖上仍然可读；
雨滴摒弃等粗硬边直线描边，改为预烘焙首尾渐隐、横向高斯羽化的光学水滴贴图并叠加远景柔焦雨幕，同时在中央正文阅读列平滑压低雨滴对比度，避免跨字闪烁干扰阅读。
静态部分与水滴贴图在建立背景时烘焙进离屏 Canvas，逐帧仅做双线性 `drawImage` 合成。
山脊与林冠都用固定种子的函数生成，缩放窗口不会「换一座山」；
椭圆柔光统一走预渲染贴图再拉伸（不在 `ctx.scale()` 之后建渐变），避免大面积柔光出现竖直色阶接缝；
雨雾与远景雨幕贴图四周平滑羽化归零，横移时不会在屏幕里留下硬边。
雪花、暴雨和竹林的渲染器在 `src/components/WeatherBackdrops.ts`，
樱花、粒子星链及动画生命周期在 `src/components/AnimatedBackdrop.tsx`，参数定义在 `src/lib/animatedBackground.ts`。

**即时更新**：花瓣 / 雪花大小会即时作用于已有粒子；调整数量只增减粒子，不重新随机整个场景。
切换明暗只重建配色贴图，保留粒子、竹竿的位置与动画进度；粒子星链也会即时跟随配色主题更新颜色。
星链脉冲仅在实际连线范围内运动，鼠标离开页面或窗口失焦后停止吸引。

**性能与降级**：背景、雪晶、水滴、竹竿与叶簇等预绘到离屏 Canvas；逐帧循环不创建渐变。
粒子数量随视口面积缩放并设上限；星链使用空间分桶查找相邻节点，水面涟漪最多 56 个。
像素比上限 1.5，暴雨最高 60 FPS，樱花 / 星链 / 雪花最高 30 FPS，竹林最高 24 FPS。
标签页隐藏时暂停，系统开启「减少动态效果」时只显示静态画面；切换场景会清理动画帧、待处理的尺寸更新和事件监听。

粒子星链仍不添加随机微粒或颗粒噪点；细颗粒只保留在浅色樱花背景。
无法识别的旧场景偏好回退为「无」，当前支持的场景会按现有参数范围读取；历史变化见 `ChangeLog.md`。

**文章可强制指定场景**：在文章开头写 `::set-background[<id>]`（见下方「文章排版指令」），
阅读本文时临时改用指定场景（参数仍用读者为该场景保存的值），离开文章立即恢复个人偏好，
不写入任何设置。编号固定为 0 无 · 1 樱花 · 2 粒子星链 · 3 雪花 · 4 暴雨 · 5 竹林，
定义在 `src/lib/articleDirectives.ts` 的 `ARTICLE_BACKGROUND_SCENES`（新增场景只能往后追加编号）。

### 账号外观同步

配色主题、明暗模式、渐变背景与动态背景属于同一组「外观偏好」。登录并连接 GitHub 后，
在 **设置 → 外观偏好同步** 点「同步外观到 GitHub」会把它们一起加入待更新队列，
统一更新时写入仓库的 `.starlog/settings/background-preferences/<login>.json`
（每个账号一个文件，`version: 3`，含 `colorTheme`、`themeMode`、`background` 与 `animatedBackground`）。
换一台设备登录同一账号时会读取该文件并自动恢复；旧版只含背景颜色的 `version: 2` 文件仍可读取。
字体与字号使用独立的 `.starlog/settings/font-preferences/<login>.json`。

---

## 🔤 字体与字号

设置页的「字体与字号设置」分三块：全站字号、**正文字体优先级**、**代码字体优先级**。

### 默认字体栈

| 用途 | CSS 变量 | 默认优先级（从高到低） |
| --- | --- | --- |
| 正文 / 界面 | `--font-sans` | `Google Sans` → `Noto Sans CJK SC` → `Noto Sans SC` → 系统无衬线（system-ui / -apple-system / Segoe UI / PingFang SC / Hiragino Sans GB / Microsoft YaHei） |
| 代码 / 等宽 | `--font-mono` | `Cascadia Code` → 系统等宽（ui-monospace / SFMono-Regular / SF Mono / Menlo / Consolas / Noto Sans Mono CJK SC） |
| 衬线回退 | `--font-serif` | Georgia → Songti SC → STSong → SimSun → Noto Serif SC |

`Google Sans` 不含中文字形，中文自然落到第二优先级的 `Noto Sans CJK SC`；两个都没装时再回到系统字体。
代码字体作用于代码块、行内代码、`<kbd>` 快捷键与表格里的等宽文字（Tailwind 的 `font-mono` 直接引用 `--font-mono`）。

### 自定义

- 正文与代码是**两组独立的优先级列表**（issue #54）：各自可以输入字体名添加、上下调序、移除，
  列表下方有一行实时样例。留空即使用上面的默认栈。自定义的正文字体会同时写入 `--font-sans` 与 `--font-serif`。
- 「读取本机字体」用浏览器的 Local Font Access API（Chromium 系）列出本机字体作为候选；不支持时手动输入即可。
- 本机没有的字体会**在后台**尝试从 Google Fonts 拉取：不阻塞设置生效，拉不到就静默回退到本地 / 系统字体。
  （旧实现是逐个 `await`、每个最多等 5 秒，加了几个本机没有的字体就会假死十几秒。）
- 字号 80%–130% 写在 `<html>` 的 `--site-font-size` 上，正文、标题、界面文字与 KaTeX 公式按比例一起缩放。
- 登录后可把「字体 + 字号」保存到 GitHub：仓库内 `.starlog/settings/font-preferences/<login>.json`，
  `version: 3`，`family` 与 `monoFamily` 各是一个逗号分隔的优先级列表。该操作先进**待更新队列**，统一更新时才提交。
  旧的 `version: 2` 文件（只有 `family`）仍能读取，代码字体回落到默认栈。

**维护提示**：默认字体栈有三份副本，改动时要一起改——`src/styles/index.css` 的 `:root`（真正的默认值）、
`src/lib/fontStacks.ts` 的 `SANS_FALLBACK` / `SERIF_FALLBACK` / `MONO_FALLBACK`（自定义字体缺字形时的回退，
字体偏好与文章排版指令共用，`font.tsx` 仅 re-export）、
`index.html` 的首屏内联脚本（React 挂载前恢复本地偏好，避免闪字体）。

文章也可以只对**自身**强制字体：在开头写 `::set-font[字体名]` / `::set-code-font[字体名]`
（见下方「文章排版指令」），优先级高于这里的个人偏好，本机没有的字体会同样在后台尝试
Google Fonts，离开文章即恢复，不改动已保存的设置。

---

## 🧩 VS Code 插件：Markdown 语法拓展

仓库自带可直接安装的 **Markdown 语法拓展**插件。它在 VS Code **内置 Markdown 预览**中直接复用本站的 React 渲染组件、KaTeX / 高亮配置与 Tailwind 样式，展示框中的公式、表格和代码也会随变量实时更新。

```bash
code --install-extension vscode_extensions/v1/starlog-markdown-2.3.0.vsix --force
```

安装后打开 `.md` 并使用 `Ctrl/⌘+K V` 分屏预览；命令 **Markdown 语法拓展: 打开语法示例文档**可用于对照检查。成品内嵌所需脚本、样式与公式字体，无需额外插件或本地博客服务。MPE 保留为可选静态兼容模式，完整同款交互效果请使用内置预览。

普通/合并表格默认靠左，Tuack 表格保持居中。VS Code Settings 中的 `starlog.preview.enableGradientBackground` 可以启用博客渐变背景，默认关闭，修改后自动刷新预览。

插件与本站共用同一份扩展语法实现，包括下文的**文章排版指令**（字体指令在预览正文中生效，背景指令在预览中只移除不切换）与 **LaTeX 符号目录**：在 Markdown 编辑器中按 `Shift + ↑` 或执行命令「插入 LaTeX 符号…」，即可按命令或别名搜索并把符号插入光标处。

安装、语法和开发说明见 [插件 README](vscode_extensions/v1/README.md)。在根目录安装依赖并执行 `npm ci --prefix vscode_extensions/v1` 后，可运行 `npm run extension:test` / `npm run extension:package` 验证或重新打包。

---

## ✍️ 两种写作方式

### 方式 A：在站内写（推荐）

1. 访问 `/login` 点击 **使用 GitHub 登录**
2. 验证码将自动复制到剪贴板，在自动打开的 GitHub 页面粘贴并授权
3. 授权后自动完成登录 → 写文章 → 点 **加入更新队列**（或申请发表 PR）→ 在内容管理的「待更新队列」中勾选部分或全部**统一更新**到 GitHub。若所选文章引用了队列中尚未上传的图片，这些图片会自动一并提交

所有需要更新仓库的操作（发布/删除文章、上传图片、发表申请、偏好同步、修改版本名称）都会先保存在本机，不会立即生效；统一更新时文件类更改会合并为一次提交并只触发一次部署。点击队列中的任意一条（或右侧的「diff」）可以查看它相对仓库当前文件的差异，确认后再更新。

整个过程基于 OAuth Device Flow，全程不需要创建或粘贴 Token。
授权令牌只保存在你浏览器的 `localStorage`，只会发送给 `api.github.com`，
可随时在 <https://github.com/settings/applications> 撤销授权。

### 方式 B：直接写文件

在 `content/posts/` 下新建 `.md` 文件，推送到 `main` 即可：

```markdown
---
title: "文章标题"
date: "2025-09-29"
summary: "一句话摘要，留空会自动截取正文"
tags: ["数学", "前端"]
cover: ""        # 可选，封面图 URL
draft: false     # true 则不在公开列表中显示
pinned: false    # true 则置顶到首页
---

正文从这里开始，支持 **Markdown**、KaTeX 公式 $e^{i\pi}+1=0$ 和代码高亮。
```

文件名即默认的 URL 别名：`content/posts/hello.md` → `/posts/hello`。
文章旁可选的同名 `hello.versions.json`（`{ "<commit sha>": "版本名" }`）用于自定义该文章历史版本的显示名称，可直接手工编写或在文章页“历史”面板中修改（后者会经待更新队列写回）。

---

## 🎛️ 交互展示框语法

用 `::show_begin` / `::show_end` 包住需要实时展示的 Markdown。第二组花括号声明变量；
变量之间用逗号或分号分隔，推荐简写为 `Z`（整数）、`Q`（有理数）、`S`（字符串）。整数默认显示数字输入框和滑动条；有理数默认只显示数字输入框，在定义末尾加 `{faster_set}` 后显示滑动条；字符串的两个限制值为最小、最大长度。

```markdown
::show_begin{二次函数}{a:Z=1[-5,5,1]; b:Q=0[-10,10,0.5]{faster_set}; name:S=星野[0,12]}
当 *&show(a)*&、*&show(b)*& 时，$a^2+b$ = *&hs(a^2+b)*&。
向下保留两位：&*floor(a^2+b,2)&*；向上保留两位：&*ceil(a^2+b,2)&*。

*&a:{-1,负一;0,零;1,正一}*&
::show_end
```

- `*&show(变量名)*&` 输出当前变量。
- `*&hs(表达式)*&` 计算仅含 `+ - * / ^ ()` 和数值变量的多项式/有理式。
- `&*floor(数值,位数)&*` 按指定位数向下取整，例如 `&*floor(1.239,2)&*` 得到 `1.23`。
- `&*ceil(数值,位数)&*` 按指定位数向上取整，例如 `&*ceil(1.231,2)&*` 得到 `1.24`。
- `*&变量名:{键,显示内容;...}*&` 声明变量值到内容的映射；映射会优先替换渲染内容，且未在标题中声明的变量会自动生成控件。

以上写法均等价于在源码中把该片段直接替换为对应的值或字符串（不会额外套一层代码框），因此可以用在正文、表格、公式或代码块中。`floor` / `ceil` 的数值参数也可以是包含数值变量的表达式。

文章页的「复制」菜单可以复制文章链接、原始源码、洛谷源码或基本 Markdown 源码。洛谷源码会把 Blog 专属的展示框与直角坐标系转换为静态 Markdown，并移除下文的文首排版指令；基本源码还会把单元格合并、折叠框和 Tuack 表格等洛谷扩展转换为普通 Markdown。

## 📐 直角坐标系语法（ui-ccs）

使用 `::begin_ui-ccs` 与 `::end_ui-ccs` 包围绘图指令，即可渲染无上下工具栏干扰的极简二维直角坐标系，支持**拖拽平移、滚轮/双指缩放、双击复位，悬浮在线上实时显示距指针最近的点坐标，靠近交点、折点、端点或单点时优先磁吸显示精确坐标**（issue #76）：

```markdown
::begin_ui-ccs
create_point:(0,0);
create_line:(-3,-2),(0,1),(3,-1),[color=red];
create_line:(7*x^2+6*x+90*x^3);
::end_ui-ccs
```

- `create_point:(x,y);`：绘制一个或多个坐标点，末尾可加 `,[color=...]` 指定颜色。
- `create_line:(x_1,y_1),(x_2,y_2),...,(x_n,y_n),[color=red];`：按顺序连接多个坐标点绘制线段或折线，可选 `[color=...]` 设置颜色。
- `create_line:(表达式);`：绘制显式函数 $y = f(x)$ 的曲线（支持 `+ - * / ^`、括号、隐式乘法及 `sin`、`cos`、`tan`、`sqrt`、`abs`、`ln`、`exp` 等常见函数，自动自适应细分采样与视口裁剪），可选 `,[color=...]`。
- 支持嵌套在 `::show_begin … ::show_end` 展示框内，随变量滑块实时更新函数曲线与点线位置。

## 🕸️ 图论画布语法（ui-graph）

使用 `::begin_ui-graph[<附加项>]` 与 `::end_ui-graph` 包围图定义，延续与二维直角坐标系一致的简洁卡片外框与**拖拽平移、滚轮/双指缩放、双击复位**交互（纯图论画布展示，不显示坐标轴、网格或节点坐标气泡）（issue #83）：

```markdown
::begin_ui-graph[dag]
5
1 2 10
2 3 5
::end_ui-graph
```

- `<point>`（或 `<point> (<x>, <y>)`）：创建节点（可选指定平面坐标）；**即使某个点从未单独创建过，只要出现在边中也自动创建**。
- `<s> <t> <w> <x> <y>`：声明从起点 `s` 到终点 `t` 的边，其中边权 `w` 与坐标 `x, y` 均为可选项；边权以**纯数字**直接标注在边旁（不再带白色/深色底色块，避免遮挡边线与正文）（issue #91）。
- 附加项 `[dag]`：启用有向图渲染（自动计算停靠于节点圆周上的箭头、平行重边弧线与自环曲线）。
- **编辑器「调整模式」**：在站内编辑器中编辑文章时，画布右上角自动提供「调整模式」开关，开启后可直接拖拽图中任意节点调整位置并写回对应 Markdown 源码块保存，亦支持一键重置自动布局。

## 🧩 表单交互与条件映射语法（ui-choose / ui-select / ui-if / ui-write / IF）

支持在文章中嵌入四类表单交互控件，并通过最高优先级的 `<<id>>` / `<id>` 替换与 KaTeX 数学条件公式动态控制正文渲染（issue #82）：

```markdown
::begin_ui-choose[a_new_choose][今天吃什么][more 1 2]
[A]
香蕉好吃！
[B]
我！
爱！
$\texttt{吃}$！
香！
蕉！
[$\sum$]
计算题！
::end_ui-choose

当前饮品：
::begin_ui-select[Drink][search]
乌龙茶
美式咖啡
柠檬水
::end_ui-select

::begin_ui-if[Todo][lined]
完成第一题
::nex
完成对拍验证
::end_ui-if

我今天要吃 ::ui-write[Number][R 0 1 4] 根香蕉！

::ui-write[Name][len 2 4][new][name 名字]
::ui-write[Tag][set 极客][len 1 6][new][merge][name 头衔]

::ui-write[Ti][R 0 0 3][new][name 已经吃的香蕉][faster]

<IF:$<number> \le <Ti>$,你真棒！><IF:$<number> \leq 2 \times <Ti>$,还不错！>

::IF[$<Todo-1> == 1$]
> 第一题已完成！
::IF_END
```

- **选择框 `::begin_ui-choose[<id>][<name>][<附加项>] … ::end_ui-choose`**：默认单选，`more <down> <up>` 指定最少/最多可选数量，选项按从上到下以 $1$ 起编号。
- **下拉框 `::begin_ui-select[<id>][<附加项>] … ::end_ui-select`**：默认单选且紧跟在上一行文本后，支持 `more <down> <up>` 与 `search` 搜索过滤。
- **是否框 `::begin_ui-if[<id>][<附加项>] … ::end_ui-if`**：以 `::nex` 分隔各布尔项，通过 1-indexed `<<id-number>>` / `<id-number>` 引用（`0`/`1`），`lined` 启用勾选划线动画。
- **填空框 `::ui-write[<id>][<附加项>]`**：默认紧接当前行文本后，支持 `set <number>`、`R <bit> <down> <up>`、`len <down> <up>`、`new`、`name <name>`（需 `new`）、`faster`（需 `R` + `new`）与 `merge`（与前一个无内容间隔的 `new` 共用一行）。
- **值替换与条件渲染**：`<<id>>` / `<id>` 以最高优先级替换为控件当前值或 1-indexed 选项编号；`<IF:<a>,<b>>` 与 `::IF[<a>] … ::IF_END` 支持含四则运算、位运算、比大小与逻辑运算的 KaTeX 条件表达式。

## 📄 文章排版指令（字体与背景）

在文章**最开头**（frontmatter 之后、第一段正文之前）可以写三条指令，强制本文的排版。指令行本身不是正文，不会出现在渲染结果、摘要与字数统计里：

```markdown
::set-font[LXGW WenKai]
::set-code-font[Fira Code]
::set-background[1]

正文从这里开始……
```

| 指令 | 作用 |
| --- | --- |
| `::set-font[<name>]` | 本文的正文字体（含标题与摘要区） |
| `::set-code-font[<name>]` | 本文的代码字体（代码块、行内代码、`<kbd>` 等） |
| `::set-background[<id>]` | 阅读本文时的动态背景场景编号（见下表，`0` 表示强制无背景） |

场景编号（与「设置 → 动态背景」的场景一一对应，参数仍用读者为该场景保存的值）：

| id | 0 | 1 | 2 | 3 | 4 | 5 |
| --- | --- | --- | --- | --- | --- | --- |
| 场景 | 无 | 樱花 | 粒子星链 | 雪花 | 暴雨 | 竹林 |

规则细节：

- **只有文首的连续指令区有效**（可夹空行）。正文开始之后再写同形文字只是普通文本；在代码围栏里演示语法不会被执行。
- `::set-font` / `::set-code-font` 可写多条：**越早出现的优先级越高**，后面的作为回退（与设置页的字体优先级列表相同模型），一条指令里也可用逗号写多个字体名，列表最后仍接站点默认字体栈兜底。`::set-background` 写多条时第一个**合法**编号（0–5）生效，非法编号忽略。
- **只是临时覆盖**：优先级高于读者的个人字体 / 背景偏好，但不写入浏览器、待更新队列或 GitHub，离开文章页立即恢复。指定的字体本机没有时，与设置页自定义字体一样在后台尝试 Google Fonts，拉不到则回退。
- 生效范围：字体——文章页（含标题区）、编辑器预览、版本对比、VS Code 插件预览；背景——文章页与站内编辑器（插件没有 Canvas 动态背景，预览中仅移除该行）。评论不识别这组指令（按普通文字显示，与 GitHub Discussions 上一致），他人内容无法借此改动页面排版。
- 复制源码时：「直接复制」原样保留指令；洛谷 / 基本源码会移除（那两个平台不认识这组语法）。

实现：解析在 `src/lib/articleDirectives.ts`（含编号↔场景映射与字体样式拼接），
渲染管线在 `src/components/Markdown.tsx` 的预处理里整体移除指令行（行号映射照常对齐），
字体通过作用域 CSS 变量 + 容器 `font-family` 局部生效，背景经
`src/lib/animatedBackground.ts` 的内存级 `setAnimatedSceneOverride` 临时覆盖 Layout 的背景层。

## 🕓 历史版本与加密文章

每次通过编辑器发布文章都会创建一个 Git commit，因此无需额外数据库即可保存完整历史。文章页“历史”按钮会列出该 Markdown 文件的每次提交，并可为任一版本**修改版本名称**（优先于提交信息显示，即更新该 Git 记录展示的名字）。修改名称会**加入待更新队列**，统一更新后保存到 GitHub 对应文章旁的 `content/posts/{slug}.versions.json`，构建后所有访客可见；未更新前名称先记录在本浏览器立即生效。同一文章的多次改名合并为一条队列条目，恢复默认（留空保存）会删除对应名称，删除文章时该名称文件也会一并清理。查看某个历史版本后点“编辑”时，若现有文章（含内容）完全一致就进入对应编辑页，否则会新建一份已填充该历史内容的本地草稿。

历史面板中的“**版本对比**”可任选原始版本与新版本，在**源码对比**（逐行高亮新增与删除，支持交换方向、只看差异附近内容）与**渲染对比**之间切换。

**渲染对比**以 Markdown 块为单位（不会截断代码围栏或列表），只展示较新版本的正文，并按「改动卡片」组织：

- 相邻的删除块与新增块合并成一张 **已修改** 卡片，旧内容在上、新内容在下，一眼能看出哪段换成了哪段；
- 旧内容使用极淡的斜纹底色 + 红色删除线（保留可读性），新内容使用绿色左侧竖线与浅色渐变；
- 顶部摘要给出「+N 段 / −M 段」与改动处数，可在改动之间 **上一处 / 下一处** 跳转；
- 两个开关：「**仅显示改动**」隐藏未改动的原文块（长文只看差异），「**显示已删除**」关闭后隐藏纯删除卡片、修改卡片只留新内容；
- 每个块的 `prose` 首尾外边距已收敛，多块拼起来仍像同一篇文章，而不是一段段孤立的绿/红方块（issue #105）。

拥有目标仓库直接推送权限的管理员可在编辑器“文章信息”中勾选“发布为带密码的加密文章”。文章标题与标签会保留在公开 frontmatter 中（标签不加密，标签云与标签页照常可用），正文和其余文章信息会在浏览器内用 **PBKDF2-SHA-256 + AES-256-GCM** 加密后再加入待更新队列（队列里保存的即是密文，密码不会写入队列）。密码不会写入 GitHub、浏览器存储或 URL；成功解锁后，浏览器仅在 IndexedDB 中保存不可导出的 `CryptoKey`，同一设备再次查看或编辑可自动解锁。可在设置页随时清除已记住的解锁状态。请仍自行妥善保管密码：忘记密码且清除站点数据后无法恢复文章内容。

---

## ⌨️ 编辑器快捷键

| 快捷键 | 作用 |
| --- | --- |
| <kbd>⌘</kbd>/<kbd>Ctrl</kbd> + <kbd>S</kbd> | 保存草稿 |
| <kbd>⌘</kbd> + <kbd>B</kbd> / <kbd>I</kbd> | 粗体 / 斜体 |
| <kbd>⌘</kbd> + <kbd>K</kbd> | 插入链接 |
| <kbd>Tab</kbd> / <kbd>Shift</kbd>+<kbd>Tab</kbd> | 缩进 / 反缩进 |
| <kbd>Shift</kbd> + <kbd>↑</kbd> | 打开 **LaTeX 符号选择框**：按命令或别名搜索（「正负」→ `\pm`、「异或」→ `\oplus`），方向键选择、Enter 插入到光标处，插入后光标落在第一个空参数内；插入过程不会把页面拽到文末（先恢复光标再以 `preventScroll` 聚焦，见 `src/lib/caret.ts`，issue #70）；最近用过的符号会记住（评论输入框同样支持，符号目录 `src/lib/latexSymbols.ts`，与 VS Code 插件共用） |
| <kbd>Enter</kbd> | 列表内自动续行（空项自动结束列表） |

全站快捷键：<kbd>⌘</kbd>+<kbd>K</kbd> 或 <kbd>/</kbd> 打开搜索。

---

## 📁 目录结构

```
.
├── .github/workflows/deploy.yml   # GitHub Pages 自动部署（路线 B）
├── .github/workflows/offline.yml  # 离线单文件版构建（自检后提交到 offline/，并发布 Rolling Release）
├── offline/index.html             # 离线单文件版产物（自动生成，请勿手工编辑，见 offline/README.md）
├── vite.offline.config.ts         # 离线构建配置（内联一切，`__STARLOG_OFFLINE__ = true`）
├── scripts/vite-plugin-single-html.mjs  # 单文件内联插件（含构建期硬校验）
├── scripts/verify-offline.mjs           # 构建后自检：缺字体 / 缺文章 / 残留外链 / 语法破坏 → 失败
├── functions/login/[[path]].ts    # OAuth 同源中转（Cloudflare Pages，路线 A）
├── oauth-relay/                   # OAuth 极简 CORS 中转（独立 Worker，路线 B 用）
├── content/
│   ├── about.md                   # 「关于」页内容
│   └── posts/                     # 所有文章（*.md）与历史版本名称（*.versions.json）
├── public/_redirects              # Cloudflare Pages 的 SPA 路由兜底
├── src/
│   ├── components/                # Layout / Markdown / 搜索 / 目录 / Toast / GitHub 授权
│   │   ├── AnimatedBackdrop.tsx   # 动态背景生命周期、樱花与粒子星链
│   │   ├── WeatherBackdrops.ts     # 雪花、暴雨与竹林（Canvas）
│   │   ├── CoordinatePlane.tsx    # 可交互二维直角坐标系（::begin_ui-ccs）
│   │   ├── GraphPlane.tsx         # 可交互图论画布与编辑器「调整模式」（::begin_ui-graph）
│   │   ├── UiWidgets.tsx          # 选择框 / 下拉框 / 是否框 / 填空框交互组件
│   │   ├── LatexPicker.tsx        # LaTeX 符号选择框（Shift + ↑）
│   │   └── ThemePicker.tsx        # 页头配色主题色卡
│   ├── lib/                       # 配置、文章解析、认证、GitHub API、待更新队列、主题
│   │   ├── headerYield.ts         # 全站顶栏防冲突渐变遮罩引擎（含全屏前的同步清理）
│   │   ├── scrollLock.ts          # 浮层背景滚动锁（引用计数，全屏编辑器 / 搜索 / 符号框共用）
│   │   ├── infiniteScroll.ts      # 首页触底自动加载（IntersectionObserver 封装 + 无 IO 回退）
│   │   ├── diff.ts                # 历史版本行级 diff、渲染块 diff 与「改动卡片」分组
│   │   ├── uiCcs.ts               # 直角坐标系语法解析、数学表达式求值与曲线裁剪
│   │   ├── uiGraph.ts             # 图论画布解析、自动布局、几何裁剪与源码点位回写
│   │   ├── uiWidgets.ts           # 表单交互控件解析、控件值映射与 KaTeX 条件求值
│   │   ├── themes.ts              # 配色主题元数据（真实色卡在 styles/index.css）
│   │   ├── articleDirectives.ts   # 文首排版指令 ::set-font / ::set-code-font / ::set-background
│   │   ├── latexSymbols.ts        # LaTeX 符号目录（别名搜索，编辑器与 VS Code 插件共用）
│   │   └── fontStacks.ts          # 默认字体栈（字体偏好与文章指令共用）
│   ├── pages/                     # 首页 / 文章 / 归档 / 标签 / 关于 / 登录 / 后台 / 编辑器
│   ├── styles/index.css           # Tailwind + 代码高亮 + 排版细节
│   ├── App.tsx                    # 路由
│   └── main.tsx                   # 入口
├── vscode_extensions/v1/         # Markdown 语法拓展插件与可安装 VSIX
├── AI_README.md                   # AI 协作维护规范（更新时必读）
├── ChangeLog.md                   # 更新日志（每次更新必须补充）
├── README.md                      # 项目说明（每次更新必须同步）
├── index.html
├── tailwind.config.js
└── vite.config.ts                 # base path + SPA 404 兜底
```

---

## 📴 离线版（单文件，完全不联网）

整个博客可以打包成**一个 HTML 文件**：拷进 U 盘、发给自己、双击打开即可阅读与写作。
离线版按设计**不发起任何网络请求**——没有在线登录，没有云端字体，不加载远程图片，也不直接改仓库。

- 产物由 [`.github/workflows/offline.yml`](.github/workflows/offline.yml) 自动构建，提交在仓库的
  [`offline/index.html`](offline/index.html)；**`main` 每次影响离线产物的改动都会刷新**
  Releases 上的滚动 tag `offline`（`starlog-offline-latest.html`，固定下载地址，标题 / 说明里记录来源提交、
  构建时间与体积；即使仓库副本没有变化也会刷新说明与附件，不会堆出大量历史 Release）；
  线上站点也会把它放在 `<站点地址>/offline/index.html` 供直接下载（`deploy.yml` 会现场构建同一份文件，
  不依赖 Actions 提交的时序）；
- 本地构建：`npm run build:offline`（= `vite build --config vite.offline.config.ts` + 产物自检），
  想用浏览器先验证：`npm run preview:offline`；
- 自检是**硬性**的：多余文件、残留相对引用、KaTeX 字体缺失、某篇文章没进包、内联脚本语法被破坏，
  以及——`api.github.com` / `/graphql` / `login/device/code` / `fonts.googleapis.com` / OAuth Client ID
  任一字符串出现在产物里——都会让构建直接失败。也就是说「离线版不联网」不是承诺，是可检查的事实。

### 支持范围

| | |
| --- | --- |
| ✅ 阅读 | 构建时打包进文件的全部文章：列表、归档、标签、站内搜索、目录、打印样式 |
| ✅ 排版 | KaTeX 公式、代码高亮、10 套配色主题、动态背景、字号（80%–130%）——样式与字体全部内联 |
| ✅ 字体 | **只用本机已安装的字体**：不请求 Google Fonts，也不注入云端 `@font-face`；本机没有的字体名按默认字体栈显示 |
| ✅ 写作 | 新建 / 编辑 / 自动保存 / 加密文章（浏览器 WebCrypto 本机加解密）/ 本机版本历史与差异对比 |
| ✅ 评论 | 变成「本机笔记」：只写在这台设备上，任何情况下都不会提交到远端 |
| 📤 带走 | 编辑器里的「保存到在线网站的本地文章」或「管理 → 离线文章包 → 导出」生成 `*.starlog-import.json`；在线上站点「管理 → 离线文章包 → 导入离线文章包」选它，即写入该站点的本地文章列表 |
| ❌ 没有 | GitHub 登录与授权、远程仓库读写、在线评论、PR 审批、远端 Git 历史版本、云端字体同步、远程图片加载、待更新队列提交 |

### 怎么把离线写的文章放在线上站点上

```
离线 HTML ──导出文章包──▶ starlog-xxxx.starlog-import.json ──线上站点「管理 → 离线文章包 → 导入」──▶ 站点本地文章列表
                                                                          │
                                                                          └─▶ 待更新队列 → 统一更新 → 一次 commit → Actions 部署
```

1. 离线文件里点「保存到在线网站的本地文章」（或到「管理 → 离线文章包」批量导出，可勾选）；
   加密文章导出的是密文信封，密码不会随文件离开本机；
2. 在联网浏览器里打开线上站点 →「管理 → 离线文章包」→「导入离线文章包」，选择这个文件；
   对话框会逐篇列出「新增 / 覆盖 / 跳过」计划，确认后才写入；
3. 内容进入该站点的**本地文章列表**；勾选「同时加入待更新队列」后可直接统一更新，
   一次提交、一次部署，线上文章列表里就有了。

### 数据存在哪、会不会丢

- 优先写 **IndexedDB**；从 `file://` 直接打开时多数浏览器禁用 IndexedDB，此时自动降级为
  **localStorage（约 5 MB）**，界面上会写明当前用的哪一个；
- 两级都不可用（无痕模式、浏览器禁止站点保存数据）时，页面会**直接拦住并给出解决办法**，
  同时拒绝一切写入——不会出现「提示保存成功、其实没存」；
- 保存 / 发布 / 导入都会 `await flushStorage()` 确认真正落盘，**确认之后**才提示成功；
- 「设置 → 离线版」可导出 / 导入**离线档案**（全部本机数据，用于备份或换设备）；
- 记住一条：清除浏览器数据 = 本机文章一起没了，长文请随手导出档案备份。

### 图片

离线版不加载任何远程图片：文章里指向站点的 `/uploads/x.png` 或外部 `https://…` 地址会显示一条
「离线版不加载远程图片」的说明，而不是破图。要带图，请在编辑器里插入图片——它会暂存在本机
（预览用本地数据），并随文章包一起导出，导入线上站点后由站点上传到仓库。

### 体积与性能

以当前仓库内容（`content/posts/` 10 篇）实测：**单文件约 3.0 MB**
——内联 CSS 1.49 MB（其中 KaTeX 字体 base64 约 1.07 MB）、内联 JS 1.50 MB，无其他文件。

- 首屏只有一次文件读取，网络请求数为 **0**（这正是设计目标）；
- 代价是首次解析这 3 MB（桌面约 60–150 ms，移动端更慢），之后路由切换是纯本地渲染，
  阅读体验通常比线上版更快；
- 体积随内容线性增长：正文与本机暂存图片都会进包。构建对成品有上限保护：
  超过 48 MB 直接失败，超过 25 MB 会在自检输出里提示（邮件/网盘分发会难受）；
- 因为不再拉取云端字体，离线版**没有**字体相关的等待与闪动（FOUT），排版完全取决于本机字体。

### 与线上站点共用一套源码

`vite.offline.config.ts` 把 `__STARLOG_OFFLINE__` 置为 `true`，线上构建固定为 `false`，
所以不会出现「离线版是另一个玩具站」的功能漂移；所有离线分支都收敛在 `src/lib/runtime.ts`
的 `OFFLINE` / `hasNetwork()` 判断下（离线版里 `hasNetwork()` 恒为 `false`），可逐条审计。

---

## 🔒 关于安全（请务必读一下）

- **写权限与身份验证完全由 GitHub OAuth 授权控制**。没有授权，即使进入页面也无法修改仓库。
- OAuth 授权范围默认是 `public_repo`（公开仓库读写）；令牌存于浏览器本地，可随时在 GitHub「Settings → Applications」一键撤销。
- OAuth 中转只转发 GitHub 的授权请求，**不持有任何机密**（Device Flow 无需 client_secret），也无法访问仓库内容。
- 在公共电脑上用完请点「退出登录」，会清除本地保存的令牌。
- 文章与评论中的 **原始 HTML 会经过净化**：脚本、事件属性（如 `onerror`）、`style`、`<iframe>`、`<form>` 等会被移除，避免评论区被用于钓鱼或注入脚本。折叠框、展示框、公式与代码高亮不受影响。

---

## 💡 常见问题

**刷新子页面 404？**
构建时会自动把 `index.html` 复制一份为 `404.html`，GitHub Pages 会用它兜底，SPA 路由即可正常工作。如果自建服务器，请配置 history fallback。

**发布后页面没更新？**
GitHub Actions 需要 1–2 分钟重新构建部署。可以在仓库的 Actions 标签页看进度。

**为什么不能像以前那样直接粘贴 Token？**
可以，但 OAuth 更好：不用在 GitHub 里翻权限创建 Token、权限边界清晰、随时一键撤销。本站用的 Device Flow 是标准的 OAuth 2.0 设备授权流程（RFC 8628），GitHub CLI、VS Code 同款。

**为什么 OAuth 还要一个中转服务？**
GitHub 的授权端点（`github.com/login/*`）不返回 CORS 头，浏览器读不到响应，纯前端无法直接完成授权。仓库内置了两种极简中转形态，部署时自动对应：Cloudflare Pages 用同源的 Pages Function（零配置）；GitHub Pages 用 `oauth-relay/` Worker（只透传 + 补 CORS 头，不含机密）。Device Flow 本身也不需要 client_secret。

**为什么设置里的「分支」和「文章目录」不能修改？**
站点是静态构建的，只会读取构建时配置的分支与目录（`src/lib/config.ts` 中的 `githubConfig`）。若允许在本地改成别的位置，文章会被写到站点永远不读取的地方，表现为“发布成功但看不到”。只有「用户 / 组织」和「仓库名」可以在设置中覆盖。

**换主题、开背景会把设置写进仓库吗？**
不会自动写入。配色主题、明暗模式、渐变背景与动态背景默认只保存在浏览器本地（`localStorage`），
同一台设备的其它标签页会立即同步；只有你在 **设置 → 外观偏好同步** 主动点「同步外观到 GitHub」后，
它们才会随待更新队列写入账号偏好文件，以便在其他设备登录同一账号时恢复。字体优先级（正文与代码各一组）
与字号使用另一份独立的账号偏好文件，同样只在主动保存后才提交。

**文章开头的 `::set-font` / `::set-background` 会改掉我的字体与背景设置吗？**
不会。它们只是「阅读本文时」的临时覆盖：打开文章时生效，离开文章（或回到列表）立即恢复你在设置里保存的字体与动态背景，什么都不会写入浏览器或 GitHub。反过来，如果指令感觉没生效，先确认它写在正文最开头（正文之后再写只是普通文字）、背景编号在 0–5 之间，以及字体名拼对了（本机没有的字体会尝试从 Google Fonts 拉取，失败则回退到默认字体）。详见「文章排版指令」一节。

**为什么背景不动？**
① 系统开启了「减少动态效果」时，动态背景只绘制一帧静态画面；② 标签页切到后台会暂停；
③ 网页总是在最前面滚动时，背景可能因为省电策略掉帧——把「雨量 / 雪量」或参数调小一些即可。

**本地草稿会丢吗？**  
草稿存在浏览器 `localStorage`，清除浏览器数据会丢失。重要内容请及时加入**待更新队列**并统一更新到 GitHub，或在设置页「导出全部草稿」。

**评论保存在哪里？**
每篇文章的评论会写入目标仓库的 GitHub Discussions（默认使用 `General` 分类），不再只存在当前浏览器。访客使用 GitHub 登录后即可加载、发表和按 GitHub 权限删除评论；目标仓库需要开启 Discussions。旧版本遗留的本机评论会继续显示迁移提示，但不会自动上传。

---

## 📚 文档与维护约定

- **[ChangeLog.md](ChangeLog.md)** —— 更新日志。每次功能/修复/配置更新都要在此登记，并按约定**注明模型名称、模型版本号与知识库截止时间**。
- **[AI_README.md](AI_README.md)** —— AI 协作维护规范。任何 AI 智能体（或人工）更新本仓库前必读：要求每次更新同步维护上面两份文档，并按模板在 ChangeLog 中记录变更与模型信息。

---

## 📄 License

MIT
