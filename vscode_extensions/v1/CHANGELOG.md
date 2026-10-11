# 更新日志

## 2.0.0 — 2026-10-11

- 插件展示名称、设置标题与命令分类改为 **Markdown 语法拓展**，扩展 ID 与 `starlog.*` 命令保持兼容。
- 重写内置预览：直接复用博客 `Markdown` / `ShowBox` React 组件、解析求值器与源码转换器，移除移植副本和交互 span 替换逻辑。
- 展示框的公式、表格、行内代码、代码块和映射 Markdown 随变量一起实时重渲染；折叠框数学标题、SVG 图标、代码复制按钮与博客一致。
- 直接编译博客的 Tailwind 配置、正文样式与固定加载顺序的 KaTeX CSS；修复 VS Code 默认样式的标题、引用、代码布局干扰。
- 离线内嵌 React、公式、高亮、全部 KaTeX 字体与依赖许可证，无需启动服务或额外公式扩展。
- 保留 frontmatter 原始行号、本地图片转换、Markdown token 分析与缓存；隔离 VS Code DOM 更新，避免破坏 React 交互。
- MPE 明确作为可选的静态兼容模式保留，安装提示默认关闭。
- 增加博客 DOM / CSS 一致性测试、交互与刷新回归、独立安装包主进程测试，以及真实 Chromium 深浅色计算样式对照测试。

## 1.0.0 — 2026-10-05

首个版本：把星野笔记 Blog 的特殊 Markdown 语法迁移为 VS Code 扩展。

- 语法高亮（注入式 TextMate 语法）：`::show_begin` / `::show_end`、内联记号、折叠框、`::cute-table{tuack}`。
- 内置 Markdown 预览：交互展示框（数字框 / 滑动条 / 文本框实时刷新）、折叠框、Tuack 表格、`<` `^` 单元格合并。
- Markdown Preview Enhanced 兼容：一键安装自包含的 `.crossnote/parser.js` 与 `style.less`，自动开启扩展表格语法，覆盖前备份。
- 命令：插入展示框 / 折叠框 / Tuack 表格、复制为洛谷源码或基本 Markdown、打开语法示例。
- 代码片段若干，以及与 Blog 行为对齐的回归测试。
