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
| 🎨 **深色模式** | 跟随系统 / 手动固定，无刷新闪白，支持 View Transition 平滑切换 |
| 🔐 **双模式登录** | 站点密码（写本地草稿）+ GitHub Token（发布到仓库） |
| 🚀 **一键发布** | 浏览器直接调用 GitHub API 提交 Markdown，Actions 自动部署 |
| 🔍 **全文搜索** | <kbd>⌘</kbd>/<kbd>Ctrl</kbd> + <kbd>K</kbd> 唤起，支持方向键选择 |
| 🏷️ **标签 / 归档** | 标签云、按年归档、置顶、草稿、阅读时长、自动目录 |
| 🖼️ **图片上传** | 直接把本地图片提交到仓库 `public/uploads/` 并插入链接 |
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

### 2. 部署到 GitHub Pages

1. 把代码推送到 GitHub 仓库的 `main` 分支
2. 打开仓库 **Settings → Pages**，把 **Source** 设为 **GitHub Actions**
3. 等待 `.github/workflows/deploy.yml` 跑完，站点就上线了

Workflow 会自动判断 base path：

- 仓库名是 `<用户名>.github.io` → base 为 `/`
- 其他仓库名（如本仓库 `Blog`）→ base 为 `/Blog/`

> 本地构建时默认使用 `/Blog/`，可以用环境变量覆盖：
> `VITE_BASE_PATH=/ npm run build`

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

### 修改登录密码

密码以 SHA-256 的形式存在 `AUTH_PASSWORD_SHA256`，**默认密码是 `starlog`**。

在浏览器控制台执行下面这段，把输出替换进去即可：

```js
crypto.subtle
  .digest('SHA-256', new TextEncoder().encode('你的新密码'))
  .then((b) =>
    console.log([...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('')),
  )
```

也可以用环境变量（`.env.local`）而不改代码：

```bash
VITE_AUTH_PASSWORD_HASH=你的哈希值
```

---

## ✍️ 两种写作方式

### 方式 A：在站内写（推荐）

1. 访问 `/login`，用站点密码登录
2. 去 **设置 → GitHub 连接**，填入 Personal Access Token
3. 写文章 → 点 **发布到 GitHub**

**如何创建 Token**（推荐 Fine-grained，权限最小化）：

1. 打开 <https://github.com/settings/personal-access-tokens/new>
2. **Repository access** 选择本博客仓库
3. **Permissions → Contents** 设为 **Read and write**
4. 生成后复制，粘贴到站内设置页

Token 只保存在你浏览器的 `localStorage`，只会发送给 `api.github.com`。

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
├── .github/workflows/deploy.yml   # GitHub Pages 自动部署
├── content/
│   ├── about.md                   # 「关于」页内容
│   └── posts/*.md                 # 所有文章
├── src/
│   ├── components/                # Layout / Markdown / 搜索 / 目录 / Toast
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

- 静态站点**没有服务端**，前端密码只是「防止别人随手点进后台」的门帘，**不是安全边界**。任何人都能看到打包后的代码。
- **真正的写权限由 GitHub Token 控制**。没有 Token，即使进了后台也只能改自己浏览器里的草稿，动不了仓库。
- 建议使用 **Fine-grained Token**，权限限制到本仓库的 Contents 读写，并设置较短的有效期。
- 在公共电脑上用完请点「退出登录」，会清除本地保存的 Token。

---

## 💡 常见问题

**刷新子页面 404？**
构建时会自动把 `index.html` 复制一份为 `404.html`，GitHub Pages 会用它兜底，SPA 路由即可正常工作。如果自建服务器，请配置 history fallback。

**发布后页面没更新？**
GitHub Actions 需要 1–2 分钟重新构建部署。可以在仓库的 Actions 标签页看进度。

**本地草稿会丢吗？**
草稿存在浏览器 `localStorage`，清除浏览器数据会丢失。重要内容请及时「发布到 GitHub」，或在设置页「导出全部草稿」。

**想加评论？**
推荐 [giscus](https://giscus.app/zh-CN)（基于 GitHub Discussions），纯静态站点友好，几行代码就能接入。

---

## 📄 License

MIT
