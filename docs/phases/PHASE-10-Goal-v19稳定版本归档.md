<title>PHASE-10 — Goal v19 灰度稳定版本归档</title>

# 目标

把 Goal v10～v19 已经灰度验证的累计工作形成可回退 GitHub 基线。归档只整理、验证和版本化现状，不修改产品行为，不重新发布飞书应用，也不触碰 Base 数据。

# 启动基线

- 分支：`codex/feishu-native-ui-v7`。
- 远端：`origin`，本地与远端基线 ahead/behind `0/0`。
- 归档前最后提交：`2aa7b51 docs: record Goal v9 gray release`。
- 目标标签：`goal-v19-gray-1.0.47`，远端预检不存在。
- Git 简短状态显示 117 个折叠条目；展开目录后实际为 52 个已跟踪修改、143 个未跟踪文件，共 195 个文件。

# 归档策略

## 纳入

- Goal v10～v19 的产品源码和 238 项自动化测试。
- BRD、PRD、TD、SPEC、SDD、TEST、TRACE、ADR、阶段记录、BUG、TODO 和 CHANGELOG。
- 设计稿、正式验收截图、必要 HTML/PDF、纯虚构容量样本及其确定性生成载荷。

## 排除但不删除

- `artifacts/linked-engine/`：浏览器夹具构建目录，可由 `tests/browser/linked-webpack.config.cjs` 重新生成；其中最大包 6.34 MB。
- `outputs/**/*.inspect.ndjson`：本地文件检查器生成的中间报告，不是业务输入或验收交付物。

这些文件继续保留在本地磁盘，仅通过 `.gitignore` 排除，不执行删除。

# 风险审计

- 常见私钥、GitHub Token、OpenAI Key、AWS Key 和显式凭据赋值模式命中 0。
- 唯一超过 1 MB 的新增文件属于上述可再构建夹具目录；排除后无新增单文件达到 1 MB。
- `origin/codex/feishu-native-ui-v7` 没有未知新提交，允许常规非强制推送。
- 应用 ID、Base ID、表 ID、版本号和验收编号属于项目公开配置/证据，不作为凭据。

# 文档一致性

- 当前发布基线统一为小组件 `1.0.50` / 应用 `1.0.47`、入口 `assets/main.1d16fb8d.js`、灰度企业 `F225904757`、权限变更“暂无”。
- 批量 1/10/50/51 条和关联 1/5/96 行已从当前待办转为完成；正式 SDK 自然超时与原生打印框物理页数继续保留真实证据边界。
- Goal v5 等历史增量条目保留当时“未上传/待验”文本，但在所在章节明确标记为历史过程快照，不再代表当前状态。

# 完成门

1. 全量 `npm test` 238/238。
2. `npm run build` 生成 `assets/main.1d16fb8d.js`。
3. `git diff --check` 通过。
4. 暂存区敏感信息、大文件和纳入范围复核通过。
5. 常规提交、注释标签和非强制推送成功；远端分支及标签回读一致。

本阶段五项完成门均已通过。

# 最终质量门进度

- `npm test`：238/238 通过。
- `npm run build`：通过，入口保持 `assets/main.1d16fb8d.js`；仅有既有三项 Webpack 体积/性能告警。
- `git diff --check` 与 `git diff --cached --check`：通过。
- 暂存区敏感信息复核：常见私钥、GitHub/OpenAI/AWS Token 和显式凭据赋值模式命中 0。
- 暂存区大文件复核：无单文件达到 1 MB；排除项未进入暂存区，且没有未暂存修改。
- 归档有效载荷提交：`a6484ab feat: archive Goal v19 gray release baseline`。
- `codex/feishu-native-ui-v7` 已常规非强制推送；注释标签 `goal-v19-gray-1.0.47` 已创建并推送。
- 远端分支与剥离注释对象后的远端标签均回读到最终闭环提交，工作区干净。
