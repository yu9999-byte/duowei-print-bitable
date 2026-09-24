<title>BUG-0001 — Edge 打印被客户端拦截</title>

- 状态：用户已确认真实 Edge 可打开原生打印预览；两个入口与 Chrome 完整回归仍待补齐
- 发现日期：2026-09-23
- 影响范围：MVP-1 单条打印；MVP-2 批量浏览器打印；顶部和设计器内部打印入口

# 现象

在真实飞书多维表格记录视图插件“多维打印”中，打开测试记录 `PO-0001` 后，无论点击插件顶部“打印”还是设计器内部“打印”，Microsoft Edge 都会显示“此页面已被 Microsoft Edge 阻止 / `ERR_BLOCKED_BY_CLIENT`”。因此不能把“已发起浏览器打印流程”或单元测试通过视为真实打印成功。

# 复现

1. 打开真实 Base `CjjybEbM8aL9rlsGhfocfRCMnFe` 的表 `tblUdB1VhaFIkGKu`。
2. 在记录视图打开“多维打印”，进入记录 `recvvQJTxl2Y6o`（`PO-0001`）。
3. 分别点击顶部“打印”和设计器内部“打印”。
4. 在 Microsoft Edge 中观察到 `ERR_BLOCKED_BY_CLIENT`。

# 初步原因

锁定的 `vue-print-designer@1.7.39` 的浏览器打印分支在 Edge 使用 `window.open(blobUrl, "_blank", ...)`。此前适配层虽绕过了新窗口，却仍在飞书插件容器内加载 `blob:` PDF iframe；实际复现证明该替代路径也不能作为兼容结论。原有模拟测试只伪造 iframe `load`/`print()`，没有证明 Edge 可以在真实飞书容器加载该 PDF。

设计器内部按钮通过 `designer:print` 事件最终进入同一上游 `window.open(blob:)` 路径；所以只改顶部按钮不能关闭缺陷。

# 修复

`DesignerAdapter` 保留真实 `vue-print-designer` 的模板和渲染能力，但不用 PDF Blob 承载浏览器打印：

- 单条：`setVariables()` 后调用 `getPreviewHtml()`，把引擎已渲染页面放入当前插件文档，再调用一次 `window.print()`。
- 批量：按已选记录顺序重复 `setVariables()`/`getPreviewHtml()`，合并页面后只调用一次 `window.print()`。
- 顶部按钮与设计器的 `designer:print` 都调用同一个 `printPrintJob()`；内部事件以捕获阶段阻止上游处理。
- 临时打印根节点在 `afterprint` 后清理，60 秒为兜底；PDF 导出仍走上游 PDF API，未被改成浏览器打印。

# TDD 证据

- Red：将契约改为“引擎 HTML + 当前文档一次打印 + 无 Blob 导航 + 内部事件接管”后，旧适配器缺少 `installDesignerPrintInterception` 导出，测试失败。
- Green：`tests/designer-adapter.test.ts` 覆盖单条与批量渲染顺序、只调用一次 `window.print()`、空页面显式失败、没有 Blob URL/iframe、内部事件不再落入上游打印监听；`npm test` 54/54 通过。
- Build：`npm run build` 通过；仅保留既有包体积警告。
- Upload：`npm run upload` 返回 `Upload succeed`，修复包为小组件 `1.0.7`。随后已创建并灰度发布应用版本 `1.0.4`（权限无变更，灰度企业 `F225904757`）。后台发布成功不等于真实 Edge E2E 已通过。

# 验收标准

- 上传组件包后，在飞书 PC 端 Microsoft Edge 的真实记录视图中，顶部与设计器内部“打印”均不出现 `ERR_BLOCKED_BY_CLIENT`，且各只出现一次浏览器打印对话框。
- 打印内容与 `PO-0001` 预览及导出 PDF 一致；用户取消不显示“已打印成功”。
- Chrome 复测相同路径；MVP-1 通过后，至少三条记录批量打印仅出现一个对话框，记录顺序正确。
- 未获得上述真实证据前，本缺陷不得关闭。

# 2026-09-23 真实复测补充

用户确认点击“打印”后已经可以进入 Microsoft Edge 原生打印预览，原 `ERR_BLOCKED_BY_CLIENT` 在本次测试入口不再出现。这是当前文档 HTML 打印路径在真实灰度插件中生效的证据，但尚未分别记录顶部和设计器内部两个入口，也未完成 Chrome 对照，因此本缺陷不直接标记为全部关闭。

复测同时发现预览一页、浏览器打印两页且第二页仅有浅灰残片的新问题，已独立登记为 [`BUG-0002`](BUG-0002-预览与打印页数不一致.md)。该分页问题不推翻“拦截已解除”的证据，但会继续阻断 `SPEC-OUT-01/02` 的严格输出一致性验收。
