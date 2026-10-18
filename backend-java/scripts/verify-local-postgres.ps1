param(
    [Parameter(Mandatory = $true)][string]$PostgresBin,
    [Parameter(Mandatory = $true)][string]$MavenCommand,
    [Parameter(Mandatory = $true)][string]$JavaHome,
    [string]$EvidenceRoot = 'C:\codex-tmp\duowei-postgres-runs',
    [switch]$FullSuite
)

$ErrorActionPreference = 'Stop'
$backendRoot = Split-Path -Parent $PSScriptRoot
$runRoot = Join-Path $EvidenceRoot ([guid]::NewGuid().ToString('N'))
$dataRoot = Join-Path $runRoot 'data'
$passwordFile = Join-Path $runRoot 'init-password.txt'
$variableNames = @('JAVA_HOME', 'PGPASSWORD', 'DUOWEI_TEST_POSTGRES_URL', 'DUOWEI_TEST_POSTGRES_USERNAME', 'DUOWEI_TEST_POSTGRES_PASSWORD')
$savedVariables = @{}
foreach ($name in $variableNames) {
    $savedVariables[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
}
$started = $false
New-Item -ItemType Directory -Path $runRoot | Out-Null
$listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
$listener.Start()
$testPort = $listener.LocalEndpoint.Port
$listener.Stop()
$testPassword = [guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N')
try {
    [IO.File]::WriteAllText($passwordFile, $testPassword, [Text.UTF8Encoding]::new($false))
    & (Join-Path $PostgresBin 'initdb.exe') -D $dataRoot -U duowei_test_admin --encoding=UTF8 --locale=C --auth=scram-sha-256 --pwfile=$passwordFile *> (Join-Path $runRoot 'initdb.log')
    if ($LASTEXITCODE -ne 0) { throw 'initdb failed' }
    Remove-Item -LiteralPath $passwordFile
    $startArguments = @('-D', ('"' + $dataRoot + '"'), '-l', ('"' + (Join-Path $runRoot 'postgres.log') + '"'), '-o', ('"-h 127.0.0.1 -p ' + $testPort + '"'), '-w', 'start')
    $startProcess = Start-Process -FilePath (Join-Path $PostgresBin 'pg_ctl.exe') -ArgumentList $startArguments -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $runRoot 'start.log') -RedirectStandardError (Join-Path $runRoot 'start-error.log')
    $startProcess.WaitForExit()
    if ($startProcess.ExitCode -ne 0) { throw 'PostgreSQL start failed' }
    $started = $true
    $env:PGPASSWORD = $testPassword
    & (Join-Path $PostgresBin 'createdb.exe') -h 127.0.0.1 -p $testPort -U duowei_test_admin duowei_acceptance *> (Join-Path $runRoot 'createdb.log')
    if ($LASTEXITCODE -ne 0) { throw 'Create database failed' }
    $env:JAVA_HOME = $JavaHome
    $env:DUOWEI_TEST_POSTGRES_URL = "jdbc:postgresql://127.0.0.1:$testPort/duowei_acceptance"
    $env:DUOWEI_TEST_POSTGRES_USERNAME = 'duowei_test_admin'
    $env:DUOWEI_TEST_POSTGRES_PASSWORD = $testPassword
    & $MavenCommand -f (Join-Path $backendRoot 'pom.xml') -B spotless:apply package -DskipTests -q *> (Join-Path $runRoot 'package.log')
    if ($LASTEXITCODE -ne 0) { throw 'JAR packaging failed' }
    $testedJar = Join-Path $runRoot 'tested-backend.jar'
    Copy-Item -LiteralPath (Join-Path $backendRoot 'target\print-backend-1.0.0.jar') -Destination $testedJar
    (Get-FileHash -LiteralPath $testedJar -Algorithm SHA256).Hash | Set-Content -LiteralPath (Join-Path $runRoot 'tested-jar.sha256')
    $mavenArguments = @('-f', (Join-Path $backendRoot 'pom.xml'), '-B', 'spotless:apply', 'verify', '-q')
    $mavenArguments += ('-Dduowei.test.packagedJar=' + $testedJar)
    if (-not $FullSuite) { $mavenArguments += '-Dtest=PostgresIntegrationTest,PostgresProcessRecoveryTest,FullApplicationProcessTest' }
    & $MavenCommand @mavenArguments *> (Join-Path $runRoot 'maven.log')
    if ($LASTEXITCODE -ne 0) { throw 'Maven verification failed' }
    foreach ($testClass in @('PostgresIntegrationTest', 'PostgresProcessRecoveryTest', 'FullApplicationProcessTest')) {
        $report = Join-Path $backendRoot ('target\surefire-reports\TEST-com.duowei.print.' + $testClass + '.xml')
        Copy-Item -LiteralPath $report -Destination (Join-Path $runRoot ($testClass + '.xml'))
        [xml]$result = Get-Content -LiteralPath $report -Raw
        if ([int]$result.testsuite.tests -lt 1 -or [int]$result.testsuite.skipped -ne 0 -or [int]$result.testsuite.errors -ne 0 -or [int]$result.testsuite.failures -ne 0) {
            throw "$testClass did not execute successfully"
        }
    }
    Copy-Item -LiteralPath (Join-Path $backendRoot 'target\surefire-reports') -Destination (Join-Path $runRoot 'surefire-reports') -Recurse
    Copy-Item -LiteralPath (Join-Path $backendRoot 'target\process-recovery') -Destination (Join-Path $runRoot 'process-recovery') -Recurse
    Copy-Item -LiteralPath (Join-Path $backendRoot 'target\full-application') -Destination (Join-Path $runRoot 'full-application') -Recurse
    $remainingSchemas = & (Join-Path $PostgresBin 'psql.exe') -h 127.0.0.1 -p $testPort -U duowei_test_admin -d duowei_acceptance -At -c "SELECT count(*) FROM information_schema.schemata WHERE schema_name LIKE 'duowei_test_%'"
    if ($LASTEXITCODE -ne 0 -or $remainingSchemas.Trim() -ne '0') { throw 'Test schema cleanup verification failed' }
    Write-Output 'PostgreSQL integration executed successfully; temporary test schemas cleaned.'
} finally {
    if ($started) {
        & (Join-Path $PostgresBin 'pg_ctl.exe') -D $dataRoot -m fast -w stop *> (Join-Path $runRoot 'stop.log')
        if ($LASTEXITCODE -ne 0) { Write-Warning 'PostgreSQL stop failed; inspect this run directory.' }
    }
    if (Test-Path -LiteralPath $passwordFile) { Remove-Item -LiteralPath $passwordFile }
    foreach ($name in $variableNames) {
        [Environment]::SetEnvironmentVariable($name, $savedVariables[$name], 'Process')
    }
    Write-Output "Evidence: $runRoot"
}
