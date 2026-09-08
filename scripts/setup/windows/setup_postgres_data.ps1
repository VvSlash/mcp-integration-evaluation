. "$PSScriptRoot\_common.ps1"
$repoRoot = Get-RepoRoot
& powershell -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'install_postgres_binaries.ps1')
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Invoke-NativeChecked -Command 'npm.cmd' -Arguments @('run', 'setup:test-db') -WorkingDirectory $repoRoot
Write-Ok 'Temporary credentials: .env.test.local (ignored). Stop: npm run stop:test-db'
