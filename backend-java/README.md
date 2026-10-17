# Java 后台（JDK 8）

来源：妙搭后台 `miaoda-duowei-automation/server`。原代码保留，当前未部署、未切换插件。

## 1. 架构与目录

Spring Boot 2.7.18、Maven、JDK 8、PostgreSQL、Selenium 4.8.3。

| 目录 | 职责 |
| --- | --- |
| `src/main/java/com/duowei/print/controller` | HTTP路由、协议适配 |
| `config` | 配置校验、请求策略与CORS |
| `service` | 模板、OAuth、渲染、后台任务、事件业务 |
| `repository` | 模板、后台任务、app_ticket数据库访问 |
| `integration/feishu` | 飞书HTTP适配 |
| `security`、`exception` | 签名、数据校验、异常脱敏 |
| `src/main/resources` | 应用配置和浏览器打印资源 |
| `src/test/java` | 配置、签名、缓存、接口契约测试 |
| `migrations` | 与原服务兼容的数据库脚本 |
| `docs` | 功能对照、验证证据 |
| `scripts` | 浏览器资源构建 |

## 2. 环境配置

数据库：`DUOWEI_DATABASE_URL`（JDBC PostgreSQL URL）、`DUOWEI_DATABASE_USERNAME`、`DUOWEI_DATABASE_PASSWORD`。

业务：`DUOWEI_PUBLIC_AUTOMATION_BASE_URL`（HTTPS，结尾`/openapi/duowei-print`）、`DUOWEI_OAUTH_REDIRECT_URI`、`DUOWEI_ALLOWED_ORIGINS`、`DUOWEI_FEISHU_APP_ID`、`DUOWEI_FEISHU_APP_SECRET`、`DUOWEI_SERVICE_AUTHORIZATION`（Bearer）、`DUOWEI_EVENT_VERIFICATION_TOKEN`。

签名：`DUOWEI_REGISTRY_WRITE_SIGNING_SECRET_HEX`、`DUOWEI_REGISTRY_READ_SIGNING_SECRET_HEX`、`DUOWEI_RENDERER_SIGNING_SECRET_HEX`、`DUOWEI_BACKGROUND_JOB_SIGNING_SECRET_HEX`，每个至少32字节十六进制，沿用原协议密钥。

运行：`PORT`默认8080；`DUOWEI_BACKGROUND_WORKER_INTERVAL_MS`默认2000；`DUOWEI_RENDER_PAGE_URL`指向渲染器页面；`DUOWEI_CHROMIUM_EXECUTABLE_PATH`可选。准备Chrome/Chromium和匹配的ChromeDriver，将驱动加入PATH或使用`-Dwebdriver.chrome.driver=路径`。

## 3. 构建与测试

```powershell
mvn spotless:apply
mvn clean verify
java -jar target/print-backend-1.0.0.jar
```

Spotless以AOSP四空格规范统一Java格式，构建自动检查。数据库迁移由运维显式执行，不自动改动现有数据库。

## 4. 浏览器资源

PDF/PNG使用原前端打印引擎；Java业务服务不调用原Node后台。资源更新：

```powershell
node backend-java/scripts/build-browser-resources.mjs
```

该构建脚本需要原妙搭工程已安装依赖；生成资源已随工程保存。

## 5. 验证与迁移状态

2026-10-17已用真实OpenJDK 8u452和Maven 3.9.9完成格式检查、编译、117项测试及打包，零失败、零错误；JAR在18081端口启动，健康接口返回成功，桥接页面HTTP 200。启动检查使用虚拟数据库地址，只证明应用启动和无数据库接口，未证明数据库业务链路。

功能映射见[迁移对照](docs/01-migration-matrix.md)，当前验收见[验证记录](docs/02-verification.md)，历次证据见[验证历史](docs/03-verification-history.md)。功能兼容核对仍在进行，不能将当前构建通过视为迁移全部完成。

## 6. 部署边界

HTTPS代理负责TLS。OAuth会话和临时租户凭证在进程内存，当前限单实例；重启后需重新连接或触发自动化。Java需要独立运行环境，不直接复用NestJS托管命令。真实飞书授权、PostgreSQL、PDF/PNG及附件回写尚需完整验收。本次不发布、不切换线上后台。

HTTP路径及认证映射见[接口清单](docs/04-api-contracts.md)。

协议测试向量从仓库根目录执行 node backend-java/scripts/generate-protocol-vectors.mjs 重新生成。仅测试开发需要Node，Java后台运行不依赖Node。
