# 17条路由验收状态

此表只索引已取得的证据，不把路由映射或单元测试当作正式环境验收。当前结论：尚不满足整体替代/灰度准入。逐轮日志、失败与包哈希见08-full-acceptance-v1.md。

| 方法与路径 | 当前最强证据 | 尚缺 |
| --- | --- | --- |
| GET /api/automation/health | 独立JAR真实HTTP，与公开health完整JSON一致 | 部署代理环境 |
| GET /openapi/duowei-print/health | 独立JAR真实HTTP200 | 部署代理环境 |
| GET /api/automation/bridge | 原脚本一致性及Node VM、本地Controller测试 | 真实宿主跨窗口交互 |
| GET /api/automation/oauth/start | 本地Controller/Service PKCE与state测试 | 原实例对照、真实飞书授权 |
| GET /openapi/duowei-print/oauth/start | 同上，路由别名测试 | 同上 |
| GET /api/automation/oauth/callback | 模拟平台成功/取消/权限、Cookie与state复用测试 | 原实例对照、真实平台及HTTPS浏览器 |
| GET /openapi/duowei-print/oauth/callback | 同上，路由别名测试 | 同上 |
| POST /api/automation/registry | 原handler10例对照；独立JAR+PostgreSQL签名写入、重复、重启、错误 | 真实OAuth签发写入及完整业务模板 |
| POST /api/automation/registry-write-token | 原授权handler10例无平台分支对照，独立进程双路径HTTP；模拟会话/权限测试 | 完整JAR最新轮见08；真实用户权限及成功签发 |
| POST /openapi/duowei-print/registry-write-token | 同上，别名测试 | 同上 |
| POST /openapi/duowei-print/registry-write | 独立JAR+PostgreSQL正常、缺签名、方向405及文案 | 原公开控制器完整动态对照；最后分派修改见08最新轮 |
| POST /openapi/duowei-print/registry-read | 同上，未知操作分派修复已通过独立JAR复验 | 真实同步链路 |
| POST /api/automation/render | 原handler错误8例；独立JAR签名HTTP成功导出、别名缓存字节一致；同输入原运行时PDF/PNG视觉一致 | 原托管实例完整HTTP对照、复杂业务模板 |
| POST /openapi/duowei-print/render | 同上，别名测试 | 同上 |
| POST /openapi/duowei-print/background-jobs | 原handler28例；独立JAR23拒绝例、真实库；并发24请求、进程中断 | 真实平台成功/失败/限流、附件核对；R-01重复上传风险 |
| POST /openapi/duowei-print/events | 原handler18例；独立JAR真实库保存/重复投递 | 真实飞书事件投递 |
| GET /openapi/duowei-print/renderer | 独立JAR匿名401/测试Bearer200，实际浏览器渲染 | 目标运行环境字体/驱动/HTTPS |

共同剩余门槛：真实飞书Block宿主页面挂载，隔离应用与测试表、可编辑/只读用户、脱敏复杂模板、代理HTTPS、性能稳定性及实际回退演练。200次顺序合成模板渲染和主PID退出检查已通过，不代替真实业务负载。R-01重复上传、R-02本机渲染慢于原基线、R-03锁会话丢失后消费重叠保持开放。未授权上线切换、正式数据变更或自动提交推送。
