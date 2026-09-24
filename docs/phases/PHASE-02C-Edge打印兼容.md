<title>PHASE-02C — Edge 记录视图打印兼容</title>

- 状态：本地 Green，组件包已上传；用户已确认一个真实 Edge 入口可打开原生打印预览，完整回归待补齐
- 日期：2026-09-23
- 规格：`SPEC-OUT-01/02`、`SPEC-BATCH-02`
- 缺陷：[`BUG-0001`](../bugs/BUG-0001-Edge打印被客户端拦截.md)

# 目标

修复真实记录视图中点击“打印”跳转 Edge `ERR_BLOCKED_BY_CLIENT` 的问题，同时继续使用真实 `vue-print-designer` 和真实多维表格数据。

# Red

前一版 iframe 方案在真实 Edge 仍复现拦截，因此改写 `tests/designer-adapter.test.ts` 契约，要求：

1. 单条输出必须使用引擎 `getPreviewHtml()` 并在当前文档调用一次 `window.print()`。
2. 批量必须按选中顺序渲染页面，再调用一次 `window.print()`。
3. 设计器返回空页面时必须明确失败。
4. 不能创建 `blob:` URL 或 PDF iframe。
5. 设计器内部 `designer:print` 必须在上游监听前被接管。

旧适配器没有内部事件接管，Red 测试因缺少该导出失败，形成有效 Red。

# Green

`src/engine/designer-adapter.ts` 改为当前文档 HTML 打印适配：

- 单条调用 `getPreviewHtml()`。
- 批量按记录顺序调用 `setVariables()`/`getPreviewHtml()`，合并为一次 `window.print()`。
- 使用 `afterprint` 和超时双路径清理临时 HTML 根节点。
- 捕获并阻止设计器的 `designer:print` 上游分支；顶部和内部入口共用适配层。
- 保留 PDF 文件导出路径，不改变真实引擎和模板结构。

# 验证

```text
npm test
tests 54, pass 54, fail 0

npm run build
success
```

上述是本地契约证据，不是飞书 Edge E2E。真实复测需在用户当前灰度租户、测试 Base、`PO-0001` 和至少三条批量记录中确认打印框、取消行为、页数和内容。

# 下一步

1. 用户已确认本次测试入口在 Microsoft Edge 中不再出现 `ERR_BLOCKED_BY_CLIENT`，可进入原生打印预览。
2. 后续仍需分别记录顶部和设计器内部入口，再用 Chrome 复测相同路径。
3. 本次复测发现单页模板产生第二张残片空白页，已登记为 [`BUG-0002`](../bugs/BUG-0002-预览与打印页数不一致.md)，按用户决定暂缓修复。
4. 分页问题恢复后再完成批量一次打印和 PDF 对照；不把“打印框能打开”等同于完整输出 E2E 通过。
