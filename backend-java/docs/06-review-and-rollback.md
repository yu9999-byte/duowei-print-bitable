# 验收回顾与回退策略

## 1. 每轮证据闭环

每轮使用独立runId，记录原后台版本、Java版本及未提交源码快照、JDK/浏览器/字体、脱敏输入、初始状态、执行命令、实际输出、差异及复验结果。结论只能引用该轮实际覆盖范围。PASS、FAIL、BLOCKED、NOT_RUN分开记录；缺环境不能写PASS。

执行前冻结案例编号和预期结果；执行后保存原始证据，再分析差异。修复后新建一轮，不覆盖旧日志、不重写失败记录。每次回顾回答：差异是什么、根因是什么、改了什么、用什么证据证明已解决、还有哪些未覆盖。

本地归档命令：`node backend-java/scripts/archive-acceptance.mjs <已审查日志> <报告> <JAR或源码快照>`。工具仅复制显式文件，生成独立目录及SHA256清单，记录HEAD和已跟踪差异哈希，不读取环境变量或配置。目录为`target/acceptance/<runId>`，应复制到团队指定的受控存储；target会被clean清理。未跟踪源码不在Git差异哈希内，正式验收必须额外提供完整源码快照或可重建版本。日志先审查脱敏；不得归档含密钥的.env、Cookie或Authorization。

SHA256用于检查文件是否变化，不是数字签名，也不能证明业务结果正确。归档成功不等于验收成功。每轮台账至少填写：runId、案例编号、状态、原/Java结果、证据清单、差异编号、负责人、复验runId。

## 2. 当前回顾台账

| 项目 | 状态 | 证据与后续 |
| --- | --- | --- |
| JDK8编译、单元及本地集成、打包 | PASS（限定本地范围） | 最新150项全部通过，零跳过；含PostgreSQL、强制中断恢复及真实Chrome，见02-verification第10节 |
| 实际Chrome渲染/超时 | PASS（限定已测模板和Windows） | 两页文本PDF、第一页PNG、变量像素、主进程退出；复杂模板仍待验 |
| PostgreSQL真实持久化 | PASS（本机PostgreSQL16.15） | 自建仅监听127.0.0.1的随机端口临时实例，真实迁移、模板/任务/ticket及重连测试通过，测试schema清理后停止实例；非正式数据库证明 |
| 原后台与Java真实接口对照 | NOT_RUN | 离线比较器已自测，不代表已采集双后台响应 |
| 飞书真实业务、复杂打印、重启恢复 | NOT_RUN | 需要测试应用、脱敏业务模板和隔离环境 |

### JVM中断恢复专项

PostgresProcessRecoveryTest在独立JDK8子进程运行实际BackgroundService与真实Repository；任务进入渲染替身的阻塞点后，由父测试强制终止自己创建的子进程。数据库保持processing/attempt=1。启动第二个独立JVM，不注入临时租户凭证，验证一个观察窗口内没有渲染或飞书调用且attempt不变；通过实际submit路径重新提交签名与新测试凭证后恢复，同任务成功、attempt=2、file_token落库且任务总行数仍为1。测试上传替身只调用一次。测试清理仅针对自己的随机schema与子进程。

此专项使用模拟飞书与模拟渲染，不证明真实文件、HTTP或外部副作用。它测试的是“上传之前中断”的恢复窗口，不能证明“上传之后、落库之前中断”不会重复上传；后一个窗口仍需专门演练。原BackgroundAutomationService同样使用内存临时凭证，恢复扫描必须tokens.has，重启后等待新凭证是现有规则，不能承诺无人触发便自动恢复。记录重启运维步骤时必须包含重新触发自动化/提交凭证及在途任务核对。

第一轮数据库专项通过证据为`C:\codex-tmp\duowei-postgres-runs\0ad54810144341b1a712fdd5e7b090e1`及target/process-recovery下独立案例目录；包含两个子进程日志和检查点。之后增加状态回写序列断言（首次等待生成→生成中，恢复生成中→生成成功）并执行完整回归，结果以02-verification最新轮为准。

2026-10-18补强PostgresIntegrationTest：在写入模板、ticket、成功任务以及queued/processing任务后销毁原物理连接，新建连接及Repository读取同一随机schema；断言模板、ticket、成功附件令牌、恢复任务状态/attempt/submission保留。该用例尚缺真实测试库执行结果；连接重建验证也不等于Java进程重启及Worker恢复验收。编译日志单独保存为`C:\codex-tmp\duowei-postgres-test-compile.log`，不得用原有测试数量冒充该新增分支已通过。

后续实测更新：已执行上述用例及修订版本、ready过滤、跨租户隔离断言，1项执行、零跳过/失败/错误。证据目录`C:\codex-tmp\duowei-postgres-runs\8621bb9e82c3466eba4444036c00b8cb`包含maven.log、postgres-test.xml、启动/停止日志。数据库随机schema数量复核为0，实例已停止。数据库来自PostgreSQL官网链接的EDB Windows16.15二进制。初次下载误选Mac包，改为明确Windows链接fileid=1260623后按ZIP索引只提取bin/lib/share并校验每个文件CRC；该来源说明不等同于独立发布签名校验。两轮启动脚本曾被Windows子进程等待阻塞，均停止准确data路径对应实例后改用只等待pg_ctl父进程；失败轮保留，没有操作其他PostgreSQL实例。

渲染协议实测更新：通过原renderer-service.ts实际HTTP handler生成8个无签名/非法参数错误夹具，与Java MockMvc实际Controller/RenderRequestService比较状态、完整JSON（仅去除顶层traceId）和trace关联。初测复现类型/页数及必填标签错误文案不同；修复Java后8例一致。日志`C:\codex-tmp\duowei-original-render-before.log`和`duowei-original-render-after.log`保留失败与复验。该证据覆盖原业务handler与Java控制器，不等于两个正式托管实例对照。

## 3. 后续试运行的回退设计

当前不切换线上，不执行发布。以下是后续变更方案的必要条件，实际执行另行确认。

切换前保存原服务可用版本、插件后台地址及代理配置、数据库备份与恢复验证记录，记录任务水位和在途任务。先停止新任务入口、等待在途任务完成，确认两套Worker不会同时消费同一业务队列。数据库变更需兼容旧服务；不得以删除新表或执行逆向SQL代替恢复方案。

明确回退触发器：权限或作用域错误、任务丢失/重复附件、打印内容差异、不能恢复的任务、持续错误或性能超过验收基线。权限、数据及内容正确性问题出现一次即停止试运行；错误率和性能阈值需在真实原后台基线测量后确定，不临时猜测数字。

触发后停止Java接收新任务并停止其Worker，核对在途任务和已产生的外部副作用，再恢复原服务路由。仅恢复地址无法撤销已上传附件或回写字段；按taskKey/记录ID逐项核对，人工批准后补偿，禁止盲目批量重放。确认原服务健康、授权、打印及任务链路后结束回退。保留故障轮全部证据，修复后重新经过关联验收门槛。
