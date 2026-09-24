<title>PHASE-01 — MVP 核心纵切与 TDD 证据</title>

- 状态：本地 Green；真实飞书 E2E 未执行
- 日期：2026-09-21
- 规格基线：`04-SPEC` v0.2
- 锁定依赖（本阶段当时基线）：`@lark-base-open/js-sdk@1.0.2`、`vue@3.5.13`、`vue-print-designer@1.7.39`；正式记录视图构建链的后续纠偏见 PHASE-02。

# 目标

在不使用自制设计器或 Mock 页面作为验收的前提下，完成从飞书选择契约、记录/关联数据、自动模板、每表活动模板到真实打印引擎预览/打印/PDF 的本地生产纵切。单元和契约测试只证明实现边界；真实飞书容器仍是最终验收面。

# TDD 循环

| 循环 | SPEC | 有效 Red | 最小 Green | 结果 |
|-|-|-|-|-|
| PrintJob | CTX-01/02、BATCH-01 | 5 个行为测试因未实现而失败 | 有序去重、缺失/重复阻断、不可变快照 | 后续扩展为 7 个回归用例 |
| 设计器绑定/输出 | TPL-01、OUT-01/02、BATCH-02 | 未绑定 testData、批量路径缺失 | `setTestData/setVariables`；浏览器打印策略已由 PHASE-02C 更新为 `getPreviewHtml()`＋当前文档 `window.print()`；批量 PDF 使用 `getBatchPdfBlob/exportBatchPdf` | 适配器回归通过；Edge 兼容细节见 PHASE-02C |
| 关联纯函数 | LINK-01/03、DATA-02 | 3 个测试因“尚未实现”失败 | 前五有序字段、关联 ID 顺序、失败不返回半截 | 3/3 Green |
| 飞书关联网关 | LINK-01/02/03 | 3 个测试显示未刷新/未展开关联 | 支持类型 18/21，目标表首视图字段顺序，`refreshLinkValue=true` | 3/3 Green |
| 字段规范化 | DATA-01/02 | 2 个测试暴露原始对象与无权限未降级 | 普通字段统一 `getCellString`，失败写入字段名与原因 | 2/2 Green |
| 模板仓库 | SAVE-01/02、SEC-01 | 4 个测试因存储未实现失败 | bridge 键隔离、schema/引擎版本、校验和、旧版本检查、运行态记录值清理 | 4/4 Green；原子并发未解决 |
| 模板溢出 | TPL-04 | 3 个测试暴露单页越界、长文本未 auto-height、页脚不重复 | 静态字段续页、auto-height、autoPaginate、repeatPerPage | 3/3 Green |
| 真实引擎预览 API | OUT-01、BATCH-02 | 缺少 `previewPrintJob` 导出 | 单条 `preview()`；多条一次 `getBatchPdfBlob()` | 3/3 Green |
| 关联降级/空态 | DATA-02、LINK-03 | 畸形 ID 被静默过滤、不可读明细字段中断；空明细缺提示 | 畸形 ID 阻断，字段级降级，独立空态变量 | 专项 Green |
| 批量长文本 | BATCH-03、TPL-04 | 首条短值使后续长值落入固定短框 | 共享模板扫描整个批次的值 | 专项 Green |

首次模块不存在或测试环境错误不计作有效 Red。每轮 Green 后均运行相邻回归；最终执行全量命令。

# 当前生产实现

1. `src/host/feishu-context.ts` 使用 `getSelection` 与 `selectRecordIdList`，空选择不回退到首条。
2. `src/host/bitable-gateway.ts` 使用当前数据表的有序字段元数据；普通字段读取可打印文本，关联字段按目标表首个视图的前五字段展开。
3. `src/core/template-generator.ts` 生成安装版引擎可加载的 `pages/canvasSize` 模板，区分短/长文本，支持静态续页和动态文本/表格流式分页。
4. `src/core/template-repository.ts` 对每个 table 存一个版本化活动模板，并在保存前清除业务记录样本。
5. `src/engine/designer-adapter.ts` 直接调用真实 Web Component；单条和批量走不同公开 API，批量不循环打印。
6. `src/App.vue` 等待引擎 ready，选记录后自动加载/生成模板；表/视图变化使旧请求失效。保存、预览、打印和 PDF 只对当前上下文开放；批量预览展示一个由引擎生成的 PDF Blob。

# 验证证据

```text
npm test
tests 42, pass 42, fail 0

npm run build
vue-tsc -b && vite build: success
```

真实设计器改为异步注册后，构建初始入口约 906 KB minified / 294 KB gzip（此前约 2.167 MB / 652 KB gzip）；引擎延迟块约 1.252 MB / 357 KB gzip，且仍有其依赖延迟块。构建仍有大块告警，必须在飞书容器测量首次 ready/预览时间后继续优化，不能仅调高 warning 阈值关闭。

异步加载改造后运行本地 Vite 浏览器冒烟：真实 `<print-designer>` 的 Shadow DOM、工具栏、画布和“就绪”可见；配置 Vue `isCustomElement` 后未新增“Failed to resolve component”警告。此项仅是浏览器集成证据，不含飞书 SDK 上下文，不能计作 E2E。

# 尚未完成与停止边界

- 本阶段尚无真实飞书记录视图资产、测试 Base/账号，故 CTX、权限、bridge 跨会话、iframe 打印/PDF 和长明细跨页 E2E 均为未执行；后续已取得 App ID 并建立可上传包，见 PHASE-02。
- 关联读取目前按 SDK link 值返回的 recordIds 全量展开；其最大长度、分页/限流和真实跨页效果仍需长明细样本验证。
- bridge 没有原子 CAS；当前单测只证明顺序发生的旧版本被拒绝，不能保证真实多用户同时保存无丢失。ADR-0003 保持 proposed。
- 尚无企业用途的引擎书面授权/法务结论，故不能宣称允许企业内测、部署或商用。
- 不用本地 Vite 页面、fixture、浏览器契约或自动化测试冒充上述 E2E。
- 若真实容器证明接口/沙箱假设不成立，保留复现证据并更新 ADR；引擎替换或 MVP 缩范围必须由用户确认。

# 下一动作

1. 真实记录视图 `BlockTypeID` 与代码上传已在 PHASE-03 完成；下一步准备含单条、三条批量、空/长关联明细的脱敏测试 Base。
2. 在真实容器逐项执行 `06-TEST` 的五步验收，保存截图、PDF、打印框次数和行数对照。
3. 验证 bridge 的写权限、容量、同表重开、不同表隔离与并发用户行为，再决定 ADR-0003 是否 accepted。
4. 记录 SPEC-PERF-01，随后按测量结果做引擎懒加载/分包优化。
