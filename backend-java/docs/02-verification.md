# 验证记录

日期：2026-10-16（北京时间）。

- JDK：Zulu OpenJDK 1.8.0_452。
- Maven：3.9.9。
- 执行：`mvn spotless:apply clean verify`，已成功。
- 测试：共27项通过，覆盖配置、签名、接口边界、渲染缓存、后台输入/失败/成功回写、重试恢复查询、OAuth失败回调、PKCE及state一次性消费、事件鉴权和请求限制。
- 产物：`target/print-backend-1.0.0.jar`。
- 启动：Java 8启动Spring Boot 2.7.18，端口18081。
- HTTP：`GET /openapi/duowei-print/health`成功；`GET /api/automation/bridge`为200。
- 限制：启动测试没有连接真实PostgreSQL，未调用真实飞书接口。完整功能映射、异常协议、OAuth授权成功链路、浏览器取消清理及后台任务集成仍需继续核对。Goal未完成。
