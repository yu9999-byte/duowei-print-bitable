<title>多维打印自动化生产服务</title>

# 职责

该服务提供 Goal v22 自动化 MVP 的八个 HTTPS 路由：

- `GET /healthz`
- `GET /v1/oauth/start`
- `GET /v1/oauth/callback`
- `POST /v1/registry-write-token`
- `POST /v1/templates`
- `POST /v1/render`
- `POST /v1/background-jobs`
- `POST /v1/feishu/events`

记录视图通过显式“连接自动化”完成飞书 OAuth；服务端使用 PKCE/state、用户身份和 Base 编辑权限校验后建立 `HttpOnly; Secure; SameSite=None` 的 Base/table 作用域会话。模板 Registry、后台任务和商店应用 `app_ticket` 使用持久卷。Renderer 使用隔离 Chromium 页面和与记录视图相同的 `vue-print-designer` 输出实现；渲染超时或调用方取消后关闭页面。后台 Worker 使用 `app_ticket` 换取应用身份令牌，只更新用户选择的附件、状态和错误字段。

# 构建

```powershell
cd automation-service
npm ci
npm run check
npm run build
cd ..
docker build -f automation-service/Dockerfile -t duowei-print-automation-service .
```

# 必需环境变量

- `DUOWEI_PUBLIC_BASE_URL`
- `DUOWEI_RECORD_VIEW_ORIGINS`
- `DUOWEI_FEISHU_APP_ID`
- `DUOWEI_FEISHU_APP_SECRET`
- `DUOWEI_REGISTRY_SIGNING_SECRET_HEX`
- `DUOWEI_REGISTRY_READ_SIGNING_SECRET_HEX`
- `DUOWEI_RENDERER_SIGNING_SECRET_HEX`
- `DUOWEI_BACKGROUND_JOB_SIGNING_SECRET_HEX`
- `DUOWEI_REGISTRY_FILE_PATH`，容器建议 `/data/templates.json`
- `DUOWEI_BACKGROUND_JOB_FILE_PATH`，容器建议 `/data/background-jobs.json`
- `DUOWEI_APP_TICKET_FILE_PATH`，容器建议 `/data/app-ticket.json`
- `DUOWEI_EVENT_VERIFICATION_TOKEN`
- `DUOWEI_BACKGROUND_WORKER_INTERVAL_MS`，默认 `1000`
- `DUOWEI_RENDERER_TIMEOUT_MS`，默认 `120000`
- `PORT`，默认 `8080`

所有密钥只由部署环境注入，不得写入记录视图、自动化 Block、镜像层或 Git。正式部署必须由 HTTPS 反向代理终止 TLS；单实例使用持久卷，多实例前必须将 JSON Store 替换为事务数据库。
