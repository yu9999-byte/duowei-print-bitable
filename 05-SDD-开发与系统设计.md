<title>多维打印 — SDD 开发与系统设计</title>

# 1. 开发方法

本项目采用 Specification-Driven Development（规格驱动开发）和 Test-Driven Development（测试驱动开发）。每个垂直切片按以下顺序执行：

1. 在 SPEC 中冻结可观察行为、边界与错误条件，给出稳定 ID。
2. 在 TRACE 中关联设计模块、测试 ID 和实施任务。
3. 先写失败测试并记录失败原因（Red）；失败必须是目标能力缺失，而不是测试环境错误。
4. 写满足规格的最小生产实现（Green），运行相同测试。
5. 重构（Refactor）后跑相邻单测、契约测试和回归测试，记录命令、结果与证据。
6. 到真实飞书环境验证，补充截图/录屏、打印或 PDF 产物；仅通过模拟测试不得关闭切片。

阶段文件记录规格版本、决策、Red/Green/Refactor 证据、真实环境证据、遗留风险。没有 Git 时先用带时间戳的测试命令与输出记录；工程建立后建议初始化 Git 以保留测试先行的可审计历史，但不强制替用户创建远端仓库。

# 2. 模块契约

| 模块 | 输入 | 输出 | 关键约束 |
|-|-|-|-|
| ContextAdapter | 记录视图 `getSelection`、批量 `selectRecordIdList` | baseId、tableId、viewId、宿主/批量 recordIds | 单条来源必须是宿主 recordId；不猜 ID。`getSelection` 属于 SDK 读取，15 秒未返回即失败；`selectRecordIdList` 属于人工选择器，不设置操作超时 |
| BitableGateway | base/table/record IDs | SDK 可读字段、记录、关联元数据 | 最多 4 个主记录读取 worker；索引保留选择顺序；任一核心记录失败即停发后续任务，等待在途任务收尾再拒绝整批。字段级不可读仍按 SPEC-DATA-02 降级；关联 ID 完整读取或失败；每次主表、字段、记录及关联元数据读取都有 15 秒有界超时，超时作为候选失败而不是永久 pending；权限遵循当前用户，真实分页/限流待验证 |
| ReadableFieldAdapter（网关内） | SDK 字段与 `getCellString` | 可打印文本或字段级诊断 | 不输出原始对象字符串，不存持久副本 |
| PrintJobBuilder | 上下文、字段、记录 | 顺序稳定的 documents[] | 保留每条记录与关联行边界 |
| BatchPrintSession | 宿主 recordId、已确认 recordIds 和摘要 | `single-ready` / `batch-ready`、数量和摘要 | 上限 50；候选 PrintJob 留在编排层，成功前不修改会话；不持久化业务值 |
| DataSourceCatalog | PrintJob 当前字段、插件系统值 | “字段/系统”数据源树与运行时值 | 字段不写死；旧模板不拥有当前数据源目录；系统 ID 使用插件命名空间；系统打印日期由任务 generatedAt 经 Date 本地年/月/日格式化，不截取 UTC 字符串、不另取当前时间；无效时刻拒绝解析，同名业务字段不被覆盖 |
| DataSourceTokenCodec | 稳定字段/系统 ID、当前标签、当前记录值 | 持久 Token、编辑标签、失焦/输出值 | 三层表示可逆；不以字段名持久绑定，不把当前值写进模板，不向用户暴露内部 ID |
| TemplateGenerator | 字段规格、纸张、引擎 schema | 默认、标签或固定高度连续模板 | 由真实引擎样本驱动，不手写伪 schema；连续模板显式标记布局类型 |
| ContinuousLayout | 固定高度连续模板、PrintJob | 原生单列长纸临时模板与数组变量 | 只接受可证明高度的单页普通字段模板；不拼接 DOM，不持久化业务值 |
| TemplateRepository | base/table、版本化模板集合 | 多模板、唯一默认项或只读回退结果 | bridge 未设置键实测返回 `{}`，空普通对象按无值处理；v1 只读迁移；非空不可读模板不覆盖，回退会话禁用保存；保存前递归移除运行记录、记录 ID、设计器变量、表格样本和凭证形态字段，读取含禁存数据的旧信封时零写入拒绝；权限与冲突显式 |
| DesignerAdapter | 模板、变量、任务 | canonical rendered pages、编辑、打印、已校验 PDF Blob | 直接调用安装版 Web Component；主预览与打印复用同一页对象；PDF 先校验文件头、页数和大小再提交下载，不造替代引擎 |
| WorkspaceShell | PrintJob、模板集合、DesignerAdapter | `WorkspaceMode` 与 `WorkspaceSurface`、所选模板、统一编辑入口 | `getWorkspaceSurface(mode, batchMode)` 将工作台表面归一为 `single-preview`、`single-edit` 或 `batch-preview`；默认预览并选默认模板；编辑时目录隐藏，左侧组件可拖入、数据源只可复制，右侧仍为真实 Web Component；批量预览只读且不暴露模板编辑操作 |

组件拖拽继续采用锁定版 `vue-print-designer@1.7.39` 的 `application/json` `{type}` 契约，让引擎创建默认组件。数据源不再写入拖拽载荷；复制动作携带稳定字段/系统 ID 与当前标签，粘贴适配层把稳定绑定插入当前文本组件，同时只向用户显示 `@字段名`。关联数组仍由表格组件的专用配置处理。该适配随引擎版本升级复核；不得恢复“拖数据源创建元素”的旧路径。

当前引擎契约不等于“同一组件多字段”：带 `payload` 的字段拖放新增元素，变量型拖放对已有文本组件更新单一绑定。Goal v2 直接移除数据源拖放语义，先通过 Token 共存、顺序、重开和输出测试，再决定使用公开内容编辑 API 或版本固定的适配；不得把字段复制粘贴退化为替换单一 `variable`。

正式环境已经证明“只保存稳定 Token、仅在输出前临时解析”不足以完成编辑闭环：旧版引擎内容编辑会把内部 Token 当普通文本，失焦后仍原样显示。Goal v3 已在 DesignerAdapter 内实现生命周期：`content-editing` 显示友好标签，`canvas-resolved` 使用当前记录运行时变量，`persisting` 转回稳定 Token，`output` 按当前 PrintJob 解析。模式转换的单元和适配器替身测试已通过；2026-10-06 当前灰度版又在正式 Base 完成双字段编辑、失焦、保存重开、再次编辑、跨记录解析和实际 PDF。字段真实改名、删除/无权/歧义仍需受控 E2E，不能从正常字段路径外推。

同名字段的标签不足以确定绑定。Codec 在持久化时先把本次粘贴记录的偏移对应到当前文本中该标签出现的位置，再将仍保留的旧引用按原顺序填入；偏移、数量或字段 ID 不吻合时返回歧义，DesignerAdapter 阻止保存。此前“旧引用在前、新引用在后”的队列规则已由 Red 测试证实可能误绑，不再使用。

模板安全采用两层防线：DesignerAdapter 只交付稳定 Token 形式的持久模板；TemplateRepository 再按键递归清理 `testData/variables/runtimeValues`、documents/records/recordId(s)/recordData/recordValues、表格元素 `data`，以及大小写、下划线、连字符变体下的 `authorization`、`refreshToken` 和 `*AccessToken`。生产源代码的回归门同时禁止 console 输出、浏览器本地存储和直接 Authorization/Bearer 构造，避免业务值或授权信息离开飞书 bridge/SDK 边界。用户主动输入的固定文本不做内容猜测或静默删改。

# 3. 工作台状态与依赖规则

工作台状态由纯模型 `WorkspaceMode`、`TemplateStatus`、`TemplateSelection` 和 `EditorPanel` 表达，UI 只编排状态，不把状态判断散落在模板中：

工作台内部模式与用户可见表面分开表达。`WorkspaceMode` 仍描述单条预览/编辑流程；`WorkspaceSurface` 是渲染边界，只有 `single-preview` 才显示模板目录和模板选择，只有 `single-edit` 才显示数据源/组件操作区，`batch-preview` 无论内部模式为何都只显示只读批次摘要。批量状态成功提交时必须同时得到 `batch-ready` 与 `batch-preview`，不能仅切换 `batchMode` 而保留单条编辑表面。

```text
loading → preview
preview ──选择自动/已存模板──> template-selected
template-selected ──编辑模板──> edit-clean
edit-clean ──发生修改──> edit-dirty
edit-dirty ──保存成功──> edit-clean
edit-clean/edit-dirty ──返回预览──> preview（dirty 时先决策）
任意状态 ──表/记录切换──> context-pending（dirty 时先决策）→ loading
```

模板状态至少区分：自动模板、已保存模板、只读回退、未保存编辑。同表可存多个模板，集合恰有一个默认项；新建草稿不覆盖已有项，删除默认项须先设置替代项。预览模式外层目录是唯一模板事实源，编辑入口位于右侧当前模板区；编辑模式只显示左侧可操作的数据源/组件和右侧真实画布/属性。引擎内部模板列表、重复组件及保存入口隐藏，内置保存事件委托给同一仓库用例。旧模板与运行态数据分离，字段 ID 绑定兼容唯一可解析的旧名称。

核心模型与格式化纯函数不依赖飞书或 DOM。飞书与引擎 API 只在边界适配层出现。UI 仅编排状态：idle→loading→ready/degraded/error→printing/exporting；切换上下文时取消或忽略旧请求。选择批量的记录顺序在 PrintJob 中冻结，不能由并发网络响应决定。

Goal v5 新增批次状态机：

```text
single-ready / batch-ready
  └─ 打开官方选择器（保留 committed session；不限制人工勾选时间）
       ├─ 取消/空选/超过 50 条/读取失败 → 回到原 ready 状态
  └─ 候选完整读取 → 同一活动模板渲染 canonical pages 并恢复变量 → 原子提交 batch-ready + preview

batch-ready
  ├─ 重新选择 → 同上，旧批次保留到新批次成功
  ├─ 退出批量 → 候选加载宿主当前记录，成功后提交 single-ready
  ├─ 打印 N 条 → 直接打印当前 canonical pages，一次 window.print
  └─ 导出 N 条 PDF → 同序一个 PDF Blob → 校验 → 一次浏览器下载
```

`batch-ready` 是工作台的预览态不变量：候选提交成功后必须隐藏编辑操作区和可编辑设计器画布，批次预览成为唯一主内容；用户只能先退出批量，再进入模板编辑。若选择动作从 `edit-dirty` 发起，先复用 `SPEC-UX-05` 的保存/放弃决策，决策完成前不启动批次读取。候选失败仍恢复原模式和原 committed session，不为了强制预览而清空工作区。

读取超时由 `read-timeout.ts` 提供单一错误类型与默认 15 秒阈值，`ContextAdapter` 和 `BitableGateway` 共用。超时只结束当前读取候选，不能提交部分任务；迟到 Promise 不得回写当前会话。官方选择器的 Promise 代表用户尚未完成交互，不能套用数据读取阈值，否则会把正常的慢速勾选误判为失败。

`prepareBatchCandidate` 是批量候选的单一事务边界：依次等待完整 `PrintJob`、校验宿主上下文、构造候选 `BatchPrintSession`、渲染全部页面、再次校验上下文并组合预览 HTML，只有全部成功才返回 `{job, session, rendered, previewHtml}`。它不接收可变 UI 引用，也不写入已提交工作区；WorkspaceShell 仅在 Promise 成功后连续替换四项状态。因此读取超时、渲染失败、上下文切换和迟到 Promise 都不能产生半提交状态，旧批次在 busy 结束后继续拥有原 job、页集和打印入口。

批量读取失败的用户反馈由 `BatchReadFeedback` 纯模型统一生成：只有 `BitableReadTimeoutError` 允许显示“重试批量读取”，普通权限/数据/渲染错误不显示误导性重试；任何 busy 状态都隐藏入口。反馈只描述候选失败和“未更改打印记录”，不改变已提交任务、页面或变量。

编辑态脏草稿的“放弃修改”是明确的独立决策：重载原模板及单条页面后，先切到可打印 `single-preview`，再唤起官方选择器；取消/空选/候选失败保留这个决策后的预览。选择“继续编辑”时按 `pendingLoadRequest` 区分用户主动发起的读取/批量请求和宿主被动切换；只有后者才能提示宿主记录已切换。保存并继续选择批量时也先刷新单条预览；若取消，已保存模板保持可打印的预览态，刷新失败则不打开选择器。

`RenderedPrintJob` 至少包含布局类型、有序页面 HTML 与模板画布尺寸。浏览器中解析引擎 HTML 的顶层子节点，过滤 `style/link/script` 资源后把每个真实纸张节点转换为应用拥有的显式打印页面容器，并拒绝零分页，不能把一个非空的空容器算作一页；加载/刷新预览时生成并缓存，iframe 预览与当前文档打印共同消费；模板或记录变化时缓存失效。打印 CSS 只匹配这些显式容器，不依赖引擎内部嵌套层级。Goal v5 仍只以默认排版判断完成，标签/连续由模板显式类型进入各自后续切片，不靠隐藏按钮临时切换。

后续标签切片独立于 Goal v5：`generateLabelTemplate` 创建可编辑的原生 `multiLabel` 模板；`prepareLabelLayout` 验证单页/单网格、首格元素和纸张边界，以所选记录顺序建立数组变量。`RenderedPrintJob.layout='labels'` 的一个 HTML 文档可以有多张最终纸。正式 Base 已验证三条同纸、七条两页和 A4 PDF，失败恢复及系统打印物理页数待验。

连续切片同样独立：`generateContinuousTemplate` 创建带 `ext.batchLayout='continuous'` 的固定高度模板；`prepareContinuousLayout` 验证单页、固定尺寸、非表格/非动态分页和元素边界，再把当前页元素作为原生单列 `multiLabel` 首格，行数等于记录数，最终高度精确相乘。`DesignerAdapter` 临时加载该长纸、一次设置数组变量、一次获取 HTML 或 PDF Blob，并在 `finally` 恢复编辑模板/变量。`RenderedPrintJob.layout='continuous'` 必须恰有一个 HTML 文档和一张最终纸。7/50 条隔离真实引擎及正式 Base 三条/十条长页证据通过；系统打印物理结果仍是发布门。见 ADR-0014。

PDF 输出不再调用上游“直接保存”作为黑盒终点。`DesignerAdapter` 对单条、默认批量、标签和连续排版统一取得真实引擎 Blob：单条/标签/连续使用 `export({type:'pdfBlob'})`，默认批量使用 `getBatchPdfBlob`。适配层读取二进制并校验 `%PDF-` 文件头、至少一个 `/Type /Page` 页面对象和非空大小，通过后创建一次临时下载链接；界面回显页数与大小。任何校验失败都在下载前终止，不显示成功。该决定见 ADR-0015。

批次栏由实际 Vue 组件负责数量和最多五条摘要呈现，纯会话模型仍是 ID、顺序和摘要的事实源。网关将 SDK 的 `isPrimary` 带入 `NormalizedField`，摘要构造器按该标记选择字段；只有兼容旧元数据时才回退首个非关联字段，空值回退记录 ID。旧模板加载/刷新预览任务只能在自身 revision 仍有效时释放工作台 busy；过期渲染不能提前开放新上下文的操作。引擎 HTML 的预览页间距在打印样式中被清除，故 HTML 对象同源不等于 CSS 分页一致；正式浏览器逐页验收是必要条件。

当前正式表完整 10 条已经验证该编排：摘要前五条加剩余数量，确认至 `batch-preview` 完成为 1,248 ms，10 个 canonical 页面保持 `PO-0001` 至 `PO-0010` 顺序，退出后回到单条；实际 PDF 同样为 10 页 A4，逐页顺序和值正确。此证据不改变 50/51、异常恢复和系统打印的独立验收门。

`renderPrintJobCandidate` 在候选渲染或变量恢复失败时回退已提交任务的变量；如果请求 revision 已过期，则停止后续候选渲染并不主动回写旧变量。WorkspaceShell 仅在该事务返回完整页面且宿主上下文仍匹配后提交新任务。此契约的单元测试不证明飞书宿主切换时引擎内部异步渲染与新模板绑定完全无交错，正式 `E2E-BATCH-02` 必须覆盖渲染中切换。

恢复变量时还要依据当前模板重算多字段文本组件的运行时值，并同步设计器测试数据与变量；只更新运行态，不更改持久模板中的稳定 Token。候选成功、失败回退、退出批量及批次预览刷新完成后共用这一恢复路径。

宿主切换发起的新任务在绑定模板前等待旧候选渲染 Promise 结束，并在等待后重新检查上下文 revision；旧读取请求的收尾不得清除新任务的加载状态。该编排仍需正式容器时序验收。

# 4. 技术调查门

PHASE-00 固定真实宿主为记录视图插件、官方 Block SDK/Webpack/Opdev 链、引擎包版本和许可证门槛。本地已用锁定安装包冻结模板 JSON、数组表格绑定、关联类型 18/21、批次 API 和 bridge 存储契约；这些仍需在飞书真实资产中复验。版本级授权调查已核对 npm 1.7.39、同版本提交与官网价格页：包声明 AGPL-3.0-only，作者商业/商标文件同时限制企业商用，且市场应用多租户分发超出标准版公开范围。该冲突不由工程侧裁定，ADR-0001 授权门保持 `unresolved`。

技术交付和授权放行采用两条独立状态轴：代码、自动化和既有 `F225904757` 受控灰度可以继续取得技术证据；扩大灰度、全量发布、收费或向其他租户分发必须先取得覆盖市场应用用途的书面授权/法务结论。发版检查必须同时记录小组件/应用版本、权限变化、灰度企业列表和 ADR-0001 授权门；授权未关闭时不得把任一技术 Green 转译为商业发布通过。调查失败记录可复现条件并出 ADR；引擎替换和范围缩减需用户决定。

# 5. 阶段和完成定义

| 阶段 | 垂直切片 | 完成条件 |
|-|-|-|
| PHASE-00 | 规格基线与一手事实 | 文档一致，宿主/引擎/授权风险列明 |
| PHASE-01/02 | MVP-1：真实宿主＋单条读取＋模板＋输出 | SPEC-CTX、DATA、TPL、DES、OUT、SAVE 和真实单条闭环 |
| PHASE-04 / Goal v5 | MVP-2：默认排版批次会话、同源预览与一次打印 | SPEC-BATCH-01/02/04/05/06/07/08 和真实三条批量闭环 |
| PHASE-03 | MVP-3：关联明细与跨页 | SPEC-LINK、BATCH-03 和真实主从闭环 |
| PHASE-05 | 真实环境回归 | 全部规格、性能、权限、PDF/打印证据 |

每个阶段不得仅以“代码写完”为完成；测试、真实环境和文档追踪必须同步。后续阶段可以并行准备纯逻辑，但不绕过前置技术门。

MVP-1 是当前最小发布验收门。MVP-2 和 MVP-3 即使已有本地契约实现，也必须在前一阶段真实闭环通过后分别验收；任何范围缩减或阶段取消需新增 ADR 并由用户确认。

# 6. 决策管理

ADR 只记录有争议或影响架构/授权的决策，状态为 proposed/accepted/superseded。每份写上下文、选择、替代、后果、证据、触发复议条件。未确定项不得伪装为 accepted。需求变化同步 BRD/PRD/SPEC/TRACE/TODO。

# 7. 整体流程一致性规则

新增需求不得只在当前页面追加一个按钮、面板或状态。实现前必须回看已有功能、数据来源、存储模型、引擎默认 UI 和用户操作路径，重新画出受影响的整体流程，并回答：

1. 是否产生第二套入口、第二个状态源或第二个数据源目录。
2. 新交互处于哪个模式和生命周期阶段，是否会绕过既有的加载、选择、保存、输出和上下文失效规则。
3. 外层工作台和真实 `vue-print-designer` 的职责边界是什么，哪些能力应该复用、隐藏或明确委托给引擎。
4. 旧逻辑哪些必须保留，哪些需要迁移；不能用新 UI 覆盖旧行为而不处理冲突。

涉及工作台结构、模板目录、编辑入口或输出链路的改动，必须先更新 SPEC/SDD/TRACE/TODO，必要时新增 ADR，再按 TDD 先写失败用例。验收同时覆盖单一事实源、模式切换、上下文切换、保存重开和真实飞书记录视图，不以局部页面截图代替整体流程证据。

# 8. PDF 结果观测实现（2026-10-02）

`exportPrintJob` 继续只消费真实引擎 Blob，不在应用层重绘 PDF。`inspectPdfBlob` 在校验 `%PDF-`、非空字节和 `/Type /Page` 后，按页面对象读取 `/MediaBox [x0 y0 x1 y1]` 的右上坐标，形成与页面数一致的 `pageSizes`；仅当每一页都成功解析且尺寸为正数时才回传该字段。UI 将同尺寸页面合并为一个“纸张 W×H pt”提示，避免把不完整解析结果当成可靠尺寸。

该解析针对锁定的 `vue-print-designer@1.7.39`/jsPDF 输出契约，不能推断打印驱动实际出纸。若未来引擎采用对象流、继承式页面尺寸或其他 PDF 结构，必须先补契约测试和解析器，再升级依赖；缺少 `pageSizes` 时仍保留文件头/页数/大小校验，不得伪造尺寸或关闭 `BUG-0002`。

# 9. Goal v7 界面外壳与动作所有权

Goal v7 只重构 `WorkspaceShell` 的界面结构、样式和展示状态，不复制业务用例。加载、选数、保存、打印、PDF、模板管理仍调用现有回调；`src/core/**`、`src/host/**`、模板协议和 `src/engine/**` 的渲染/字段/输出算法保持锁定。设计器适配层只允许使用 `vue-print-designer@1.7.39` 的公开主题接口及注入 UI Chrome 收纳规则，以关闭默认浮层、隐藏重复输出入口；不得改变模板或输出语义。

工作台以 `single-preview / single-edit / batch-preview` 为显式展示面：

1. `single-preview` 拥有模板目录、单一新建入口、当前模板编辑和单条输出；模板行管理动作通过同一菜单分发到既有仓库回调。
2. `single-edit` 隐藏模板目录及打印/PDF，左侧在数据源与组件间切换，右侧挂载唯一真实设计器；返回和保存继续经过同一草稿守卫与持久化用例。
3. `batch-preview` 只读，拥有批次摘要、重选/退出和批量输出，不挂载编辑操作面。

视觉 Token 以 CSS 自定义属性或现有样式层集中定义，禁止散落新的业务判断。根容器固定占满宿主高度；应用栏/工具栏不参与内容滚动，模板或编辑侧栏只滚动自己的列表，预览区成为纸张唯一纵向滚动容器。实现按 CT-UX-08/09/10 与设计器 Chrome 契约先 Red 后 Green；用户确认方案 B 后已完成本地候选，并在独立授权下以小组件 `1.0.37` / 应用 `1.0.34` 仅灰度到 `F225904757`。正式 E2E-UX-02 已通过，不改变后续发布仍需单独授权的边界。
