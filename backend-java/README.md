# Java 后台迁移（JDK 8）

迁移来源：`miaoda-duowei-automation/server`。原服务保留，新工程未部署，未切换插件后台。

## 环境和启动

需要 JDK 8、Maven 3.8+、PostgreSQL、Chrome/Chromium 和匹配版本的 ChromeDriver。将 ChromeDriver 加入 PATH，或使用 JVM 参数 `-Dwebdriver.chrome.driver=绝对路径`。服务使用 Spring Boot 2.7.18、Selenium 4.8.3。

```powershell
mvn clean verify
java -jar target/print-backend-1.0.0.jar
```

核对数据库表结构后使用 `migrations/` 脚本。应用不会自动运行迁移。请先在测试数据库验证，避免改动生产数据。

## 环境变量

- `PORT`：默认 8080。
- `DUOWEI_DATABASE_URL`：`jdbc:postgresql://主机:5432/数据库`。
- `DUOWEI_DATABASE_USERNAME`、`DUOWEI_DATABASE_PASSWORD`。
- `DUOWEI_PUBLIC_AUTOMATION_BASE_URL`：HTTPS 公网地址，结尾 `/openapi/duowei-print`。
- `DUOWEI_OAUTH_REDIRECT_URI`：公网 `/api/automation/oauth/callback`。
- `DUOWEI_ALLOWED_ORIGINS`：插件允许来源，逗号分隔，不含空格和尾部斜线。
- `DUOWEI_FEISHU_APP_ID`、`DUOWEI_FEISHU_APP_SECRET`。
- `DUOWEI_REGISTRY_WRITE_SIGNING_SECRET_HEX`、`DUOWEI_REGISTRY_READ_SIGNING_SECRET_HEX`、`DUOWEI_RENDERER_SIGNING_SECRET_HEX`、`DUOWEI_BACKGROUND_JOB_SIGNING_SECRET_HEX`：沿用现有协议密钥，每个至少32字节，十六进制。
- `DUOWEI_EVENT_VERIFICATION_TOKEN`。
- `DUOWEI_RENDER_PAGE_URL`：本 Java 服务 `/openapi/duowei-print/renderer` 的可达地址，建议回环地址。
- `DUOWEI_CHROMIUM_EXECUTABLE_PATH`：可选浏览器路径。

密钥只从环境注入。需 HTTPS 反向代理才能使用 OAuth Secure Cookie。Java 项目需要单独 Java 托管环境，不能直接用 NestJS 构建命令发布。

## 迁移内容

- 模板 Registry 读写、HMAC 鉴权、作用域绑定、敏感数据检查和 PostgreSQL 存储。
- OAuth PKCE、Base 编辑权限核验、作用域会话、写入令牌签发和浏览器桥接。
- Selenium 隔离浏览器渲染、PDF/PNG 产物校验、同版浏览器打印引擎资源。
- 后台任务提交、数据库持久化、单进程 Worker、临时租户令牌、字段核验、附件上传和当前记录回写。
- app_ticket 事件校验和存储、2MB JSON 请求限制、允许来源 CORS。

对外保留 `/api/automation` 和 `/openapi/duowei-print` 路径。后台任务继续要求 `x-duowei-tenant-access-token`，令牌只在内存保留90分钟，不写数据库；服务重启后需重新触发自动化提供凭据。默认 Worker 每2秒扫描，部署限单实例。

## 浏览器资源

资源已随工程生成。仅浏览器端打印引擎保留 JavaScript；业务服务不调用 Node 后台。更新引擎时，在原妙搭工程依赖可用的工作区执行：

```powershell
node backend-java/scripts/build-browser-resources.mjs
```

## 验证状态和差异

当前环境未发现 Java、javac 或 Maven，因此尚未编译、运行 Java 测试或完成真实接口验收。浏览器资源构建及桥接脚本语法检查通过，Java 测试源覆盖签名防篡改与敏感数据拒绝。

上线前必须完成：JDK8编译、Node/Java跨语言签名样例比对、数据库迁移演练、OAuth与模板同步、真实PDF/PNG以及后台任务附件回写验收。当前工程是待验证迁移实现，不能视为已可替代线上服务。

已知行为差异：尚未迁移原服务渲染缓存，重复标准渲染会重新生成；部分错误响应文本/状态与原服务不完全一致；当前数字规范化基于Jackson，浮点数极值签名兼容需要跨语言测试；OAuth state/会话及临时租户令牌为进程内存，多实例需改共享存储；Chrome沙箱需由部署环境支持；现有灰度插件发布不适用于直接托管这个Java服务。本次未发布。
