# 更新日志

## 2.2.0 — 2026-10-20

- 新增直角坐标系语法 `::begin_ui-ccs … ::end_ui-ccs`（与博客 issue #76 同步）：支持 `create_point:(x,y);`、`create_line:(x_1,y_1),...,(x_n,y_n),[color=...];` 与显式函数曲线 `create_line:(7*x^2+6*x+90*x^3);`，内置预览直接复用博客 `CoordinatePlane` 组件，支持鼠标/触控拖拽平移、滚轮缩放、悬停坐标读数、一键复位及嵌套在 `::show_begin` 内的实时联动。
- 新增命令 **插入直角坐标系**（`starlog.insertCoordinateSystem`）、`uiccs` / `::begin_ui-ccs` 代码片段、TextMate 语法高亮与 MPE 静态 SVG 兼容渲染；洛谷 / 基本 Markdown 复制自动降级为静态说明文本。

## 2.1.0 — 2026-10-19

- 新增文章级排版指令（与博客 issue #59 同步）：文章开头可写 `::set-font[字体名]`、`::set-code-font[字体名]`、`::set-background[0–5]`。解析与字体栈与博客共用 `src/lib/articleDirectives.ts`、`src/lib/fontStacks.ts`，禁止另行维护副本。字体指令在内置预览中作用于正文（需本机有该字体，插件不联网下载）；背景指令针对博客网页的动态背景，预览中仅移除指令行。洛谷 / 基本复制与 MPE 静态转换同样会移除这些指令。新增 `setfont` / `setcodefont` / `setbackground` 代码片段，语法示例文档新增对应章节。
- 新增命令 **插入 LaTeX 符号…**（`starlog.insertLatexSymbol`，Markdown 编辑器中默认 `Shift + ↑`）：QuickPick 可按命令或任意别名过滤（「正负」→ `\pm`、「异或」→ `\oplus`），选中后把符号插入光标处，需要参数的命令把光标放到第一个空参数里。符号目录与博客站内编辑器共用 `src/lib/latexSymbols.ts`。
- 回归测试新增：文首指令与博客组件的同款 DOM 对照、解析 / 移除 / 转换断言、LaTeX 别名搜索与插入光标断言。

## 2.0.2 — 2026-10-16

- 同步博客共享样式：内置预览现在包含 10 套配色主题的 CSS 变量与主题化品牌色阶
  （`--brand-50…950` 在 `:root` 里仍是原来的蓝紫色，所以预览外观与之前一致）。
- 正文样式（表格、折叠框、展示框、公式、代码高亮）与深浅色、渐变背景开关的行为均无变化。
- 仅同步样式，命令、设置项与扩展 ID 均无变化。

## 2.0.1 — 2026-10-11

- 普通表格与非 Tuack 合并表格默认靠左，保留 Markdown 列对齐；Tuack 表格继续居中。修正博客共享样式，两端保持一致。
- 新增 Settings 开关 `starlog.preview.enableGradientBackground`，默认关闭。开启使用博客同款渐变，关闭使用主题纯色背景；修改后自动刷新内置预览。
- 修复创建后删除展示框导致正文重复、随后全部消失的问题：React 正文永久置于内置 `markdown-body` 外，避免 morphdom 与 React 共同修改同一棵 DOM，不再依赖 window 消息的捕获监听顺序。
- 同源码的内容更新保留展示框变量；删除、再次创建、清空正文及切换文档正常清理并渲染。
- 增加真实 morphdom 宿主桥接与 Chromium `postMessage` 生命周期回归，覆盖宿主/插件两种加载顺序、未闭合语法编辑、普通/合并/Tuack 表格及深浅色背景开关。

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
