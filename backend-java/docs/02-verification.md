# 验证记录

更新日期：2026-10-18（北京时间）。Goal仍在进行，完整迁移验收尚未完成。历史故障和修复见[验证历史](03-verification-history.md)。

## 1. 构建基线

- Zulu OpenJDK 1.8.0_452、Maven 3.9.9、Spring Boot 2.7.18。
- 从仓库根执行：`mvn -f backend-java/pom.xml -B spotless:apply clean verify`；真实浏览器需下节的环境变量和驱动参数。
- 最近完整结果：150项全部通过，零跳过、零失败、零错误；包含真实PostgreSQL16.15、JVM强制中断恢复及Chrome两项，JDK8格式检查、编译和打包成功。
- JAR：`backend-java/target/print-backend-1.0.0.jar`。
- 完整构建日志：`C:\codex-tmp\duowei-java-final-verify.log`，逐项报告：`backend-java/target/surefire-reports`。

## 2. 真实浏览器证据

使用Chrome 155及匹配ChromeDriver 155.0.8059.84。显式设置`DUOWEI_TEST_REAL_BROWSER=true`、`DUOWEI_CHROMIUM_EXECUTABLE_PATH`，Maven添加`-Dwebdriver.chrome.driver=驱动完整路径`；默认构建跳过真实浏览器测试。

RealBrowserIntegrationTest的内容测试加载工程内renderer.html：本地HTTP要求服务Bearer，实际打印引擎处理两页有效文本模板。PDF检查文件头、EOF及pageCount=2；PNG经ImageIO解码，检查600×800第一页尺寸；稳定字段order从SO-001改为XXXXXXXX后像素变化超过20个。输出位于target/real-browser.pdf及target/real-browser.png。该证据不覆盖所有图片、复杂表格、字体和分页视觉结果。

生命周期测试使用真实Chrome及本地可控页面：通知已进入永不完成的Promise后，触发8秒测试超时；确认ChromeDriver会话关闭，同artifactKey可新建会话重试并正常关闭。重试页面返回合成最小协议响应，仅验证生命周期，PDF内容由上面的独立测试验证。Windows另记录goog:processID并用tasklist按精确PID检查超时及正常退出后的Chrome主进程；此检查不证明所有后代进程均退出，其他系统跳过该PID检查。

曾出现两页PDF变一页及PNG变量无像素差异，最终捕获Vue错误为测试元素缺少style导致zIndex访问失败。补齐有效style后强断言通过，移除了临时依赖补丁、headless入口和诊断，恢复原浏览器资源入口。原后台未修改。

## 3. 业务测试范围

| 范围 | 已有证据 | 未覆盖的真实环境 |
| --- | --- | --- |
| 签名 | Node生成数值/对象canonical和SHA256向量、HMAC向量、篡改/版本/时间/作用域拒绝 | 向量不能穷举所有JSON输入 |
| OAuth | PKCE、state单次消费、取消优先、严格权限布尔值、有效期、会话复用/隔离、桥接303、错误码/trace/安全响应头 | 真实飞书授权及窗口交互 |
| 模板 | upsert参数、联合键SQL、ready列表、作用域/修订读取、行校验、原字符串保留 | 真实PostgreSQL往返 |
| 渲染 | 规范化、签名、协议、二进制响应、缓存合并、模拟生命周期及真实浏览器证据 | 全部复杂模板与所有系统进程清理 |
| 后台任务 | 提交规范化、幂等/失败重试、立即调度、恢复行校验、凭证过期、状态回写、原样字段名、上传20MiB边界 | 真实数据库和飞书、进程重启恢复 |
| 飞书HTTP | 真实本地HTTP测试URL编码、Bearer、中文JSON、multipart边界/文件名/MIME/字节 | 真实飞书接口 |
| app_ticket/商店令牌 | challenge、token/app_id校验、ticket存取模拟、跨租户缓存与提前刷新 | 真实事件投递/持久化及令牌交换 |
| 桥接脚本 | 原后台生成脚本逐字一致；Node VM验证来源/窗口/版本、同步、脱敏、OAuth恢复、过期状态与跳转限制 | 真实popup/第三方Cookie交互 |
| 请求策略 | 来源、JSON/方法/内容类型、2MiB上限、trace和错误脱敏 | 实际反向代理/托管鉴权 |

接口见[HTTP清单](04-api-contracts.md)，原模块与测试映射见[迁移对照](01-migration-matrix.md)。17个业务方法路径均有映射，不代表所有平台外围能力均等价。

## 4. 数据库测试与启动检查

PostgresIntegrationTest仅在`DUOWEI_TEST_POSTGRES_URL`显式配置时运行，账号变量为`DUOWEI_TEST_POSTGRES_USERNAME`、`DUOWEI_TEST_POSTGRES_PASSWORD`。要求授权专用测试库和CREATE SCHEMA权限。创建随机schema，执行两份真实迁移，验证模板upsert/read、任务失败重试/成功幂等及ticket覆盖，finally清理自己创建的schema。当前未执行，不能计为数据库验证通过；不自动使用应用数据库变量。

最近JAR启动检查：JDK8、端口18089、本地虚拟凭据及不可用本地数据库。health=200且protocolVersion=1；匿名renderer=401，正确Bearer访问renderer=200（1427950字节）；event challenge=200并原样返回smoke。完成后停止测试Java进程。该检查只证明应用启动和无数据库HTTP行为。

## 5. 剩余验收与边界

1. 本机PostgreSQL迁移/Repository/重连已通过；仍需真实Java进程重启Worker恢复及目标部署数据库版本验收。
2. 飞书测试环境授权、字段分页、附件上传及记录回写。
3. 复杂模板、图片/表格/字体、浏览器桥接窗口交互和所有子进程清理。
4. 继续逐项审计原测试断言和托管外围适配；SPA托管与平台信息注入继续由原工程承担，Nest平台BusinessException全局外形尚未证明完全等价。

原后台保留，不部署、不切换线上后台、不自动提交或推送。自动同步产生的Git提交不代表本任务执行了提交。
## 6. 进程检查发现的缺陷与修复验证

新增精确PID检查后，曾复现超时后sessionId为null但Chrome主进程仍存活；先前会话测试不足以证明进程清理。清除中断后直接quit又可能等挂起脚本结束。RenderService取消路径现通过驱动返回的goog:processID终止自己启动的浏览器，Windows使用taskkill /PID /T /F，其他系统使用kill -TERM；之后清除中断执行quit并恢复线程中断状态。finally在中断时同样终止浏览器，且在完成quit后才移除active映射，避免取消遗漏启动后的驱动。进程终止调用失败仍尝试WebDriver关闭。只对本服务创建的驱动PID操作。

修复后本机Windows主进程退出测试及JDK8完整verify通过：146项中145项通过、1项数据库跳过，真实浏览器2项通过，git diff --check通过。其他系统进程终止及所有后代进程仍未直接验证。

## 7. 渲染错误分类复核

原renderer-service直接使用渲染异常消息判断超时并返回504。Java RenderCache原先将执行异常统一包装为“生成文件失败”，会丢失渲染器自身的超时消息而返回502。现保留非空原异常消息，控制器继续统一脱敏；无消息异常仍返回通用错误。RenderCacheTest增加超时消息及原因保留断言。修复后再次执行JDK8完整verify：147项中146项通过，1项数据库测试跳过，真实Chrome两项通过，格式检查和JAR打包成功。脚本格式检查及桥接VM验证亦通过。

## 8. 共享任务超时复核

原实现为每次新渲染创建一个Promise.race，所有同键请求共用截止时间。Java原先每次task.get都重新等待完整超时。现RenderTask记录单调时钟起点，后续等待仅使用剩余时间；已完成产物仍可命中缓存。新增测试先中断首个HTTP等待者，保留渲染任务，延迟加入第二个等待者，验证其按原截止时间超时、没有重启渲染并调用取消。完整verify通过148项中的147项（数据库1项跳过），包括真实Chrome两项。随后将移除旧任务、取消浏览器与新任务插入置于同一生命周期锁，避免旧任务取消误伤同键重试；针对缓存/超时测试再次执行verify并打包成功。完整日志与定向日志分别为duowei-java-final-verify.log、duowei-java-cache-verify.log。

## 9. 自建隔离数据库与原后台响应对照

2026-10-18通过verify-local-postgres.ps1创建随机独立目录/密码/端口的PostgreSQL16.15，仅监听127.0.0.1。实际执行两份迁移和模板版本/ready过滤/租户隔离、任务幂等/失败重试、ticket覆盖及销毁连接后重新读取的断言，确认无临时schema残留并停止实例。首次数据库单独测试通过后，与真实Chrome一起执行完整verify，149项全部通过，零跳过/失败/错误。完整日志、数据库XML、全套Surefire报告和停止日志位于`C:\codex-tmp\duowei-postgres-runs\ba2f8120a1f74f57a7d0c6cf7027ec04`。此证据不替代进程重启Worker或正式数据库兼容验收。

OriginalRenderContractTest新增原renderer-service.ts实际HTTP handler生成的8个错误响应案例，对比Java控制器/请求Service状态、JSON及trace关联。初测发现类型/页数/必填标签文案不同，已修复并复验通过。只忽略随机traceId，仍验证同侧响应头关联。生成命令为`node backend-java/scripts/generate-render-contracts.mjs`。不依赖真实飞书，不代表原托管平台代理层已验收。

## 10. JVM强制中断与Worker恢复

2026-10-18新增PostgresProcessRecoveryTest：子JVM实际Worker将任务推进processing/attempt=1，阻塞于渲染替身后强制终止；第二个独立JVM启动后无凭证不调用飞书/渲染、attempt不变，重新通过submit注入有效签名及测试临时凭证后成功。数据库同任务仅1行，attempt=2、file_token持久化；测试上传仅1次，状态序列首次等待生成→生成中、恢复生成中→生成成功。该凭证等待规则与原BackgroundAutomationService一致。

完整verify为150项全通过，无跳过/失败/错误，含真实Chrome。证据目录`C:\codex-tmp\duowei-postgres-runs\5008f78acf57402fa6a64f2db1a034b9`包含全套Surefire、process-recovery子JVM日志和检查点、数据库启动/停止日志；schema清理和实例停止通过。飞书和渲染在本专项使用测试替身，不等于真实外部业务恢复；尚未验证上传完成后、成功落库前崩溃窗口的副作用，不能承诺任意时点恰好一次上传。详情见06回顾台账。
