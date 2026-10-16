# 验证记录

日期：2026-10-16（北京时间）。

补充签名证据：使用本机 Node.js 的 JSON.stringify、键排序及 crypto SHA-256 生成包含中文、负零与指数阈值的固定向量；Java ProtocolTest 对相同 canonical JSON 与摘要逐字断言通过。ProtocolTest 当前5项通过。此向量只证明这些输入的规范化及摘要兼容，尚不能证明全部数值边界和签名协议完全一致。

取消路径核对：ChromeDriver 启动完成并登记后立即检查线程中断，覆盖超时取消发生在驱动启动期间、尚未登记浏览器的窗口；中断后进入 finally 关闭驱动。修改后真实 JDK 8 的 spotless:apply clean verify 成功，34项测试通过。该竞态修复尚缺真实浏览器启动延迟场景验收。

- JDK：Zulu OpenJDK 1.8.0_452。
- Maven：3.9.9。
- 执行：`mvn spotless:apply clean verify`，已成功。
- 测试：最新完整 clean verify 共42项通过，零失败、零错误，覆盖配置、签名、接口边界、渲染缓存、后台输入/失败/成功回写、重试恢复查询、OAuth失败回调、PKCE及state一次性消费、事件鉴权和请求限制。
- 产物：`target/print-backend-1.0.0.jar`。
- 启动：Java 8启动Spring Boot 2.7.18，端口18081。
- HTTP：`GET /openapi/duowei-print/health`成功；`GET /api/automation/bridge`为200。
- 限制：启动测试没有连接真实PostgreSQL，未调用真实飞书接口。OAuth成功授权已通过模拟链路测试；完整功能映射、异常协议、真实浏览器及数据库集成仍需继续核对。Goal未完成。

本轮补齐：渲染缺签名401契约；渲染页面携带服务Authorization、等待引擎就绪、检查浏览器协议版本；浏览器清理异常不覆盖原始渲染失败；OAuth及后台任务签名密钥统一由配置组件提供。上述浏览器调整已编译通过，尚未完成真实浏览器验收。

请求兼容性：渲染请求在验签前按原实现规范化；注册表读取规范化scope/selection；后台任务复制输入、整理字段目标并去除身份字段两端空格，避免修改调用者输入。

本轮继续补齐：模板持久化读取校验字段引用数组；后台恢复校验任务 ID、taskKey、状态和 attempt；请求策略改为由配置组件提供来源白名单和渲染地址。

渲染输入兼容核对：与原 TypeScript 严格比较保持一致，拒绝输出类型两端空格；接受数值 pageLimit=1.0，继续拒绝小数页数。新增回归测试后，JDK 8 完整构建35项通过。

飞书字段分页证据：后台成功链路模拟测试现在将附件字段与状态字段分别放在两页，断言第二页请求使用编码后的 page_token=next%2Fpage，再验证上传及最小字段回写。完整 JDK 8 构建仍为35项通过。此项为模拟接口验收，未调用真实飞书。

商店令牌能力补齐：新增ticket持久化读取及可选MarketplaceTokenProvider，覆盖app_ticket交换应用令牌、租户令牌、内存缓存和提前30分钟刷新。新增2项模拟测试通过；JDK 8完整构建37项通过。未接入当前Worker，未调用真实飞书。

补充验收：MarketplaceTokenTest验证不同租户令牌隔离、共享应用令牌；AppTicketRepositoryTest验证读取、空ticket、缺失received_at与无记录情况。均为模拟测试，不替代真实PostgreSQL。最新JDK 8完整构建40项通过。

事件协议对齐：challenge原样返回，只有字符串encrypt触发加密事件拒绝；空白或非字符串app_ticket返回APP_TICKET_INVALID。新增challenge空格及空ticket回归测试通过，最新真实JDK 8完整构建41项通过。

恢复行一致性：恢复查询补回task_key，并与job_id和submission.taskKey同时校验，防止读取不一致持久化任务。修改后真实JDK 8完整构建41项通过，零失败。

恢复校验回归：新增持久化task_key与job_id不一致时拒绝处理的测试。最新真实JDK 8完整构建42项通过。
