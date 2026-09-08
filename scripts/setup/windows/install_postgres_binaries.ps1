. "$PSScriptRoot\_common.ps1"
$repoRoot = Get-RepoRoot
$pin = Get-Content -LiteralPath (Join-Path $repoRoot 'config\postgres\windows-binaries.json') -Raw | ConvertFrom-Json
$destination = Join-Path $repoRoot 'third_party\postgres'
$candidates = @((Join-Path $destination 'pgsql\bin\initdb.exe'))
if ($env:POSTGRES_BIN) { $candidates += Join-Path $env:POSTGRES_BIN 'initdb.exe' }
$candidates += @(Get-ChildItem 'C:\Program Files\PostgreSQL\*\bin\initdb.exe' -ErrorAction SilentlyContinue | ForEach-Object FullName)
foreach ($candidate in $candidates) {
    if ((Test-Path -LiteralPath $candidate) -and ((& $candidate --version) -match ([regex]::Escape($pin.version) + '$'))) {
        Write-Ok "PostgreSQL $($pin.version) binaries available: $candidate"
        exit 0
    }
}
New-Item -ItemType Directory -Force -Path $destination | Out-Null
$archive = Join-Path $destination "postgresql-$($pin.version)-windows-x64.zip"
if (-not (Test-Path -LiteralPath $archive)) {
    Write-Step "Downloading pinned portable PostgreSQL $($pin.version) from EDB"
    Invoke-WebRequest -UseBasicParsing -Uri $pin.url -OutFile ($archive + '.partial')
    Move-Item -LiteralPath ($archive + '.partial') -Destination $archive
}
Expand-Archive -LiteralPath $archive -DestinationPath $destination -Force
$installed = Join-Path $destination 'pgsql\bin\initdb.exe'
if (-not (Test-Path -LiteralPath $installed)) { throw 'Archive does not contain initdb.exe' }
if ((& $installed --version) -notmatch ([regex]::Escape($pin.version) + '$')) { throw 'Unexpected PostgreSQL version' }
@{ version=$pin.version; url=$pin.url; sha256=(Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash; downloadedAt=(Get-Date).ToUniversalTime().ToString('o') } |
    ConvertTo-Json | Set-Content -LiteralPath (Join-Path $destination 'download-manifest.json') -Encoding UTF8
Write-Ok 'Portable binaries ready. No service was installed.'
