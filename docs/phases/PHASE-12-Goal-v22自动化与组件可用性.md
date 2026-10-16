<title>PHASE-12 — Goal v22 自动化与组件可用性</title>

# 目标

在不实现手写签名组件、不修改原业务 Base、不擅自发布或申请权限的前提下，先稳定现有打印闭环，再实现单记录自动化生成 PDF/PNG 的 MVP，并把首批常用组件从“目录可见”提升为“可创建、可配置、可保存、可恢复、可输出”。服务间 HMAC 身份签名属于安全基础设施，不是本轮移出的“签名组件”。

# 阶段门

| 阶段 | 内容 | 退出证据 |
|-|-|-|
| A | 冻结 Goal v21 基线并执行主流程回归 | 全量测试、生产构建、Git 基线记录 |
| B | 现有 P0/P1 可用性收口 | 失败测试、修复、相邻回归 |
| C | 自动化架构与平台技术验证 | ADR-0028、一手文档、接口合同 |
| D | 自动化动作、模板注册表与渲染服务 MVP | 单元/契约/集成测试、有效 PDF/PNG |
| E | 首批组件能力审计与补齐 | 组件矩阵、真实引擎保存/恢复/输出证据 |
| F | 独立测试 Base 与正式灰度验收 | 自动化真实触发和回写；需单独发布/权限授权 |

# 已完成证据

## A：基线

- 工作区保留 Goal v21 未发布候选，不覆盖、不回退。
- Git HEAD：8709042f0430f8e43964b99112d8ecfb663ab97c，远端分支 codex/feishu-native-ui-v7。
- npm test：243/243 通过。
- npm run build：通过，入口 assets/main.d15c3ef3.js；只有既有三项 Webpack 包体积告警。

## C：官方能力核验

- 已确认自动化动作是独立 BlockType，不是记录视图中的模拟按钮。
- execute 可获得触发记录上下文和 tenantAccessToken，SingleSelect.autocomplete 可动态加载模板。
- ResultType 可返回 Attachment 数组；上传附件需要新增多维表格管理权限和 permission.type=2。
- 自动化沙箱禁止 jsdom、sharp；当前浏览器打印引擎不能直接在该沙箱运行，外部 Renderer Service 是必需依赖。
- 当前 bridge 模板存储没有服务端自动化读取接口，必须增加受身份校验的 Template Registry 同步层。

## D：自动化本地实现与服务边界

- `AutomationDomain` 已锁定单记录上下文、模板作用域、引用字段裁剪、PDF/PNG 输出语义和稳定幂等键；模板修订、输出类型或引用值变化都会生成新键。
- `AutomationAction` 已实现“查询模板 → 只读取引用字段 → 渲染 → 校验产物 → 官方附件上传”的单一流程；并发重复投递只渲染、上传一次，失败后可重试，用户错误不泄漏凭据。
- 飞书 Action 已提供动态模板选择、完整多页 PDF/首页 PNG、Attachment/success/status/error/artifactKey 结果和原生 `SetRecord` 后续步骤；注册器只放行飞书、Registry、Renderer 三个必要域名。
- 已建立独立 `automation-block/src/register.ts` 和 `automation-block/block.json`：入口向官方 `basekit` 注册 Action；平台现已分配独立 BlockTypeID `blk_6ab0a4c12f818bde89e6d397`，不复用记录视图 ID。Registry/Renderer 地址与签名密钥只从部署环境读取，缺失、占位、弱密钥或非飞书环境全部 fail closed。
- 记录读取使用飞书 `base/v3 ... records/batch_get` 的 `select_fields` 投影，仅请求模板引用字段；tenantAccessToken 只发往 `open.feishu.cn`，不进入 Registry 或 Renderer 请求。
- Template Registry 已完成 HMAC 写签名、服务读签名、tenant/Base/table 隔离、HTTP 读写端口、请求限额和记录视图同步适配器。浏览器端不能持有共享密钥，也不能提供 tenantKey；它只提交 Base/数据表/模板草稿，写授权服务从可验证飞书会话取得 tenantKey/principalId/canWrite，补成权威完整 body 并签发一次性精确签名。同步端原样使用该 body；客户端 tenantKey 注入、匿名、只读、篡改、过期和跨作用域请求全部拒绝。
- Registry 存储已抽成可注入端口；新增单实例持久化 JSON Store，服务重启可恢复模板，并发写串行化且不会丢项，损坏文件 fail closed、不被覆盖，状态文件不含签名密钥。正式部署必须使用持久卷；多实例需改接事务数据库 Store。
- Renderer Service 已完成精确请求签名、2 MiB 默认上限、30 秒默认超时、artifactKey 并发复用、二进制响应校验和安全错误结构；无头浏览器每个任务使用隔离页面并保证关闭，页面协议直接调用 `renderer-browser.ts`。
- 真实锁定引擎已生成 2 页 PDF（13,142 bytes，`%PDF-`）和首页 PNG（27,659 bytes，标准 PNG 文件头）。由于引擎 `imageBlob` 实际返回 JPEG，业务层已按纸张比例裁取第一页并重新编码为 PNG。

## E：首批组件本地完成证据

- 真实 `vue-print-designer@1.7.39` 已保存并恢复 `text/image/table/line/rect/pageNumber`；同一 text 通过 Enter、换行和自动高度覆盖多行文本。
- `component-engine` 已使用与 `App.vue` 相同的 `application/json`、`{"type": ...}` 拖放协议创建文本和临时矩形；真实 DOM 选中组件后，通过原生属性面板把文本移动到 `x=80/y=640`、缩放到 `320×90`，画布即时反馈与持久快照一致。
- 新建文本绑定真实“订单编号”，保留两行内容；临时矩形经真实 Delete 快捷键删除，随后保存、重载仍保持组件、属性和字段绑定。
- 真实预览逐项通过文本、多行文本、图片、表格、横线、矩形和页码；同一持久模板生成浏览器打印 HTML、23,593-byte PDF 和 77,139-byte 标准首页 PNG，纸张边界、组件节点和真实 `DW-COMP-001` 值均保留。
- 已逐项打开原生属性面板：图片来源/上传/变量/边框/填充/透明度，文本内容/变量/换行/自适应，表格列/数据/表脚/变量/分页/脚本，横线颜色/粗细/线型，矩形背景/边框/圆角，页码格式/标签/字体/样式。
- 本轮不复制引擎属性面板，也不新增签名组件；组件创建、属性、保存、恢复和输出继续复用同一模板模型。

## 当前本地质量门

- 初始 Template Registry、持久化 Store、Renderer Service、无头页面协议、后端权威租户写授权边界、飞书 Action 适配器、独立 Block 入口和组件/真实渲染测试完成时，全量 `npm test` 为 292/292，入口为 `assets/main.d15c3ef3.js`。
- 随后补齐记录视图真实接线候选：bridge 保存后同步；重命名同步最新名称和快照；删除发送墓碑；同一稳定模板 ID 替换旧修订；JSON Store 重启后墓碑仍有效；同步失败不回滚本地成功。记录视图上传缺少任一真实 HTTPS 端点时 fail closed。
- 最终 `npm test` 324/324，`npx vue-tsc -b`、`npm run check:automation-block`、根 `npm run build`、自动化服务 `npm run check/build` 与 `git diff --check` 通过；记录视图候选入口为 `assets/main.8388ad3e.js`，只有既有三项 Webpack 包体积告警。
- 飞书 OAuth 写授权已接入：一次性 state/PKCE、用户身份和 tenant 解析、目标 Base 编辑权限校验、Base/table 作用域安全会话、重放/来源/作用域/权限拒绝以及回调注入防护均有自动化证据。
- 八路由生产服务、精确凭据 CORS、持久 Registry/后台任务/app_ticket 和 Playwright Renderer 已打包；完整服务健康检查为 200，真实 Chromium 生成 2 页 14,017-byte PDF 和 1 页 29,967-byte 标准 PNG。生产 HTTPS 尚未部署，该证据只属于本地候选。
- 本地验收记录：`artifacts/implementation-v22/验收记录.md`。
- 2026-10-12 已在 Codex 隔离浏览器复跑真实组件与自动化渲染夹具：组件 create/select/move/resize/delete/bind/save/reload、23,593-byte PDF、77,139-byte PNG再次通过；自动化 2 页 13,142-byte PDF 与首页 27,659-byte PNG再次通过。未操作用户 Chrome。
- 记录视图保存/重命名/删除已经接入可配置同步端口，但尚未绑定和验证真实线上 URL；飞书会话校验、HTTPS 服务地址、后端密钥、持久卷和后台域名仍是外部配置门。当前环境没有可核实的 `DUOWEI_*` 部署配置，不能用匿名接口、示例地址或前端密钥绕过。

# Red → Green 计划

1. AUTO-01：无 recordID 的触发必须失败；有 recordID 时形成单记录任务。
2. AUTO-02：模板目录严格按 tenant/Base/table 隔离，只返回已保存、同步成功且为最新 ready 修订的记录模板。
3. AUTO-03：相同内容重复触发得到同一 artifactKey；模板修订、记录内容或输出类型变化必须产生新键。
4. AUTO-04：发送到 Renderer Service 的载荷不得包含 tenantAccessToken、authorization、refreshToken 或当前未引用字段。
5. AUTO-05：PDF 保留完整页，PNG 只取第一页；空文件、错误 MIME 或无页面产物拒绝。
6. AUTO-06：成功和业务失败都形成可供后续“修改记录”步骤消费的稳定结果结构。
7. COMP-01：文本/多行文本、图片、表格、横线、矩形、页码逐项验证创建、属性、保存、恢复和输出。

## 自动化产品模型修订（2026-10-13）

竞品文档调研与当前正式状态共同确认：自动化模板下拉的真实数据链尚未上线。当前产品合同修订为：模板只来自当前 tenant/Base/table 中已保存且同步成功的最新记录模板；输出只保留完整 PDF 和首页 PNG；运行模式分为标准与后台。标准模式返回最终附件和状态给同一自动化的后续动作，后台模式选择附件/状态/错误字段后直接回写当前记录，不把最终文件传给同一流程。DOCX/XLSX、批量自动化和签名继续排除。

实施顺序：

1. 以失败测试复现正式模板下拉无数据，并打通记录视图保存/改名/删除到 Registry 再到 autocomplete 的生产链路；
2. 把现有同步动作收敛为标准模式，真实验证 PDF/PNG 及后续“修改记录”引用；
3. 新增后台模式字段选择、持久任务、Worker 状态机、附件/状态/错误原子回写和幂等；
4. 只在独立测试 Base 分别验收标准 PDF、标准 PNG、后台 PDF、后台 PNG；
5. 本地测试、构建和正式 E2E 均通过后，才更新完成状态并按单独授权上传/灰度。

本地实现结果（2026-10-13）：第 1～3 项已完成 Red→Green。Action 已支持标准/后台模式和条件字段；后台字段按附件/文本类型过滤；`POST /v1/background-jobs` 接收签名任务并持久化，Worker 覆盖等待、生成中、成功、失败、重复触发复用与跨重启恢复；`POST /v1/feishu/events` 验证并持久化当前应用 app_ticket，再通过商店应用令牌链上传 Base 附件并只回写用户选择字段。第 4～5 项的生产部署、上传、灰度补丁和独立 Base E2E 仍未执行。

# 外部变更与发布状态

2026-10-14 续办：记录视图 `1.0.54` / 应用 `1.0.58` 已灰度到唯一企业 `F225904757`，自动化组件为 `1.0.6`，权限变更“暂无”。独立测试 Base 模板保存成功但 OAuth 授权页返回 `20027`，原因是请求了未开通的 `docs:permission.member:auth`。官方文档确认现有 `bitable:app` 可调用同一编辑权限判断接口；TDD 修订后主项目 334/334、服务 29/29 和构建通过。妙搭服务提交 `c2f4e6a` 发布为 `7696381664310103277`，状态 finished。没有追加权限、扩大灰度或写入原业务 Base。模板同步及四条自动化 PDF/PNG 路径仍需在独立测试 Base 实测，不能把部署完成写成 E2E 通过。

2026-10-13 用户已单独授权：为目标“多维打印”应用新增自动化 BlockType、申请必要附件权限、上传自动化 Block，并仅向灰度企业 `F225904757` 发布；验收只允许使用独立测试 Base，原业务 Base 不修改。

- 已创建自动化能力，BlockTypeID 为 `blk_6ab0a4c12f818bde89e6d397`；自动化小组件版本为 `1.0.0`。
- 已创建应用版本 `1.0.48`，详情 ID `7695681883687144658`，同时引用自动化小组件 `1.0.0` 与记录视图 `1.0.50`。
- 版本已通过审核并进入“灰度中”；2026-10-13 12:57（北京时间）回读“已灰度企业”仅为 `F225904757`，没有扩大灰度或全量发布。
- `1.0.48` 仍绑定记录视图 `1.0.50`；`assets/main.8388ad3e.js` 同步/OAuth 补丁未上传。线上妙搭环境缺少 `DUOWEI_FEISHU_APP_SECRET`，当前自动化服务 `/healthz` 返回 HTTP 404，所以不能执行正式自动化 E2E，也不能把本地候选写成当前灰度版本能力。
- 下一次外部变更必须先补齐生产 HTTPS 服务、OAuth 回调/域名和记录视图同步补丁；仍须沿用既有授权边界，不新增权限、不扩大灰度。部署后先回读服务、应用版本和灰度企业，再进入独立测试 Base 验收。
- 独立测试 Base `GmpDbJRMiaBQSgsTnnncwdn1nCd` 已新增专用表 `tblqCnpRCEWPcHtp` / “自动化生成文件验收”，字段覆盖测试单号、客户、商品、数量、备注、生成文件、生成状态、错误信息和产物键；唯一虚构记录为 `reczz28MijsUCdqV` / `AUTO-001`。建表前执行 dry-run，建表后回读 9 个真实字段及记录；既有五张验收表记录数保持不变。

生产服务、会话校验、持久化和记录视图真实同步仍必须以实际部署/访问证据为准；任何缺失都不能用 Block 上传或审核通过替代。原业务 Base 字段和记录、全量发布、其他灰度企业继续不在授权范围。
