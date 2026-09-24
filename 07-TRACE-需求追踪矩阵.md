<title>多维打印 — 需求追踪矩阵</title>

# 使用规则

一行代表一个可验收能力。状态按“规格已定义 / 单元已过 / 集成已过 / E2E 已过 / 阻塞”分层表述，并注明尚未执行的下一层；不能因上游文档声称支持就标为已过。单元测试通过不代表整行场景已完成；真实飞书环境仍未验证。

# MVP 分阶段映射

| 阶段 | 需求追踪范围 | 当前门状态 |
|-|-|-|
| MVP-1 单条 | `SCN-01`、`FR-CTX`、`FR-DATA`、`FR-SRC`、`FR-TPL`、`FR-DES`、`FR-OUT`、`FR-SAVE` | 本地 Green，组件包已上传；Edge 当前文档 HTML 打印待真实 E2E |
| MVP-2 批量 | `SCN-02`、`FR-BATCH`、`SPEC-BATCH-01/02/03` | 本地契约 Green；真实批量打印待 E2E |
| MVP-3 关联 | `SCN-03`、`FR-DATA-03`、`FR-LINK`、`SPEC-LINK-01/02/03` | 关联单元 Green；真实长明细待 E2E |

阶段顺序是最小 MVP 交付顺序，三个阶段共同构成 MVP 总范围。

| 业务目标/场景 | PRD 需求 | SPEC | 设计模块 | 测试 | 当前状态 |
|-|-|-|-|-|-|
| BG-01 零配置 | FR-CTX-01/02 | SPEC-CTX-01/02 | ContextAdapter、PrintJobBuilder | UT-CTX-01、`tests/print-job.test.ts` | 单元已过；E2E 未执行 |
| BG-02 单条 SCN-01 | FR-DATA-01/02 | SPEC-DATA-01 | BitableGateway、ReadableFieldAdapter、PrintJobBuilder | UT-DATA-01、`tests/bitable-gateway.test.ts`、E2E-OUT-01 | 单元已过；E2E 未执行 |
| BG-01 动态数据源 | FR-SRC-01/02 | SPEC-SRC-01/02/03 | DataSourceCatalog、DesignerAdapter、WorkspaceShell | `tests/data-sources.test.ts`、`tests/designer-adapter.test.ts`、E2E-SRC-01 | 当前字段/系统唯一目录及真实拖拽载荷本地 Green；飞书画布 E2E 未执行 |
| BG-02 主从 SCN-03 | FR-DATA-03、FR-LINK-01 | SPEC-LINK-01/02/03 | BitableGateway、ReadableFieldAdapter、TemplateGenerator | `tests/linked-records.test.ts`、`tests/bitable-gateway.test.ts`、E2E-LINK-02 | LINK-01/03 单元已过；跨页 E2E 未执行 |
| BG-02 批量 SCN-02 | FR-BATCH-01 | SPEC-BATCH-01/02/03 | PrintJobBuilder、DesignerAdapter | `tests/print-job.test.ts`、`tests/designer-adapter.test.ts`、E2E-BATCH-02 | 顺序/单次 API 契约已过；E2E 未执行 |
| BG-01 自动模板 | FR-TPL-01/02/03/04/05 | SPEC-TPL-01/03/04 | TemplateGenerator、DesignerAdapter | `tests/template-generator.test.ts`、E2E-TPL-02 | 生成/边界单元已过；真实渲染 E2E 未执行 |
| BG-03 微调保存 | FR-DES-01/02/03/04 | SPEC-DES-01/02、SPEC-SAVE-01/02/03 | DesignerAdapter、TemplateRepository | `tests/template-repository.test.ts`、E2E-DES-01 | 不可读模板回退、base/table 隔离、旧键只读兼容与草稿守卫本地 Green；跨会话 E2E 未执行 |
| BG-01 工作台模式 | FR-DES-01、FR-OUT-01 | SPEC-UX-01/02/03/04/05、SPEC-SAVE-03 | WorkspaceShell、DesignerAdapter、TemplateRepository | `tests/workspace.test.ts`、`tests/designer-adapter.test.ts`、E2E-UX-01 | 单一模板事实源、模板选择和脏草稿保护本地 Green；真实默认预览/编辑切换待 E2E |
| BG-02 输出 | FR-OUT-01/02/03/04 | SPEC-OUT-01/02 | DesignerAdapter、WorkspaceShell | `tests/designer-adapter.test.ts`、E2E-OUT-01 | 64/64 本地回归已过，含当前文档 HTML 打印、无 Blob 导航、内部打印接管和预览 HTML；真实飞书打印/PDF E2E 待按 [BUG-0001](docs/bugs/BUG-0001-Edge打印被客户端拦截.md) 复测 |
| BG-04 安全授权 | FR-DATA-04、NFR-03/05 | SPEC-DATA-02、SPEC-SEC-01 | BitableGateway、TemplateRepository | `tests/bitable-gateway.test.ts`、`tests/template-repository.test.ts`、SEC-01 | 降级/模板脱敏单元已过；权限 E2E 未执行 |
| BG-01 时效 | NFR-01/02 | SPEC-PERF-01 | 全链路 | PERF-01 | 规格已定义 |

# 证据登记

| 证据 ID | 范围 | 位置 | 结论 |
|-|-|-|-|
| E-UP-01 | 上游包声明、Web Component API、批量 API、许可证 | [ADR-0001](docs/adr/ADR-0001-打印引擎与许可证.md) | 上游源码事实，不是本项目运行通过 |
| E-FS-01 | 飞书记录视图宿主、构建、选择上下文、权限 | [ADR-0002](docs/adr/ADR-0002-飞书宿主与数据边界.md)、[ADR-0004](docs/adr/ADR-0004-记录视图构建与空白页.md)、[PHASE-03](docs/phases/PHASE-03-控制台接入与测试版本.md) | 基础应用 `1.0.2` 与后续组件 `1.0.3` 灰度、企业范围、租户安装及测试 Base 已证；容器功能 E2E 未执行 |
| E-PERSIST-01 | 模板持久化 | [ADR-0003](docs/adr/ADR-0003-活动模板存储.md)、`tests/template-repository.test.ts` | bridge 方案单元已过；真实权限/容量/跨会话待验证 |
| E-TDD-01 | PrintJobBuilder Red→Green | [PHASE-00](docs/phases/PHASE-00-需求基线与技术核验.md)、`tests/print-job.test.ts` | 5 项 Red，6 项 Green，最终 7/7 回归通过 |
| E-TDD-02 | 关联、字段、模板、存储、预览、Edge 打印 TDD | [PHASE-01](docs/phases/PHASE-01-MVP核心纵切.md)、[PHASE-02B](docs/phases/PHASE-02B-不可读模板回退.md)、[PHASE-02C](docs/phases/PHASE-02C-Edge打印兼容.md)、`tests/*.test.ts` | 各轮有效 Red→Green；当前回归 64/64，记录视图生产构建通过 |
| E-TDD-03 | 独立网页纠偏为记录视图插件 | [PHASE-02](docs/phases/PHASE-02-记录视图接入.md)、`app.json`、`record-view/*` | Webpack/Opdev 代码包构建通过；真实上传/E2E 未执行 |
| E-TDD-04 | 真实字段数据源与系统分组 | [ADR-0005](docs/adr/ADR-0005-动态数据源模型.md)、[PHASE-02A](docs/phases/PHASE-02A-动态数据源接入.md)、`tests/data-sources.test.ts` | 字符串变量目录 Red；对象树、旧模板刷新和系统命名空间 Green；小组件 `1.0.3` 已随应用版本灰度生效，真实 `PO-0001` 已加载动态数据源，字段 11 项和系统“打印日期”仍待逐项人工核验 |
| E-TDD-05 | 打印工作台模式分离 | [ADR-0007](docs/adr/ADR-0007-打印工作台模式分离.md)、[PHASE-02D](docs/phases/PHASE-02D-打印工作台模式分离.md)、`tests/workspace.test.ts`、`tests/designer-adapter.test.ts` | 默认预览、显式编辑、单活动模板状态、四个编辑入口和真实预览 HTML 已本地 Green；真实记录视图 E2E 待执行 |
| E-TDD-06 | 工作台单一事实源与草稿生命周期 | [ADR-0008](docs/adr/ADR-0008-工作台单一事实源.md)、[PHASE-02E](docs/phases/PHASE-02E-整体流程一致性重构.md)、`tests/workspace.test.ts`、`tests/data-sources.test.ts`、`tests/designer-adapter.test.ts`、`tests/template-repository.test.ts` | 模板选择、内置模板面板抑制、唯一数据源拖拽、草稿守卫和 base/table 隔离本地 Green；真实记录视图 E2E 待执行 |
| E-BUG-01 | Edge `ERR_BLOCKED_BY_CLIENT` 打印复现与修复 | [BUG-0001](docs/bugs/BUG-0001-Edge打印被客户端拦截.md)、[ADR-0006](docs/adr/ADR-0006-记录视图 iframe 打印兼容.md)、[PHASE-02C](docs/phases/PHASE-02C-Edge打印兼容.md) | 旧 `window.open(blob:)` 与 iframe Blob 路径已由当前文档 HTML 打印替换，且接管内部打印；当前本地回归 58/58 Green，组件包已上传；真实 Edge E2E 待复测 |

新增或修改 SPEC 时，必须在本表增删关联并更新对应测试；不允许无规格的实现或无测试的 P0 需求。
