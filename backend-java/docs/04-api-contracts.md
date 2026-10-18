# HTTP 接口迁移清单

核对来源：原 `server/modules/automation/automation.controller.ts` 与 `automation-openapi.controller.ts`，以及 Java 四个 Controller。以下路径均相对于服务根路径；原妙搭 `/app/<appId>` 前缀由部署代理处理。

## 1. 浏览器与内部接口

| 方法 | 路径 | Java处理器 | 认证与结果 |
| --- | --- | --- | --- |
| GET | `/api/automation/health` | RegistryController.health | 健康、protocolVersion=1 |
| GET | `/api/automation/bridge` | BridgeController.bridge | 来源/opener限制、CSP、no-store |
| GET | `/api/automation/oauth/start` | AutomationController.start | 一次性state，302飞书授权或失败HTML |
| GET | `/api/automation/oauth/callback` | AutomationController.callback | PKCE交换、编辑权限、安全Cookie、HTML或303桥接回跳 |
| POST | `/api/automation/registry` | RegistryController.registry | HMAC，兼容读写分派 |
| POST | `/api/automation/registry-write-token` | AutomationController.authorize | 来源与OAuth会话，签发作用域绑定写签名 |
| POST | `/api/automation/render` | RenderController.render | HMAC，二进制PDF/PNG或结构化错误 |

## 2. 公网接口

| 方法 | 路径 | Java处理器 | 认证与结果 |
| --- | --- | --- | --- |
| GET | `/openapi/duowei-print/health` | RegistryController.health | 同健康协议 |
| GET | `/openapi/duowei-print/oauth/start` | AutomationController.start | 同授权入口 |
| GET | `/openapi/duowei-print/oauth/callback` | AutomationController.callback | 同授权回调 |
| POST | `/openapi/duowei-print/registry-write-token` | AutomationController.authorize | 同写签名授权 |
| POST | `/openapi/duowei-print/registry-write` | RegistryController.registry | 仅写；读取请求405 WRITE_ONLY_ENDPOINT |
| POST | `/openapi/duowei-print/registry-read` | RegistryController.registry | 仅读；写入请求405 READ_ONLY_ENDPOINT |
| POST | `/openapi/duowei-print/render` | RenderController.render | 同渲染协议 |
| POST | `/openapi/duowei-print/background-jobs` | AutomationController.submit | HMAC与临时租户凭证；新任务202，复用200 |
| POST | `/openapi/duowei-print/events` | AutomationController.event | challenge、verification token、app_id、app_ticket |
| GET | `/openapi/duowei-print/renderer` | RenderController.page | 打印引擎HTML；服务Bearer保护由RequestPolicy实施 |

原两个Controller合计17个方法与路径组合，Java均有对应映射。静态映射一致不代表全部请求参数、错误分支和真实业务验收完成。

## 3. 协议证据和剩余边界

- RegistryContractTest验证读写隔离、缺签名及非法模板错误；RegistryServiceTest验证签名和作用域。
- OAuthRouteTest验证缺state与取消回调；OAuthFailureTest验证模拟授权、Cookie、桥接回跳及会话复用。
- RenderContractTest验证缺签名、两组超时504、二进制及产物响应头；真实Chrome已生成两页文本PDF及第一页PNG，并验证动态字段改变像素，复杂模板和视觉结果仍待验。
- BackgroundRouteTest验证租户凭证、任务错误、签名错误和trace一致性；BackgroundValidationTest验证有效签名及复用响应。
- BridgeContractTest与EventServiceTest分别验证桥接静态契约、事件处理；浏览器交互及真实事件投递仍待验。
- RequestErrorContractTest与RequestPolicyTest验证请求策略、内容类型、JSON、方法、大小及来源；代理前缀和线上托管鉴权尚未部署验收。

当前Goal v2验收及外部环境缺口以[完整验收台账](08-full-acceptance-v1.md)为准；[验证记录](02-verification.md)保留历史构建基线。本清单不授权部署或切换插件地址。
