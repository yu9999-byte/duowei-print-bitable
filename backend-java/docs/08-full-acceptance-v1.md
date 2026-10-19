# 完整验收任务 v1

用户确认后执行，沿用当前迁移Goal，不部署或切换正式后台。

## 本轮冻结基线

2026-10-18，仓库HEAD：74f5f8b68be83c5c9a1a6dc18d9f60f496e57233。启动时JAR SHA256：5E6CD599051CEE020F5F2AABF2350D532B221450F321D48A6CBF96F1AD6148AA。工作区有未提交改动，HEAD不能单独代表当前源码；后续构建产物按独立证据批次记录，不能混用启动时哈希。

## 验收台账

| 编号 | 必验项 | 当前结论 | 下一证据 |
| --- | --- | --- | --- |
| V1-01 | JDK8全量构建与本机数据库/Chrome | 当前完整回归未通过：163项、1宿主挂载错误；后续锁修改仅定向复验 | 最新生产修改后完整回归；历史152项不代表现状 |
| V1-02 | 实际Java监听与浏览器展示原插件 | 未完成 | 实际HTTP、浏览器截图/控制台、宿主限制 |
| V1-03 | 真实数据库迁移/隔离/重连 | 前轮通过，本轮复验 | 当前轮Postgres XML |
| V1-04 | 全部17方法路径双后台对照 | 部分完成，原handler及独立JAR证据见09路由索引 | 真实平台成功分支及原实例完整HTTP对照 |
| V1-05 | 飞书测试宿主完整操作 | 未执行 | 测试应用/表格/用户及真实操作记录 |
| V1-06 | 复杂业务模板PDF/PNG一致性 | 未完成，简单模板Java输出已测 | 两边样本、逐页文字/尺寸/视觉比较 |
| V1-07 | 故障与恢复 | 三崩溃窗口已测；R-01重复上传、R-03锁丢失重叠未解决 | 外部副作用恢复策略、限流与完整业务复验 |
| V1-08 | 性能/持续运行 | 同模板基线已测，Java较慢；40次连续渲染通过，非长期验收 | R-02优化及长时资源/负载验证 |
| V1-09 | 回退演练 | 数据库pg_dump/pg_restore通过；服务回退未执行 | 隔离路由/Worker/在途任务实际演练 |

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

### V1-07 并发重复提交专项

原background-job handler与原内存仓储新增三轮并发基线（新任务、已有failed、已有succeeded），每轮8个请求。人为设置读取屏障，使8个existing查询都先完成，再放行创建；屏障不替换原createOrGet逻辑。原结果保存background-concurrency.json：新任务8次202/reused=false，失败重试8次200/reused=true且queued，成功任务8次200/reused=true且succeeded。此处原内存仓储不等于原正式Drizzle实例；原Drizzle代码另核查存在先get再insert的模式，未做原正式数据库并发实测。

PostgresConcurrencyTest使用8个调用线程、真实PostgreSQL独立连接、实际BackgroundService与Repository SQL，仅覆写exists以在实际SELECT后设置相同读取屏障。停止该测试service的Worker以隔离提交行为，不执行渲染/飞书调用；测试明确不证明正在运行的完整JAR或多Worker消费幂等。每轮核对8个响应状态/完整body去trace后的内容及trace关联、任务总行数1、attempt=0；失败任务重试成为queued，成功任务保持succeeded及原附件token。凭据仅本地虚构，不调用平台。测试产物在target/concurrency独立UUID目录，runner复制到数据库轮目录。

并发语义注意：同一新任务的同时到达请求可能全部返回202/reused=false，因为该标志来自写入前查询。原handler与本轮Java观察相同；不能据此承诺“同时提交仅有一个202”，也不能仅凭响应判定任务是否重复，需核对taskKey与数据库行。唯一任务行不等于外部副作用恰好一次，R-01仍保留。最终数据库轮结果见后续记录。

并发专项数据库轮完成：C:\codex-tmp\duowei-postgres-runs\153efb16a7fa4b37acffb4adbf41a068，四类共6项、零跳过/失败/错误，三轮共24个并发提交响应与原基线一致且均只保留1行；成功任务附件token不变。JAR HTTP、Repository及三个崩溃窗口同时复验；R-01风险复现结果不作为风险关闭。冻结JAR SHA256=8F6F468D5CEC0B91DEC669777A02288174A8CD1F2F89F92321DEA96E87ACA347。临时schema数量0、PostgreSQL实例停止成功。仅定向回归，不代表真实宿主展示或全量验收通过。

### V1-06 同输入原运行时与Java真实打印对照

render-original-parity.mjs直接打包原createPlaywrightHeadlessRuntime和createHeadlessBrowserRenderer，加载原automation-renderer-entry.ts独立构建的页面，通过本机真实Chrome生成文件。测试为两页合成发货单：中英文字体、订单字段替换、地址换行、六组商品/数量对齐、合计、第二页附件说明。非真实企业模板，不包含图片/条码/复杂表格证明。初次脚本因esbuild未转译装饰器失败（duowei-original-render-parity.log）；显式experimentalDecorators/target后成功，日志duowei-original-render-parity-retry.log；未修改原代码。

RenderParityTest在同一Chrome二进制通过生产Java RenderService/Selenium加载当前Java renderer.html，逐字使用原轮request-pdf.json及request-png.json。校验artifactKey、文件名、contentType、页数完全相同；PNG600×800共480000像素差异0。定向JDK8 verify打包通过，测试1项、零跳过/失败/错误，日志C:\codex-tmp\duowei-java-render-parity.log。

PDF两端均2页、450×600.009pt，经Poppler scale-to800转换每页600×800，逐页像素差异均0；检查原PNG及Java两页版面，标题/动态订单/中文/换行/商品数量/合计与第二页说明无裁切错位。pypdf文本提取均为0：这是引擎导出的栅格PDF，本轮只证明视觉内容及页数一致，不能用两个空文本结果宣称可搜索文本或逐字段语义提取通过。compare-render-parity.py保留可复现比较逻辑。

产物目录target/render-parity/original-runtime，包含两端PDF/PNG、脱敏请求、原构建HTML、元数据、页图、差分图和pdf-comparison.json。与正式宿主、真实复杂模板、签名HTTP渲染链路分开判定；V1-06部分完成，其他缺口不因此关闭。

### 当前累计修改完整回归（真实数据库与Chrome均启用）

执行verify-local-postgres.ps1 -FullSuite，同时开启DUOWEI_TEST_REAL_BROWSER=true及DUOWEI_TEST_RENDER_PARITY_DIRECTORY，使用JDK8、真实Chrome155/驱动155、临时PostgreSQL16.15。运行目录C:\codex-tmp\duowei-postgres-runs\47b62ded695a4fbb9e187328162c5451，冻结被测JAR SHA256=8F6F468D5CEC0B91DEC669777A02288174A8CD1F2F89F92321DEA96E87ACA347。Maven最终汇总与按本轮maven.log创建时间筛选的Surefire XML一致：161项、0 failure、1 error、0 skipped，即160项成功、1项未通过，完整verify失败，不能写成全量通过。打包预备阶段成功，不等于完整验收成功。

唯一error为PluginPreviewHttpTest的实际浏览器挂载等待超时；本轮console再次明确Block client only running in Block host，原页面#app无子元素。这是独立浏览器缺Block宿主的既有失败，不删除或跳过门槛。RealBrowserIntegrationTest、RenderParityTest、真实PostgreSQL/并发/崩溃专项及其余契约回归没有新增失败；该事实仍不关闭各自范围之外的验收缺口。

完整日志、所有报告、页面截图/console、打印与进程证据已复制到本轮目录，test-summary.json由summarize-test-run.py生成并与Maven161项汇总核对。该工具仅按报告修改时间排除旧结果，需始终结合Maven最终汇总判断是否有遗漏，不把旧报告目录本身当作本轮成功。当前失败轮原脚本未自动复制，已手动保存；脚本现补充失败时先保存证据再退出，PowerShell语法解析0错误，该失败分支新增逻辑尚未再次故障注入实测。finally准确停止本轮实例成功，未操作其他数据库。

当前判断：本地累计回归除宿主挂载门槛外未出现新增失败，但完整验收未通过；真实飞书隔离环境/脱敏复杂业务模板、17路由全部正常权限重复对照、压力性能基线及回退演练仍有未完成内容。Goal保持active，不能进入灰度或生产切换。

### V1-08 首轮同输入串行渲染性能基线（发现差异）

render-original-parity.mjs新增可选DUOWEI_RENDER_BENCHMARK_REPETITIONS（1至20），原Playwright每次调用独立启动/关闭浏览器，匹配原BrowserRuntimeService按次启动并closeBrowser的生命周期；先前视觉轮曾复用同一Browser但逐次新Page，该历史事实仅作视觉证据，不用于性能比较。RenderParityTest同参数测实际Java RenderService每次新建/关闭ChromeDriver。双方使用同一Chrome155二进制、同一两页合成发货单、同一字段输入、localhost资源，PDF/PNG各5次串行；计时覆盖browser启动、页面加载、导出及关闭，不覆盖签名HTTP、排队、数据库、飞书或整机资源曲线。

本轮target/render-parity/benchmark-v1：原PDF毫秒[2080.00,2010.65,1979.11,1936.85,1931.81]，Java[4513.81,2568.35,2575.70,3007.95,2761.84]；中位1979.11对2761.84，Java/原=1.3955。原PNG[2117.66,2125.24,2188.58,2114.99,2127.88]，Java[2759.16,2727.33,2651.23,2587.29,2499.31]；中位2125.24对2651.23，Java/原=1.2475。首次PDF额外耗时已保留，不删除首样本美化结果。先原后Java的非交错采样可能受主机负载影响，不能据此定位到Selenium本身或宣称生产延迟相同比例。

风险R-02：本机同输入串行渲染Java观测慢约40%（PDF）/25%（PNG）。未设置事后放宽的准入阈值，也未将此项判通过。后续需交错/更大样本、稳定主机资源和阶段耗时定位，再决定修复与复验。长时稳定性、并发吞吐和真实业务性能仍NOT_RUN。本轮JDK8 RenderParityTest verify通过（1项、零跳过/失败/错误），表示文件及测量路径可用，不代表性能验收通过。末次PNG及PDF两页Poppler像素差异仍为0；PDF栅格文本提取0的限制保留。

日志C:\codex-tmp\duowei-original-benchmark.log与duowei-java-benchmark.log；原始毫秒样本、benchmark-summary.json及PDF/PNG在该目录，summarize-render-benchmark.py可重新生成统计。没有修改生产渲染策略，没有发布/提交或连接正式数据。

### R-02 第二轮Java阶段计时

RenderParityTest仅在测试子类覆写createDriver，记录实际ChromeDriver构造时间，不修改生产RenderService。重新各5次：PDF总中位2547.67ms、driver启动中位1166.02ms、扣除启动后中位1383.76ms；PNG总中位2488.96ms、启动1161.65ms、后续1328.45ms。仍与第一轮原基线比较时比值为1.2873/1.1711；原端未在本轮同步重测，不据此宣称优化或性能回归消失。启动占较大比例，但缺原端分阶段数据，不能认定启动是两端差值根因。

本轮1项定向verify成功，PNG像素与元数据仍一致。日志C:\codex-tmp\duowei-java-benchmark-launch.log，含阶段样本的java-timings.json及benchmark-summary.json；首轮Java样本已另存java-timings-first-round.json，历史数值不覆盖。R-02仍开放；下一步需原端同阶段计时和交错采样，长时/资源稳定性仍未验证。

### R-02 原运行时阶段计时与第三轮复验

原脚本在注入browser工厂的chromium.launch前后计时，保持每次浏览器独立启动和关闭，不修改原运行时函数。新目录target/render-parity/benchmark-stages-v1，双方各格式5次且均保留首样本。原PDF总中位2084.85ms、launch333.30ms、扣除launch后1733.73ms；Java2546.84ms、createDriver1159.37ms、后续1388.45ms。原PNG2070.34ms、launch290.95ms、后续1781.29ms；Java2475.45ms、createDriver1155.02ms、后续1311.63ms。总比值1.2216/1.1957。

阶段比较显示Java driver构造比原browser launch多约0.83至0.86秒，而后续组合阶段更快，支持下一步排查驱动服务/会话初始化开销，尚不能细分为驱动服务启动、Chrome启动或握手。双方构造计时边界包含组件不同，该差别本身是实际调用路径的一部分。先原后Java且样本量小，不能作为生产性能结论或优化成功证明。未改变生产策略，R-02保持开放。定向JDK8 verify成功1项、零跳过/失败/错误，两页PDF/第一页PNG像素复验差异0；PDF文本提取0限制保留。

日志C:\codex-tmp\duowei-original-benchmark-stages.log及duowei-java-benchmark-stages.log；原始阶段样本、benchmark-summary.json和视觉对照产物保存在独立目录，没有覆盖前两轮。下一步候选是隔离测量ChromeDriver服务启动与新会话耗时，再决定是否能在保留独立浏览器及超时清理语义下优化；不能直接改为共享Browser掩盖开销。

### R-02 驱动服务与会话进一步拆分

DriverStartupTimingTest在5次独立样本中显式start ChromeDriverService，再new ChromeDriver(service,options)，分别计时；每次查询新会话document.readyState=complete，quit并stop，断言服务不再运行。仅测试诊断，不修改生产创建策略。实测服务启动中位586.05ms、新会话560.97ms、页面就绪探测加退出清理677.17ms。前两阶段合计与前轮createDriver约1.16秒一致。结果说明耗时同时涉及服务与会话，不能只归因Chrome本体或Java计算；清理阶段也不可直接删除，否则改变独立浏览器与资源释放语义。

JDK8定向verify通过1项、零跳过/失败/错误并打包。日志C:\codex-tmp\duowei-driver-startup-timing.log；原始5组阶段值与summary.json在target/driver-timing/4c596b04-c904-4dc6-922c-2b0ce6c350ab。这里只核对驱动服务isRunning=false，未新增浏览器PID级退出证明，不扩大为长时无泄漏结论。R-02继续开放；可探索预启动驱动服务但仍新建独立浏览器的方案，需要验证并发及取消清理后再考虑修改生产实现。

### V1-04 公开注册表入口补验及方向错误文案

FullApplicationProcessTest扩展内外health完整JSON一致、公开registry-read/registry-write承载注册表夹具、方向错误405及数据库行数保护。检查原automation-openapi.controller.ts发现方向错误JSON还包含message，而Java遗漏；已补齐“模板写入入口不允许读取”及“自动化公网入口只允许读取模板”，并增强单元/真实HTTP断言。

第一轮运行目录C:\codex-tmp\duowei-postgres-runs\1f903ec76f1141aabbc041f0bd045619，执行过程中代理修改源码导致最后Spotless检查失败，不能作为通过轮；失败保存逻辑实际执行，verification-status.txt与报告/产物已保存，实例停止成功。此为执行过程错误，后续冻结源码重新执行，不覆盖失败历史。

另有尚待核对的公开分派边界：原isRegistryReadRequest只对operation=list/get返回true，而Java内部read使用has(operation)。本轮公开夹具复用内部handler生成结果，不足以证明未知operation公开行为相同。该边界明确保留为待修差异，不能因公开正常读写通过宣称17路由完全等价。

方向文案补齐后真实JAR/PostgreSQL轮b5c134f2bc2b4a80b6a784bc042f28c1通过（四类6项、零跳过/失败/错误），包括双health、公开读写正常/鉴权和方向错误文案。随后按原isRegistryReadRequest规则修复公开分派为仅list/get识别读取，未知operation在公开read返回405；内部handler仍保留自身错误校验。RegistryContractTest与OriginalRegistryContractTest定向verify共4项通过，日志C:\codex-tmp\duowei-public-registry-boundary.log。该最后分派修改尚未重新执行独立JAR数据库轮，不能沿用上一轮包结果证明修改后实际HTTP通过。

公开分派最后修复已完成独立JAR与真实库复验：C:\codex-tmp\duowei-postgres-runs\b30b37c44b204be3bb29018c32d216b6，冻结JAR SHA256=8D9020D4DFDCF7DFA53BE6983228F1389374F31E851BBD30AAB0D93225572DB3，四类共6项零跳过/失败/错误，公开read未知operation=405 READ_ONLY_ENDPOINT、读写方向文案、双health、持久化重启、并发及崩溃窗口全部按各自断言通过。临时schema清理与实例停止成功。新增09-route-acceptance-status.md逐条列出17方法路径最强证据及剩余缺口，避免把局部通过当成全部接口验收。R-01与R-02未关闭，真实宿主/平台链路仍未验证。

### V1-09 隔离数据库逻辑恢复演练通过

verify-local-postgres.ps1新增备份恢复阶段，运行目录C:\codex-tmp\duowei-postgres-runs\5cbb134bbfb44c8fb1eba33b3d793a37。四类6项定向数据库/JAR/并发/崩溃测试通过后，创建演练schema、应用原两份迁移、写入合成模板1行、queued/processing/succeeded任务3行及虚构ticket1行；实际pg_dump自定义格式备份，恢复到同一独立实例的另一个新建库duowei_restore。比较稳定排序的三表完整JSON，包含时间戳/任务状态/attempt/submission/file_token/ticket，两端一致。rollback-data-result.txt记录PASS，两个库的DROP SCHEMA成功，准确实例停止成功。

这是数据恢复阶段的真实演练，不是服务切回或业务恢复完整验收。夹具submission/snapshot仅为空对象结构数据，不能被当作实际Worker请求；未恢复或重放外部任务，不操作真实附件。完整回退仍需入口冻结、旧新Worker互斥、实际业务任务水位及外部副作用核对。R-01/R-02保持开放。最初构造脚本时嵌套PowerShell here-string导致解析失败，未执行文件修改或数据库动作，随后改用apply_patch，成功执行版本语法解析0错误。

### V1-04 OAuth授权草稿入口原handler对照

generate-authorization-contracts.mjs执行原registry-write-authorization及feishu-oauth-session实际函数，平台fetch设置为不允许调用。10例覆盖null/数组/数字/空对象、空作用域、顶层额外属性、作用域额外属性、数组模板、不可信来源、合法请求但未连接账号。对原connectUrl仅替换动态state，仍核对state存在、路径及完整响应字段。

OriginalAuthorizationContractTest经Java实际Controller/OAuthService比较状态、完整JSON去trace、trace头关联、连接state格式，验证未访问FeishuClient。初测失败（duowei-authorization-before.log与XML已归档）；修复Controller先验证草稿形状并返回原400 REQUEST_INVALID文案，避免非对象进入ObjectNode反序列化错误；不可信来源错误改为原“模板同步请求来源不受信任”。修复后10例一致，OriginalAuthorizationContractTest、OAuthRouteTest、OAuthFailureTest定向verify成功并打包，日志C:\codex-tmp\duowei-authorization-after.log。

仅无平台交互的授权草稿/未连接分支，不代表真实飞书授权及编辑权限成功，亦未覆盖所有畸形scope值或原callback HTML完整对照。尚未对该最后修改执行独立JAR的HTTP复验；现有其他包证据不能代替。合法会话下的签发和实际模板同步仍待隔离飞书环境。

### OAuth草稿独立进程HTTP复验与CORS证据层次

FullApplicationProcessTest增加两组registry-write-token路径，每组10例。初轮使用冻结JAR/真实PostgreSQL，目录C:\codex-tmp\duowei-postgres-runs\2ca08e1a6e8641dd96cd7335b400d31d；untrusted期望原handler401而实际403导致失败，日志/报告自动保存，实例停止。定位Java RequestPolicy在Controller前拒绝Origin；原main.ts同样配置前置CORS拒绝，但尚无其实际HTTP拒绝状态/正文证据。因此不修改生产CORS为迎合handler，也不宣称该分支双端完整HTTP一致。

测试现在分别验证：可信Origin的9例完整状态/JSON（动态trace与state校验后替换）、未信任Origin403且无Access-Control-Allow-Origin。后者仅是Java服务安全拒绝证据；原handler401仍由OriginalAuthorizationContractTest证明，两者作用层不同。客户端JDK8 HttpURLConnection需测试参数sun.net.http.allowRestrictedHeaders=true以实际发送Origin；不能把被JDK丢弃的Origin当真实来源测试。

修订后FullApplicationProcessTest与OriginalAuthorizationContractTest共2项定向verify通过，日志C:\codex-tmp\duowei-authorization-process.log。此轮独立生产主类classpath进程运行，非java -jar，数据库故意不可用；证明HTTP授权入口无平台分支和完整过滤器行为，不替代最新修改的冻结JAR/真实数据库复验。原CORS错误响应实际对照仍待验，真实OAuth/宿主展示未完成。

最新OAuth草稿修复已通过冻结JAR实际HTTP与真实PostgreSQL轮：C:\codex-tmp\duowei-postgres-runs\ee0f2b85058c48aa8d0700ebaba1f987，SHA256=C45C121740590D2A4081BFC6BB781569CB86E18D9531DECE2C84990A1F7B154F。两路径各10例，可信来源9例状态/完整JSON及动态state/trace关联通过，不可信来源403且无允许来源头作为单独CORS断言通过。四类共6项零跳过/失败/错误，原有注册表/事件/任务拒绝/并发/崩溃恢复关联检查通过；pg_dump/pg_restore完整行比较通过，schema清理与实例停止成功。该轮无真实飞书调用，无浏览器宿主验收，不能代替全量回归或关闭R-01/R-02。

### V1-04/V1-06 签名HTTP成功渲染验收补强

FullApplicationProcessTest在配置DUOWEI_TEST_RENDER_PARITY_DIRECTORY时读取已由原Playwright运行时生成的相同合成发货单请求，使用本地零字节测试密钥生成当前有效HMAC，实际POST两个render路径。两种格式分别要求200及非空产物，同artifactKey跨别名第二请求返回与首次完全相同字节，验证共享缓存；实际PNG与原运行时PNG逐像素一致，PDF校验%PDF头并保存，PDF逐页视觉另行比较。该测试直接进入生产Controller/认证/缓存/Selenium/浏览器，不是服务替身。成功不代表真实业务复杂模板或平台自动化上传。

HTTP读取超时由测试客户端10秒改为60秒，避免把浏览器启动波动误判为请求不可用；不改变生产超时策略。产物与http-render-result.txt保存在独立进程证据目录，执行结果待本轮完成后记录。

签名HTTP成功轮完成：C:\codex-tmp\duowei-postgres-runs\df2c0a9158f9417b8a39fdbb94863e99，冻结JAR SHA256=C45C121740590D2A4081BFC6BB781569CB86E18D9531DECE2C84990A1F7B154F，四类6项定向通过、零跳过/失败/错误，真实Chrome通过JAR内部renderer页面完成PDF/PNG导出。两入口同键字节一致，PNG原图零像素差异；另用Poppler将HTTP PDF两页转换600×800，与原运行时对应页逐像素差异均0，记录http-pdf-comparison.json。数据库联测/备份恢复成功、schema清理及实例停止成功。未测复杂业务模板及真实飞书链路，不关闭R-01/R-02。

### 固定源码补强：包含未跟踪文件

freeze-acceptance-source.py冻结明确源目录src/migrations/scripts/docs及pom/README/格式配置，输出目录必须在backend源码树之外且不能已存在；拒绝源链接、运行配置和私钥扩展。排除target、所有.env（含example）与node_modules。实际快照C:\codex-tmp\duowei-source-freeze\goal-v2-20261018-1025，110文件，backend-source.zip SHA256=31e8d815027472cbe358d8f83a364b7a267d9582576da18b5d492ad1ab496b16，HEAD=041bfcbbab4afe767fc3dbb9b36fa8d056bf34fb。逐文件长度/SHA256清单、ZIP CRC及解包内容哈希复核通过，包含未跟踪的实际HTTP与打印对照测试；不再仅依赖Git trackedDiff哈希。

该快照是此时源码的证据，不是历史每轮源码快照，也不能证明历史JAR由其构建；各轮包哈希仍独立记录。生成浏览器资源的脚本引用原妙搭工程及依赖，原依赖未包含，故不能据此宣称完全离线可重建。此次快照发生在本条台账写入之前，后续台账变更不属于它；不覆盖旧包或旧源码证据。未包含任何真实配置或数据，没有提交推送。

### 固定源码独立目录离线重建通过

上述ZIP解压至全新目录C:\codex-tmp\duowei-source-rebuild\goal-v2-20261018-1026，使用JDK8及Maven3.9.9执行离线package -DskipTests，退出码0，未使用原工作区target。重建JAR SHA256=f38751a663f192601eb69fbeef9d090d4d14c384e5454f10e329f451b88f8d81。与df2c0a9158f9417b8a39fdbb94863e99轮实际测试JAR逐ZIP条目比较，235条名称及解压字节全部一致，无增删或内容变化；外层ZIP哈希不同，不能宣称包字节可复现。offline-rebuild.log及offline-rebuild-result.json位于源码快照目录。

此轮只证明现有Maven缓存条件下独立源码可编译打包，未执行测试，未重新生成原工程浏览器资源，不代表全依赖离线供应或目标机器运行验收。与先前实际测试包条目相同增强源码关联证据，但仍保留各轮独立测试及环境限制。

### 累计修改后完整回归：163项，仍未整体通过

运行目录C:\codex-tmp\duowei-postgres-runs\44d104af665b40068af7299b58b8de8b。JDK8、真实隔离PostgreSQL、Chrome155，启用FullSuite、真实插件浏览器及原合成发货单渲染对照。当前轮XML按Maven日志创建时间筛选，与Maven最终汇总一致：163项，162通过、0断言失败、1错误、0跳过；Maven退出失败。唯一错误PluginPreviewHttpTest等候#app挂载超时，浏览器console明确Block client only running in Block host。不移除SDK保护或跳过该案例制造绿色结果。

新增授权草稿原handler对照、驱动阶段诊断以及现有实际JAR/真实库、签名HTTP渲染、并发和三崩溃窗口均无新增错误。通过的崩溃案例仍再次证明R-01风险，并非风险关闭。本轮因完整回归失败，脚本未进入其后的数据库备份恢复阶段；该阶段只能引用此前独立通过轮。报告、截图、console及产物已复制到运行目录，stop.log确认准确临时实例停止。test-summary.json保存当前轮汇总与问题。

本轮RenderParityTest使用benchmark-stages-v1作为输入并写出当轮Java产物/单次计时；工作目录内同名计时文件不是第三轮五样本历史的不可变证据，历史分析应引用此前归档，不能拿本轮单样本重算原性能比。整体结论仍为不满足替代/灰度准入：真实宿主及平台链路、复杂业务模板、R-01/R-02、长时稳定性与完整服务回退尚缺。没有部署、正式数据写入或提交推送。

### 短时连续40次真实渲染与主进程退出检查

新独立目录C:\codex-tmp\duowei-render-stability\goal-v2-20261018-1032，复制已验合成发货单及原产物作为输入，不覆盖历史目录。RenderParityTest新增可选DUOWEI_TEST_RENDER_PROCESS_EXIT检查：记录每次实际ChromeDriver能力中的goog:processID，生产render返回后通过只读Get-Process确认该浏览器主PID不存在。每次记录耗时、产物长度、PID、退出检查及MemoryMXBean已用堆，及时写盘保留中断前样本。未改变生产代码。

JDK8定向verify退出0，Surefire 1项、零跳过/失败/错误；PDF和PNG各连续20次，共40次全部生成且主PID退出检查通过。PDF耗时中位2785.70ms、最大5154.09ms；PNG中位2658.10ms、最大3531.41ms。耗时不含退出探测PowerShell启动开销。末次各格式元数据一致；末次PNG原图像素差异0，末次PDF两页Poppler600×800逐页差异0，文本提取仍0，不能声称可搜索文字一致。

已用堆首53.72MiB、末/峰211.35MiB；未控制GC、未采集存活对象和RSS，不能将增长认定泄漏，也不能声称没有泄漏。仅约数分钟的顺序调用，不是长期负载/并发容量验收。PID检查仅Chrome主进程，不证明全部子进程或驱动进程无残留。无真实平台调用，R-01/R-02及真实宿主门槛保持开放。stability-summary.json、40组java-timings.json、Surefire XML、Maven日志及PDF视觉比较保存在该独立目录。

### R-03 两个Worker实例重复处理同一任务已复现

PostgresConcurrencyTest新增双Worker专项：两个独立BackgroundService对象、各自单线程Worker与Repository，共享真实隔离PostgreSQL任务表；使用有效签名submit为各自内存装入测试凭证并触发实际drain。屏障强制两次真实recoverable查询均完成后才继续，再在渲染替身处等待两个执行者到达。平台与渲染均为受控替身，没有真实附件。最终同一任务只有1行、status=succeeded、attempt=2，但上传替身执行2次。测试期望重复以固定复现风险，不是“不重复”安全验收通过。

运行目录C:\codex-tmp\duowei-postgres-runs\54bd9b0065d94c84b8a12e3e5f1e32a9，四类7项全部执行、零跳过/失败/错误。新增multi-worker-risk.txt随concurrency复制保存；当前轮test-summary.json汇总7项。数据库备份恢复完整行核对通过，随机schema清理及准确实例停止成功。此轮未设置真实渲染对照输入，不沿用上一轮签名HTTP成功渲染声明。

根因：recoverable只是SELECT queued/processing，processing UPDATE没有跨实例领取互斥；单实例单线程不能约束另一个实例。原background-job.ts的running Map也只约束同一个processor对象，静态证据没有跨实例锁，但本轮没有原服务双实例动态测试，不能宣称原正式部署同样已复现。R-03与R-01不同：前者是不发生崩溃时双消费者重叠，后者是上传后恢复的外部副作用窗口。

当前不能支持多副本消费、滚动发布重叠或新旧Worker同时运行同一队列。单消费者约束必须在未来隔离部署/回退演练中实际验证，文档约束不等于已实现互斥；后续需设计并验证跨实例领取/连接失效/崩溃释放及恢复规则。不能只锁queued而跳过processing掩盖恢复要求，也不能用改测期望掩盖重复副作用。没有修改生产代码或执行切换，R-03保持开放，整体准入仍未通过。

### R-03 首轮修复：同库同schema的Worker会话锁

BackgroundJobRepository.withWorkerLock通过独立JDBC连接取得PostgreSQL会话级pg_try_advisory_lock，键由current_database与current_schema加固定Worker命名空间计算；未取得时不扫描任务。锁覆盖整个drain，包括queued与processing恢复、渲染和平台写入，finally显式解锁并关闭连接；SQL解锁失败则尝试abort物理连接，避免把可能持锁的连接还给连接池。BackgroundService将原扫描逻辑置于锁内，保留单实例串行策略、签名与响应及恢复凭证规则。没有新增迁移。测试替身显式执行锁回调，避免mock默认不执行而虚假通过原扫描校验。

双Worker用例改为先等首Worker进入渲染，再触发第二Worker，必须观察第二次锁拒绝后才释放首次渲染；期望模拟上传1次、attempt=1、成功行1条。之前两次上传的失败历史及源码归档保留。真实PostgreSQL轮7203ace2a1294e25892096230964ffae四类7项全部通过、零跳过/失败/错误，冻结JAR SHA256=F6A5434773FD695DB9F964E5739E43D7154F51BFBB67E37BE45DB89CFFCE4FC3。三个真实子JVM强杀窗口恢复仍通过，说明已测崩溃会话释放后可继续消费；R-01的两次上传仍然存在。数据库备份恢复与准确实例停止通过。另四类任务处理/校验/原契约定向verify退出0，日志C:\codex-tmp\duowei-worker-lock-unit.log。

此为R-03修复的第一层证据，不关闭完整多副本准入：尚缺独立JVM双消费者、锁连接异常/网络分区及连接池失效注入、锁回调异常释放的专项。会话锁需要直连或保持会话的代理，不适用于事务级连接代理；连接池需为消费锁额外预留至少一个连接。未加外部写入fencing，锁连接意外断开而旧执行者仍运行时仍有重叠风险；原妙搭Worker也不遵循该Java锁，故不能用此修复授权新旧服务重叠。后续保持R-03开放，不以常规互斥测试替代上述缺项。尚未对该生产修改执行新的完整浏览器全回归。

### R-03 独立JVM锁争用、崩溃释放及异常释放

PostgresConcurrencyTest新增LockProbe子JVM，实际构造Repository及JDBC连接，持锁回调写入acquired标记后等待自己的release文件。父测试等第一子进程取得锁，再启动第二个子JVM，验证正常退出、result=false且没有进入回调；强杀第一子进程并确认退出，轮询新连接取得锁。随后父进程在持锁回调抛出指定异常，校验异常原文继续传播，再启动第三子JVM，验证result=true且正常退出。锁实际在不同JVM/物理连接之间争用，不依赖Java内存互斥。仅锁生命周期，不是两个完整业务Worker进程或外部副作用验收。

运行目录C:\codex-tmp\duowei-postgres-runs\aa388cb858654a68ba722357aa9365af，四类8项全部执行、零跳过/失败/错误。包含前轮双BackgroundService实际drain互斥及三个强杀恢复窗口。lock-lifecycle.txt、三个子进程日志/标记及Surefire报告已随concurrency复制；test-summary.json汇总当前轮。pg_dump/pg_restore完整行核对通过，随机schema与子进程清理、准确数据库实例停止通过。

取得了进程间锁争用及进程死亡释放的证据，仍不证明锁连接丢失而业务线程存活时安全，也不覆盖事务代理/连接池故障。没有真实平台调用或发布动作，R-01/R-02及R-03剩余边界保持开放，真实宿主验收未完成。

### R-03 锁会话终止而回调仍存活：风险实测

新增lostLockConnectionDoesNotFenceTheStillRunningCallback：使用随机ApplicationName标记本测试唯一锁连接，实际持锁回调等待释放；在自己创建的隔离PostgreSQL中按application_name精确查得唯一PID后pg_terminate_backend，仅终止该测试锁会话。旧回调保持active，另一Repository实际取得同schema锁并进入回调，确认两者重叠。释放旧回调后，其解锁SQL才报告失败。没有真实平台调用，没有终止其他连接或现有数据库实例。

运行目录C:\codex-tmp\duowei-postgres-runs\0dcfaa449e8245c0be45a521b8ada0fa，四类9项零跳过/失败/错误；新增通过表示复现风险，不是互斥安全通过。lock-loss-risk.txt、当前轮test-summary.json与报告已保存。数据库完整备份恢复通过，schema及准确实例停止成功。该测试注入的是服务端会话终止，并非真实物理网络分区；证据足以反驳“锁可保证故障时唯一消费者”的主张，但不代表所有网络故障已覆盖。

R-03仍开放。会话锁改善健康连接时互斥，不能fence已经发出的外部请求；简单心跳或上传前检查仍有检查后断线窗口，不能声称根治。R-01上传结果未知窗口同样不能靠本地事务证明远端恰好一次。已询问用户在“结果不确定时暂停待核对”与“保持自动重试并接受重复”之间选择；该业务取舍会改变原恢复语义，收到选择前不擅自改变。其他可独立验证工作继续，不把等待决策当作整体完成。

### 锁修改后完整回归：166项、1已知宿主错误

目录C:\codex-tmp\duowei-postgres-runs\8e8bea781f6d45548628badbe2240321，JDK8、真实隔离PostgreSQL、Chrome及签名HTTP渲染启用。按当前轮XML时间筛选的test-summary.json与Maven最终总数一致：166项、165通过、0断言失败、1错误、0跳过。唯一错误仍为PluginPreviewHttpTest实际插件#app挂载超时；其余包括锁生命周期/锁丢失风险复现、实际JAR数据库与签名渲染均无新增失败。Maven退出失败，不能声明全量构建验收通过；未执行失败后的备份恢复阶段。报告和产物保存，准确数据库实例停止成功。

本轮源码另冻结C:\codex-tmp\duowei-source-freeze\goal-v2-lock-20261018-1048，110文件，ZIP SHA256=c6d610e8c8ad230a1f89b9b14876b74717f2e6d1fd35cec16f34a32a8916b359，包含新增锁代码与测试；本条台账及README后续变更不在快照。此轮将上一短时稳定性目录用作单次渲染输入，覆盖了其中java-timings.json，40次原始样本应引用10:34归档73f059d8-da31-483f-96fd-8d9e568b7fb5中的副本，不能把当前工作目录当历史原始数据。后续轮应复制只读输入到新目录。

恢复策略选择仍未收到答复；已请求隔离飞书测试宿主/表链接、App ID及脱敏模板路径，密钥只保留本地。真实宿主/平台链路缺少输入，不操作正式系统代替。整体验收仍未通过，没有部署或推送。

### R-02 预启动驱动服务诊断

DriverStartupTimingTest新增独立诊断：显式启动一个ChromeDriverService，RemoteWebDriver顺序建立5个独立会话，每次验证readyState、不同session ID和window标记为空，设置标记后quit；每次DELETE session之后服务仍运行，最终stop后isRunning=false。仅证实页面全局标记未串用，不代表所有Cookie/文件/浏览器进程隔离已验。生产仍使用ChromeDriver独立服务，不做性能策略变更。

JDK8定向verify两项通过，零失败/错误/跳过；日志C:\codex-tmp\duowei-prestarted-driver-timing.log。本轮独立服务5样本在target/driver-timing/37325640-57b7-4990-85d9-7f313eaf90d2/samples.json：serviceStart中位608.32ms、sessionStart898.02ms、探测及清理771.53ms。预启动5样本在9d4974ec-255e-42d0-8605-8e9b83344dec/prestarted-samples.json：sessionStart1168.69ms、探测及清理153.36ms。不计预启动一次性成本的组合阶段有改善可能，但会话本身更慢；非交错、样本少、RemoteWebDriver与ChromeDriver路径不同，不能宣称生产优化或推导完整渲染性能达标。

RemoteWebDriver诊断未执行生产必需的CDP请求头/完整渲染，也未验并发、取消/超时和驱动服务崩溃。后续若探索复用服务需补这些证据；R-02继续开放。原真实飞书与恢复策略输入仍待补齐。

### 渲染证据不再覆盖输入目录

修复RenderParityTest的证据写入策略：DUOWEI_TEST_RENDER_PARITY_DIRECTORY仅作为输入源，必需请求/原图/元数据复制到target/render-parity-runs/<UUID>，原PDF存在时也复制，记录input-source.txt；所有Java产物和计时写入新目录。避免后轮覆盖前轮样本。verify-local-postgres.ps1在成功及失败分支均复制该目录；历史批次可能一并复制，仍按本轮时间与UUID辨认，不把所有副本都当本轮执行。脚本语法解析0错误，该新增复制分支尚未再执行数据库整轮。

JDK8 RenderParityTest定向verify退出0，1项零跳过/失败/错误；新目录c263debf-2f97-4a63-b689-81a365170c8e，PNG逐像素一致，另外Poppler验证PDF两页600×800像素差异均0。日志C:\codex-tmp\duowei-parity-isolated-evidence.log。没有修改生产服务，不能关闭真实业务模板或宿主验收；历史被覆盖文件只使用先前归档恢复，不重写历史结果。

### HikariCP会话锁正常与异常归还专项

PostgresConcurrencyTest使用实际HikariCP池（maxPoolSize=2、minimumIdle=1）及真实隔离PostgreSQL，连续三轮持锁时拒绝独立DriverManager连接、回调正常结束后独立连接取得锁、回调异常传播后独立连接再取得锁，逐轮池activeConnections=0。锁连接未关闭物理会话而是归还池，因而该检查补足直连物理关闭可能掩盖的锁残留边界。没有模拟SQL或锁查询。

运行目录C:\codex-tmp\duowei-postgres-runs\d879590287cf4238878c92bbe4b9b360，四类10项零跳过/失败/错误，pooled-lock-result.txt位于concurrency/fb389346-1da6-47d5-a540-91fc78c279d1。数据库备份恢复完整行一致、schema清理及准确实例停止通过。上一轮新增render-parity-runs复制分支也实际执行并保存已有批次，但本轮未执行RenderParityTest，不能把这些复制品当本轮渲染产物。正常池归还得到证明，锁丢失旧回调存活风险仍在；不扩大到网络分区、事务代理或全部连接池故障。


### R-02 三组交替双端采样

独立证据根C:\codex-tmp\duowei-interleaved\goal-v2-20261018-1101，顺序为原PDF/PNG、Java PDF/PNG，重复3组；每组原运行时脚本独立启动，Java独立Maven测试JVM，渲染计时不含构建和Maven启动。输入均为同合成发货单，各批次保存原始请求、双方产物及计时，Java新UUID目录另复制到pair-N/java-run，不覆盖历史样本。三组Java定向verify均退出0。

PDF原总耗时中位2420.99ms、Java4868.46ms，比例2.0109；PNG原2667.54ms、Java3092.13ms，比例1.1592。每组PDF为首个请求，Java冷JVM/JIT影响包含在真实render调用中，不能与之前同JVM五次稳态样本混合。并非随机AB/BA交错，各端每格式仅3样本，不能推导生产p95或将变化都归因驱动。该结果表明新进程首请求仍明显偏慢，R-02不能关闭。

三组PNG比较均0像素差异；各组PDF两页Poppler600×800均0像素差异，文本提取0限制保留。paired-summary.json包含原始各组数值及方法限制。未修改生产策略；性能修复仍需同时覆盖冷启动与长时稳态，并保留超时取消和资源释放语义。真实飞书与业务模板输入仍未取得，不用本轮合成样本替代。


### 连续200次真实渲染完成

本轮同一JVM顺序PDF100次、PNG100次，RenderParityTest的重复上限由20扩展至100；生产代码未改。活跃执行会话17827最终MavenExit=0，Surefire定向1项通过。UUID为52383171-3414-45b7-b4eb-e43c38bceceb，全部200次实际调用成功、200次对应Chrome主PID退出检查通过。完整输入、计时、末次产物、XML和日志另复制至C:\codex-tmp\duowei-render-soak-evidence\52383171-3414-45b7-b4eb-e43c38bceceb，不依赖target保存。

PDF中位3010.45ms、最大4893.81ms，前20次中位2981.20ms、末20次3031.07ms；PNG中位2969.26ms、最大3328.97ms，前20次3186.28ms、末20次2928.66ms。当前样本未见明显持续恶化，但没有规定生产负载与服务等级阈值，不宣称容量达标。堆首53.66MiB、末204.63MiB、峰227.79MiB，过程中存在回落；无受控GC/存活对象/RSS证据，不证明没有泄漏。

末次PNG原图像素一致；末次PDF两页Poppler600×800逐页像素差异0，文本提取0限制保留。中间产物仅记录长度和调用完成，未逐份保存或比较，不能宣称200份文件逐页全部比对。仅合成模板顺序调用、非真实飞书或并发业务压力；未检查所有子进程/驱动PID，未替代目标环境长期稳定性验收。R-01/R-02/R-03及真实宿主缺口继续保留。


### R-02 Base64传输候选试验撤回

尝试将浏览器产物bytes数组在WebDriver返回前转换Base64，Java解码并核对长度，新增覆盖全部256字节及损坏输入的单元断言。JDK8定向RenderEnvelopeTest/RenderParityTest verify退出0，真实PDF/PNG各5次，PNG像素与原一致。日志C:\codex-tmp\duowei-base64-render.log，渲染UUID a0a8cbb0-a960-426c-ba4d-7020c272040a。PDF中位3266.38ms、PNG3432.08ms；没有同期随机配对基线，不能认定统计上变慢，但无证据支持性能改善。候选源码、测试和计时先归档，随后恢复已冻结的原RenderService及RenderEnvelopeTest，未将未经证实的优化留在生产。打印引擎及协议未变。R-02保持开放。


### 撤回候选后的交付包校验

重新执行JDK8 verify，RenderEnvelopeTest/RenderContractTest/RenderCacheTest/RenderTimeoutTest共13项零跳过/失败/错误，Maven退出0并打包，日志C:\codex-tmp\duowei-render-restored-build.log。现有target JAR SHA256=b87b0d82c76cffe47e1d73b49c33811e38110ece3a4799e360548b0791611695。与最后全量轮8e8bea781f6d45548628badbe2240321包中的34个生产类/资源条目逐字节比较无差异，确认target不再包含Base64候选实现。比较不涵盖测试源码，外层ZIP哈希变化不作为业务差异。结果C:\codex-tmp\duowei-render-restored-evidence\result.json。该定向成功不覆盖原全量宿主错误，整体验收仍未通过。


### 用户授权自主选择后：结果未知任务暂停核对

用户明确要求“需要做什么，你自己去做”，采用保守默认，不再等待恢复策略选择：上传前先持久化[REVIEW_REQUIRED]标记，恢复扫描排除该标记；failed的相同键重复提交也不得清除该标记或重新入队。上传开始后的上传/回写异常置failed并保留待核对标记，避免误报确定失败后自动重传。成功落库正常清除error。沿用现有状态与表结构，不新增迁移；这改变原后台自动重试语义，是有意的安全取舍。上传前标记落库后、实际发出前崩溃也会暂停，宁可待核对而不盲目重发。

真实PostgreSQL/JDK8轮59a061308177455a9e15926418002b41四类10项通过、零跳过/失败/错误，备份恢复及准确实例停止通过。三个子JVM强杀窗口更新断言：render前崩溃仍恢复成功，uploaded/written窗口重新提交凭证后仍processing且无恢复渲染、上传总次数1、待核对标记保留，均不再自动重复上传。平台仍为替身，不证明真实附件核对完成。原失败历史保留。定向21项首轮因BackgroundRepositoryTest硬编码旧扫描SQL失败，日志duowei-review-required-unit.log；更新断言后复验日志duowei-review-required-unit-after.log，实际最终结果以日志为准。

尚需提供安全的核对/恢复操作及失败重提专项、全部回归；不以直接手改SQL作为交付流程。旧妙搭Worker不识别此标记，禁止新旧消费者混用同一队列；历史processing且未有标记的任务也不能据此保证安全。R-03锁丢失时已取得任务快照的旧执行者仍可能重叠，未被此措施解决。真实环境和业务模板将从现有工程配置中继续查找，不使用正式数据替代；本轮仅查到测试源码，尚未确认隔离宿主。当前Goal工具仍显示blocked，不能声称已恢复active或整体验收完成。


### 2026-10-19 上传资格原子领取

发现旧Worker快照可绕过扫描排除条件，上传前标记需原子领取。beforeUpload改为仅processing且无REVIEW_REQUIRED的条件UPDATE，只有受影响行数1才继续上传；未取得直接返回，不将其改成普通失败。processing更新也不得清除已有待核对标记或重置终态。

真实PostgreSQL轮1c133f638a324fa59db7994b5e3966c3四类10项零跳过/失败/错误，备份恢复和实例停止成功。新增真实并发断言：两个独立连接同时领取仅1个成功；旧processing调用不清标记；requireReview后的重复提交保留failed。原三个强杀窗口仍通过。定向BackgroundProcessingTest/BackgroundRepositoryTest verify亦成功，日志C:\codex-tmp\duowei-upload-claim.log。此措施限制上传资格，不保证旧执行者无状态回写；仍需安全核对恢复工具及真实平台测试。未部署、未推送。
