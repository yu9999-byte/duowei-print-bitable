# 完整验收任务 v1

用户确认后执行，沿用当前迁移Goal，不部署或切换正式后台。

## 本轮冻结基线

2026-10-18，仓库HEAD：74f5f8b68be83c5c9a1a6dc18d9f60f496e57233。启动时JAR SHA256：5E6CD599051CEE020F5F2AABF2350D532B221450F321D48A6CBF96F1AD6148AA。工作区有未提交改动，HEAD不能单独代表当前源码；后续构建产物按独立证据批次记录，不能混用启动时哈希。

## 验收台账

| 编号 | 必验项 | 当前结论 | 下一证据 |
| --- | --- | --- | --- |
| V1-01 | JDK8全量构建与本机数据库/Chrome | 通过：152项，零跳过/失败/错误 | c8c8d166b7194f5db4fcafb6e0a01012轮完整证据 |
| V1-02 | 实际Java监听与浏览器展示原插件 | 未完成 | 实际HTTP、浏览器截图/控制台、宿主限制 |
| V1-03 | 真实数据库迁移/隔离/重连 | 前轮通过，本轮复验 | 当前轮Postgres XML |
| V1-04 | 全部17方法路径双后台对照 | 未完成，仅8个渲染错误案例已对照 | 正常/非法/认证/过期/重复及副作用 |
| V1-05 | 飞书测试宿主完整操作 | 未执行 | 测试应用/表格/用户及真实操作记录 |
| V1-06 | 复杂业务模板PDF/PNG一致性 | 未完成，简单模板Java输出已测 | 两边样本、逐页文字/尺寸/视觉比较 |
| V1-07 | 故障与恢复 | 上传前进程中断通过 | 上传后落库前、回写失败、限流等窗口 |
| V1-08 | 性能/持续运行 | 未执行 | 原后台基线及同负载Java结果 |
| V1-09 | 回退演练 | 文档已设计，演练未执行 | 隔离路由/Worker/在途任务实际演练 |

各项通过范围不能外推。保留失败轮与修复复验轮，使用06-review-and-rollback策略归档。仅所有必验项得到足够证据才输出可进入灰度结论；未取得飞书真实环境不得以模拟替代。

本轮完整证据目录：`C:\codex-tmp\duowei-postgres-runs\c8c8d166b7194f5db4fcafb6e0a01012`。含真实PostgreSQL迁移/重连、JVM中断恢复、Chrome渲染及插件资源两项；Maven verify成功并打包，临时schema清理与实例停止通过。原渲染8例夹具重新生成，桥接VM验证、比较器3项自测及脚本格式检查通过。V1-02仍需真实HTTP及视觉证据，不能以资源处理器测试替代。

## Goal v2启动与HTTP证据

用户确认Goal v2后回读目标工具返回无活动Goal，已新建并核验active，未覆盖或结束其他目标。本验收台账沿用，范围保持全部九阶段。

PluginPreviewHttpTest使用真实Spring Boot嵌入式Tomcat及生产PluginPreviewConfiguration，绑定127.0.0.1随机端口，加载实际record-view/dist构建，HTTP逐字节比较首页和HTML声明的全部入口脚本。2026-10-18 JDK8定向verify成功，连同配置/路径处理两项共3项通过，已打包；Tomcat自动关闭。日志`C:\codex-tmp\duowei-plugin-real-http.log`，测试报告为对应Surefire XML。本轮只启动页面资源配置，排除数据库且不包含完整业务过滤器/Controller，不是整套应用JAR运行证据，不覆盖浏览器挂载和飞书宿主。V1-02部分完成，其他未验项保持原状态；未把该定向轮当作全量153项通过。

### 浏览器挂载失败：真实宿主限制

启用真实Chrome后，原插件首页加载但#app在20秒内没有子元素，挂载断言失败。保存截图确认全白，body文本为空；console明确报错`Uncaught Error: Block client only running in Block host`，来源为原插件SDK入口脚本。另有favicon404，非主因。日志`C:\codex-tmp\duowei-plugin-browser.log`及`duowei-plugin-browser-diagnostic.log`，截图/控制台位于target/plugin-preview-browser。本轮定向测试失败，不能沿用之前HTTP通过宣称浏览器展示通过。

V1-02结论：Java静态托管通过，独立浏览器系统展示不通过，飞书Block宿主展示尚未执行。下一步需要隔离飞书插件宿主进行真实挂载；不通过伪造SDK或删除宿主检查把测试变绿。其他接口、文件和恢复验收仍可独立推进。失败测试保留为实际挂载验收门槛。

### V1-07 崩溃窗口风险实测

PostgresProcessRecoveryTest增加三个参数窗口：render（上传前）、uploaded（上传替身已记录副作用但调用尚未返回）、written（成功回写替身已记录副作用但数据库尚未succeed）。均使用真实PostgreSQL和独立子JVM强制终止/重启，外部飞书及渲染为受控替身。三个案例和Repository集成共4项定向verify通过，零跳过/失败/错误；这表示风险被成功复现，不能写成业务“恰好一次”验收通过。

结果：render窗口上传1次，uploaded/written窗口均上传2次；同任务数据库1行、最终succeeded、attempt=2。written窗口首次已发出生成成功，恢复又发生成中→生成成功。新JVM无凭证时不执行，提交新凭证后才恢复。证据目录`C:\codex-tmp\duowei-postgres-runs\834ed5d86ee94204918cb8668f0d9d78`含三组子进程检查点、状态序列、上传计数和数据库报告；schema清理、实例停止确认。

原background-job.ts的process顺序同为render→uploadArtifact→updateRecord→store.save(succeeded)，恢复processing会重新render/upload，静态代码证据显示原实现具有同类窗口，但未在本轮对原后台实际进程做故障注入。因此Java风险实测与原代码规则一致，不能扩大成原正式环境已复现。风险编号R-01：重复媒体上传/短暂状态回退。尚未实际验证飞书是否保留孤立媒体或可安全清理，不自动删除附件，不自动重放正式任务。

改进候选：上传token落库检查点可减少已收到token后的重复上传，但不能消除“飞书已接收、响应尚未返回”窗口。完全保证需要外部幂等支持或可核对的恢复协议，不能通过本地事务承诺。灰度前需确定可接受的至少一次语义和核对/补偿流程，或完成专门设计与复验；当前不满足无未解决风险准入条件。

### V1-04 注册表原实现响应对照

generate-registry-contracts.mjs通过原template-registry-service.ts实际handler生成7个案例：缺签名、缺作用域、数组作用域、空租户、未知操作、缺模板选择、空修订。OriginalRegistryContractTest执行真实Java Controller/RegistryService并核对状态、完整JSON（仅移除顶层traceId）和trace头关联，仓储为不允许访问的替身。

初测read-missing-scope原返回401，Java400；原handler按错误消息中的“作用域”归类为AUTH_INVALID。已保持原校验顺序（先作用域再operation再selection）、原文案及错误分类。修复后OriginalRegistryContractTest、RegistryContractTest、RegistryServiceTest定向verify成功并打包。日志`C:\codex-tmp\duowei-registry-before.log`及`duowei-registry-after.log`保留失败和复验。该修复仅证明已覆盖错误分支，不证明正常写入或17条路由全部对照通过；浏览器宿主挂载失败仍保留，未运行全量测试掩盖该失败。

### 正常签名链路与trace修复

注册表原handler案例扩展至10个，新增有效签名list空列表、get未命中null、写入204。固定零字节测试密钥与测试专用有效期，只用于本地夹具，非正式密钥策略。两端核对仓储是否执行对应方法；Java还核对参数，非法请求不触及仓储。原handler签名实际验证，Java通过实际RegistryService与RequestPolicy（仓储仍为替身）。

接入RequestPolicy后初测发现错误响应body.traceId与响应头首值不同：过滤器先setHeader、MVC再addHeader造成重复trace。RequestPolicy现包装响应，仅对x-duowei-trace-id的addHeader改为setHeader，其他多值头保留。回归核对trace只出现一次及body关联，避免把独立Controller测试当作完整过滤链证据。首次成功链路日志`C:\codex-tmp\duowei-registry-success.log`保留该失败；后续修正测试对204空body的处理，最终日志为`duowei-registry-success-final.log`。定向测试覆盖OriginalRegistryContractTest、RegistryContractTest、RegistryServiceTest、RequestPolicyTest、RequestErrorContractTest；不是全量或真实数据库/飞书对照。

### V1-02 完整应用独立进程启动

FullApplicationProcessTest在独立JDK8子JVM启动生产PrintApplication，明确从classpath去除target/test-classes，防止页面测试配置被组件扫描。使用完整生产Controller/Service/RequestPolicy与本地虚拟配置，绑定127.0.0.1随机端口。实测health=200、protocolVersion=1；原record-view/dist首页HTTP200并逐字节一致；匿名renderer=401、正确测试Bearer renderer=200且包含打印引擎。结束后销毁并等待准确子进程退出。

本轮JDK8定向verify通过（1项，零跳过/失败/错误），并打包。日志`C:\codex-tmp\duowei-full-application.log`，子进程应用日志和result.txt在target/full-application下独立UUID目录。数据库故意指向不可用本地端口，因此只证明完整进程启动和无数据库HTTP行为，不证明数据库业务。使用编译类+运行依赖启动生产主类，尚非java -jar包装启动的证据。原插件独立浏览器仍因Block宿主限制无法挂载，本证据不撤销该失败。

### V1-02 JAR交付包独立启动复验

FullApplicationProcessTest新增可选duowei.test.packagedJar参数：指定时直接用JDK8的java -jar启动现有文件，默认仍测试生产主类。先执行spotless:apply package -DskipTests生成交付包，再执行定向verify，避免测试时引用尚未生成的JAR。实测1项通过、零跳过/失败/错误，result.txt明确记录launch-mode: java -jar。health200、protocolVersion=1；原插件首页200且字节一致；匿名renderer401、测试Bearer renderer200。子进程已退出。

日志：C:\codex-tmp\duowei-jar-build.log及C:\codex-tmp\duowei-packaged-application.log。本轮交付包SHA256为39AC7A2ED453DA8A18C00E77F4EC03AA8045B8F58810EBA01839D8498578B7F0。数据库仍是故意不可用的本地端口，故此轮不证明数据库业务或真实飞书宿主展示；保留既有浏览器挂载失败与R-01风险。未据此宣布全量验收完成。

### V1-03/V1-04 JAR与真实PostgreSQL的HTTP联测

FullApplicationProcessTest启用DUOWEI_TEST_POSTGRES_URL时创建随机schema、执行两份原始迁移，再把currentSchema连接参数传给独立java -jar进程。使用原handler生成的有效签名夹具，通过实际/api/automation/registry执行空列表读取、两次相同模板写入、SQL核查只有1行；停止并等待原JVM退出，再启动同一JAR，真实HTTP读取仍保留原模板名称。此轮没有mock仓储或过滤器。新增7个原错误夹具逐一核对实际HTTP状态、完整JSON（仅移除traceId）和唯一trace头与body关联。

第一轮联测目录C:\codex-tmp\duowei-postgres-runs\0f9f97eaafc4460b8fdd19f9472c76f9通过；第二轮7c9bc0ccc429492ea1168c08210654a6验证脚本先打包再测试及复制进程证据。最后冻结JAR和补充错误分支轮以本节后续结果为准。verify-local-postgres.ps1现先打包、复制tested-backend.jar并记录SHA256，再以该不可覆盖路径启动，避免后续verify重新打包造成被测包混淆。脚本还保存完整应用首次及重启日志；各独立目录不覆盖历史失败证据。定向运行仅以明确列出的三份测试类报告判定，不把surefire-reports目录残留旧报告当成全量回归。

范围限制：仅本机隔离PostgreSQL16.15和注册表这一路径；不是17条路由全验，不证明飞书OAuth/自动化/附件回写。R-01与Block宿主挂载限制继续保留。

冻结包复验结果：目录C:\codex-tmp\duowei-postgres-runs\2bdf44d6eedc4b6eb35ca99635105bfc，3个测试类共5项通过、零跳过/失败/错误（Repository1、三个崩溃窗口3、完整JAR进程HTTP1）。tested-backend.jar的SHA256复核为39AC7A2ED453DA8A18C00E77F4EC03AA8045B8F58810EBA01839D8498578B7F0，与tested-jar.sha256一致。完整进程日志、重启日志、database-result.txt、result.txt已随脚本复制；临时schema数量为0且实例停止成功。崩溃窗口测试通过代表再次复现R-01，不表示该风险已解决。未执行全量浏览器回归，不改变原插件独立Chrome挂载失败结论。

### V1-04 事件入口原实现对照及Unicode空白修复

generate-event-contracts.mjs打包并执行原feishu-app-ticket.ts实际handler，生成18个案例，覆盖非对象、加密事件、缺失/错误/数字token、挑战原文/空字符串、忽略事件、外应用、空/数字ticket、Unicode空白及前后Unicode空白、有效ticket和重复投递。原store替身记录每次save的ticket，Java OriginalEventContractTest经真实Controller、EventService及RequestPolicy比较HTTP状态/完整JSON/保存参数，仓储为替身。

新增Unicode案例前16例通过；补充后复现原实现返回400、Java200的差异（unicode-blank-ticket）。根因Java String.trim不覆盖ECMAScript String.trim的NBSP/BOM等空白。仅在EventService对app_ticket采用与原规则一致的边缘空白删除，校验及保存均使用同一归一化结果。未修改其他签名或输入归一化规则。失败日志C:\codex-tmp\duowei-original-event-unicode-before.log及对应失败XML已归档；修复后日志duowei-original-event-unicode-after.log，OriginalEventContractTest及EventServiceTest共9项定向verify通过、零跳过/失败/错误，18例逐项一致。该轮是本地处理链及仓储替身，不等于飞书实际投递。

FullApplicationProcessTest同步增加18例实际HTTP事件请求和真实PostgreSQL ticket断言：非法/忽略请求在首条有效事件前不产生行，有效事件去除边缘空白、重复投递仍只有同app一行。以冻结JAR运行的数据库复验结果见后续记录；不以单元测试通过代替该结果。

事件真实HTTP与PostgreSQL复验通过：证据目录C:\codex-tmp\duowei-postgres-runs\90ef9b731f7d499fa91f1d7dacef2771，三类共5项、零跳过/失败/错误；18个原事件案例实际HTTP响应一致，ticket落库及重复投递行数核对通过。被测tested-backend.jar SHA256=3267D0B42A24AF0BC4BDDC564B197BD4D887D99996BD671D746FEAD845CA6615。模板重启保留和崩溃窗口复验同时执行；后者仍保留R-01重复上传风险。临时schema清理和实例停止成功。该轮不是全量回归，飞书真实投递/宿主展示仍未验证。

### V1-04 后台任务原实现对照与错误协议修复

generate-background-contracts.mjs打包原background-job-service.ts与background-job.ts，直接执行原handler及原内存仓储。28例包括空/非对象请求、版本/任务键/输出/作用域/字段配置/额外属性/产物键错误，缺签名/坏签名/过期/任务键或body摘要不符，以及新建和queued/processing/succeeded/failed已有任务五组响应。测试签名为零字节测试密钥、测试长有效期，不改变正式签名策略。

初测空请求原返回“后台任务版本无效”，Java先校验taskKey导致文案不同，失败日志duowei-original-background-before.log与XML已归档。修复BackgroundService按原校验顺序及中文字段标签归一化请求；字段重复、输出不匹配、额外属性等错误使用原文案。Controller允许JsonNode进入业务校验，使null/数组/数字请求返回原JOB_INVALID对象错误。后台签名专用验证保留HMAC/版本/受众/有效期/任务键/摘要校验，并分别返回原无效/过期/任务键不符/内容不符文案；其他协议的通用验证不改变。事件与任务边缘空白规则复用此前经原实现验证的ECMAScript trim工具。

OriginalBackgroundContractTest经过实际Controller、BackgroundService、RequestPolicy；仓储替身控制既有状态，recoverable为空，飞书/渲染替身不产生外部调用。核对状态、完整JSON（仅删除traceId）、唯一trace头关联及拒绝请求不接触仓储。28例一致，连同BackgroundValidationTest、BackgroundRouteTest、OriginalEventContractTest、EventServiceTest、ProtocolTest共28项定向verify成功，零跳过/失败/错误，日志C:\codex-tmp\duowei-original-background-final.log。已有状态响应经仓储替身控制，不是完整Worker成功链路证明；并发、真实飞书仍待验。异常签名格式的所有畸形变体不在本轮覆盖范围，不能宣称协议完全等价。

FullApplicationProcessTest另增加其中23个拒绝案例，通过冻结JAR的实际HTTP入口比较状态/JSON，并在每次请求后检查真实PostgreSQL任务表仍为0行；不提交有效任务触发外部平台调用。数据库轮最终结果见后续记录。

后台任务实际HTTP拒绝轮完成：C:\codex-tmp\duowei-postgres-runs\820d2fe971b94d7f81d6ec80f0fb55e6。冻结JAR SHA256=8F6F468D5CEC0B91DEC669777A02288174A8CD1F2F89F92321DEA96E87ACA347。23个拒绝案例实际HTTP状态/JSON与原实现一致，真实任务表逐项核对为0行；18个事件案例、模板重复写入/重启保留同时通过。数据库3类共5项零跳过/失败/错误，schema清理及实例停止成功。R-01三个崩溃窗口再次复验，重复上传风险仍未关闭。正常任务状态的五组响应仍是控制仓储替身的本地契约证据，不是完整实际HTTP任务生成成功验收。

关联复验：BackgroundProcessingTest、BackgroundRepositoryTest、OriginalRegistryContractTest、OriginalRenderContractTest定向verify成功，日志C:\codex-tmp\duowei-background-regression.log；用于检查任务处理与注册表/渲染错误契约未因本轮归一化及签名修改回退，不替代真实平台与复杂模板验收。
