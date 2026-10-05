# 星野笔记 · Starlog

一个托管在 **GitHub Pages** 上的静态博客，但支持**登录**和**在线编辑**：内置 Markdown 编辑器（含 KaTeX 数学公式与代码高亮），写完可以一键提交回仓库并自动重新部署。界面精致，深色模式开箱即用。

```
React 19 + TypeScript + Vite + Tailwind CSS + react-markdown + KaTeX
```

---

## ✨ 功能

| | |
| --- | --- |
| 📝 **在线编辑** | 分栏实时预览、工具栏、快捷键、滚动同步、自动保存草稿 |
| 🧮 **KaTeX 公式** | 行内 `$…$` 与独立 `$$…$$`，支持 `aligned`、矩阵、分段函数 |
| 🎨 **个性化外观** | 深浅色模式、多字体优先级、80%–130% 全站字号与渐变背景 |
| 🔐 **GitHub OAuth 授权** | 基于 Device Flow 极简一键登录，令牌仅保存在浏览器本地 |
| 🚀 **一键发布** | 浏览器直接调用 GitHub API 提交 Markdown，Actions 自动部署 |
| 🔍 **全文搜索** | <kbd>⌘</kbd>/<kbd>Ctrl</kbd> + <kbd>K</kbd> 唤起，支持方向键选择 |
| 🏷️ **标签 / 归档** | 标签云、按年归档、置顶、草稿、阅读时长、自动目录 |
| 🖼️ **图片上传** | 直接把本地图片提交到仓库 `public/uploads/` 并插入链接 |
| 🕓 **历史版本** | 每次发布均保留 Git 提交版本；可浏览、查看、继续编辑，并对比任意两个版本的差异 |
| 🔒 **密码文章** | 仓库管理员可在发布前用浏览器 Web Crypto 加密完整文章，阅读和编辑均需密码 |
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

## ✍️ 两种写作方式

### 方式 A：在站内写（推荐）

1. 访问 `/login` 点击 **使用 GitHub 登录**
2. 验证码将自动复制到剪贴板，在自动打开的 GitHub 页面粘贴并授权
3. 授权后自动完成登录 → 写文章 → 点 **发布到 GitHub**（或申请发表 PR）

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

每次通过编辑器发布文章都会创建一个 Git commit，因此无需额外数据库即可保存完整历史。文章页“历史”按钮会列出该 Markdown 文件的每次提交；查看某个历史版本后点“编辑”时，若现有文章（含内容）完全一致就进入对应编辑页，否则会新建一份已填充该历史内容的本地草稿。

历史面板中的“**版本对比**”按钮可任选原始版本与新版本，逐行高亮两个版本 Markdown 源码的新增与删除，并支持交换方向、只看差异附近内容。

拥有目标仓库直接推送权限的管理员可在编辑器“文章信息”中勾选“发布为带密码的加密文章”。完整 frontmatter 和正文会在浏览器内用 **PBKDF2-SHA-256 + AES-256-GCM** 加密后才提交，密码不写入 GitHub、localStorage 或 URL。请自行妥善保管密码：忘记后无法恢复文章内容。

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
│   ├── components/                # Layout / Markdown / 搜索 / 目录 / Toast / GitHub 授权
│   ├── lib/                       # 配置、文章解析、认证、GitHub API、主题
│   ├── pages/                     # 首页 / 文章 / 归档 / 标签 / 关于 / 登录 / 后台 / 编辑器
│   ├── styles/index.css           # Tailwind + 代码高亮 + 排版细节
│   ├── App.tsx                    # 路由
│   └── main.tsx                   # 入口
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

**本地草稿会丢吗？**
草稿存在浏览器 `localStorage`，清除浏览器数据会丢失。重要内容请及时「发布到 GitHub」，或在设置页「导出全部草稿」。

**评论保存在哪里？**
每篇文章的评论会写入目标仓库的 GitHub Discussions（默认使用 `General` 分类），不再只存在当前浏览器。访客使用 GitHub 登录后即可加载、发表和按 GitHub 权限删除评论；目标仓库需要开启 Discussions。旧版本遗留的本机评论会继续显示迁移提示，但不会自动上传。

---

## 📄 License

MIT
