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
    if (-not $FullSuite) { $mavenArguments += '-Dtest=PostgresIntegrationTest,PostgresProcessRecoveryTest,FullApplicationProcessTest,PostgresConcurrencyTest' }
    & $MavenCommand @mavenArguments *> (Join-Path $runRoot 'maven.log')
    $verificationExit = $LASTEXITCODE
    if ($verificationExit -ne 0) {
        # Preserve failed-run evidence before cleanup as carefully as passing evidence.
        foreach ($artifact in @('surefire-reports', 'process-recovery', 'full-application', 'concurrency', 'plugin-preview-browser', 'render-parity', 'render-parity-runs')) {
            $artifactPath = Join-Path $backendRoot ('target\' + $artifact)
            if (Test-Path -LiteralPath $artifactPath) {
                Copy-Item -LiteralPath $artifactPath -Destination (Join-Path $runRoot $artifact) -Recurse
            }
        }
        [IO.File]::WriteAllText((Join-Path $runRoot 'verification-status.txt'), "FAIL: Maven exit $verificationExit; copied reports may include previous runs; use XML timestamps and Maven log.", [Text.UTF8Encoding]::new($false))
        throw 'Maven verification failed; evidence preserved'
    }
    foreach ($testClass in @('PostgresIntegrationTest', 'PostgresProcessRecoveryTest', 'FullApplicationProcessTest', 'PostgresConcurrencyTest')) {
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
    Copy-Item -LiteralPath (Join-Path $backendRoot 'target\concurrency') -Destination (Join-Path $runRoot 'concurrency') -Recurse
    if (Test-Path -LiteralPath (Join-Path $backendRoot 'target\render-parity-runs')) {
        Copy-Item -LiteralPath (Join-Path $backendRoot 'target\render-parity-runs') -Destination (Join-Path $runRoot 'render-parity-runs') -Recurse
    }
    $remainingSchemas = & (Join-Path $PostgresBin 'psql.exe') -h 127.0.0.1 -p $testPort -U duowei_test_admin -d duowei_acceptance -At -c "SELECT count(*) FROM information_schema.schemata WHERE schema_name LIKE 'duowei_test_%'"
    if ($LASTEXITCODE -ne 0 -or $remainingSchemas.Trim() -ne '0') { throw 'Test schema cleanup verification failed' }
    # Backup rehearsal uses only this instance and a separate destination database.
    $seedPath = Join-Path $runRoot 'rollback-seed.sql'
    $seedSql = "CREATE SCHEMA duowei_test_rollback; SET search_path TO duowei_test_rollback;" + [Environment]::NewLine
    foreach ($migration in @('0001_duowei_automation_template.sql', '0002_duowei_automation_background.sql')) {
        $seedSql += [IO.File]::ReadAllText((Join-Path $backendRoot ('migrations\' + $migration))) + [Environment]::NewLine
    }
    $seedSql += "INSERT INTO duowei_automation_template(tenant_key,base_token,table_id,template_id,revision,name,status,snapshot,referenced_field_ids) VALUES ('tenant','base','table','template','r1','rollback-fixture','ready','{}','[]');"
    $seedSql += "INSERT INTO duowei_automation_background_job(job_id,task_key,status,attempt,submission,file_token) VALUES ('queued','queued','queued',0,'{}',NULL),('processing','processing','processing',1,'{}',NULL),('succeeded','succeeded','succeeded',1,'{}','isolated-file-token');"
    $seedSql += "INSERT INTO duowei_automation_app_ticket(app_id,ticket,received_at) VALUES ('cli_test','isolated-ticket',CURRENT_TIMESTAMP);"
    [IO.File]::WriteAllText($seedPath, $seedSql, [Text.UTF8Encoding]::new($false))
    & (Join-Path $PostgresBin 'psql.exe') -h 127.0.0.1 -p $testPort -U duowei_test_admin -d duowei_acceptance -v ON_ERROR_STOP=1 -f $seedPath *> (Join-Path $runRoot 'rollback-seed.log')
    if ($LASTEXITCODE -ne 0) { throw 'Rollback seed failed' }
    $snapshotPath = Join-Path $runRoot 'isolated-backup.dump'
    & (Join-Path $PostgresBin 'pg_dump.exe') -h 127.0.0.1 -p $testPort -U duowei_test_admin -d duowei_acceptance -Fc -f $snapshotPath *> (Join-Path $runRoot 'backup.log')
    if ($LASTEXITCODE -ne 0) { throw 'Backup failed' }
    & (Join-Path $PostgresBin 'createdb.exe') -h 127.0.0.1 -p $testPort -U duowei_test_admin duowei_restore *> (Join-Path $runRoot 'restore-createdb.log')
    if ($LASTEXITCODE -ne 0) { throw 'Restore database creation failed' }
    & (Join-Path $PostgresBin 'pg_restore.exe') -h 127.0.0.1 -p $testPort -U duowei_test_admin -d duowei_restore --exit-on-error $snapshotPath *> (Join-Path $runRoot 'restore.log')
    if ($LASTEXITCODE -ne 0) { throw 'Restore failed' }
    $compareSql = "SELECT json_build_object('templates',(SELECT json_agg(t ORDER BY template_id) FROM duowei_test_rollback.duowei_automation_template t),'jobs',(SELECT json_agg(j ORDER BY job_id) FROM duowei_test_rollback.duowei_automation_background_job j),'tickets',(SELECT json_agg(a ORDER BY app_id) FROM duowei_test_rollback.duowei_automation_app_ticket a))::text"
    $sourceSnapshot = & (Join-Path $PostgresBin 'psql.exe') -h 127.0.0.1 -p $testPort -U duowei_test_admin -d duowei_acceptance -At -v ON_ERROR_STOP=1 -c $compareSql
    if ($LASTEXITCODE -ne 0) { throw 'Source snapshot failed' }
    $restoredSnapshot = & (Join-Path $PostgresBin 'psql.exe') -h 127.0.0.1 -p $testPort -U duowei_test_admin -d duowei_restore -At -v ON_ERROR_STOP=1 -c $compareSql
    if ($LASTEXITCODE -ne 0 -or ($sourceSnapshot -join "`n") -cne ($restoredSnapshot -join "`n")) { throw 'Restored records differ' }
    [IO.File]::WriteAllText((Join-Path $runRoot 'rollback-data-result.txt'), 'PASS: complete fixture rows match after pg_dump/pg_restore, including timestamps, statuses, attempts, submissions, file token and ticket. No service cutover or external rollback claim.', [Text.UTF8Encoding]::new($false))
    foreach ($databaseName in @('duowei_acceptance', 'duowei_restore')) {
        & (Join-Path $PostgresBin 'psql.exe') -h 127.0.0.1 -p $testPort -U duowei_test_admin -d $databaseName -v ON_ERROR_STOP=1 -c 'DROP SCHEMA duowei_test_rollback CASCADE' *> (Join-Path $runRoot ($databaseName + '-rollback-cleanup.log'))
        if ($LASTEXITCODE -ne 0) { throw 'Rollback fixture cleanup failed' }
    }
    Write-Output 'PostgreSQL integration and backup/restore executed successfully; temporary schemas cleaned.'
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
