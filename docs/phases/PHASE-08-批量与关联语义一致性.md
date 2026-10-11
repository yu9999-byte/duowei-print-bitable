<title>PHASE-08 — 批量与关联语义一致性</title>

# 目标

修复模板级批量归属、默认/连续屏幕差异、自动生成字段范围和单值/明细关联分流，同时保持真实设计器、已有模板和打印/PDF输出链不变。

# Red

2026-10-11 新增目标用例后出现 9 项失败：

- 会话未记录模板 ID，无法判断跨模板切换。
- `multiple=false` 的父记录仍尝试读取目标表并生成 table，空值也没有“—”。
- 自动/连续模板仍包含系统打印日期元素。
- canonical preview 没有 screen-only 独立纸张边界。

# Green

- 批量候选写入当前模板 ID，`shouldExitBatchOnTemplateSwitch` 统一切换判定；App 对跨模板切换构造宿主当前记录候选，成功后原子退出批量。
- 网关新增 `linkKind=reference|detail`；reference 读取 `getCellString`，detail 沿用完整关联展开。首次正式验收进一步证明单向自关联的 `property.multiple` 也可能为 `true`，因此最终规则为：`FieldType.SingleLink` 且目标表等于当前表时固定为 reference，其他关联再按 `multiple` 分类。数据源和模板生成器均消费同一结果，不按字段名称猜测。
- 自动与连续生成器停止放置系统打印日期，数据源目录保持该项。
- 预览组合器注入 `@media screen` 的白纸、20px 间距和阴影；打印页盒无改动。

# Refactor 与回归

- 抽取 `isDetailLinkField` 兼容旧 detail 结构，避免各层重复判断。
- 初始全量 `npm test`：230/230；初始构建入口 `assets/main.f14c204e.js`。
- 正式 SDK 缺口补测先 Red：单向自关联 `multiple=true` 被实际分类为 `detail`；修复后全量 `npm test`：231/231。
- 最终 `npm run build`：通过，入口 `assets/main.bedfd72c.js`，SHA256 `B9319C37580E6FAF6A09A7B673856F673543CF9A33E060C52C421D71B3B6DDBB`，仅既有三项体积告警。
- Codex 隔离浏览器本地 UI 验收通过：默认三条为 3 张 `794 × 1123px` 独立白纸，连续三条为 1 张 `794 × 3369px` 长纸；记录顺序保持不变。
- 模板 A 的三条批量切换到模板 B 后，B 恢复“当前记录 · 1 页”；批量中新建自动模板同样退出原批次。
- 自动模板画布没有打印日期，左侧“系统 → 打印日期”仍可手动使用；证据见 `artifacts/implementation-v18/验收记录.md`。
- 已补齐独立受控真实 Base：6 条虚构关联订单、127 条明细；新增单向自关联“父记录”，`O-SINGLE-001 → O-EMPTY-001`，原业务 Base 未修改。当前正式 Goal v17 复现了父记录被误生成为表格和自动打印日期两项旧缺陷，证明样本有效；证据见 `artifacts/implementation-v18/真实关联Base基线.md`。
- `git diff --check`：通过。

# 正式发布与验收

- 初始候选已上传并发布为小组件 `1.0.48` / 应用 `1.0.45`。业务 Base 验证默认三条为三张纸、连续三条为一张长纸、跨模板退出原批量、自动模板不含打印日期；独立关联 Base 同时暴露了真实 SDK 的单向自关联分类缺口。
- 按 TDD 新增上述真实失败用例并修复，补丁最终发布为小组件 `1.0.49` / 应用 `1.0.46`（详情 ID `7695306784256084928`），状态“灰度中”，权限变更“暂无”，灰度企业仅 `F225904757`，未全量发布。
- 正式包实例 `1791703295909_ey3swpndrla` 加载 `assets/836.ca17a79a.js` 与 `assets/main.bedfd72c.js`。
- 独立关联 Base 正式通过：`O-SINGLE-001` 的父记录显示可读文本 `O-EMPTY-001` 且关联明细仍为一行表格；`O-EMPTY-001` 父记录显示“—”且空明细显示“暂无关联记录”；`O-MULTI-001` 显示 5 行；`O-LONG-001` 的 96 行跨 7 页、每页重复表头且编号从 `D-LONG-001` 至 `D-LONG-096` 完整。
- 原业务 Base 未修改，正式验收结束后恢复 `PO-0001` 单条预览和原模板；证据见 `artifacts/release-2026-10-11-goal-v18/验收记录.md`。
