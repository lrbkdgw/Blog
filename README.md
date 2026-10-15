# 星野笔记 · Starlog

一个托管在 **GitHub Pages** 上的静态博客，但支持**登录**和**在线编辑**：内置 Markdown 编辑器（含 KaTeX 数学公式与代码高亮），写完先加入本地**待更新队列**，再统一批量提交回仓库并自动重新部署。提供 8 套完整主题、深浅色与随系统模式，以及可关闭的背景氛围和轻量交互动效。

```
React 19 + TypeScript + Vite + Tailwind CSS + react-markdown + KaTeX
```

---

## ✨ 功能

| | |
| --- | --- |
| 📝 **在线编辑** | 分栏实时预览、工具栏、快捷键、滚动同步、自动保存草稿 |
| 🧮 **KaTeX 公式** | 行内 `$…$` 与独立 `$$…$$`，支持 `aligned`、矩阵、分段函数 |
| 🎨 **个性化外观** | 8 套主题、浅色/深色/随系统、多字体优先级、80%–130% 字号与自定义渐变；首页可快捷换色 |
| ✨ **背景与动效** | 雨夜、阳光、星空、极光、樱落、萤火、轻雪、海波；参数独立记忆，关闭/轻量/完整三档，遵循系统减少动态效果 |
| 🔐 **GitHub OAuth 授权** | 基于 Device Flow 极简一键登录，令牌仅保存在浏览器本地 |
| 🚀 **待更新队列** | 发布/删除文章、上传图片、发表申请、偏好同步等仓库操作先保存在本地，可勾选部分或全部**一次批量更新**（合并为一次提交、一次部署） |
| 🔍 **全文搜索** | <kbd>⌘</kbd>/<kbd>Ctrl</kbd> + <kbd>K</kbd> 唤起，支持方向键选择 |
| 🏷️ **标签 / 归档** | 标签云、按年归档、置顶、草稿、阅读时长、自动目录 |
| 🖼️ **图片上传** | 图片先暂存本地待更新队列，统一更新时提交到仓库 `public/uploads/` 并插入链接 |
| 🕓 **历史版本** | 每次发布均保留 Git 提交版本；可浏览、查看、继续编辑、**自定义版本名称**，并对比任意两个版本的**源码差异或并排渲染效果** |
| 🔒 **密码文章** | 标题与标签公开，正文与其他信息由浏览器 Web Crypto 加密；本设备成功解锁一次后可自动恢复 |
| 🎛️ **交互展示框** | Markdown 中可声明整数、有理数、字符串变量，实时计算并渲染展示内容 |
| 📱 **响应式** | 手机 / 平板 / 桌面均已适配，支持打印样式 |

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
npm run preview -- --base /Blog/  # 预览默认 /Blog/ 构建；根路径构建改为 --base /
npm test           # 外观配置、初始化一致性、色彩对比度、场景渲染回归
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

## 🎨 主题、背景与动效

在首页「今天的色彩」中快捷换色，或打开 **设置 → 装扮你的阅读空间**（`/settings#appearance`）查看预览并调整完整外观。无需登录。

| 主题 | 风格 | 推荐场景 |
| --- | --- | --- |
| 星野经典 | 蓝紫、轨道与星球 | 星空 |
| 极光幻境 | 青绿与紫色流光 | 极光 |
| 樱落春日 | 樱粉与暖白、花枝 | 樱落 |
| 森林微光 | 苔绿、叶片与自然质感 | 萤火 |
| 深海漫游 | 海蓝、青色与水纹 | 海波 |
| 落日余晖 | 杏橙与玫瑰色 | 阳光 |
| 霓虹夜航 | 紫色与品红、网格光带 | 极光 |
| 墨色书房 | 纸白墨深、线稿与纸张质感 | 纯净背景 |

- **主题不仅改变底色**：按钮、链接、卡片、边框、选中文字、代码块和首页原创 SVG 插画会一起适配；每套主题都支持浅色与深色。
- **三个独立维度**：主题色、明暗模式、背景场景分别选择。切换主题不会清空已有场景参数或自定义渐变；「应用主题推荐场景」才会更换场景。与旧版不同，雨夜、星空等场景现在也适配浅色，不再强制覆盖明暗选择。
- **背景场景**：保留雨夜、阳光、星空，新增极光、樱落、萤火、轻雪、海波。每个场景的参数单独记忆，可恢复本场景默认值。新用户的雷电默认关闭。
- **动态效果**：「关闭」保留静态场景，停止背景与装饰动画；「轻量」使用较少粒子与轻柔过渡；「完整」增加粒子与鼠标卡片聚光。触屏不启用鼠标聚光，窄屏仍降低渲染开销。
- **无障碍与性能**：系统开启“减少动态效果”时强制静态呈现，但保留用户的原始动效档位。标签页隐藏时暂停绘制；Canvas 按需加载、预绘光晕，像素比与帧率均有上限。支持键盘选择、焦点提示与无动画回退。正文使用独立阅读底板，打印时隐藏氛围装饰。
- **保存与重置**：主题/明暗/动效保存在 `starlog:personal-settings.appearance`，场景仍使用其中的 `animatedBackground` 字段，仅存本设备，不写入 GitHub。旧版 `starlog:theme` 与原有场景参数可继续读取，同源标签页即时同步。「重置主题与特效」不会清除字体、字号、自定义渐变或文章。
- **自定义渐变优先级**：主题提供底色，自定义渐变在其上叠加，透明动态场景位于最上方。渐变强度接近 100% 时会覆盖主题底色；想恢复主题底色，可在「背景渐变与透明度」中恢复默认。

默认组合为 **星野经典 + 跟随系统 + 轻量动效 + 纯净背景**。所有新增插画与特效均由本地 CSS / SVG / Canvas 实现，不依赖远程图片、字体服务或第三方 UI 特效库。

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

## 🧩 VS Code 插件：Markdown 语法拓展

仓库自带可直接安装的 **Markdown 语法拓展**插件。它在 VS Code **内置 Markdown 预览**中直接复用本站的 React 渲染组件、KaTeX / 高亮配置与 Tailwind 样式，展示框中的公式、表格和代码也会随变量实时更新。

```bash
code --install-extension vscode_extensions/v1/starlog-markdown-2.0.1.vsix --force
```

安装后打开 `.md` 并使用 `Ctrl/⌘+K V` 分屏预览；命令 **Markdown 语法拓展: 打开语法示例文档**可用于对照检查。成品内嵌所需脚本、样式与公式字体，无需额外插件或本地博客服务。MPE 保留为可选静态兼容模式，完整同款交互效果请使用内置预览。

普通/合并表格默认靠左，Tuack 表格保持居中。VS Code Settings 中的 `starlog.preview.enableGradientBackground` 可以启用博客渐变背景，默认关闭，修改后自动刷新预览。

安装、语法和开发说明见 [插件 README](vscode_extensions/v1/README.md)。在根目录安装依赖并执行 `npm ci --prefix vscode_extensions/v1` 后，可运行 `npm run extension:test` / `npm run extension:package` 验证或重新打包。

---

## ✍️ 两种写作方式

### 方式 A：在站内写（推荐）

1. 访问 `/login` 点击 **使用 GitHub 登录**
2. 验证码将自动复制到剪贴板，在自动打开的 GitHub 页面粘贴并授权
3. 授权后自动完成登录 → 写文章 → 点 **加入更新队列**（或申请发表 PR）→ 在内容管理的「待更新队列」中勾选部分或全部**统一更新**到 GitHub。若所选文章引用了队列中尚未上传的图片，这些图片会自动一并提交

所有需要更新仓库的操作（发布/删除文章、上传图片、发表申请、偏好同步）都会先保存在本机，不会立即生效；统一更新时文件类更改会合并为一次提交并只触发一次部署。

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

文章页的「复制」菜单可以复制文章链接、原始源码、洛谷源码或基本 Markdown 源码。洛谷源码会把 Blog 专属的展示框按变量默认值转换为静态 Markdown；基本源码还会把单元格合并、折叠框和 Tuack 表格等洛谷扩展转换为普通 Markdown。

## 🕓 历史版本与加密文章

每次通过编辑器发布文章都会创建一个 Git commit，因此无需额外数据库即可保存完整历史。文章页“历史”按钮会列出该 Markdown 文件的每次提交，并可为任一版本**修改版本名称**（仅保存在本浏览器，优先于提交信息显示）；查看某个历史版本后点“编辑”时，若现有文章（含内容）完全一致就进入对应编辑页，否则会新建一份已填充该历史内容的本地草稿。

历史面板中的“**版本对比**”可任选原始版本与新版本，在**源码对比**（逐行高亮新增与删除，支持交换方向、只看差异附近内容）与**渲染对比**（并排渲染两个版本的完整效果，可各自滚动）之间切换。

拥有目标仓库直接推送权限的管理员可在编辑器“文章信息”中勾选“发布为带密码的加密文章”。文章标题与标签会保留在公开 frontmatter 中（标签不加密，标签云与标签页照常可用），正文和其余文章信息会在浏览器内用 **PBKDF2-SHA-256 + AES-256-GCM** 加密后再加入待更新队列（队列里保存的即是密文，密码不会写入队列）。密码不会写入 GitHub、浏览器存储或 URL；成功解锁后，浏览器仅在 IndexedDB 中保存不可导出的 `CryptoKey`，同一设备再次查看或编辑可自动解锁。可在设置页随时清除已记住的解锁状态。请仍自行妥善保管密码：忘记密码且清除站点数据后无法恢复文章内容。

---

## ⌨️ 编辑器快捷键

| 快捷键 | 作用 |
| --- | --- |
| <kbd>⌘</kbd>/<kbd>Ctrl</kbd> + <kbd>S</kbd> | 保存草稿 |
| <kbd>⌘</kbd> + <kbd>B</kbd> / <kbd>I</kbd> | 粗体 / 斜体 |
| <kbd>⌘</kbd> + <kbd>K</kbd> | 插入链接 |
| <kbd>Tab</kbd> / <kbd>Shift</kbd>+<kbd>Tab</kbd> | 缩进 / 反缩进 |
| <kbd>Enter</kbd> | 列表内自动续行（空项自动结束列表） |

全站快捷键：<kbd>⌘</kbd>+<kbd>K</kbd> 或 <kbd>/</kbd> 打开搜索。

---

## 📁 目录结构

```
.
├── .github/workflows/deploy.yml   # GitHub Pages 自动部署（路线 B）
├── functions/login/[[path]].ts    # OAuth 同源中转（Cloudflare Pages，路线 A）
├── oauth-relay/                   # OAuth 极简 CORS 中转（独立 Worker，路线 B 用）
├── content/
│   ├── about.md                   # 「关于」页内容
│   └── posts/*.md                 # 所有文章
├── public/_redirects              # Cloudflare Pages 的 SPA 路由兜底
├── src/
│   ├── components/                # 页面组件、外观面板、主题插画、视口入场与动态背景
│   ├── lib/                       # 文章/认证/GitHub/队列，以及 appearance/scenes 外观配置
│   │   └── backdrop/renderers.ts  # 8 种透明 Canvas 场景，共用粒子与光场渲染器
│   ├── pages/                     # 首页 / 文章 / 归档 / 标签 / 关于 / 登录 / 后台 / 编辑器
│   ├── styles/                    # index.css 排版；themes.css 色彩；appearance.css 外观动效
│   ├── App.tsx                    # 路由
│   └── main.tsx                   # 入口
├── test/                         # 外观单元回归与可选 Chromium 浏览器回归
├── vscode_extensions/v1/          # Markdown 语法拓展插件与可安装 VSIX
├── AI_README.md                   # AI 协作维护规范（更新时必读）
├── ChangeLog.md                   # 更新日志（每次更新必须补充）
├── README.md                      # 项目说明（每次更新必须同步）
├── index.html
├── tailwind.config.js
└── vite.config.ts                 # base path + SPA 404 兜底
```

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

**本地草稿会丢吗？**  
草稿存在浏览器 `localStorage`，清除浏览器数据会丢失。重要内容请及时加入**待更新队列**并统一更新到 GitHub，或在设置页「导出全部草稿」。

**评论保存在哪里？**
每篇文章的评论会写入目标仓库的 GitHub Discussions（默认使用 `General` 分类），不再只存在当前浏览器。访客使用 GitHub 登录后即可加载、发表和按 GitHub 权限删除评论；目标仓库需要开启 Discussions。旧版本遗留的本机评论会继续显示迁移提示，但不会自动上传。

---

## 🧪 外观回归验证

```bash
npm ci
npm test               # 无需浏览器：配置校验、旧设置兼容、首屏初始化一致性、强调色对比度、8 个渲染器
npm run build          # TypeScript 检查与生产构建
```

可选浏览器回归复用仓库 VS Code 插件已有的 `playwright-core` 工具，**需自行准备 Chromium/Chrome 可执行文件**。先运行 `npm ci --prefix vscode_extensions/v1`，在另一个终端启动开发预览或生产预览，再执行：

```bash
# 默认 /Blog/ 生产构建示例，预览服务需保持运行
npm run preview -- --base /Blog/ --port 4173

# 在另一个终端执行；替换成实际浏览器路径
BROWSER_EXECUTABLE_PATH=/path/to/chromium \
BLOG_TEST_URL=http://127.0.0.1:4173/Blog/ npm run test:browser

# 修改共享样式后，还应验证 VS Code 预览
BROWSER_EXECUTABLE_PATH=/path/to/chromium npm run extension:test
```

浏览器回归覆盖主题/明暗切换、场景与参数保存、跨标签页同步、减少动态效果、可见性暂停、存储失败、缺失可选浏览器 API、首页筛选/搜索/文章渲染、移动端及 130% 字号布局。未设置浏览器路径时，浏览器测试会明确跳过，不代表已经完成视觉验证。可用 `BLOG_SCREENSHOT_DIR` 将代表性截图保存到本地临时目录；不要提交浏览器下载、截图或构建产物。

---

## 📚 文档与维护约定

- **[ChangeLog.md](ChangeLog.md)** —— 更新日志。每次功能/修复/配置更新都要在此登记，并按约定**注明模型名称、模型版本号与知识库截止时间**。
- **[AI_README.md](AI_README.md)** —— AI 协作维护规范。任何 AI 智能体（或人工）更新本仓库前必读：要求每次更新同步维护上面两份文档，并按模板在 ChangeLog 中记录变更与模型信息。

---

## 📄 License

MIT
