---
title: "你好，这是一个能在线写作的静态博客"
date: "2025-09-20"
summary: "介绍这个博客是怎么在没有后端的情况下，做到登录、在线编辑和一键发布的。"
tags: ["公告", "前端"]
pinned: true
---

GitHub Pages 是纯静态托管——没有服务器、没有数据库、没有接口。那么「登录」和「在线编辑」到底是怎么实现的？

## 核心思路：把 GitHub 当后端

整个方案只有一句话：**浏览器直接调用 GitHub 的 Contents API，把 Markdown 文件 commit 回仓库**。

```text
你在浏览器里写 → 保存到 localStorage（草稿）
              → 点击发布 → GitHub API 提交文件
              → GitHub Actions 自动构建 → Pages 更新
```

### 两种登录方式

| 方式 | 能做什么 | 数据在哪 |
| --- | --- | --- |
| 密码登录 | 写作、预览、导出 `.md` | 浏览器 localStorage |
| GitHub Token | 上面全部 + 发布 / 删除 / 传图 | 仓库 `content/posts/` |

密码登录只是一道门帘——静态站点的所有代码都是公开的，前端密码天然不构成安全边界。**真正的写权限完全由 GitHub Token 控制**，而 Token 只存在你自己的浏览器里。

### 文章是怎么被读到的

构建时 Vite 用 `import.meta.glob` 把 `content/posts/**/*.md` 全部读进来：

```ts
const modules = import.meta.glob('/content/posts/**/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
})
```

于是每篇文章都变成打包产物的一部分，首屏无需任何网络请求。本地草稿则在运行时从 localStorage 读出来，与仓库文章合并——同名时以本地版本为准，这样你能一边改一边看效果。

## 写作体验

编辑器支持这些快捷键：

- <kbd>⌘</kbd> + <kbd>S</kbd> 保存草稿
- <kbd>⌘</kbd> + <kbd>B</kbd> / <kbd>⌘</kbd> + <kbd>I</kbd> 粗体、斜体
- <kbd>⌘</kbd> + <kbd>K</kbd> 插入链接
- <kbd>Tab</kbd> 缩进，列表里回车自动续行

还有：

- [x] 实时分栏预览与滚动同步
- [x] 停止输入 2.5 秒自动存草稿
- [x] 图片上传到仓库 `public/uploads/`
- [ ] 评论系统（也许接一个 giscus）

## 下一步

Fork 这个仓库，改掉 `src/lib/config.ts` 里的站点信息与 `githubConfig`，推送到 `main`，等 Actions 跑完就有自己的博客了。

> 写作这件事，最重要的从来不是工具。但一个顺手的工具，确实能让人更愿意开始写。
