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
| ContextAdapter | 记录视图 `getSelection`、批量 `selectRecordIdList` | baseId、tableId、viewId、宿主/批量 recordIds | 单条来源必须是宿主 recordId；不猜 ID |
| BitableGateway | base/table/record IDs | SDK 可读字段、记录、关联元数据 | 所有返回的关联 ID 完整读取或失败；权限遵循当前用户；真实分页/限流待验证 |
| ReadableFieldAdapter（网关内） | SDK 字段与 `getCellString` | 可打印文本或字段级诊断 | 不输出原始对象字符串，不存持久副本 |
| PrintJobBuilder | 上下文、字段、记录 | 顺序稳定的 documents[] | 保留每条记录与关联行边界 |
| DataSourceCatalog | PrintJob 当前字段、插件系统值 | “字段/系统”数据源树 | 字段不写死；旧模板不拥有当前数据源目录；系统 ID 使用插件命名空间 |
| TemplateGenerator | 字段规格、纸张、引擎 schema | 可加载模板数据 | 由真实引擎样本驱动，不手写伪 schema |
| TemplateRepository | base/table、版本化模板 | 当前唯一活动模板或只读回退结果 | 权限与迁移显式；不可读模板不覆盖、不阻断当前数据源，回退会话禁用保存 |
| DesignerAdapter | 模板、变量、任务 | 预览、编辑、打印、PDF | 直接调用安装版 Web Component，不造替代引擎 |
| WorkspaceShell | PrintJob、模板加载结果、DesignerAdapter | `preview`/`edit` 模式、模板状态、统一编辑入口 | 默认预览；单活动模板目录不引入多模板数据模型；编辑器仍由真实 Web Component 提供 |

# 3. 工作台状态与依赖规则

工作台状态由纯模型 `WorkspaceMode`、`TemplateStatus`、`TemplateSelection` 和 `EditorPanel` 表达，UI 只编排状态，不把状态判断散落在模板中：

```text
loading → preview
preview ──选择活动模板──> template-selected
template-selected ──编辑模板──> edit-clean
edit-clean ──发生修改──> edit-dirty
edit-dirty ──保存成功──> edit-clean
edit-clean/edit-dirty ──返回预览──> preview（dirty 时先决策）
任意状态 ──表/记录切换──> context-pending（dirty 时先决策）→ loading
```

模板状态至少区分：自动模板、已保存模板、只读回退、未保存编辑。当前表仍只有一个活动模板；目录是产品呈现，不等于多模板存储。外层模板目录是唯一模板事实源，设计器内置模板列表在宿主中隐藏；设计器只负责画布和排版。

核心模型与格式化纯函数不依赖飞书或 DOM。飞书与引擎 API 只在边界适配层出现。UI 仅编排状态：idle→loading→ready/degraded/error→printing/exporting；切换上下文时取消或忽略旧请求。选择批量的记录顺序在 PrintJob 中冻结，不能由并发网络响应决定。

# 4. 技术调查门

PHASE-00 固定真实宿主为记录视图插件、官方 Block SDK/Webpack/Opdev 链、引擎包版本和许可证门槛。本地已用锁定安装包冻结模板 JSON、数组表格绑定、关联类型 18/21、批次 API 和 bridge 存储契约；这些仍需在飞书真实资产中复验。飞书 iframe 对打印/PDF、持久化容量/权限和企业授权未验证前不得标记 E2E 完成。调查失败记录可复现条件并出 ADR；引擎替换和范围缩减需用户决定。

# 5. 阶段和完成定义

| 阶段 | 垂直切片 | 完成条件 |
|-|-|-|
| PHASE-00 | 规格基线与一手事实 | 文档一致，宿主/引擎/授权风险列明 |
| PHASE-01/02 | MVP-1：真实宿主＋单条读取＋模板＋输出 | SPEC-CTX、DATA、TPL、DES、OUT、SAVE 和真实单条闭环 |
| PHASE-04 | MVP-2：批次预览与一次打印 | SPEC-BATCH 和真实三条批量闭环 |
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
