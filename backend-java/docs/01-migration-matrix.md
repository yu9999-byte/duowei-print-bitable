# 迁移功能与验收对照

基准：miaoda-duowei-automation/server 与 shared/duowei-print。状态以验证证据为准。

| 原模块 | Java目标层 | 必须保留的行为 | 当前待办 |
| --- | --- | --- | --- |
| automation-config | config | HTTPS、密钥长度、来源、回调路径、Worker间隔校验 | 已实现启动校验，5项配置测试通过 |
| automation.controller / openapi.controller | controller | 两组路径、读写隔离、健康检查、原错误协议 | 薄Controller及契约测试 |
| template-registry-service | service/security | 读写HMAC、作用域、摘要、时效 | 跨语言签名与异常对齐 |
| template-registry.store / row | repository/model | 联合主键、ready筛选、修订、时间、JSON映射 | 数据库兼容测试；读取行校验状态、快照及字段引用数组 |
| registry-write-authorization | service | draft白名单、身份核验、签发授权 | DTO及输入校验 |
| feishu-oauth-session | service/integration | PKCE/state一次性、用户信息、编辑权限、会话、回跳 | Service已拆分，过期state失败HTML回调测试通过；成功授权链路待验 |
| automation-bridge-document | resources/service | 来源与opener核验、恢复同步、CSP | 模板整理及协议测试 |
| renderer-service / headless-renderer | service/render | 安全请求、HMAC、缓存、超时、产物校验、取消清理 | 已加入缓存、失败清除及超时取消；真实浏览器验收待完成 |
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
| browser-runtime.test.ts | RenderEnvelopeTest、RenderCacheTest、RenderTimeoutTest | 已覆盖模拟超时、取消、关闭及重试；启动诊断、独立页面与真实浏览器清理仍待验 |
| registry-row.test.ts | TemplateRowTest、RegistryServiceTest | 已覆盖读取映射；真实数据库往返及敏感快照异常仍待验 |
| feishu-session-identity.test.ts | OAuthFailureTest仅部分相关 | 身份字段与编辑权限全部分支 |
| background-job-row.test.ts | BackgroundRepositoryTest、BackgroundProcessingTest | 全部持久化状态与输入校验 |
| background-job.test.ts | BackgroundValidationTest、BackgroundProcessingTest | 状态机、重复请求及全部失败阶段 |
| feishu-oauth-session.test.ts | OAuthFailureTest | PKCE/state/session全部原断言 |
| feishu-background-ports.test.ts | MarketplaceTokenTest、EventServiceTest、BackgroundProcessingTest、TenantCredentialTest | 已覆盖临时令牌过期清理、异常字段及20MiB上传边界模拟测试；真实上传仍待验 |

补充Java测试：ProtocolTest、RenderNormalizationTest、RequestPolicyTest、AppTicketRepositoryTest。数据库集成、真实浏览器和真实飞书仍独立验收。
