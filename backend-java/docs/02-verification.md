# 验证记录

日期：2026-10-16（北京时间）。

- JDK：Zulu OpenJDK 1.8.0_452。
- Maven：3.9.9。
- 执行：`mvn spotless:apply clean verify`，已成功。
- 测试：共33项通过，覆盖配置、签名、接口边界、渲染缓存、后台输入/失败/成功回写、重试恢复查询、OAuth失败回调、PKCE及state一次性消费、事件鉴权和请求限制。
- 产物：`target/print-backend-1.0.0.jar`。
- 启动：Java 8启动Spring Boot 2.7.18，端口18081。
- HTTP：`GET /openapi/duowei-print/health`成功；`GET /api/automation/bridge`为200。
- 限制：启动测试没有连接真实PostgreSQL，未调用真实飞书接口。OAuth成功授权已通过模拟链路测试；完整功能映射、异常协议、真实浏览器及数据库集成仍需继续核对。Goal未完成。

本轮补齐：渲染缺签名401契约；渲染页面携带服务Authorization、等待引擎就绪、检查浏览器协议版本；浏览器清理异常不覆盖原始渲染失败；OAuth及后台任务签名密钥统一由配置组件提供。上述浏览器调整已编译通过，尚未完成真实浏览器验收。

请求兼容性：渲染请求在验签前按原实现规范化；注册表读取规范化scope/selection；后台任务复制输入、整理字段目标并去除身份字段两端空格，避免修改调用者输入。

本轮继续补齐：模板持久化读取校验字段引用数组；后台恢复校验任务 ID、taskKey、状态和 attempt；请求策略改为由配置组件提供来源白名单和渲染地址。
