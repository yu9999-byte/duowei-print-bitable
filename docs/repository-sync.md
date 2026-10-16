# 源码归档与同步

主仓库：https://github.com/yu9999-byte/duowei-print-bitable（私有）。

当前开发分支为 `codex/feishu-native-ui-v7`。查看最新开发代码时应切换到该分支；`main` 不会因开发分支推送自动更新。

提交范围包括记录视图、自动化 Block、独立自动化服务、测试、构建脚本、产品文档及 Markdown 验收记录。自动化代码的归档不代表恢复暂停任务，也不代表已通过生产验收；发布状态以 CHANGELOG 和验收记录为准。

依赖、构建包、浏览器配置、临时截图、PDF、日志和本地环境配置不进入新增提交。历史已跟踪的验收产物保留。部署密钥通过环境变量注入，不提交实际值。

`miaoda-duowei-automation/` 是独立 Git 仓库，不作为主仓库目录或隐式子模块提交。2026-10-16 整理时工作区干净，分支 `sprint/default`，提交 `c2f4e6a3831299653c0a284bddc1fcf46ed73adb`；远程为 `https://miaoda-git.feishu.cn/apaas4.0/-/t_XIn8Sfxe/code_UA8E4w7Sm5og.git`。需要该服务源码时从其独立远程获取。

归档检查：根项目 `npm test`、`npm run build`；自动化服务 `npm --prefix automation-service run check` 和 `npm --prefix automation-service run build`。GitHub 同步与飞书发布分别验收。
