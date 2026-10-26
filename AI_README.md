# AI_README.md · AI 协作维护规范

本文件约定 **AI 智能体（以及任何协作者）更新本仓库时必须遵守的文档维护流程**。
无论改动大小、由人还是 AI 完成，均适用。开始任何更新前请先阅读本文件。

---

## 一、必须遵守的规则

### 规则 1：每次更新必须同步更新两份文档

与代码一起提交，缺一不可：

| 文档 | 要求 |
| --- | --- |
| [README.md](README.md) | 项目说明。若本次改动影响功能、配置、目录结构、使用方式或 FAQ，**必须**同步修改相应章节；即使无影响，也应通读确认相关内容仍然准确，必要时做最小修正。 |
| [ChangeLog.md](ChangeLog.md) | 更新日志。**必须**在文件顶部（时间倒序）新增本次更新的条目；同一天的多次更新各占一个条目。 |

只改代码而不更新这两份文档的更新视为**未完成**。

### 规则 2：ChangeLog 条目必须写明模型信息

每个 ChangeLog 条目都**必须**包含以下三项（缺一不可）：

1. **模型名称**
2. **模型版本号**
3. **知识库截止时间**

填写要求：

- 如实填写执行本次更新的模型名称、版本号与其知识库截止时间。
- 若所用平台（如 Arena.ai 的多模型调度）不公开具体底层模型、版本或统一的知识库截止时间，则在对应项注明「未公开」并简述原因（示例见 ChangeLog 中的现有条目），**不得虚构或猜测**。
- 若某次更新由多个模型协作完成，逐一列出并注明各自负责的部分。

### 规则 3：条目格式与排序

- ChangeLog 条目**按时间倒序**排列（最新在最上）。
- 每条目包含：日期与标题、模型信息表、「新增 / 调整 / 修复 / 验证」小节（无内容的小节可省略）。
- 提交信息与 Pull Request 说明应能与 ChangeLog 条目对应，便于互相追溯。

---

## 二、ChangeLog 条目模板

````markdown
## YYYY-MM-DD · <本次更新标题>

| 模型信息 | |
| --- | --- |
| 模型名称 | <模型名称；平台不公开则注明「未公开」及原因> |
| 模型版本号 | <版本号；平台不公开则注明「未公开」及原因> |
| 知识库截止时间 | <截止时间；平台不公开则注明「未公开」及原因> |

### 新增
- <新增的功能、文档、接口等>

### 调整
- <行为或实现上的调整>

### 修复
- <修复的 Bug>

### 验证
- <构建/测试命令及结果，如 `npm run build` 通过、`npm run extension:test` 61 项通过>
````

---

## 三、建议的更新流程

1. 阅读本文件与当前 [README.md](README.md)、[ChangeLog.md](ChangeLog.md)，了解现状与已记录的历史。
2. 进行代码 / 内容修改。
3. 运行验证（常规：`npm run build`；涉及 VS Code 插件时：`npm ci --prefix vscode_extensions/v1` 后 `npm run extension:test`；
   **涉及 `src/**`、`vite*.config.ts`、`scripts/vite-plugin-single-html.mjs` 或 `content/posts/**` 时**，
   还必须跑 `npm run build:offline` 并通过 `scripts/verify-offline.mjs` 的自检——离线版是单文件产物，
   少字体、漏文章、内联脚本被破坏这类问题只在线上构建里看不出来）。
   **`npm run extension:test` 不做类型检查**：CI 的 `extension.yml`（check 名 `verify`）还会跑
   `npm --prefix vscode_extensions/v1 run typecheck`，那是另一条独立红线。插件的 tsconfig 只 include
   自己的 `src`，代码却顺着 import 复用了站点的 `src/lib/*`，所以站点侧一旦引入 Vite 全局常量
   （如 `__STARLOG_OFFLINE__`）或新的环境声明，就要同步把声明文件加进
   `vscode_extensions/v1/tsconfig.json` 的 `include`，并在本地跑一次
   `npm --prefix vscode_extensions/v1 run typecheck` 再提交（2026-10-19 的 CI 失败就是漏了这步）。
   离线版的定位是**不依赖互联网**：不要在 `OFFLINE` 分支里引入任何互联网请求（GitHub API、云端字体、
   远程图片都不行）。唯一例外是 issue #112 的局域网协作：仅在用户主动交换连接码后使用 WebRTC 点对点
   直连，`iceServers` 必须为空，不得引入 STUN / TURN 或外部信令服务器。如果自检报出「产物里出现了在线端点」，
   说明新代码把在线能力漏进了离线文件，要么把调用放到 `if (OFFLINE)` 之后，要么像 `config.ts` / `github.ts`
   那样把端点常量写成 `OFFLINE ? '' : 'https://…'`，而不是把自检删掉。
   自检通过后，把 `dist-offline/index.html` 拷到 `offline/index.html` 一并提交（该文件由
   `.github/workflows/offline.yml` 自动维护，**不要手工编辑**，也不要提交 `dist-offline/`）。
4. **更新 README.md**（按规则 1）与 **ChangeLog.md**（按规则 1、2、3，含模型信息）。
5. 将代码与文档一并提交并推送；提交信息写清本次变更。

---

*本文件建立于 2026-10-15；规则的任何修改同样需要在 ChangeLog.md 中登记。*
