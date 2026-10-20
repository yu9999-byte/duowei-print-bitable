param([Parameter(Mandatory = $true)][string]$PostgresBin)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$runRoot = Join-Path $projectRoot ('artifacts/table-view-2026-10-19/postgres-' + [guid]::NewGuid().ToString('N'))
$dataRoot = Join-Path $runRoot 'data'
$passwordFile = Join-Path $runRoot 'init-password.txt'
New-Item -ItemType Directory -Path $runRoot | Out-Null
$variableNames = @('PGHOST','PGPORT','PGUSER','PGPASSWORD','PGDATABASE','DUOWEI_TEST_PSQL')
$savedVariables = @{}
foreach ($name in $variableNames) { $savedVariables[$name] = [Environment]::GetEnvironmentVariable($name, 'Process') }
$listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
$listener.Start()
$testPort = $listener.LocalEndpoint.Port
$listener.Stop()
$started = $false
try {
    $testPassword = [guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N')
    [IO.File]::WriteAllText($passwordFile, $testPassword, [Text.UTF8Encoding]::new($false))
    & (Join-Path $PostgresBin 'initdb.exe') -D $dataRoot -U shared_test --encoding=UTF8 --locale=C --auth=scram-sha-256 --pwfile=$passwordFile *> (Join-Path $runRoot 'initdb.log')
    if ($LASTEXITCODE -ne 0) { throw 'initdb failed' }
    Remove-Item -LiteralPath $passwordFile
    $startArguments = @('-D', ('"' + $dataRoot + '"'), '-l', ('"' + (Join-Path $runRoot 'postgres.log') + '"'), '-o', ('"-h 127.0.0.1 -p ' + $testPort + '"'), '-w', 'start')
    $startProcess = Start-Process -FilePath (Join-Path $PostgresBin 'pg_ctl.exe') -ArgumentList $startArguments -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $runRoot 'start.log') -RedirectStandardError (Join-Path $runRoot 'start-error.log')
    $startProcess.WaitForExit()
    if ($startProcess.ExitCode -ne 0) { throw 'PostgreSQL start failed' }
    $started = $true
    $env:PGHOST = '127.0.0.1'; $env:PGPORT = [string]$testPort; $env:PGUSER = 'shared_test'; $env:PGPASSWORD = $testPassword; $env:PGDATABASE = 'postgres'
    $env:DUOWEI_TEST_PSQL = Join-Path $PostgresBin 'psql.exe'
    & node (Join-Path $PSScriptRoot 'verify-shared-template-postgres.mjs') *> (Join-Path $runRoot 'verification.log')
    if ($LASTEXITCODE -ne 0) { Get-Content -LiteralPath (Join-Path $runRoot 'verification.log'); throw 'Shared template PostgreSQL verification failed' }
    Get-Content -LiteralPath (Join-Path $runRoot 'verification.log')
} finally {
    if ($started) {
        & (Join-Path $PostgresBin 'pg_ctl.exe') -D $dataRoot -m fast -w stop *> (Join-Path $runRoot 'stop.log')
        if ($LASTEXITCODE -ne 0) { Write-Warning 'Test PostgreSQL stop failed; inspect the exact data directory reported above' }
    }
    # Keep logs, not the disposable cluster or generated password hashes.
    $resolvedData = [IO.Path]::GetFullPath($dataRoot)
    $resolvedRun = [IO.Path]::GetFullPath($runRoot)
    $resolvedProject = [IO.Path]::GetFullPath($projectRoot)
    if ($resolvedRun.StartsWith($resolvedProject + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase) -and
        $resolvedData -eq (Join-Path $resolvedRun 'data') -and
        !(Test-Path -LiteralPath (Join-Path $resolvedData 'postmaster.pid')) -and
        (Test-Path -LiteralPath $resolvedData)) {
        Remove-Item -LiteralPath $resolvedData -Recurse -Force
    }
    if (Test-Path -LiteralPath $passwordFile) { Remove-Item -LiteralPath $passwordFile }
    foreach ($name in $variableNames) { [Environment]::SetEnvironmentVariable($name, $savedVariables[$name], 'Process') }
}
