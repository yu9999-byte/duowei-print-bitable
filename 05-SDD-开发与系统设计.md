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
| BitableGateway | base/table/record IDs | SDK 可读字段、记录、关联元数据 | 最多 4 个主记录读取 worker；索引保留选择顺序；任一核心记录失败即停发后续任务，等待在途任务收尾再拒绝整批。字段级不可读仍按 SPEC-DATA-02 降级；按 SDK `property.multiple` 把关联分类为单值 `reference` 或多值 `detail`，前者读取可读文本，后者才展开关联 ID/目标表；每次主表、字段、记录及关联元数据读取都有 15 秒有界超时，超时作为候选失败而不是永久 pending；权限遵循当前用户，真实分页/限流待验证 |
| ReadableFieldAdapter（网关内） | SDK 字段与 `getCellString` | 可打印文本或字段级诊断 | 不输出原始对象字符串，不存持久副本 |
| PrintJobBuilder | 上下文、字段、记录 | 顺序稳定的 documents[] | 保留每条记录与关联行边界 |
| BatchPrintSession | 宿主 recordId、当前模板 ID、已确认 recordIds 和摘要 | `single-ready` / `batch-ready`、模板归属、数量和摘要 | 上限 50；批量会话只属于发起模板，切换其他模板退出批量；候选 PrintJob 留在编排层，成功前不修改会话；不持久化业务值 |
| BatchEditProjection | 一份公共模板、PrintJob、当前布局 | 默认全部页面、连续完整长画布或标签完整网格；元素到记录值的映射；可回收公共模板 | 只存在于 `batch-edit` 内存；不拥有批次或仓库存储；不得把业务值、记录 ID、实例副本或投影元数据写入模板 |
| DataSourceCatalog | PrintJob 当前字段、插件系统值 | “字段/系统”数据源树与运行时值 | 字段不写死；旧模板不拥有当前数据源目录；系统 ID 使用插件命名空间；系统打印日期由任务 generatedAt 经 Date 本地年/月/日格式化，不截取 UTC 字符串、不另取当前时间；无效时刻拒绝解析，同名业务字段不被覆盖 |
| DataSourceTokenCodec | 稳定字段/系统 ID、当前标签、当前记录值 | 持久 Token、编辑标签、失焦/输出值 | 三层表示可逆；不以字段名持久绑定，不把当前值写进模板，不向用户暴露内部 ID |
| TemplateGenerator | 字段规格、纸张、引擎 schema | 空白/自动生成基础画布及标签兼容画布 | 由真实引擎样本驱动，不手写伪 schema；自动画布只铺排当前表字段，不自动放系统字段；创建方式与批量排版模式分离 |
| ContinuousLayout | 固定高度连续模板、PrintJob | 原生单列长纸临时模板与数组变量 | 只接受可证明高度的单页普通字段模板；不拼接 DOM，不持久化业务值 |
| DesignerComponentCatalog | 锁定引擎标准组件类型 | 基础、数据与编码、形状三组共九个组件 | 只声明创建入口与拖拽 type，不复制属性 schema；`multiLabel` 只归标签布局 |
| TemplateLayoutChoice | 当前模板、目标 `BatchLayoutMode`、基础/标签画布生成器 | 同一模板的持久表示与有效排版视图 | 切换不创建模板；历史标签根画布保留为标签变体，普通基础画布与各模板设置隔离 |
| BatchLayoutTransaction | 候选绑定、渲染、全量编辑投影、仓库写入、旧画布恢复回调 | 已渲染页面与已保存模板集合 | 严格按候选→渲染→投影→保存执行；失败恢复旧画布，调用方成功返回前不提交预览/会话状态 |
| TemplateRepository | base/table、版本化模板集合 | 多模板、唯一默认项或只读回退结果 | 飞书官方 `bridge.setData` 定义为“在当前 base 中存储自定义内容”，安装版 SDK 定义为按 key 读写持久化数据；仓库 key 不含成员 ID。bridge 未设置键实测返回 `{}`，空普通对象按无值处理；v1 只读迁移；非空不可读模板不覆盖，回退会话禁用保存；保存前递归移除运行记录、记录 ID、设计器变量、表格样本和凭证形态字段，读取含禁存数据的旧信封时零写入拒绝；权限与冲突显式。官方措辞支持 Base 作用域判断，但跨成员仍需正式双账号证据；用户已将该验证移出 Goal v15，不能写成已通过 |
| DesignerAdapter | 模板、变量、任务 | canonical rendered pages、全量编辑投影、公共模板同步、组件拖拽、原生属性面板、打印、已校验 PDF Blob | 直接调用安装版 Web Component；每个投影元素绑定其记录运行值，提交交互后回收并重投影；只关闭重复元素库/结构面板，保留属性面板；输出从公共模板生成，主预览与打印复用同一页对象；屏幕预览以 screen-only 样式区分固定纸页和长纸，不污染打印/PDF；PDF 先校验文件头、页数和大小再提交下载，不造替代引擎 |
| WorkspaceShell | PrintJob、模板集合、DesignerAdapter | `WorkspaceMode` 与 `WorkspaceSurface`、所选模板、数据源/组件操作区和当前模板批量排版 | 四种表面保持既有目录/编辑职责；批量编辑显示“已选 N 条、全部记录可滚动编辑”；批量会话绑定发起模板，预览切到其他模板时原子恢复目标模板的宿主当前记录；组件可拖入、数据源只可复制，默认/连续/标签只在批量工作区切换当前模板，右侧仍为真实 Web Component |

组件拖拽继续采用锁定版 `vue-print-designer@1.7.39` 的 `application/json` `{type}` 契约，让引擎创建默认组件。数据源不再写入拖拽载荷；复制动作携带稳定字段/系统 ID 与当前标签，粘贴适配层把稳定绑定插入当前文本组件，同时只向用户显示 `@字段名`。关联数组仍由表格组件的专用配置处理。该适配随引擎版本升级复核；不得恢复“拖数据源创建元素”的旧路径。

当前引擎契约不等于“同一组件多字段”：带 `payload` 的字段拖放新增元素，变量型拖放对已有文本组件更新单一绑定。Goal v2 直接移除数据源拖放语义，先通过 Token 共存、顺序、重开和输出测试，再决定使用公开内容编辑 API 或版本固定的适配；不得把字段复制粘贴退化为替换单一 `variable`。

正式环境已经证明“只保存稳定 Token、仅在输出前临时解析”不足以完成编辑闭环：旧版引擎内容编辑会把内部 Token 当普通文本，失焦后仍原样显示。Goal v3 已在 DesignerAdapter 内实现生命周期：`content-editing` 显示友好标签，`canvas-resolved` 使用当前记录运行时变量，`persisting` 转回稳定 Token，`output` 按当前 PrintJob 解析。模式转换的单元和适配器替身测试已通过；2026-10-06 当前灰度版又在正式 Base 完成双字段编辑、失焦、保存重开、再次编辑、跨记录解析和实际 PDF。字段真实改名、删除/无权/歧义仍需受控 E2E，不能从正常字段路径外推。

同名字段的标签不足以确定绑定。Codec 在持久化时先把本次粘贴记录的偏移对应到当前文本中该标签出现的位置，再将仍保留的旧引用按原顺序填入；偏移、数量或字段 ID 不吻合时返回歧义，DesignerAdapter 阻止保存。此前“旧引用在前、新引用在后”的队列规则已由 Red 测试证实可能误绑，不再使用。

模板安全采用两层防线：DesignerAdapter 只交付稳定 Token 形式的持久模板；TemplateRepository 再按键递归清理 `testData/variables/runtimeValues`、documents/records/recordId(s)/recordData/recordValues、表格元素 `data`，以及大小写、下划线、连字符变体下的 `authorization`、`refreshToken` 和 `*AccessToken`。生产源代码的回归门同时禁止 console 输出、浏览器本地存储和直接 Authorization/Bearer 构造，避免业务值或授权信息离开飞书 bridge/SDK 边界。用户主动输入的固定文本不做内容猜测或静默删改。

# 3. 工作台状态与依赖规则

工作台状态由纯模型 `WorkspaceMode`、`TemplateStatus`、`TemplateSelection` 和 `EditorPanel` 表达，UI 只编排状态，不把状态判断散落在模板中：

工作台内部模式与用户可见表面分开表达。`WorkspaceMode` 描述预览/编辑状态；`WorkspaceSurface` 由模式与批次会话共同得到四种表面。`single-preview` 与 `batch-preview` 显示同一模板目录；`single-edit` 与 `batch-edit` 均隐藏目录，以统一“数据源/组件”侧栏和真实设计器占据工作区。批量排版属于右侧当前模板工作区，不形成第三个编辑面板或模板类型。批量候选成功仍原子提交为 `batch-ready + preview`；`batch-edit` 直接展开全部已选记录并由设计器内部滚动查看，不存在上一条/下一条或记录级导航。

```text
loading → preview
preview ──选择自动/已存模板──> template-selected
template-selected ──编辑模板──> edit-clean
edit-clean ──发生修改──> edit-dirty
edit-dirty ──保存成功──> edit-clean
edit-clean/edit-dirty ──返回预览──> preview（dirty 时先决策）
任意状态 ──表/记录切换──> context-pending（dirty 时先决策）→ loading
```

模板状态至少区分：自动模板、已保存模板、只读回退、未保存编辑。同表可存多个模板，集合恰有一个默认项；新建草稿不覆盖已有项，删除默认项须先设置替代项。预览模式外层目录是唯一模板事实源，编辑入口位于右侧当前模板区；编辑模式左侧只显示可操作的数据源和九种标准组件，右侧显示真实画布与原生属性面板。批量排版切换更新当前模板元数据，不生成新草稿。引擎内部模板列表、重复元素库、结构面板及保存入口隐藏，内置保存事件委托给同一仓库用例。

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

`batch-ready` 是已提交记录集合的不变量，而不是只读 UI 不变量：候选提交成功后先显示批次预览，但可在不改变 committed session 的前提下进入 `batch-edit`。保存模板后以当前 `PrintJob` 完整生成候选 canonical pages，成功才替换预览；失败保留草稿和旧页面。若选择动作从 `edit-dirty` 发起，仍先复用 `SPEC-UX-05` 的保存/放弃决策，决策完成前不启动批次读取。候选失败恢复原模式和原 committed session。

Goal v13 的批量编辑投影只存在于当前设计器会话。`bindBatchEditProjection(designer, template, job, layout)` 以公共模板为基线，按布局复制可编辑实例，并用元素级记录映射及投影变量让每个实例显示自己的真实值。绑定完成后先归一化引擎从 Token 内容推断出的文本变量，避免首次用户修改与运行时推断一起被识别成冲突。输入和按键过程中只刷新脏状态；锁定版 Shadow DOM 文本框 `focusout` 直接进入批量同步，其他 `change/pointerup/click/drop` 提交后以短延迟调用 `synchronizeBatchEditProjection`，先回收被修改实例为公共模板，再重建全部实例。保存前强制 flush 同步并通过 `getPersistentTemplateData` 取得公共模板；该函数剥离投影元数据，仓库清洗继续阻止业务值和记录对象落库。若一次同步发现不同实例存在不同变更，操作失败并保留草稿，不静默选择覆盖。

编辑态滚动所有权与预览不同：预览由 `.preview-surface` 滚动，编辑由 Web Component 内部 `.canvas-scroll` 滚动。外层 `.canvas-stage` 和 `.designer-host` 继续限制工作区边界，但必须具有 `height:100%`、`min-height:0`，`print-designer` 同样取得确定的 100% 高度；不得再用只有 `min-height` 的不完整链，也不得在宿主外套第二个可滚动容器。

锁定版 `vue-print-designer@1.7.39` 的文本 textarea 把无 Shift 的 Enter 当作提交。Goal v9 的版本固定适配在 Shadow DOM 捕获阶段仅接管无修饰键 Enter：按当前选区插入 `\n`、更新选择位置并派发合成 `input`，阻止引擎同一次 keydown 提交；失焦仍走引擎 `commitInlineEdit` 和既有数据源同步。该适配必须以源码契约和事件测试锁定，升级引擎时优先删除适配并使用公开多行编辑能力。

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

工作台以 `single-preview / single-edit / batch-preview / batch-edit` 为显式展示面：

1. `single-preview` 拥有模板目录、单一新建入口、当前模板编辑和单条输出；模板行管理动作通过同一菜单分发到既有仓库回调。
2. `single-edit` 隐藏模板目录及打印/PDF，左侧在数据源与组件间切换，右侧挂载唯一真实设计器；返回和保存继续经过同一草稿守卫与持久化用例。
3. `batch-preview` 保留模板目录；右侧当前模板工具栏拥有记录数量、重选/退出、当前模板编辑和批量输出。默认、标签、连续三种布局均从当前模板推导。
4. `batch-edit` 隐藏模板目录，左侧显示唯一数据源/组件操作面，右侧挂载真实设计器；只显示返回批量预览和唯一保存，不显示模板切换或尚未重渲染的新模板输出动作。返回预览恢复原目录选择；保存成功后以原记录顺序原子重建批次。
5. 新建模板使用 `prepareTemplateDraft(kind, job, designer)` 事务边界：显式生成默认/连续/标签模板对象，先在设计器完成加载、数据绑定和首屏渲染，再提交草稿状态。事务失败返回原工作台快照，不允许先清空预览再尝试创建。

设计器和飞书宿主边界可能返回 JSON 兼容的响应式代理，不能直接假设所有模板/记录对象都满足浏览器 `structuredClone`。`cloneJsonValue` 作为统一复制边界：普通数据优先使用原生结构化克隆；仅在其拒绝代理时回退到 JSON 往返；两者都失败则显式终止，不能静默复用可变代理。模板绑定/快照、数据源刷新/输出准备、连续布局、打印任务和模板仓储均走该边界；回归门见 `CT-TPL-05` 与 BUG-0009。

模板目录的重命名与删除属于 `WorkspaceShell` 展示交互，不新增核心状态或仓储用例：模板行菜单只负责打开产品内模态层，确认后仍调用既有 `TemplateRepository.rename/remove`。名称规范化位于 `src/components/template-management.ts`，仅去除首尾空格并拒绝空值；不修改 `src/core/**`。重命名弹层初始焦点进入并全选名称输入，删除弹层初始焦点停在取消；Tab 在弹层内循环，Esc、遮罩或取消关闭后将焦点归还原模板的更多按钮。仓储失败保留弹层与输入，避免用户丢失上下文。

视觉 Token 以 CSS 自定义属性或现有样式层集中定义，禁止散落新的业务判断。根容器固定占满宿主高度；应用栏/工具栏不参与内容滚动，模板或编辑侧栏只滚动自己的列表，预览区成为纸张唯一纵向滚动容器。实现按 CT-UX-08/09/10/11 与设计器 Chrome 契约先 Red 后 Green；用户确认方案 B 后已完成本地候选，并在独立授权下以小组件 `1.0.37` / 应用 `1.0.34` 仅灰度到 `F225904757`。正式 E2E-UX-02 已通过；SPEC-UX-11 后续修正仍是本地候选，不改变后续发布需单独授权的边界。

# 10. Goal v14 输出一致性设计

浏览器打印文档只由 `composeBrowserPrintDocument(RenderedPrintJob)` 生成：先输出模板尺寸的 `@page`，再组合 `composeRenderedPrintPages` 的资源和显式页面。页面容器拥有固定宽高、溢出裁剪、页内禁止拆分、非末页强制分页和末页结束；第一层真实引擎纸张根节点占满页盒并移除设计器专用阴影。全局样式只保留打印根默认隐藏，不再复制分页算法。

该设计保留三层职责：引擎负责模板布局和 PDF 渲染，`RenderedPrintJob` 负责页面事实，浏览器打印适配只负责把相同页面放进确定的物理页盒。`getPrintJobPdfBlob` 只把原有 PDF 生成从下载动作中拆出用于测试，不改变产品导出、模板、字段绑定、Goal v13 批量编辑或权限。决策见 ADR-0021。

# 11. 原生组件属性与批量排版设计

编辑侧栏的 `EDITOR_PANELS` 固定为 `data-sources / components`。`DesignerComponentCatalog` 声明九种引擎标准组件，App 只负责把 `{type}` 拖拽载荷交给真实设计器。组件落入画布后的属性不回流到外层表单；`installDesignerWorkspaceChrome` 保留引擎原生属性面板，只收起会造成第二套入口的元素库和结构面板。页面纸型与方向继续属于设计器现有能力，不再增加外层“页面设置”。

ADR-0022 曾采用“新建另一排版草稿”，该段设计已被 ADR-0023 取代。现行排版切换是当前模板候选事务：App 生成同一模板的目标有效视图，完整渲染并在编辑态重建全部记录投影，再写回该模板的批量设置；全链成功才替换本地预览。模板 ID、目录数量和记录会话始终不变。
# Goal v15：模板与批量排版状态设计

Goal v15 以 ADR-0023 为准，将创建和排版拆成两个正交状态：`TemplateCreateKind(blank|automatic)` 只生成当前模板的初始画布，`BatchLayoutMode(default|continuous|labels)` 只控制当前模板在批量会话中的输出算法。UI 不再通过排版切换创建模板草稿。

实现顺序遵循 TDD：先锁定两项创建入口、同模板模式切换、跨模板隔离、旧模板迁移与候选失败回滚；再引入独立领域模块；最后接入 App、真实设计器投影和仓库。历史标签根画布不会直接冒充默认画布：旧标签结构保存在 `duoweiBatchLayout.labelTemplate`，另建普通基础画布；返回标签仍恢复原内容。批量模式切换必须完整渲染候选后提交，任何异常都保留模板 ID、模板集合、记录会话和上一份可打印预览。两个仓库客户端连接同一 Base bridge 存储时必须读取同一集合，代码不得按成员派生 key；该客户端契约不能替代飞书正式双成员验收。用户于 2026-10-10 将正式双成员及权限边界移出 Goal v15，因此它们不再阻塞本 Goal，也不被标为已通过；未来若重新要求共享保证且正式结果证明 bridge 按成员隔离，再启用 ADR-0023 约定的最小服务端共享方案，不提前建设后端。

# 12. Goal v16：关联明细完整读取与原生分页

开发顺序严格为 Red→Green→Refactor：先为重复 ID、超时穿透、无视图、首视图前五列、双主记录明细隔离和长表格分页建立失败测试，再修改最小读取逻辑，最后用真实设计器浏览器夹具验证输出。领域层不得反向依赖 host；超时通过既有错误类型/错误名保持语义，其他记录级异常才包装为具体关联 ID 错误。

数据流固定为 `SDK link value → LinkCellValue → ExpandedLinkedRecords → PrintJob document values → table variable → canonical rendered pages/PDF`。任何层不得另建一份只供预览或打印的明细模型。默认批量投影为每条主记录重写独立 table 变量，回收时剥离投影变量并只保存公共模板。候选任一步失败时不得提交半截 job、半截页或被截断的明细。

# 13. Goal v18：模板级批量、字段生成和屏幕纸张边界

批量候选提交时把 `selectedTemplateId` 写入内存态 `BatchPrintSession.templateId`。模板切换统一调用 `shouldExitBatchOnTemplateSwitch`；只有切回同一归属模板才可保留批次，其他模板必须先加载宿主当前记录并完成目标模板渲染，再原子提交单条会话。失败恢复使用原设计器模板和原 PrintJob，不允许目标模板与旧批次页面混合。

关联分类只在 BitableGateway 发生一次，并随 `NormalizedField.linkKind` 向下游传播。正式 SDK 证明 `property.multiple` 不是单向自关联的充分判据：`FieldType.SingleLink` 且 `property.tableId === selection.tableId` 时优先分类为 `reference`，其余关联再以 `multiple === true` 分类为 `detail`。`reference` 不建立关联 reader、不生成 `arrayColumns`，DataSourceCatalog 不标记为数组，TemplateGenerator 将其作为普通字段；`detail` 沿用既有完整展开、空态和原生 table 分页。规则不读取字段名称。为兼容既有测试/旧内存结构，缺少 `linkKind` 且已有 `isLink/arrayColumns` 的字段继续按 detail 处理。

首次正式版本 `1.0.48/1.0.45` 暴露上述真实 SDK 差异后，开发顺序仍保持 Red→Green：新增“单向自关联且 `multiple=true` 仍为 reference”的失败测试，确认实际得到 `detail`，再修改唯一分类函数 `getLinkKind`。最终全量 231/231，构建入口 `assets/main.bedfd72c.js`；业务 Base 与独立关联 Base E2E 通过后才接受本设计。

自动模板移除 `auto-printed-at` 与 `continuous-printed-at`，但运行时 `SYSTEM_PRINT_DATE_ID`、系统数据源目录和既有模板解析保持不变。屏幕预览样式由 `composeRenderedPrintPages` 以 `@media screen` 注入，每个固定页有独立白纸、20px 间距和克制阴影；连续只有一个长页容器。浏览器打印仍由 Goal v14 的 `@media print` 页盒规则控制，屏幕装饰不参与物理分页。

# 14. Goal v19：容量前置校验与可重试候选快照

50 条边界必须下沉到 `prepareBatchCandidate` 事务入口。调用方传入已经去重并冻结的记录 ID；事务先调用领域校验，再允许执行 `loadJob`。因此 51 条路径不会调用主记录读取、上下文复核或设计器渲染，页面层可以保留即时提示，但不再是唯一安全边界。成功读取后的 PrintJob 记录顺序必须与冻结请求完全一致，不能让网关返回子集或重排后继续提交。

超时重试使用只存在于内存的 `BatchRetryRequest`：保存失败时的 Base、表、视图、宿主记录、模板 ID 和有序记录 ID，不保存字段值或模板副本。点击重试直接复用该快照，不重新打开官方选择器；进入事务前先比较当前上下文和模板。上下文不一致时丢弃快照并要求重新选择。候选成功后清除快照；非超时失败不提供误导性重试。三种排版只在同一候选事务的 render 回调内分流，因此共享相同的容量、超时和原子提交规则。
