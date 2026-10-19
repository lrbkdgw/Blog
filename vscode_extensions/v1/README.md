# Markdown 语法拓展 · VS Code 插件

安装后，在 **VS Code 内置 Markdown 预览**中使用与本仓库博客相同的正文渲染：同一份 React 组件、Markdown 插件链、KaTeX、代码高亮、交互展示框和 Tailwind 样式，而不是另写一套近似实现。

当前版本：**2.1.0**。目录 `v1/` 与扩展 ID `lrbkdgw.starlog-markdown` 保留以兼容旧版；插件展示名称、设置标题、命令分类均为 **Markdown 语法拓展**。

## 安装与使用

在仓库根目录执行：

```bash
code --install-extension vscode_extensions/v1/starlog-markdown-2.1.0.vsix --force
```

也可以在扩展侧边栏的 `…` 菜单选择 **从 VSIX 安装…**，安装上面的文件。升级后按 VS Code 的提示重新加载窗口，并重新打开预览。

1. 打开任意 `.md` 文件。
2. 执行 **Markdown: 打开侧边预览**（Windows/Linux：`Ctrl+K V`；macOS：`⌘+K V`），或使用 `Ctrl/⌘+Shift+V` 打开内置预览。
3. 命令 **Markdown 语法拓展: 打开语法示例文档**可打开随包附带的示例并分屏预览。

**无需安装额外的公式插件、MPE、Node.js 或启动博客服务。** React、公式渲染、高亮、CSS 和全部 KaTeX 字体均内嵌在 VSIX 中，安装后离线可用（文档中使用的外链图片仍需网络）。

## 预览背景设置

VS Code **Settings** 中搜索 `@ext:lrbkdgw.starlog-markdown` 或「渐变」，使用 **Starlog › Preview: Enable Gradient Background** 开关。也可以在用户或工作区的 `settings.json` 中设置：

```json
{
  "starlog.preview.enableGradientBackground": false
}
```

默认 `false`：使用与博客主题对应的纯色背景；设为 `true`：使用博客同款渐变背景。修改设置后，已打开的内置预览会自动刷新，无需重新加载窗口。这只切换页面背景，不改变正文、公式、代码或展示框的样式。设置变更使用内置刷新命令，VS Code 重新载入预览时，展示框变量会恢复默认值。

普通 Markdown 表格和非 Tuack 合并表格默认靠左，单元格遵循列分隔符中的对齐设置（`:--` 左、`:--:` 中、`--:` 右）；只有 Tuack 表格整体居中。此规则来自博客的共享样式，博客和插件同步生效。

## 为什么可以保持一致

| 内容 | 唯一来源 |
| --- | --- |
| Markdown、GFM、公式、高亮、折叠框、智能表格、代码复制按钮、标题锚点 | `src/components/Markdown.tsx` |
| 展示框布局、数字框 / 滑动条 / 文本框及实时重渲染 | `src/components/ShowBox.tsx` |
| 变量解析、映射、表达式与取整 | `src/lib/showBox.ts` |
| 复制为洛谷 / 基本 Markdown | `src/lib/markdownSource.ts` |
| 文首排版指令（`::set-font` / `::set-code-font` / `::set-background`）的解析与字体栈 | `src/lib/articleDirectives.ts`、`src/lib/fontStacks.ts` |
| LaTeX 符号目录（命令、别名、插入光标） | `src/lib/latexSymbols.ts` |
| 默认排版、深浅色主题与控件样式 | `src/styles/index.css`、`tailwind.config.js` |
| React / KaTeX / remark / rehype 的版本 | 仓库根目录 `package-lock.json` |

扩展主进程用博客组件生成初始 HTML；预览脚本再直接挂载同一组件。改变变量后，**整段 Markdown 源码重新经过博客的渲染链**，所以公式、表格、行内代码、围栏代码、映射生成的 Markdown 都会一起更新，而不只是替换正文中的几个 span。

样式在构建时直接从博客生成，并加正文作用域；宿主适配层仅中和 VS Code 自带的字号、标题下边距、引用圆角等冲突，不维护另一份博客主题。公式 CSS 也放在同一样式入口中，确保加载顺序一致。

- 默认采用博客的字体栈与 16px 基准字号，不使用 `markdown.preview.fontFamily` / `fontSize` 改写正文。文章开头若写了 `::set-font[…]` / `::set-code-font[…]`，与博客一致直接套用到预览正文（需本机装有该字体，插件不会联网下载）；`::set-background[…]` 针对博客网页的动态背景，预览只移除指令行、不切换背景。
- 随 VS Code 的深浅色主题选择博客对应的配色；博客网页上个人设置的字体、字号和背景偏好不会自动跨应用同步。
- YAML frontmatter 与博客一样不作为正文渲染，源行号保留原始偏移。
- 本地图片经过 VS Code 的资源转换；相对链接仍由内置预览打开。
- React 正文永久位于内置 `markdown-body` 的外面，避免内置 DOM 更新破坏创建、删除展示框后的渲染；隐藏入口不留下重复标题或滚动锚点。
- 同源码刷新保留交互状态；源码改变时沿用博客组件的重置规则，切换文档不共享变量状态。
- 保留内置预览的原始 token 分析与滚动行号，不放宽预览安全策略，也不重复调用 `acquireVsCodeApi`。

同款效果针对 **Markdown 正文**，不包含博客的导航、文章元信息、评论和网页布局。其它改变整篇 Markdown 渲染的扩展可能发生冲突，建议不要同时启用。

## 支持语法

| 语法 | 说明 |
| --- | --- |
| `::show_begin{标题}{变量定义}` … `::show_end` | 交互展示框 |
| `*&show(变量)*&` | 输出当前变量值 |
| `*&hs(表达式)*&` | 计算只含 `+ - * / ^ ()` 与数值变量的式子 |
| `&*floor(数值,位数)&*` / `&*ceil(数值,位数)&*` | 按位数向下 / 向上取整，兼容旧写法 `*&floor(…)*&` |
| `*&变量:{键,内容;…}*&` | 变量到 Markdown 内容的映射，未声明的变量自动生成控件 |
| `:::info[标题]{open}` … `:::` | 折叠框，支持 `info/note/tip/success/warning/error/danger` 与多层嵌套 |
| `::cute-table{tuack}` | Tuack 表格 |
| 表格内的 `<` / `^` | 向左 / 向上合并单元格 |
| `$…$`、`$$` 块、`math` 围栏 | 与博客相同的 KaTeX 公式 |
| 普通 Markdown / GFM | 高亮代码、任务列表、删除线、脚注、表格、原始 HTML 等 |
| 文首 `::set-font[字体名]` / `::set-code-font[字体名]` | 强制本文正文 / 代码字体；可写多条，越早优先级越高，后面的作回退 |
| 文首 `::set-background[0–5]` | 强制在博客阅读本文时的动态背景（0 无 · 1 樱花 · 2 粒子星链 · 3 雪花 · 4 暴雨 · 5 竹林），插件预览中仅移除该行 |

变量定义：`名字:类型=默认值[最小,最大,步长]`。`Z` 为整数，`Q` 为有理数，`S` 为字符串。整数默认有滑动条；有理数需加 `{faster_set}` 才显示滑动条；字符串的两个限制是最小、最大长度。

````markdown
::show_begin{二次函数}{a:Z=1[-5,5,1]; b:Q=0[-10,10,0.5]{faster_set}; name:S=星野[0,12]}
你好，*&show(name)*&。结果是 *&hs(a^2+b)*&。

$$
x_{*&show(a)*&}=*&hs(a^2+b)*&
$$

```cpp
int a = *&show(a)*&;
```
::show_end
````

## 命令与片段

命令面板中的分类统一为 **Markdown 语法拓展**：

- 插入交互展示框 / 折叠框 / Tuack 表格。
- 插入 LaTeX 符号…：按 `Shift + ↑`（仅 Markdown 编辑器聚焦时）或从命令面板打开，可搜命令或别名（「正负」→ `\pm`、「异或」→ `\oplus`），选中插入光标处；符号目录与博客站内编辑器共用 `src/lib/latexSymbols.ts`。`Shift + ↑` 在 Markdown 里被本扩展接管，如需恢复选区上扩，可在键盘快捷方式里改绑 `starlog.insertLatexSymbol`。
- 复制为洛谷源码 / 基本 Markdown 源码（有选区时只转换选区）。
- 打开语法示例文档。
- 安装 / 移除 Markdown Preview Enhanced 静态兼容支持。

旧的 `starlog.*` 命令 ID 和设置键保留，原有快捷键无需修改。

代码片段包括 `show`、`varz`、`varq`、`vars`、`show(`、`hs(`、`floor(`、`ceil(`、`map`、`callout`、`tuack`、`setfont`、`setcodefont`、`setbackground`。

## Markdown Preview Enhanced（可选，静态兼容）

**要与博客的交互渲染一致，请使用上面的 VS Code 内置预览。** MPE 使用自己独立的渲染引擎，不加载本扩展的 React 预览脚本，不能提供同款交互。

为兼容已有工作流，保留 MPE 的安装 / 移除命令：它们会写入全局 `~/.crossnote` 或当前工作区 `.crossnote` 的单表达式 `parser.js`、合并 `style.less`，并开启扩展表格语法。其它解析器会在覆盖前备份，原有样式保留。

该路线只按变量默认值静态展开展示框，不保证与博客的完整视觉效果一致。自动安装提示默认关闭，安装本插件不会擅自修改 MPE 配置。

## 开发与验证

扩展必须在本仓库内构建，因为它引用博客源码和根目录锁定的依赖；安装成品 VSIX 不需要仓库。

```bash
# 仓库根目录
npm ci
npm ci --prefix vscode_extensions/v1
npm run build                              # 博客类型检查与生产构建
npm --prefix vscode_extensions/v1 run typecheck
npm run extension:test                     # 构建 + DOM / CSS / jsdom / 主进程 / MPE 回归
npm run extension:package                  # 构建并生成 starlog-markdown-2.1.0.vsix
npm --prefix vscode_extensions/v1 run watch # 监听共享源码、样式、Tailwind 配置与 MPE 源码
```

另外提供可选的真实 Chromium 对照测试。先构建博客，再指定本机 Chrome/Chromium 可执行文件：

```bash
BROWSER_EXECUTABLE_PATH=/path/to/chrome npm --prefix vscode_extensions/v1 run test:browser
```

测试同时加载 VS Code 默认样式，逐项比较深浅主题下标题、代码、普通/合并/Tuack 表格、折叠框、展示框和公式的计算样式，并验证变量更新及渐变开关。另用真实 `morphdom` 与异步 `postMessage`，在宿主/插件两种加载顺序下回归创建、删除、再次创建展示框、未闭合编辑、清空和切换文档。不设置该环境变量时，仅跳过四项浏览器测试，其余测试照常运行；这不是启动 VS Code/Electron 的端到端测试。

关键目录：

```text
src/render.tsx           博客组件的服务端渲染 + frontmatter / 行号适配
src/markdownIt.ts        内置预览桥接，保留 VS Code token 缓存与图片转换
src/preview/preview.tsx  挂载博客 React 组件，隔离 VS Code 的 DOM 更新
src/core/showBox.ts      博客求值器的直接 re-export
src/core/sourceConvert.ts 博客源码转换的直接 re-export
src/core/transform.ts    仅用于 MPE 的静态兼容转换
media/preview.css        很薄的 VS Code 外壳适配
out/                    打包的主进程、脚本、正文 CSS、KaTeX 字体
resources/mpe/          MPE 静态兼容构建产物
resources/third-party-notices.txt  打包依赖与字体的许可证
```
