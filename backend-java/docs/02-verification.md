# 验证记录

更新日期：2026-10-17（北京时间）。Goal仍在进行，完整迁移验收尚未完成。

## 1. 当前构建结果

- JDK：Zulu OpenJDK 1.8.0_452。
- Maven：3.9.9。
- 从仓库根目录执行：`mvn -f backend-java/pom.xml -B spotless:apply clean verify`。
- 最新结果：74项测试通过，零失败、零错误；Java格式检查、编译和打包成功。
- 产物：`backend-java/target/print-backend-1.0.0.jar`。
- `git diff --check`通过。

此前在Java 8下启动Spring Boot 2.7.18，端口18081，健康接口成功、桥接页面HTTP 200。该启动检查使用虚拟数据库地址，只证明应用和无数据库接口启动。

## 2. 已验证行为与证据范围

| 范围 | 当前证据 | 限制 |
| --- | --- | --- |
| 配置及请求策略 | 配置校验、来源、2MB限制、JSON/方法/内容类型错误协议、trace header测试 | 未验证真实反向代理 |
| 签名 | Node.js生成中文、负零及指数阈值canonical JSON/SHA-256向量，Java逐字断言；拒绝签名篡改、字符串及小数版本 | 尚未完整证明全部数值边界与跨语言HMAC协议 |
| OAuth | 模拟成功授权、失败回调、PKCE、state一次性消费和会话测试 | 未进行真实飞书授权 |
| 模板 | 作用域、签名、快照敏感字段、字段引用数组及持久化行校验 | 未在真实PostgreSQL执行upsert/read |
| 渲染协议 | 规范化后验签；拒绝类型空格、小数页数；接受数值pageLimit=1.0；返回协议版本、数组及整数页数回归测试 | 未生成真实PDF/PNG |
| 渲染缓存 | 成功复用、失败后重试、两个调用共享同一产物的测试 | 未用真实浏览器验证并发、超时和取消 |
| 浏览器生命周期 | 已实现Authorization、readiness等待、协议检查、finally关闭及启动后中断检查；编译通过 | 启动期间取消竞态及进程清理仍需真实浏览器验收 |
| 后台任务 | 提交与恢复共用normalizeSubmission；输入不变、严格版本、幂等/失败重试查询、状态回写与标识一致性测试 | 真实数据库事务及重启恢复未验收 |
| 飞书字段与附件 | 模拟两页字段查询并断言page_token编码、上传、最小字段回写和失败脱敏 | 未调用真实飞书接口 |
| 商店令牌 | ticket读取、应用/租户令牌交换、提前30分钟刷新、跨租户隔离及缺ticket拒绝测试 | 可选能力，当前Worker仍使用临时租户凭证；未调用真实飞书 |
| app_ticket事件 | challenge原样返回、token/app_id校验、无效ticket错误码、持久化调用及异常行测试 | Repository测试使用模拟JDBC |
| 数据库脚本 | 0001、0002与原后台分别计算SHA-256，均逐字节一致 | 静态一致性不证明真实执行成功 |

## 3. 尚未完成的验收

1. 隔离PostgreSQL：执行迁移、模板读写、任务创建/失败/重试/恢复和ticket持久化。
2. Chromium与匹配驱动：真实PDF/PNG、页面Authorization、引擎就绪、超时、取消和浏览器进程清理。
3. 飞书测试环境：真实OAuth、字段分页、附件上传及记录回写；不得使用未授权的线上数据。
4. 完整协议与原测试逐项映射，包括更全面的跨语言签名及数值边界向量。

本机PATH未发现postgres、psql、docker或chromedriver，常规PostgreSQL安装目录不存在。Chrome和Edge可执行文件存在，尚缺匹配驱动。外部环境不足与实现缺陷分别记录，不以模拟测试冒充真实验收。

## 4. 操作边界

原后台保留。不部署、不切换线上后台、不自动提交或推送。工作区若出现自动同步提交，不代表本任务执行了Git提交。

2026-10-17桥接契约：BridgeContractTest验证origin规范化、opener限制、同源API路径、恢复存储、nonce与CSP及no-store，拒绝带路径origin。修复桥接白名单直接按逗号拆分未去空格的问题，改用已验证的allowedOrigins配置。静态页面契约测试不替代浏览器交互验收。

2026-10-17模板行映射：TemplateRowTest验证tenant/base/table/template/revision、中文名称、快照和字段引用读取保持一致，拒绝非字符串字段引用。使用模拟JDBC；首次测试的Mockito可变参数匹配已修正。真实JDK 8完整构建49项通过，零失败。

2026-10-17 OAuth权限对齐：auth_result仅接受布尔true，拒绝false与字符串true，不签发会话Cookie；expires_in必须为数值。参数化回归覆盖权限三种响应，真实JDK 8完整构建51项通过。此项为模拟飞书接口测试。

2026-10-17飞书响应校验：通用OpenAPI必须返回对象及数值code=0；拒绝缺失code、数组、字符串code、小数code和非零code。OAuth Token端点允许标准无code对象响应。MockRestServiceServer覆盖5种异常响应，真实JDK 8完整构建56项通过；未调用真实飞书。

飞书响应正向回归：补充数值code=0的OpenAPI响应及无code的标准OAuth Token响应通过测试。最新真实JDK 8完整构建58项通过，零失败。

OAuth错误响应回归：HTTP 200但包含error字段的Token响应也会拒绝。FeishuResponseTest共8项通过，最新真实JDK 8完整构建59项通过，零失败。

OAuth有效期对照：按原实现将正数expires_in计算的会话时长限制在60秒至2小时；使用浮点计算后限幅，避免整数乘1000溢出，拒绝非有限或非正有效期。修改后真实JDK 8完整构建59项通过。

OAuth有效期边界回归：补充expires_in=30及1e20的模拟授权，确认短有效期按原协议限为60秒，极大有效期不会整数溢出。最新真实JDK 8完整构建61项通过，零失败。

OAuth来源配置一致性：授权入口改用configuration.allowedOrigins()，与桥接及请求策略共用规范化白名单，避免配置中的空格或末尾斜杠导致误拒绝。修改后真实JDK 8完整构建61项通过。

请求策略来源一致性：CORS过滤器也改用allowedOrigins()，与OAuth及桥接统一；预检测试使用含空格、多个来源与末尾斜杠的配置，验证合法来源通过且陌生来源拒绝。真实JDK 8完整构建61项通过。

临时租户凭证清理：过期凭证在读取时从内存移除，服务关闭清空凭证与时间记录；凭证与过期时间同步更新，避免读取不一致。TenantCredentialTest覆盖过期移除、有效凭证读取及关闭清理。真实JDK 8完整构建62项通过，零失败。

后台失败保留回归：模拟浏览器渲染失败后，飞书失败状态回写也再次失败，仍验证数据库保存原始且脱敏后的渲染错误，不被次级回写错误覆盖，且不上传文件。真实JDK 8完整构建62项通过。

字段元数据与失败链路：拒绝缺失items、非数组items及小数附件字段类型；忽略缺失稳定ID或名称的字段，has_more仅接受布尔值。新增3项异常元数据测试，失败发生在渲染和上传之前。失败状态回写再次失败时仍保存原始脱敏错误。真实JDK 8完整构建65项通过，零失败。

上传大小边界回归：后台成功链路参数化覆盖小文件、恰好20MiB及20MiB加1字节；前两者上传成功，超限时保存失败且不调用上传接口。最新真实JDK 8完整构建67项通过，零失败。

上传表单契约：后台测试捕获multipart参数，验证POST方法、文件名称、bitable_file归属类型、baseToken节点、字节大小及文件字节保持一致。真实JDK 8完整构建67项通过；此为模拟上传契约，未调用真实飞书。

上传MIME兼容修复：文件part显式携带渲染产物contentType，与原Blob类型一致；模拟上传测试断言application/pdf、文件名与原始字节。真实JDK 8完整构建67项通过，零失败。

渲染超时回归：RenderTimeoutTest模拟阻塞渲染，验证超时触发线程中断及renderer.cancel、失败缓存移除、同产物键可重新生成。默认生产超时仍为90秒；测试使用500毫秒。真实JDK 8完整构建68项通过，零失败。真实浏览器取消和进程清理仍待验收。

渲染关闭回归：服务关闭时取消活动Future、调用renderer.cancel、中断模拟渲染并释放等待请求；RenderTimeoutTest共2项通过。最新真实JDK 8完整构建69项通过，零失败。此项未启动真实Chromium。

关闭后请求回归：执行器拒绝新任务时清除对应缓存并取消Future，返回服务已关闭，避免后续相同请求等待无法执行的任务。重复请求回归通过；真实JDK 8完整构建70项通过，零失败。

渲染关闭并发修复：任务登记及提交与关闭操作共用生命周期锁，关闭标志阻止新任务插入，避免关闭扫描与新请求竞争留下未取消任务。修改后真实JDK 8完整构建70项通过。真实浏览器进程清理仍待验收。

跨语言HMAC证据：本机Node.js crypto使用32字节固定测试密钥生成完整test-v1签名，Java以不同属性插入顺序生成的canonical payload、base64url及HMAC令牌逐字一致。ProtocolTest新增固定向量通过，真实JDK 8完整构建71项通过。该向量不代表全部数值边界已证明兼容。

来源配置边界：拒绝仅包含逗号的来源配置，防止Java split丢弃空元素后空集合通过校验。新增ConfigurationTest回归，真实JDK 8完整构建72项通过，零失败。

OAuth路由对齐：缺少state时两组start/callback路由均返回安全失败HTML；参数去除两端空格，失效start不再仅返回纯文本。新增MockMvc覆盖四个入口，首次回归发现并修复start页面协议遗漏。真实JDK 8完整构建73项通过，零失败。

OAuth取消回调：error参数优先于code，state/code去除两端空格；新增路由回归。最新JDK 8完整构建74项通过，零失败、零错误。

OAuth会话复用核对：成功授权后使用安全Cookie再次申请写签名，验证飞书tenant_key与principalId写入签名、签名可验且摘要绑定授权body、原draft不被修改；更换tableId重新要求连接，恶意来源即使持有Cookie也拒绝。三组成功授权参数均执行上述断言。JDK 8完整构建仍为74项通过，零失败、零错误。

妙搭托管身份边界：原modules/automation/feishu-session-identity依赖托管平台验证的userId、数值tenantId与appId。独立Java服务不能自行信任客户端传入这些字段，使用飞书OAuth user_info身份、编辑权限及服务配置的client_id替代。此为运行环境适配，尚未证明妙搭托管会话与Java服务直接互通。
