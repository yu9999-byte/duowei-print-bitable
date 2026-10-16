<title>PHASE-11 — Goal v21 字段生命周期闭环</title>

# 目标

在不修改原业务 Base 的前提下，完成字段改名、删除、不可读与同名歧义的模板生命周期闭环。稳定字段 ID 是唯一绑定依据；用户界面和全部输出只展示当前字段名、真实值或明确失效状态。

# 启动审计

- 已有能力：稳定 ID、友好 `@字段名`、历史标签、唯一旧名迁移、同名粘贴位置保护和失效字段编辑标签。
- 缺口一：`prepareTemplateForOutput` 独立做字符串替换，删除字段会在输出变量中保留内部 Token。
- 缺口二：`getDocumentVariables` 会为未返回值的当前字段写入 `undefined`，Codec 因键存在而把它渲染为空白。
- 缺口三：上述差异没有同时覆盖默认、连续、标签和多记录输出。

# TDD Red

新增 `SPEC-SRC-08`、`CT-DES-08`、`SPEC-SRC-08/CONT` 和 `SPEC-SRC-08/LABEL`。首次定向运行 82 项中 78 项通过：

- 连续两条和标签七条均得到 `@__duowei_field_deleted`，证明最终输出泄露内部 Token。
- 当前元数据仍含字段但记录缺值时得到空字符串，预期为 `[字段不可读取：受限字段]`。
- 直接输出测试首次还包含一个测试自身的连字符属性访问错误；已修正，未把它计作产品缺陷证据。

# Green 实现

1. `createPrintJobDataSourceTokenCodec` 集中创建当前字段、系统项、关联空态和历史字段标签定义。
2. `getDocumentVariables` 只为记录实际拥有的字段建立稳定变量；缺少键与正常空值不再混淆。
3. `prepareTemplateForOutput` 接受同一 Codec；无显式 Codec 时从模板数据源目录和历史绑定恢复规则。
4. DesignerAdapter、默认批量、连续与标签输出全部复用同一解析器；持久模板仍保留稳定 ID，输出变量不含内部 Token。
5. 补正常空值边界后定向 83/83，包含两条默认批量记录、连续两段和标签七项的失效状态一致性。

# 完成证据

- SPEC、SDD、TEST、TRACE、TODO、CHANGELOG 和 ADR 已同步。
- 全量 `npm test` 243/243；生产构建通过，入口 `assets/main.d15c3ef3.js`；`git diff --check` 通过。
- 真实 `vue-print-designer@1.7.39`：默认 2 页/19,969 bytes、连续 1 页/18,705 bytes、标签 1 页/15,813 bytes，三者均得到有效 PDF Blob，编辑标签、持久快照和输出 Token 边界通过。
- 独立测试 Base `GmpDbJRMiaBQSgsTnnncwdn1nCd` 的专用表 `tblym9wiXnKUwKCh`：字段 `fldayqgEbW` 改名后 ID 和值保持；旧 `fldS2RxdiW` 删除后，同名新字段为 `fldI3vXXnW`，历史绑定没有迁移或误绑。两条真实快照的默认/连续/标签验收 2/2。
- 原业务 Base 始终只读；没有修改权限制造不可读现场。未上传、未发布、未修改权限或灰度范围；正式插件 UI 复验需另行发布授权。
- 完整证据见 `artifacts/implementation-v21/验收记录.md`。
