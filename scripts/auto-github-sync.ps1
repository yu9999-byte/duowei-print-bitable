[CmdletBinding()]
param(
    [string]$RepositoryRoot,
    [string]$Branch = "main",
    [string]$Remote = "origin",
    [string]$ExpectedRepository = "yu9999-byte/duowei-print-bitable",
    [switch]$DryRun,
    [switch]$SkipValidation
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($RepositoryRoot)) {
    $RepositoryRoot = Split-Path -Parent $PSScriptRoot
}

$script:RepoRoot = (Resolve-Path -LiteralPath $RepositoryRoot).Path
$script:LogPath = Join-Path $script:RepoRoot ".git\auto-sync.log"
$script:StagedByScript = $false
$script:CommitCreated = $false

function Write-SyncLog {
    param(
        [ValidateSet("INFO", "WARN", "ERROR")]
        [string]$Level,
        [string]$Message
    )

    $line = "{0} [{1}] {2}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Level, $Message
    Write-Host $line

    if (Test-Path -LiteralPath (Split-Path -Parent $script:LogPath)) {
        if ((Test-Path -LiteralPath $script:LogPath) -and
            (Get-Item -LiteralPath $script:LogPath).Length -gt 1MB) {
            $tail = Get-Content -LiteralPath $script:LogPath -Tail 500
            Set-Content -LiteralPath $script:LogPath -Value $tail -Encoding UTF8
        }
        Add-Content -LiteralPath $script:LogPath -Value $line -Encoding UTF8
    }
}

function Invoke-Git {
    param(
        [Parameter(Mandatory = $true)]
        [string[]]$Arguments,
        [int[]]$AllowedExitCodes = @(0)
    )

    $lines = @(& git -C $script:RepoRoot @Arguments 2>&1)
    $exitCode = $LASTEXITCODE
    $output = ($lines | ForEach-Object { "$_" }) -join [Environment]::NewLine

    if ($AllowedExitCodes -notcontains $exitCode) {
        $command = "git " + ($Arguments -join " ")
        throw "$command failed with exit code $exitCode.`n$output"
    }

    return [pscustomobject]@{
        ExitCode = $exitCode
        Output = $output.Trim()
    }
}

function Invoke-ValidationCommand {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Label,
        [Parameter(Mandatory = $true)]
        [string[]]$Arguments
    )

    $lines = @(& npm @Arguments 2>&1)
    $exitCode = $LASTEXITCODE
    if ($exitCode -ne 0) {
        $output = ($lines | ForEach-Object { "$_" }) -join [Environment]::NewLine
        throw "$Label failed with exit code $exitCode.`n$output"
    }

    Write-SyncLog -Level INFO -Message "$Label passed."
}

function Test-StagedContent {
    $nameResult = Invoke-Git -Arguments @(
        "-c", "core.quotepath=false", "diff", "--cached", "--diff-filter=ACMR", "--name-only"
    )
    $paths = @($nameResult.Output -split "`r?`n" | Where-Object { $_ })

    foreach ($path in $paths) {
        $normalized = $path.Replace("\", "/")
        $fileName = [System.IO.Path]::GetFileName($normalized)
        $isEnvironmentFile = $fileName -match '^\.env(?:\.|$)' -and $fileName -ne ".env.example"
        $isCredentialFile = $normalized -match '(?i)(?:^|/)(?:credentials?|secrets?)(?:\.|/|$)'
        $isPrivateKey = $fileName -match '(?i)\.(?:pem|key|p12|pfx)$'

        if ($isEnvironmentFile -or $isCredentialFile -or $isPrivateKey) {
            throw "Sensitive-looking file is blocked: $path"
        }

        $sizeResult = Invoke-Git -Arguments @("cat-file", "-s", ":$path")
        if ([long]$sizeResult.Output -gt 20MB) {
            throw "File exceeds the 20 MB automatic-sync limit: $path"
        }
    }

    $diffResult = Invoke-Git -Arguments @(
        "diff", "--cached", "--unified=0", "--no-color", "--", ".",
        ":(exclude)package-lock.json", ":(exclude)*.png", ":(exclude)*.jpg", ":(exclude)*.jpeg"
    )
    $addedContent = $diffResult.Output
    $secretPatterns = @(
        @{ Name = "private key"; Pattern = '-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----' },
        @{ Name = "GitHub token"; Pattern = 'gh[pousr]_[A-Za-z0-9_]{20,}' },
        @{ Name = "AWS access key"; Pattern = 'AKIA[0-9A-Z]{16}' },
        @{ Name = "credential assignment"; Pattern = '(?im)^\+(?!\+\+).*(?:api[_-]?key|client[_-]?secret|password|private[_-]?key)\s*[:=]\s*["''][^"'']{8,}["'']' }
    )

    foreach ($secretPattern in $secretPatterns) {
        if ($addedContent -match $secretPattern.Pattern) {
            throw "Potential $($secretPattern.Name) detected in staged content."
        }
    }

    Invoke-Git -Arguments @("diff", "--cached", "--check") | Out-Null
}

function Invoke-ProjectValidation {
    if ($SkipValidation) {
        Write-SyncLog -Level WARN -Message "Project validation was explicitly skipped."
        return
    }

    Push-Location -LiteralPath $script:RepoRoot
    try {
        Invoke-ValidationCommand -Label "npm test" -Arguments @("test")
        Invoke-ValidationCommand -Label "npm run build" -Arguments @("run", "build")
    }
    finally {
        Pop-Location
    }
}

function Invoke-PushWithRetry {
    $delays = @(0, 5, 15)
    $lastError = $null

    for ($attempt = 0; $attempt -lt $delays.Count; $attempt++) {
        if ($delays[$attempt] -gt 0) {
            Write-SyncLog -Level WARN -Message "Push failed; retrying in $($delays[$attempt]) seconds."
            Start-Sleep -Seconds $delays[$attempt]
        }

        try {
            Invoke-Git -Arguments @("push", $Remote, "HEAD:$Branch") | Out-Null
            return
        }
        catch {
            $lastError = $_
        }
    }

    throw $lastError
}

function Invoke-FetchWithRetry {
    $delays = @(0, 5, 15)
    $lastError = $null

    for ($attempt = 0; $attempt -lt $delays.Count; $attempt++) {
        if ($delays[$attempt] -gt 0) {
            Write-SyncLog -Level WARN -Message "Fetch failed; retrying in $($delays[$attempt]) seconds."
            Start-Sleep -Seconds $delays[$attempt]
        }

        try {
            Invoke-Git -Arguments @("fetch", $Remote, $Branch, "--quiet") | Out-Null
            return
        }
        catch {
            $lastError = $_
        }
    }

    throw $lastError
}

function Invoke-AutoSync {
    $gitDirectory = Join-Path $script:RepoRoot ".git"
    if (-not (Test-Path -LiteralPath $gitDirectory)) {
        throw "Repository root does not contain .git: $($script:RepoRoot)"
    }

    $remoteUrl = (Invoke-Git -Arguments @("remote", "get-url", $Remote)).Output
    $repositoryPattern = '(?i)github\.com[:/]' + [regex]::Escape($ExpectedRepository) + '(?:\.git)?$'
    if ($remoteUrl -notmatch $repositoryPattern) {
        throw "Remote '$Remote' is not the expected GitHub repository: $remoteUrl"
    }

    $currentBranch = (Invoke-Git -Arguments @("branch", "--show-current")).Output
    if ($currentBranch -ne $Branch) {
        Write-SyncLog -Level WARN -Message "Skipped: current branch '$currentBranch' is not '$Branch'."
        return 0
    }

    $stagedCheck = Invoke-Git -Arguments @("diff", "--cached", "--quiet") -AllowedExitCodes @(0, 1)
    if ($stagedCheck.ExitCode -eq 1) {
        Write-SyncLog -Level WARN -Message "Skipped: the index contains user-staged changes."
        return 0
    }

    Invoke-FetchWithRetry
    $remoteRef = "refs/remotes/$Remote/$Branch"
    $localHead = (Invoke-Git -Arguments @("rev-parse", "HEAD")).Output
    $remoteHead = (Invoke-Git -Arguments @("rev-parse", "--verify", $remoteRef)).Output

    $remoteIsAncestor = Invoke-Git -Arguments @("merge-base", "--is-ancestor", $remoteRef, "HEAD") -AllowedExitCodes @(0, 1)
    $localIsAncestor = Invoke-Git -Arguments @("merge-base", "--is-ancestor", "HEAD", $remoteRef) -AllowedExitCodes @(0, 1)
    if ($remoteIsAncestor.ExitCode -ne 0) {
        if ($localIsAncestor.ExitCode -eq 0) {
            Write-SyncLog -Level WARN -Message "Skipped: local '$Branch' is behind '$Remote/$Branch'."
        }
        else {
            Write-SyncLog -Level ERROR -Message "Skipped: local and remote '$Branch' have diverged."
        }
        return 0
    }

    $statusBefore = (Invoke-Git -Arguments @(
        "-c", "core.quotepath=false", "status", "--porcelain=v1", "--untracked-files=all"
    )).Output
    $hasWorkingChanges = -not [string]::IsNullOrWhiteSpace($statusBefore)
    $hasUnpushedCommits = $localHead -ne $remoteHead

    if (-not $hasWorkingChanges -and -not $hasUnpushedCommits) {
        Write-SyncLog -Level INFO -Message "No changes to sync."
        return 0
    }

    if ($DryRun) {
        Write-SyncLog -Level INFO -Message "Dry run: validation, commit, and push would run now."
        return 0
    }

    Invoke-ProjectValidation

    $statusAfterValidation = (Invoke-Git -Arguments @(
        "-c", "core.quotepath=false", "status", "--porcelain=v1", "--untracked-files=all"
    )).Output
    if ($statusAfterValidation -ne $statusBefore) {
        Write-SyncLog -Level WARN -Message "Skipped: working tree changed while validation was running."
        return 0
    }

    if ($hasWorkingChanges) {
        Invoke-Git -Arguments @("add", "--all") | Out-Null
        $script:StagedByScript = $true
        Test-StagedContent

        $unstagedCheck = Invoke-Git -Arguments @("diff", "--quiet") -AllowedExitCodes @(0, 1)
        $untracked = (Invoke-Git -Arguments @("ls-files", "--others", "--exclude-standard")).Output
        if ($unstagedCheck.ExitCode -ne 0 -or -not [string]::IsNullOrWhiteSpace($untracked)) {
            throw "Working tree changed after files were staged."
        }

        $commitMessage = "chore(auto): sync " + (Get-Date -Format "yyyy-MM-dd HH:mm:ss zzz")
        Invoke-Git -Arguments @("commit", "-m", $commitMessage) | Out-Null
        $script:CommitCreated = $true
        $script:StagedByScript = $false
        Write-SyncLog -Level INFO -Message "Created commit: $commitMessage"
    }

    Invoke-PushWithRetry
    $pushedHead = (Invoke-Git -Arguments @("rev-parse", "HEAD")).Output
    Write-SyncLog -Level INFO -Message "Pushed $pushedHead to $Remote/$Branch."
    return 0
}

$mutex = $null
$mutexAcquired = $false
try {
    $hashBytes = [System.Security.Cryptography.SHA256]::Create().ComputeHash(
        [System.Text.Encoding]::UTF8.GetBytes($script:RepoRoot.ToLowerInvariant())
    )
    $hash = ([System.BitConverter]::ToString($hashBytes)).Replace("-", "").Substring(0, 16)
    $mutex = New-Object System.Threading.Mutex($false, "Local\GitHubAutoSync-$hash")
    $mutexAcquired = $mutex.WaitOne(0)
    if (-not $mutexAcquired) {
        Write-SyncLog -Level INFO -Message "Another sync is already running."
        exit 0
    }

    exit (Invoke-AutoSync)
}
catch {
    if ($script:StagedByScript -and -not $script:CommitCreated) {
        try {
            Invoke-Git -Arguments @("reset", "--quiet") | Out-Null
        }
        catch {
            Write-SyncLog -Level ERROR -Message "Failed to restore the index after an error: $_"
        }
    }

    Write-SyncLog -Level ERROR -Message $_.Exception.Message
    exit 1
}
finally {
    if ($mutexAcquired -and $null -ne $mutex) {
        $mutex.ReleaseMutex()
    }
    if ($null -ne $mutex) {
        $mutex.Dispose()
    }
}
