<title>ADR-0006 — 记录视图浏览器打印兼容</title>

- 状态：accepted（实现策略）；真实飞书 Edge E2E 待验证
- 日期：2026-09-23

# 背景

真实飞书记录视图插件中的 Edge 打印复现为 `ERR_BLOCKED_BY_CLIENT`。`vue-print-designer@1.7.39` 会在 Edge 中通过 `window.open(blob:)` 新开页面。先前尝试改为当前插件文档的 `blob:` PDF iframe，但用户在顶部和设计器内部入口仍观察到拦截；模拟 iframe 测试并不能说明真实飞书容器允许该加载方式。

# 决策

保留真实 `vue-print-designer` 及其模板、变量和页面渲染能力。浏览器打印由 `DesignerAdapter` 调用 `getPreviewHtml()` 取得引擎渲染的 HTML，临时追加到当前插件文档后调用一次 `window.print()`：单条一份页面，批量按已选顺序合并多份页面。

应用在设计器异步资源挂载前注册捕获阶段的 `designer:print` 监听；顶部和内部入口均进入同一打印适配层，不让内部按钮再调用上游 `window.open(blob:)` 分支。`afterprint` 清理临时节点，60 秒兜底。PDF 文件导出仍使用上游 PDF API。

# 未采用的方案

- 不 fork 或修改 `vue-print-designer`：会增加升级和许可证维护成本。
- 不通过 `window.open(blob:)` 或新标签页打印：正是已复现的 Edge 拦截路径。
- 不通过隐藏 `blob:` PDF iframe 打印：用户复现仍失败，且没有真实容器加载成功证据。
- 不回退到独立网页或自制 PDF/画布：违反真实飞书记录视图插件和真实引擎边界。

# 后果

浏览器实际打印的是引擎返回的 HTML 而非 PDF viewer，纸张边距、分页和视觉一致性必须同预览/PDF 在真实容器比对。方案依赖飞书插件当前文档允许 `window.print()`，因此必须在飞书 PC 端 Edge 和 Chrome 完成真实复测；单元测试只验证事件和调用契约。PDF 导出仍调用上游 `export({ type: "pdf" })` / `exportBatchPdf`，与浏览器打印兼容修复隔离。

# 证据与复议条件

`tests/designer-adapter.test.ts` 的引擎 HTML、单次 `window.print()`、无 Blob 导航和内部事件接管契约测试，以及 `docs/bugs/BUG-0001-Edge打印被客户端拦截.md` 记录本地证据。若真实容器仍阻止当前文档打印，保留新的错误证据并由用户决定是否增加宿主外部打印桥接；不得静默改成独立 Demo。
