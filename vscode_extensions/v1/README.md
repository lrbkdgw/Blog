# 星野笔记特殊语法 · VS Code 扩展（v1）

把 [星野笔记 Blog](../../README.md) 的专属 Markdown 语法搬进 VS Code：在编辑器里高亮、补全，在预览里实时渲染，并且**同时支持 VS Code 内置 Markdown 预览与 Markdown Preview Enhanced（MPE）**。

```
vscode_extensions/v1/starlog-markdown-1.0.0.vsix   ← 可直接安装的扩展包
```

## 一、安装

方式 A（命令行）：

```bash
code --install-extension vscode_extensions/v1/starlog-markdown-1.0.0.vsix
```

方式 B（界面）：扩展侧边栏 → 右上角 `…` → **从 VSIX 安装…** → 选择上面的 `.vsix`。

安装后打开任意 `.md` 文件，命令面板执行 **「星野笔记: 打开语法示例文档」** 即可对照预览效果。

## 二、支持的语法

| 语法 | 说明 |
| --- | --- |
| `::show_begin{标题}{变量定义}` … `::show_end` | 交互展示框，变量实时驱动正文 |
| `*&show(变量)*&` | 输出变量当前值 |
| `*&hs(表达式)*&` | 计算只含 `+ - * / ^ ()` 与数值变量的式子 |
| `&*floor(数值,位数)&*` / `&*ceil(数值,位数)&*` | 按位数向下 / 向上取整（兼容旧写法 `*&floor(…)*&`） |
| `*&变量:{键,内容;…}*&` | 取值到展示内容的映射；未声明的变量会自动生成控件 |
| `:::info[标题]{open}` … `:::` | 折叠框，支持 `info/note/tip/success/warning/error/danger` 与多层嵌套（`::::`） |
| `::cute-table{tuack}` | 下一张表格使用 Tuack 风格 |
| 表格里的 `<` / `^` | 向左 / 向上合并单元格（colspan / rowspan） |

变量定义：`名字:类型=默认值[最小,最大,步长]`，类型用 `Z`（整数）、`Q`（有理数）、`S`（字符串）。
整数默认带滑动条；有理数需在定义末尾加 `{faster_set}` 才显示滑动条；字符串的两个限制值是最小、最大长度。

这些规则与 Blog 前端（`src/lib/showBox.ts`、`src/components/Markdown.tsx`、`src/lib/markdownSource.ts`）完全一致——扩展直接移植了同一套解析 / 求值代码，所以站内与本地预览结果相同。

## 三、两条预览路线

### 1. VS Code 内置 Markdown 预览（开箱即用，**可交互**）

扩展通过 `markdown.markdownItPlugins` 注入 markdown-it 插件，并附带预览样式与脚本：

- 展示框带数字框 / 滑动条 / 文本框，拖动即时刷新正文中的 `show` / `hs` / `floor` / `ceil` / 映射结果；
- 文档重新渲染后仍会记住当前取值（按展示框内容哈希）；
- 公式 `$…$`、行内代码与代码块里的记号按默认值静态替换，避免破坏 KaTeX 与代码高亮。

### 2. Markdown Preview Enhanced（需一键安装，**静态渲染**）

MPE 不会加载其它扩展注册的 markdown-it 插件，但它支持「扩展解析器」。执行命令：

> **星野笔记: 安装 Markdown Preview Enhanced 支持**（可选全局 `~/.crossnote` 或当前工作区 `.crossnote`）

该命令会：

1. 写入 `parser.js`——一个**自包含、单表达式**的脚本（兼容 crossnote ≥ 0.9.30 的 QuickJS 沙箱，不含 `require` / Node API），在 `onWillParseMarkdown` 阶段把特殊语法展开；
2. 把配套样式合并进 `style.less`（只替换 `starlog-markdown:begin/end` 标记之间的内容，你原有的样式会保留）；
3. 打开 MPE 的 `enableExtendedTableSyntax`，让 `<` / `^` 能生成 colspan / rowspan；
4. 若已存在他人写的 `parser.js`，会先备份为 `parser.js.bak-<时间戳>` 再覆盖，并在通知里告诉你路径。

MPE 预览里展示框按**变量默认值**静态渲染，并在底部列出变量清单（MPE 预览不执行扩展提供的脚本，因此没有滑动条）；折叠框、Tuack 表格、单元格合并、框内的 Markdown 与公式都正常。

卸载：**星野笔记: 移除 Markdown Preview Enhanced 支持**。

## 四、命令一览

| 命令 | 作用 |
| --- | --- |
| 星野笔记: 安装 / 移除 Markdown Preview Enhanced 支持 | 读写 `.crossnote/parser.js` 与 `style.less` |
| 星野笔记: 插入交互展示框 / 折叠框 / Tuack 表格 | 带占位符的代码片段 |
| 星野笔记: 复制为洛谷源码 | 展示框按默认值展开，保留折叠框与表格扩展 |
| 星野笔记: 复制为基本 Markdown 源码 | 再把折叠框转引用、展开合并单元格、去掉 Tuack 指令（有选中内容时只转换选区） |
| 星野笔记: 打开语法示例文档 | 打开 `samples/syntax-demo.md` 并分屏预览 |

还有一批代码片段：`show`、`varz`、`varq`、`vars`、`hs(`、`floor(`、`ceil(`、`map`、`callout`、`tuack`。

## 五、已知差异

- 预处理会插入若干行 HTML，预览的滚动同步在展示框 / 折叠框之后可能有几行偏移。
- 折叠框标题按纯文本渲染（Blog 站内会额外渲染标题里的 KaTeX）。
- MPE 路线下 `<` 依赖 MPE 的「扩展表格语法」；安装命令已自动开启，若手动关闭则合并失效。

## 六、本地开发

```bash
cd vscode_extensions/v1
npm install
npm run build      # 产出 out/ 与 resources/mpe/
npm test           # markdown-it / QuickJS 单表达式 / jsdom 交互 回归测试
npm run typecheck
npm run package    # 重新生成 .vsix
```

目录结构：

```
src/core/showBox.ts       从 Blog 移植的解析 / 求值 / 渲染核心（无依赖）
src/core/transform.ts     特殊语法 → Markdown + HTML
src/core/sourceConvert.ts 洛谷 / 基本 Markdown 降级
src/markdownIt.ts         内置预览的 markdown-it 插件（含表格合并）
src/preview/preview.ts    内置预览的交互脚本
src/mpe/parserEntry.ts    MPE 扩展解析器入口
src/mpeSetup.ts           .crossnote 安装 / 卸载逻辑
resources/mpe/            构建产物：parser.js、style.less
```
