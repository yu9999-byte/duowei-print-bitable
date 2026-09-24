# GitHub 自动同步机制

该机制通过 Windows 任务计划程序每 30 分钟检查一次项目，在满足安全条件时自动创建提交并推送到 GitHub。

## 执行条件

同步脚本只操作 `yu9999-byte/duowei-print-bitable` 的 `main` 分支，并依次确认：

1. 当前远端是预期的 GitHub 仓库。
2. 当前分支是 `main`，暂存区没有用户手动暂存的内容。
3. 本地分支没有落后于远端，也没有与远端分叉。
4. `npm test` 与 `npm run build` 都成功。
5. 验证期间工作区没有继续发生变化。
6. 文件名、文件大小、补丁格式和常见凭据特征检查均通过。

任一条件不满足时，本轮同步停止。脚本不会强推、拉取、合并或改写历史。

## 安装和管理

在项目根目录执行：

```powershell
# 模拟检查，不提交或推送
pwsh -NoProfile -File .\scripts\auto-github-sync.ps1 -DryRun

# 安装每 30 分钟运行一次的任务
pwsh -NoProfile -File .\scripts\install-auto-github-sync.ps1

# 立即手动执行一次完整同步
pwsh -NoProfile -File .\scripts\auto-github-sync.ps1

# 卸载自动同步任务
pwsh -NoProfile -File .\scripts\uninstall-auto-github-sync.ps1
```

只有用户登录 Windows 时任务才会运行。电脑休眠或关机期间不会唤醒设备，恢复后会补跑一次。

## 结果和故障处理

- 自动提交信息格式：`chore(auto): sync YYYY-MM-DD HH:mm:ss +08:00`
- 运行日志：`.git/auto-sync.log`
- 日志超过 1 MB 时只保留末尾 500 行。
- 拉取或推送遇到临时网络故障时会重试三次。全部失败后，已经创建的本地提交会保留，下一轮在远端未分叉的前提下继续重试。
- 发现手动暂存内容时不会接管暂存区。
- 自动检查不替代 GitHub 分支保护或代码评审。
