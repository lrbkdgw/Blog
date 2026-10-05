# Starlog Blog Markdown（VS Code 插件）

把 Blog 的特殊 Markdown 语法迁移到 VS Code，提供：

- 特殊指令和占位符的 TextMate 语法高亮（代码围栏内不会误高亮）
- `showbox`、`callout`、`tuack`、`showvar`、`showexpr`、`showfloor`、`showceil`、`showmap` 片段补全
- 语法悬停说明
- 展示框、嵌套提示框和取整参数的实时诊断

## 支持的 Blog 语法

- 合并表格单元格：单元格内容 `^` / `<`
- Tuack 三线表：`::cute-table{tuack}`
- 折叠提示框：`:::info[标题]{open}`（也支持 note/tip/success/warning/error/danger）
- 交互展示框：`::show_begin{标题}{变量定义}` … `::show_end`
- `*&show(name)*&`、`*&hs(a+b)*&`
- `&*floor(value,2)&*`、`&*ceil(value,2)&*`
- `*&name:{0,否;1,是}*&` 映射

## 本地安装

1. 在本目录运行 `npx @vscode/vsce package`，生成 `.vsix`。
2. VS Code 执行“Extensions: Install from VSIX...”并选择生成文件。
3. 打开语言模式为 Markdown 的文件。

开发调试时，可在 VS Code 中打开本目录并按 `F5` 启动 Extension Development Host。

## 配置

`starlogBlogMarkdown.diagnostics.enabled`：是否启用诊断，默认 `true`。
