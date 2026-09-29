---
title: 关于
---

## 关于这个博客

这是一个**完全静态**的个人博客，代码托管在 GitHub，页面由 GitHub Pages 提供服务。它没有服务器、没有数据库，但依然可以在线写作并发布。

### 它能做什么

- ✍️ **在线编辑**：内置 Markdown 编辑器，左边写右边即时预览
- 🧮 **数学公式**：由 KaTeX 渲染，行内 $a^2 + b^2 = c^2$ 与独立公式都支持
- 🎨 **深色模式**：跟随系统，也可以手动固定
- 🔍 **全文搜索**：按 <kbd>⌘</kbd> + <kbd>K</kbd> 随时唤起
- 🚀 **一键发布**：编辑器里点「发布到 GitHub」，文章就会被提交回仓库并自动重新部署

### 技术栈

| 层面 | 选型 |
| --- | --- |
| 框架 | React 19 + TypeScript |
| 构建 | Vite |
| 样式 | Tailwind CSS |
| 渲染 | react-markdown + remark/rehype |
| 公式 | KaTeX |
| 部署 | GitHub Actions → GitHub Pages |

### 写作方式

1. 在站内登录后直接写（推荐），或者
2. 往 `content/posts/` 里丢一个 `.md` 文件，推送到 `main` 分支

两种方式最终都会变成同一份静态站点。

> 如果你也想要一个这样的博客，直接 Fork 这个仓库，改掉 `src/lib/config.ts` 里的配置就能用了。
