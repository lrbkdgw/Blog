# 更新日志

## 1.0.0 — 2026-10-05

首个版本：把星野笔记 Blog 的特殊 Markdown 语法迁移为 VS Code 扩展。

- 语法高亮（注入式 TextMate 语法）：`::show_begin` / `::show_end`、内联记号、折叠框、`::cute-table{tuack}`。
- 内置 Markdown 预览：交互展示框（数字框 / 滑动条 / 文本框实时刷新）、折叠框、Tuack 表格、`<` `^` 单元格合并。
- Markdown Preview Enhanced 兼容：一键安装自包含的 `.crossnote/parser.js` 与 `style.less`，自动开启扩展表格语法，覆盖前备份。
- 命令：插入展示框 / 折叠框 / Tuack 表格、复制为洛谷源码或基本 Markdown、打开语法示例。
- 代码片段若干，以及与 Blog 行为对齐的回归测试。
