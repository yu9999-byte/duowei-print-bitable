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
