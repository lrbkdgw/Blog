# 更新日志 · ChangeLog

> **维护约定**（详见 [AI_README.md](AI_README.md)）：每次更新本仓库都必须同步更新
> [README.md](README.md) 与本文件，并在对应条目中注明 **模型名称、模型版本号、知识库截止时间**。
> 条目按时间倒序排列（最新在最上），同一天的多次更新各占一个条目。

---

## 2026-10-15 · 文档与 AI 协作约定（本次）

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
