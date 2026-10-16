<title>多维打印自动化 Block 本地工程</title>

# 用途

这是 Goal v22 的独立飞书自动化操作入口。`src/register.ts` 只注册“多维打印－生成打印文件”动作，不包含 Renderer、Registry 服务实现，也不存放任何密钥。

# 当前外部门

开发者后台已经为“多维打印”创建真实“自动化操作”能力，`block.json.blockTypeID` 固定为 `blk_6ab0a4c12f818bde89e6d397`。不得复用记录视图 ID，也不得把该工程上传到其他应用能力。

正式接入还必须由部署环境安全注入：

- `DUOWEI_REGISTRY_ENDPOINT`：Template Registry 的 HTTPS 读取地址，必须以 `/openapi/duowei-print/registry-read` 结尾；
- `DUOWEI_REGISTRY_READ_SIGNING_SECRET_HEX`：至少 32 字节的十六进制读取签名密钥；
- `DUOWEI_RENDERER_ENDPOINT`：Renderer 的 HTTPS 渲染地址，必须以 `/openapi/duowei-print/render` 结尾；
- `DUOWEI_RENDERER_SIGNING_SECRET_HEX`：至少 32 字节的十六进制渲染签名密钥；
- `DUOWEI_BACKGROUND_JOB_ENDPOINT`：后台模式持久任务的 HTTPS 提交地址，必须以 `/openapi/duowei-print/background-jobs` 结尾；
- `DUOWEI_BACKGROUND_JOB_SIGNING_SECRET_HEX`：至少 32 字节的十六进制后台任务签名密钥；
- `DUOWEI_PLATFORM_ENV`：当前只能为 `feishu`，省略时也是 `feishu`。

禁止把密钥写入源码、`block.json`、测试夹具、前端构建或 Git。类型检查使用根目录 `npm run check:automation-block`。`npm run build` / `npm run upload` 只在临时私有 FaaS 工程中注入部署配置，执行结束立即删除临时目录；生成物不进入记录视图包或 Git。权限、域名和发布仍须显式授权。

入口会先安装飞书 FaaS 的最小运行时兼容层，为旧版 Node 沙箱补齐签名所需的 `crypto.subtle`、`crypto.randomUUID`、`TextEncoder`、`TextDecoder`、`btoa` 和 `atob`。该兼容层不修改业务协议、密钥或请求目标；它只保证模板下拉在发起 `context.fetch` 前不会因浏览器式全局对象缺失而中断。
