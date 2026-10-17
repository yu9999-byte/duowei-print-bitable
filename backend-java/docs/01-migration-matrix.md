# 迁移功能与验收对照

基准：miaoda-duowei-automation/server 与 shared/duowei-print。状态以验证证据为准。

| 原模块 | Java目标层 | 必须保留的行为 | 当前待办 |
| --- | --- | --- | --- |
| automation-config | config | HTTPS、密钥长度、来源、回调路径、Worker间隔校验 | 已实现启动校验，5项配置测试通过 |
| automation.controller / openapi.controller | controller | 两组路径、读写隔离、健康检查、原错误协议 | 薄Controller及契约测试 |
| template-registry-service | service/security | 读写HMAC、作用域、摘要、时效 | 跨语言签名与异常对齐 |
| template-registry.store / row | repository/model | 联合主键、ready筛选、修订、时间、JSON映射 | 数据库兼容测试；读取行校验状态、快照及字段引用数组 |
| registry-write-authorization | service | draft白名单、身份核验、签发授权 | DTO及输入校验 |
| feishu-oauth-session | service/integration | PKCE/state一次性、用户信息、编辑权限、会话、回跳 | Service已拆分；过期state、PKCE、权限类型、成功会话及桥接回跳本地模拟测试通过；真实飞书待验 |
| automation-bridge-document | resources/service | 来源与opener核验、恢复同步、CSP | 模板整理及协议测试 |
| renderer-service / headless-renderer | service/render | 安全请求、HMAC、缓存、超时、产物校验、取消清理 | 已加入缓存、失败清除及超时取消；真实Chrome两页PDF/第一页PNG及变量像素变化通过；真实超时关闭会话及同键重试通过，复杂模板和系统进程残留仍待验 |
| browser-runtime | integration/render | 页面隔离、浏览器关闭、启动诊断 | 生命周期及配置注入 |
| background-job-service / background-job | service/job | 请求规范化、幂等、失败重试、状态机、恢复 | Service/Repository已拆分；输入、失败持久化、重试与恢复查询测试通过；真实数据库待验 |
| background-automation.service | service/job | 临时租户凭证、单Worker、凭证失效、恢复 | 生命周期与间隔配置 |
| feishu-background-ports | integration/feishu | 字段分页及类型、最小更新、20MB上传 | 成功上传/最小字段回写与失败脱敏模拟测试通过；真实飞书待验 |
| feishu-app-ticket / store | service/repository | challenge、token、app_id、事件、持久化 | challenge、错误token/跨应用拒绝、有效ticket持久化调用测试通过 |
| createMarketplaceTokenProvider / AppTicketStore.get | integration/feishu、repository | 持久化ticket读取、app_access_token及tenant_access_token交换、缓存提前刷新 | 已补齐可选MarketplaceTokenProvider及ticket读取；令牌交换、缓存提前刷新、缺ticket拒绝测试通过；当前Worker仍使用临时租户凭证；真实数据库及飞书待验 |
| main / filters | config/exception | CORS、请求上限、错误脱敏 | JSON与2MB限制、请求体保留及trace header测试通过；JSON、方法、内容类型错误协议及 trace header 已补测 |
| view / client resources | resources | 浏览器引擎、静态资源与入口 | 识别托管专用边界 |

## 完成门槛

1. 每个模块具备对应实现，移除Controller中的业务与SQL。
2. Java、配置和文档格式化，工具可重复检查。
3. 真实JDK8执行mvn clean verify成功，JAR启动验证。
4. 外部依赖测试与真实飞书线上验收分开记录，不以模拟结果代替线上结果。

## 原测试文件映射与剩余缺口

以下按原server目录测试文件建立索引；同主题测试不等于全部断言等价。

| 原测试文件 | Java测试文件 | 仍需逐项核对 |
| --- | --- | --- |
| automation-config.test.ts | ConfigurationTest | URL与密钥边界逐例对照 |
| automation-openapi.controller.test.ts | RegistryContractTest、RenderContractTest、RequestErrorContractTest | 全部路由及错误响应 |
| automation-bridge-document.test.ts | BridgeContractTest | 已覆盖静态页面契约；真实浏览器消息与恢复同步仍待验 |
| browser-runtime.test.ts | RenderEnvelopeTest、RenderCacheTest、RenderTimeoutTest、BrowserLaunchTest | 已覆盖模拟超时、取消、关闭、重试及启动失败诊断；独立页面与真实浏览器清理仍待验 |
| registry-row.test.ts | TemplateRowTest、RegistryServiceTest | 已覆盖读取映射；真实数据库往返及敏感快照异常仍待验 |
| feishu-session-identity.test.ts | 不属于活动路由；OAuthFailureTest覆盖当前身份链路 | identityFromMiaodaSession仅定义与自身测试引用，Gateway实际使用OAuth verifyIdentity；不把未接入的平台会话适配器作为已迁移能力 |
| background-job-row.test.ts | BackgroundRepositoryTest、BackgroundProcessingTest | 全部持久化状态与输入校验 |
| background-job.test.ts | BackgroundValidationTest、BackgroundProcessingTest | 状态机、重复请求及全部失败阶段 |
| feishu-oauth-session.test.ts | OAuthFailureTest、OAuthRouteTest | 已覆盖PKCE、state消费、安全Cookie、会话签名复用、表格作用域隔离、恶意来源及取消回调；已补同源桥接303成功回跳与Cookie复用模拟验证；真实窗口交互仍待验 |
| feishu-background-ports.test.ts | MarketplaceTokenTest、EventServiceTest、BackgroundProcessingTest、TenantCredentialTest | 已覆盖临时令牌过期清理、异常字段及20MiB上传边界模拟测试；真实上传仍待验 |

补充Java测试：ProtocolTest、RenderNormalizationTest、RequestPolicyTest、AppTicketRepositoryTest。数据库集成、真实浏览器和真实飞书仍独立验收。

## 原后台外围文件核对

以下为业务模块之外的文件，不能仅凭17个业务接口映射宣称整个托管工程等价。

| 原文件/目录 | 核对结果 | Java对应与边界 |
| --- | --- | --- |
| modules/hello/*.ts | Controller、Service均为整段注释的脚手架示例，无活动接口 | 不生成无效示例功能 |
| modules/view/view.controller.ts | 根路径及通配路径渲染index，注入妙搭平台信息和CLIENT_BASE_PATH | Java仅包含打印引擎资源，未迁移妙搭前端SPA托管与平台信息注入；前端托管继续由现有工程承担，此适配差异须在切换前核对 |
| main.ts | Nest启动、CORS、JSON请求限制、HTML引擎、静态资源目录 | Spring Boot启动、RequestPolicy及resources；独立部署的代理路径/静态前端托管尚未验收 |
| app.module.ts、各module.ts | 依赖注入和妙搭平台模块注册 | Spring组件扫描；不直接复用妙搭Node运行时 |
| common/interfaces、constants、filters | Nest全局兜底错误模型与平台BusinessException | ApiErrors与各业务Controller错误协议；平台BusinessException外形未证明等价，不能将业务错误测试扩展为所有平台异常兼容 |
| database/schema.ts | 模板、任务、ticket表声明 | 两份兼容SQL迁移与JdbcTemplate Repository；PostgresIntegrationTest待配置专用测试库执行 |
| generated/automation-renderer-document | 打印引擎生成资源 | resources/renderer.html及build-browser-resources.mjs；需真实浏览器验收 |

更新的测试证据：BrowserLifecycleTest覆盖导航失败和启动期间关闭的模拟清理；FeishuResponseTest覆盖实际RestTemplate URL编码；PostgresIntegrationTest为显式环境变量启用的真实数据库测试，当前跳过。详细结果以02-verification.md为准。

OAuth对照补充：FeishuClient对OAuth Token响应严格要求数字code=0，与原feishu-oauth-session一致；OAuthRouteTest覆盖不受信任来源的IDENTITY_INVALID及响应trace一致性。授权开始/桥接跳转保留no-referrer，回调HTML保留nosniff及base-uri限制。

## 后台任务状态机逐项对照（2026-10-17）

| 原实现行为 | Java位置与证据 | 未证明部分 |
| --- | --- | --- |
| 新建queued/attempt=0；相同任务键复用；仅failed重试为queued并删除error，保留原submission/attempt | BackgroundJobRepository.createOrRetry的条件ON CONFLICT；BackgroundRepositoryTest | 真实PostgreSQL执行仍待配置 |
| queued/processing按created_at恢复；检查任务键、状态及attempt | recoverable与BackgroundService.drain；BackgroundProcessingTest异常行测试 | 真实进程重启恢复未验收 |
| 单Worker、临时租户凭证90分钟、到期不处理 | 单线程ScheduledExecutorService与tokenFor；TenantCredentialTest | 进程重启凭证丢失与原实现一致 |
| queued先写等待，processing递增attempt，成功写附件和状态，失败保存原错误 | BackgroundService.process；BackgroundProcessingTest成功及失败分支 | 飞书真实写入和数据库事务未验收 |
| 字段名原样作为飞书记录fields的键，包括首尾空格 | 保留metadata.textValue；成功测试覆盖附件/状态/错误三字段空格，失败测试覆盖状态空格 | 飞书真实字段待验 |
| 上传上限20MiB，分页游标不修剪，multipart带文件MIME | BackgroundProcessingTest、FeishuHttpIntegrationTest | 真实飞书上传未验收 |

已对齐提交后立即调度及启动立即扫描：submit在持久化及响应快照完成后向单线程Worker提交drain，start的首次扫描延迟为0。BackgroundValidationTest设置60秒扫描周期，验证提交后2秒内触发扫描；没有启动定时器，避免以周期扫描误判立即调度。关闭期间被拒绝的调度保留持久化任务供重启恢复。
## 模板存储逐项对照（2026-10-17）

原template-registry.store的五列联合冲突键与Java upsert一致，重复写更新名称、状态、快照、引用字段及updated_at；list限制ready并按updated_at倒序，get按作用域/ID/修订号查询且不过滤状态。TemplateRowTest覆盖行字段映射与非法引用字段，新增写入参数断言证明签名中的模板字符串未被静默trim。读取scope/selection按原parseRead修剪，operation按原实现严格接受list/get，不修剪枚举值。写签名scope按原verifyWrite精确比较，不把带空格作用域误认为同一作用域。真实数据库证据仍依赖PostgresIntegrationTest，当前未配置测试库。
## 配置测试对照（2026-10-17）

原automation-config.test.ts的完整HTTPS配置、Bearer、四组密钥、事件token、Worker下限、App ID、公开路径及跨来源回调拒绝均有ConfigurationTest覆盖，兼容旧OpenAPI回调地址及250/60000边界。补齐原Number环境值支持的十进制小数整数、科学记数法及十六/二/八进制整数；结果仍限制250到60000，非整数/空值/越界拒绝。来源列表忽略空项，域名小写、HTTPS默认443省略；继续应用OAuth要求的HTTPS origin限制，不宣称所有WHATWG URL解析细节与java.net.URI完全等价。
## 商店令牌缓存对照（2026-10-17）

MarketplaceTokenProvider保留原app_ticket→app_access_token→tenant_access_token链路，租户键修剪并隔离缓存，剩余有效期严格大于30分钟才复用。expire沿用原Number转换：null/空字符串/空数组为0，布尔值为0/1，数字字符串和单值数组可转换，缺失/对象/非法字符串/非有限值回退3600秒。缓存截止时刻使用double避免巨大秒数转long溢出，令牌仅验证非空后保留原始内容；MarketplaceTokenTest新增11组转换与交换次数断言。真实飞书交换仍未执行，该可选Provider未替代Worker的临时租户凭证路径。
## 桥接脚本运行对照（2026-10-17）

scripts/verify-bridge.mjs在本地编译原automation-bridge-document.ts，取其实际生成脚本与Java bridge.js注入同一来源/端点后的脚本逐字比较，结果一致。使用Node VM执行生成资源，验证不受信任来源/非opener/错误版本无网络操作、probe回应、授权后签名仅传注册请求、成功回执不泄露签名、错误信息脱敏、OAuth保存与返回恢复、过期状态删除及不可信连接地址拒绝。命令node backend-java/scripts/verify-bridge.mjs退出0。证据为脚本运行协议，不是真实浏览器popup或第三方Cookie验证；Java CSP/nonce/HTTP头由BridgeContractTest独立验证。