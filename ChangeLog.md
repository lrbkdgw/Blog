# 更新日志 · ChangeLog

> **维护约定**（详见 [AI_README.md](AI_README.md)）：每次更新本仓库都必须同步更新
> [README.md](README.md) 与本文件，并在对应条目中注明 **模型名称、模型版本号、知识库截止时间**。
> 条目按时间倒序排列（最新在最上），同一天的多次更新各占一个条目。

---

## 2026-10-15 · 修复文章显示 Bug：帮助页嵌套围栏、渲染对比 frontmatter 与围栏解析一致性

| 模型信息 | |
| --- | --- |
| 模型名称 | Arena.ai Agent Mode（平台多模型动态调度，包括但不限于 Claude、ChatGPT、Gemini、Grok、Qwen、Kimi 等） |
| 模型版本号 | 未公开（由 Arena.ai 平台调度，不提供具体底层模型版本） |
| 知识库截止时间 | 未公开（依所调度的底层模型而定，平台未公开统一口径） |

### 修复
- **帮助页（content/about.md）文章无法正常显示**：「链接与图片」示例外层 `~~~markdown` 围栏内嵌套了同长度的 `~~~ts` / `~~~` 示例围栏。按 CommonMark 规则，外层围栏在第一个裸 `~~~` 处提前闭合，多出的 `~~~` 又开启一个新代码块，把正文段落「外部链接会在新标签页打开…」与标题「脚注、自动链接与换行」及整个脚注示例全部吞进代码块（目录中还出现指向不存在锚点的死链）。已将外层围栏改为四波浪号 `~~~~markdown` / `~~~~`，并去掉示例中多余的反斜杠转义（`` \` ``、`\${`）。
- **历史「渲染对比」把 frontmatter 当正文渲染**：版本对比的渲染模式此前把历史版本的完整文件文本（含 YAML frontmatter）直接交给渲染器，文章顶部会显示 `title:` / `date:` / `tags:` 等元数据垃圾。现先用 `parseFrontmatter` 剥离出正文再渲染；「源码对比」模式仍展示完整文件，不受影响。
- **围栏解析统一为 CommonMark 规则**（目录提取 `extractToc`、Markdown 预处理、复制源码转换 `markdownSource.ts`、VS Code 插件 MPE 兼容转换）：此前带 info string 的围栏行（如 `~~~ts`）会被误判为闭合围栏，且不校验围栏标记字符与长度，可能导致目录死锚点、围栏内示例被误执行扩展指令、复制转换与页面渲染行为不一致。现统一为：开启围栏可带 info string；闭合围栏必须与开启围栏同标记字符（`` ` `` 或 `~`）、长度不短于开启围栏且不带 info string；围栏行最多缩进 3 个空格。

### 调整
- VS Code 插件构建产物（`out/extension.js`、`out/preview.js`、`resources/mpe/parser.js`）随 `src/core/transform.ts` 的围栏修复一并重建。
- 通读 README.md 确认：本次修复均为纠正错误行为，未改变任何已文档化的功能、配置或使用方式，README 无需修改。

### 验证
- `npm run build`（tsc --noEmit + vite build）通过。
- `npm run extension:test`：61 项测试（57 pass / 4 skip / 0 fail），与修改前基线一致。
- SSR 渲染检查：全部 8 篇文章的代码围栏数与 `<pre>` 数、源码标题数与渲染 `h*` 数完全一致；帮助页正文段落不再落入 `<pre>`，「脚注」标题正常渲染，页内 42 个锚点链接（含手动目录）0 死链。
- jsdom 运行时回归：首页 / 文章页（含大体积的 smsky 题单）/ 归档 / 标签 / 帮助 / 登录 / 设置 / 管理 / 编辑器 / 404 全部挂载无运行时错误；历史版本「查看」、版本对比（源码 / 渲染，经真实 GitHub API 拉取历史）、客户端导航、搜索、复制源码转换（direct / luogu / basic）、交互展示框均正常，渲染对比面板不再含 frontmatter。
- frontmatter `serializePost → buildPost` 往返校验（6 篇仓库文章 + 边界用例）与加密信封校验通过。

---

## 2026-10-15 · 文档与 AI 协作约定

| 模型信息 | |
| --- | --- |
| 模型名称 | Arena.ai Agent Mode（平台多模型动态调度，包括但不限于 Claude、ChatGPT、Gemini、Grok、Qwen、Kimi 等） |
| 模型版本号 | 未公开（由 Arena.ai 平台调度，不提供具体底层模型版本） |
| 知识库截止时间 | 未公开（依所调度的底层模型而定，平台未公开统一口径） |

### 新增
- 新增 [`AI_README.md`](AI_README.md)：AI 协作维护规范——约定每次更新必须同步维护 README.md 与 ChangeLog.md，且 ChangeLog 条目必须注明模型名称、模型版本号与知识库截止时间（含条目模板与更新流程）。
- 新建本更新日志 [`ChangeLog.md`](ChangeLog.md)。

### 调整
- README.md 同步「待更新队列」「历史版本命名与渲染对比」的行为说明（简介、写作流程、加密文章、FAQ、目录结构），并新增「文档与维护约定」一节。

---

## 2026-10-15 · 待更新队列、历史版本命名与渲染对比、若干修复（PR #43）

| 模型信息 | |
| --- | --- |
| 模型名称 | Arena.ai Agent Mode（平台多模型动态调度，包括但不限于 Claude、ChatGPT、Gemini、Grok、Qwen、Kimi 等） |
| 模型版本号 | 未公开（由 Arena.ai 平台调度，不提供具体底层模型版本） |
| 知识库截止时间 | 未公开（依所调度的底层模型而定，平台未公开统一口径） |

### 新增
- **待更新队列**：内容管理界面「发表申请」右侧新增队列页。所有需要更新仓库的操作（发布/删除文章、上传图片、发表申请 PR、账号偏好同步）不再立即生效，先保存在本机；可勾选部分更改一次批量更新或全部更新，文件类更改合并为一次 Git 提交（一次部署），失败条目保留可重试。图片暂存本地并在站内预览中自动使用暂存数据。
- **历史版本命名**：历史版本列表可为任一版本修改显示名称（本地保存，优先于提交信息显示，可恢复默认）。
- **历史版本渲染对比**：版本对比新增「源码对比 / 渲染对比」切换，渲染模式并排展示两个版本的完整渲染效果。

### 调整
- 编辑器「发布到 GitHub / 申请发表」改为「加入更新队列」，统一更新时才真正提交；同文章多次更改只保留最新意图。
- 设置页字体/背景「保存到 GitHub 账号」改为入队，统一更新后同步；登录恢复偏好时不再用旧远程版本覆盖队列中未更新的更改。

### 修复
- 修复 `useEffect` 依赖对象引用不稳定导致仓库权限接口在 Admin/编辑器中反复请求（新增 `useRepoTarget` 稳定订阅）。
- 修复 GitHub contents API 路径与 ref 未按段编码（分支名含 `/`、文件名含空格等会请求失败）。
- 修复超过 1MB 的远程文件 contents API 不返回内容的问题（回退 `download_url`）。
- 修复畸形百分号编码导致文章锚点跳转、折叠框标题渲染崩溃。
- 修复 Toast 站内跳转链接误用 `target=_blank` 新标签页打开。
- 修复 VS Code 插件等非 Vite 打包环境中 `import.meta.glob` 加载即抛错（发布记录逻辑独立为 `publishTimes.ts`，并对 glob 加 typeof 守卫）。

### 验证
- `npm run build`（tsc + vite）通过。
- `npm run extension:test`：61 项测试全部通过（57 pass / 4 skip / 0 fail）。

---

## 更早的变更

在本日志建立之前完成的更新（当时未记录模型信息，一并补录于此供追溯），完整过程见
[Pull Requests](https://github.com/lrbkdgw/Blog/pulls?q=is%3Apr) 与 git 提交记录：

| 日期 | PR | 内容 |
| --- | --- | --- |
| 2026-10-11 | [#42](https://github.com/lrbkdgw/Blog/pull/42) | 重写 VS Code 插件：Markdown 语法拓展与博客同源渲染 |
| 2026-10-06 | [#41](https://github.com/lrbkdgw/Blog/pull/41) | fix(content): restore encrypted post tags |
| 2026-10-06 | [#40](https://github.com/lrbkdgw/Blog/pull/40) | 加密文章不再加密标签 |
| 2026-10-06 | [#39](https://github.com/lrbkdgw/Blog/pull/39) | 编辑器：滚动对齐与全屏改进、加密草稿修复与元数据保护、长文输入性能优化 |
