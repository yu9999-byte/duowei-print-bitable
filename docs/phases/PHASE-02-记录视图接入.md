<title>PHASE-02 — 记录视图正式接入</title>

- 状态：本地与控制台接入 Green；真实 Base 阻塞
- 日期：2026-09-21
- 规格基线：`04-SPEC` v0.3

# 本轮纠偏

用户明确指出原页面空白，且交付必须是多维表格内打印字段的插件。官方一手文档确认打印类入口应为记录视图插件，而不是独立 Vite 网页。

# Red

1. 原 `dist/index.html` 引用 `/assets/...`，子路径/静态打开可能资源 404。
2. 根目录没有 `app.json`、`block.json`、BlockTypeID、官方 Webpack 插件或 Opdev 上传脚本。
3. 代码只围绕“再次选择记录”，没有把记录视图宿主 `recordId` 作为单条默认记录。
4. 文档将宿主统一描述为“侧边栏插件”，与当前开放平台插件分类不一致。

# Green

1. 新增 `app.json`，绑定用户提供的市场应用 ID；新增 `record-view/block.json`，先显式留空，取得控制台事实后写入真实 BlockTypeID。
2. 新增官方 Webpack/Opdev 构建，生产资源为相对路径，输出带 `offlineWeb` 清单。
3. Webpack 生产包使用 `@lark-opdev/block-bitable-api`；单元测试继续使用可在 Node 运行的同契约 SDK。
4. ContextAdapter 增加 `recordId`，单条优先返回宿主记录；只有没有宿主记录时才进入批量选择器。
5. BRD/PRD/TD/SPEC/SDD/TEST/TRACE/TODO/ADR 同步为记录视图口径。

# 验证

```text
npm test
tests 44, pass 44, fail 0

npm run build
webpack 5 production build: success
record-view/dist/index.html -> ./assets/...
record-view/dist/project.config.json -> cli_aa3a18dc8eb95bd1
record-view/dist/index.json -> blockRenderType offlineWeb; blockTypeID blk_6ab0a4c12f818bde89ca4e8a
```

# 当前阻断与下一步

初次访问控制台曾返回 `403 无权访问`；用户切换到有权限账号后已成功进入目标应用，并添加“多维表格插件→记录视图”能力。平台生成的 `BlockTypeID` 为 `blk_6ab0a4c12f818bde89ca4e8a`，已写入 `record-view/block.json`。后续上传、发布与灰度证据见 PHASE-03。当前只剩明确测试 Base 与真实容器 E2E。
