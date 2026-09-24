[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [ValidateRange(5, 1440)]
    [int]$IntervalMinutes = 30,
    [string]$TaskName = "duowei-print-bitable-auto-sync"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$syncScript = Join-Path $PSScriptRoot "auto-github-sync.ps1"
if (-not (Test-Path -LiteralPath $syncScript)) {
    throw "Sync script not found: $syncScript"
}

$powerShellPath = (Get-Command powershell.exe -ErrorAction Stop).Source
$escapedScript = $syncScript.Replace('"', '""')
$actionArguments = '-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "{0}"' -f $escapedScript
$action = New-ScheduledTaskAction -Execute $powerShellPath -Argument $actionArguments
$trigger = New-ScheduledTaskTrigger `
    -Once `
    -At (Get-Date).AddMinutes(1) `
    -RepetitionInterval (New-TimeSpan -Minutes $IntervalMinutes)
$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -MultipleInstances IgnoreNew `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 20)
$currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$principal = New-ScheduledTaskPrincipal -UserId $currentUser -LogonType Interactive -RunLevel Limited
$description = "Safely validate, commit, and push duowei-print-bitable every $IntervalMinutes minutes."

if ($PSCmdlet.ShouldProcess($TaskName, "Register scheduled GitHub auto-sync task")) {
    Register-ScheduledTask `
        -TaskName $TaskName `
        -Action $action `
        -Trigger $trigger `
        -Settings $settings `
        -Principal $principal `
        -Description $description `
        -Force | Out-Null
}

Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue |
    Select-Object TaskName, State, TaskPath
