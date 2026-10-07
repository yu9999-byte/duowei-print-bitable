<title>PHASE-00 — 需求基线与技术核验</title>

- 状态：本地技术核验完成；真实宿主/许可门转入后续阶段
- 日期：2026-09-21
- 本阶段目标：统一需求口径，建立 SDD/TDD 工作流，核验引擎与飞书宿主关键事实。

# 已完成过程

1. 阅读初始 BRD、PRD、TD，发现批量范围、多模板、引擎 API、模板 JSON 和许可证等冲突/假设。
2. 将三场景均定为 MVP，单活动模板列入当时 MVP 基线，多模板管理后置；批量必须单次打印任务。该模板范围已由 ADR-0009 取代，现行要求为同表多模板集合。
3. 重写 BRD、PRD、TD，建立项目导航、SPEC、SDD、TEST、TRACE、TODO、CHANGELOG。
4. 查阅上游 GitHub/Gitee 代码和许可说明；确证 Web Component 与批量 API 在上游 master 存在，但未安装包/宿主验证；记录 ADR-0001。
5. 建立宿主与存储的 proposed ADR，不将尚未验证的决策写为已完成。
6. 启动生产核心 PrintJobBuilder 切片：先写 `tests/print-job.test.ts`，建立未实现函数；执行 `npm test` 得到 5 项行为失败（非环境故障），再补充快照用例、实现有序去重/完整性校验/防变更快照，重跑得到 6/6 通过。随后增加“未选中记录不进入任务”的回归用例。
7. 当时依据旧 JS SDK 文档及打印样例采用了侧边栏/选择器口径；用户反馈后已按当前开放平台一手文档纠偏为记录视图插件，见 ADR-0002/0004 与 PHASE-02。
8. 锁定 SDK 1.0.2、Vue 3.5.13 和 `vue-print-designer` 1.7.39，完成安装包模板/API 浏览器契约；后续实现证据转入 PHASE-01。

# 当前证据

- 上游源码/类型/README/商业许可链接见 ADR-0001。
- 本地目录扫描：最初只有三份 Markdown，无 Git 工程、应用代码或测试。
- 本地 Markdown 链接检查通过：`ALL_LOCAL_MARKDOWN_LINKS_RESOLVE`；旧冲突用语扫描仅在 TD/CHANGELOG 中作为历史纠错出现。
- Red：`npm test`，5 tests、0 pass、5 fail，错误均为“PrintJobBuilder 尚未实现”（此前首次模块缺失报错不计作有效 Red）。
- Green：`npm test`，6 tests、6 pass、0 fail。随后补“未选中记录不进入任务”的回归断言，最终 `npm test` 为 7 tests、7 pass、0 fail。生产模块 `src/core/print-job.ts`，测试文件 `tests/print-job.test.ts`。
- 这些是纯逻辑证据，无真实飞书环境 E2E 证据。

# 下一步

1. 核对所有文档中的 MVP 范围、测试 ID、链接和“已验证/待验证”用语。
2. 确认真实飞书宿主、测试资产和许可证使用边界。
3. 在真实飞书扩展资产中复验已锁定引擎、官方选择、bridge 与输出行为。

# 未解决风险

企业用途许可、真实飞书扩展入口和多选上下文、模板持久化、批量预览与打印在 iframe 中的行为。关联读取和输出已完成本地契约测试，但不替代真实 E2E。任何一项不成立需记录复现和 ADR；不擅自切换引擎或降低场景范围。
