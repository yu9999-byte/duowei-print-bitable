# 系统展示与Java后台的连接

源码核对发现：miaoda-duowei-automation/client/src/app.tsx首页为框架Welcome占位页，真正多维打印界面入口为仓库src/main.ts及src/App.vue，由record-view/webpack.config.cjs构建为飞书记录视图插件。Java不需要复制或重写这套界面，保留原插件能避免界面行为变化。

## 本机展示

可选启动参数`--duowei.plugin-preview-directory=A:/打印宝/record-view/dist`让Spring Boot在`/plugin-preview/index.html`托管已存在的插件构建。默认不开启；目录必须包含index.html，路径不覆盖API和受保护renderer。此功能仅方便本地查看同一前端构建，不能伪造飞书登录、记录选择或Base SDK。不要把带开发配置的预览当作正式入口发布。

独立浏览器能否显示框架取决于插件SDK的宿主要求；若显示未连接或缺少表格上下文，是待飞书联调项，不能用假数据把它标为系统可用。正式效果需在隔离飞书测试插件中加载原界面并连接Java HTTPS测试域名。

## 测试插件接入Java

记录视图构建参数：DUOWEI_TEMPLATE_SYNC_AUTHORIZATION_ENDPOINT指向Java `/openapi/duowei-print/registry-write-token`，DUOWEI_TEMPLATE_REGISTRY_WRITE_ENDPOINT指向`/openapi/duowei-print/registry-write`，DUOWEI_TEMPLATE_SYNC_BRIDGE_ENDPOINT指向`/api/automation/bridge`。Java允许来源需包含测试插件真实origin，OAuth回调与测试域名一致。不要把服务签名密钥或服务Bearer写进浏览器构建。

自动化服务端另配置DUOWEI_REGISTRY_ENDPOINT、DUOWEI_RENDERER_ENDPOINT、DUOWEI_BACKGROUND_JOB_ENDPOINT对应Java registry-read/render/background-jobs，使用相同协议密钥。模板同步配置在构建时注入，单独运行Java不会自动替换已经发布插件的地址。

验收顺序：Java启动与health→前端资源HTTP加载→飞书测试宿主挂载→模板读取/编辑→OAuth授权→模板同步→自动化生成PDF/PNG→附件/状态回写。每步保留实际结果，不将静态HTML200视为完整系统验收。原正式插件和后台地址保持不变。

本轮验证：JDK8执行`spotless:apply verify -Dtest=PluginPreviewConfigurationTest`成功，2项通过并重新打包。测试覆盖默认不挂载、目录缺首页拒绝、配置路径隔离、Spring资源处理器返回首页/脚本精确字节和父目录越界404。使用临时夹具及Spring模拟请求，不是实际HTTP监听或真实浏览器视觉验收。日志`C:\codex-tmp\duowei-plugin-preview-check.log`。本轮没有重跑此前150项全量测试，不能将两轮简单相加宣称完整152项通过。
