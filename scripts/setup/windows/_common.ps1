
$ErrorActionPreference = "Stop"

function Get-RepoRoot {
    $dir = $PSScriptRoot
    while ($dir -and -not (Test-Path (Join-Path $dir "package.json"))) {
        $parent = Split-Path -Parent $dir
        if ($parent -eq $dir) { $dir = $null; break }
        $dir = $parent
    }
    if (-not $dir) { throw "Nie znaleziono katalogu glownego repo (package.json)." }
    return $dir
}

function Write-Step([string]$Message) { Write-Host "==> $Message" -ForegroundColor Cyan }
function Write-Ok([string]$Message)   { Write-Host "[OK] $Message" -ForegroundColor Green }
function Write-WarnMsg([string]$Message) { Write-Host "[UWAGA] $Message" -ForegroundColor Yellow }
function Write-ErrMsg([string]$Message)  { Write-Host "[BLAD] $Message" -ForegroundColor Red }

function Test-CommandExists([string]$Name) {
    return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

function Read-DotEnv {
    param([string]$RepoRoot)
    $envFile = Join-Path $RepoRoot ".env"
    if (-not (Test-Path $envFile)) { $envFile = Join-Path $RepoRoot ".env.example" }
    $result = @{}
    if (Test-Path $envFile) {
        foreach ($line in Get-Content $envFile) {
            $trimmed = $line.Trim()
            if ($trimmed -eq "" -or $trimmed.StartsWith("#")) { continue }
            $idx = $trimmed.IndexOf("=")
            if ($idx -lt 1) { continue }
            $key = $trimmed.Substring(0, $idx).Trim()
            $value = $trimmed.Substring($idx + 1).Trim()
            $result[$key] = $value
        }
    }
    return $result
}

function Set-DotEnvValue {
    param([string]$RepoRoot, [string]$Key, [string]$Value)
    $envFile = Join-Path $RepoRoot ".env"
    if (-not (Test-Path $envFile)) {
        $example = Join-Path $RepoRoot ".env.example"
        if (Test-Path $example) { Copy-Item $example $envFile }
        else { New-Item -ItemType File -Path $envFile | Out-Null }
        Write-WarnMsg ".env nie istnial -- utworzono z .env.example. Uzupelnij sekrety recznie."
    }
    $lines = @(Get-Content $envFile)
    $pattern = "^\s*$([regex]::Escape($Key))\s*="
    $found = $false
    $newLines = foreach ($line in $lines) {
        if ($line -match $pattern) { $found = $true; "$Key=$Value" } else { $line }
    }
    if (-not $found) { $newLines = @($newLines) + "$Key=$Value" }
    Set-Content -Path $envFile -Value $newLines -Encoding Ascii
    Write-Ok "Zapisano $Key do .env"
}

function Invoke-NativeChecked {
    param([string]$Command, [string[]]$Arguments, [string]$WorkingDirectory)
    $prevLocation = $null
    if ($WorkingDirectory) { $prevLocation = Get-Location; Set-Location $WorkingDirectory }
    try {
        & $Command @Arguments
        if ($LASTEXITCODE -ne 0) {
            throw "Polecenie '$Command $($Arguments -join ' ')' zakonczylo sie kodem $LASTEXITCODE."
        }
    } finally {
        if ($prevLocation) { Set-Location $prevLocation }
    }
}
