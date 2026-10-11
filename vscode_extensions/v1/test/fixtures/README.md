# VS Code 宿主测试夹具

`vscode-markdown.css` / `vscode-highlight.css` 来自 Microsoft VS Code 的 Markdown 扩展：

- https://github.com/microsoft/vscode/blob/main/extensions/markdown-language-features/media/markdown.css
- https://github.com/microsoft/vscode/blob/main/extensions/markdown-language-features/media/highlight.css

2026-10-11 获取，保留原始版权与 MIT 许可说明。测试故意同时加载这些默认样式，以防预览正文受到宿主的字号、标题、引用或代码布局规则干扰。升级支持的 VS Code 版本时可更新快照；它们不进入成品 VSIX。


`vscode-update.mjs` 是以下更新分支的缩小测试桥接，不是完整 VS Code：

- https://github.com/microsoft/vscode/blob/main/extensions/markdown-language-features/preview-src/index.ts

使用真正的 `morphdom`，保留更新事件、文档切换、相等节点/折叠状态处理，以及事件之后添加原生复制按钮的顺序；省略脚本执行等无关功能。Chromium 测试在插件之前/之后分别注册宿主监听器，用异步 `window.postMessage` 触发更新，并验证创建、删除、再次创建展示框后 DOM、变量、公式和正文仍正确。这能捕获 jsdom 与 Chromium 在 window 目标事件监听顺序上的差异。测试桥接还在更新事件之后按内置滚动同步的方式读取 `.code-line`，检查新正文行号和 EOF 锚点已同步发布，隐藏入口没有重复锚点。
