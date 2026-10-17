# 验证记录

更新日期：2026-10-17（北京时间）。Goal仍在进行，完整迁移验收尚未完成。

## 1. 当前构建结果

- JDK：Zulu OpenJDK 1.8.0_452。
- Maven：3.9.9。
- 从仓库根目录执行：`mvn -f backend-java/pom.xml -B spotless:apply clean verify`。
- 最新结果：共127项，126项通过，1项PostgreSQL集成测试因未配置测试库跳过，零失败、零错误；Java格式检查、编译和打包成功。
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
| 渲染协议 | 规范化后验签；拒绝类型空格、小数页数；接受数值pageLimit=1.0；返回协议版本、数组及整数页数回归测试 | 真实Chrome已生成单页PDF/PNG；复杂模板仍需验收 |
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

本机PATH未发现postgres、psql或docker，常规PostgreSQL安装目录不存在。已在C:\codex-tmp安装ChromeDriver 155.0.8059.84，通过显式路径调用Chrome 155。外部环境不足与实现缺陷分别记录，不以模拟测试冒充真实验收。

## 4. 操作边界

原后台保留。不部署、不切换线上后台、不自动提交或推送。工作区若出现自动同步提交，不代表本任务执行了Git提交。

## 5. 历史记录

逐次修复、测试与构建证据见[验证与修复历史](03-verification-history.md)。

PostgreSQL集成测试：PostgresIntegrationTest仅在DUOWEI_TEST_POSTGRES_URL显式配置时执行，账号变量为DUOWEI_TEST_POSTGRES_USERNAME与DUOWEI_TEST_POSTGRES_PASSWORD。连接必须指向授权的专用测试库，需CREATE SCHEMA权限。测试创建随机schema、执行两份真实迁移、验证模板upsert/read、任务失败重试/成功幂等和ticket覆盖，finally删除该临时schema；不读取应用数据库变量。当前未执行，不能计为数据库验证通过。

## 6. 最新JAR启动检查

2026-10-17，使用JDK8运行最新JAR，端口18089，本地测试凭据及不可用的本地数据库地址。真实HTTP结果：health=200且protocolVersion=1；匿名renderer=401；正确服务Bearer访问renderer=200（1427950字节）；event challenge=200并原样返回smoke。检查后已停止本次Java进程。该检查不证明数据库连通、实际Chrome渲染或飞书联调成功。

## 7. 真实浏览器集成验证

RealBrowserIntegrationTest使用真实Chrome、匹配ChromeDriver及本地HTTP服务加载随工程保存的renderer.html，校验服务Bearer访问并分别导出PDF和PNG。已生成target/real-browser.pdf及target/real-browser.png；PDF检查协议、文件头、EOF和单页数，PNG由ImageIO实际解码并检查600×800像素。测试模板为空白单页，不代表复杂模板、字体、图片、变量及分页视觉结果验收。

设置DUOWEI_TEST_REAL_BROWSER=true、DUOWEI_CHROMIUM_EXECUTABLE_PATH为Chrome路径，Maven附加-Dwebdriver.chrome.driver=驱动完整路径即可执行。pom.xml通过selenium.version统一所有Selenium组件为4.8.3，避免Spring Boot将传递组件降为4.1.4导致真实浏览器连接失败。浏览器测试默认跳过；上述127项结果为显式启用浏览器后的构建，唯一跳过项是PostgreSQL测试。