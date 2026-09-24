[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [string]$TaskName = "duowei-print-bitable-auto-sync"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($null -eq $task) {
    Write-Host "Scheduled task '$TaskName' is not installed."
    exit 0
}

if ($PSCmdlet.ShouldProcess($TaskName, "Unregister scheduled GitHub auto-sync task")) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Host "Scheduled task '$TaskName' was removed."
}
