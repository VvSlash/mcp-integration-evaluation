
param(
    [int]$Iterations = 30,
    [string]$Server = "all"
)

. "$PSScriptRoot\..\setup\windows\_common.ps1"
$repoRoot = Get-RepoRoot

if (-not (Test-Path (Join-Path $repoRoot ".env"))) {
    Write-ErrMsg "Brak .env -- skopiuj .env.example i uzupelnij dane polaczenia."
    exit 1
}
if (-not (Test-Path (Join-Path $repoRoot "node_modules"))) {
    Write-ErrMsg "Brak node_modules -- uruchom scripts/setup/windows/install_node_dependencies.ps1"
    exit 1
}

$failures = 0

Write-Step "Wspolny runner MCP-only: serwer(y) '$Server', $Iterations iteracji na scenariusz"
try {
    Invoke-NativeChecked -Command "npm" -Arguments @("run", "mcp:all", "--", "--server", $Server, "--iterations", "$Iterations") -WorkingDirectory $repoRoot
    Write-Ok "Wspolny runner MCP-only zakonczony."
} catch {
    $failures += 1
    Write-ErrMsg "Wspolny runner MCP-only nie powiodl sie: $($_.Exception.Message)"
    Write-Host "Sprawdz: PostgreSQL (serwery SQL), fixture'y JSON (npm run data:json), seed REST (npm run data:rest-seed), wolny port REST_API_PORT."
    Write-Host "Diagnostyka pojedynczego serwera: npm run mcp:all -- --server <nazwa> albo runnery dedykowane (mcp:postgres[:sql], mcp:json, mcp:rest)."
}

Write-Step "Najnowsze przebiegi w results/raw/"
Get-ChildItem (Join-Path $repoRoot "results\raw") -Directory -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -ne "legacy" -and $_.Name -ne "external" } |
    Sort-Object LastWriteTime -Descending | Select-Object -First 3 |
    ForEach-Object { Write-Host "  $($_.Name)" }

if ($failures -gt 0) { exit 1 }
Write-Ok "Wszystkie dostepne przebiegi MCP-only wykonane."
