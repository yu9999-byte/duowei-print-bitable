<title>Goal v15 — bridge 模板共享作用域审计</title>

# 结论

当前仍应优先使用飞书原生 `bitable.bridge`，不应提前建设后端：飞书官方把 `bridge.setData` 定义为“在当前 base 中存储自定义内容”，而不是浏览器或当前用户存储；安装版 SDK 又把 `getData/setData` 定义为按 key 读写持久化数据。项目模板 key 只包含 Base 和数据表，不包含成员身份。

这些证据支持“同一 Base 共享存储”的技术判断，但官方页面没有直接写明两个不同成员一定读取同一值，因此不能把跨成员能力标记为已验证。用户于 2026-10-10 将正式双成员和权限边界验收移出 Goal v15；技术审计结论保留，本项不再阻塞该 Goal。

# 一手证据

1. 飞书官方 [`bridge.setData`](https://open.feishu.cn/document/base-extension/base-view-extensions/api/bridge/bridge_setdata?lang=zh-CN)，页面最后更新于 2024-03-07：正文为“在当前 base 中存储自定义内容”。
2. 飞书官方 [`bridge.getData`](https://open.feishu.cn/document/base-extension/base-view-extensions/api/bridge/bridge_getdata?lang=zh-CN)，页面最后更新于 2023-07-26：正文为“获取 bridge.setData 存储的内容”。
3. 本项目安装的 `@lark-base-open/js-sdk@1.0.2` 类型声明：`getData(key)` 为“读取持久化数据”，`setData(key, data)` 为“写入持久化数据”。类型未声明成员级作用域。
4. 生产源模板 key 为 `baseId + tableId`，没有 `userId/openId`；新增 `SPEC-SAVE-05` 测试确认两个仓库客户端连接同一共享存储时读取完全相同的集合和 revision，不同数据表仍隔离。

# 正式双成员验收

状态：Deferred。用户已将本节移出 Goal v15；以下步骤仅在未来重新提出跨成员保证时恢复执行。

候选发布后使用同一 Base、同一数据表和两个不同飞书成员账号：

1. 成员 A 打开多维打印，记录当前模板目录、默认项和排版设置；新建一个专用验收模板并保存。
2. 成员 B 重新打开插件，不由 A 转发页面缓存；必须直接看到同名模板、相同默认项和相同排版设置。
3. B 切换该模板并选择三条记录，确认使用相同画布和排版；记录选择不从 A 的会话继承。
4. 用权限受限的成员读取同一目录并打印；保存、重命名、设默认或删除若被拒绝，集合必须保持不变并显示明确错误。
5. A 重开确认 B 的只读尝试没有改变目录；若 B 有写权限，则 B 的一次受控重命名应在 A 重开后出现。

验收记录必须包含两个不同成员身份、Base/table、操作前后 revision、目录名称及权限结果。只比较 URL、存储 key 或同一账号的两个窗口均不合格。

# 若正式结果证明 bridge 按成员隔离

最小后端不是把模板写进业务表或浏览器存储，而是一个应用自有的共享模板服务：

- 主键：`tenant + base + table`；值继续使用当前 v2 模板集合信封、revision 和 checksum。
- 接口：读取集合和带 `expectedRevision` 的条件写入；冲突返回并要求重载，不做最后写入者静默覆盖。
- 身份：后端必须验证飞书用户/租户身份及其对目标 Base 的权限，不能信任客户端直接提交的 `userId/baseId`。
- 权限：可读成员取得同一集合；创建、编辑、重命名、设默认和删除只允许具备相应飞书权限的成员。
- 安全：继续复用现有模板清洗规则，不存记录值、记录 ID、批量实例、访问令牌或授权头。
- 迁移：首次服务端写入时从 bridge 读取并校验现有 v2 集合；成功后再切换读路径，失败保留 bridge 原值和只读回退。

只有未来恢复正式双成员测试且实际证明 bridge 隔离或不可控后，才进入该后端方案；当前不创建服务、不申请权限、不改发布配置。
