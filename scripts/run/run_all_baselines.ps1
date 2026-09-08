
param([int]$Iterations = 30)

. "$PSScriptRoot\..\setup\windows\_common.ps1"
$repoRoot = Get-RepoRoot

if (-not (Test-Path (Join-Path $repoRoot ".env"))) {
    Write-ErrMsg "Brak .env -- skopiuj .env.example i uzupelnij dane polaczenia z PostgreSQL."
    exit 1
}
if (-not (Test-Path (Join-Path $repoRoot "node_modules"))) {
    Write-ErrMsg "Brak node_modules -- uruchom najpierw scripts/setup/windows/install_node_dependencies.ps1"
    exit 1
}

$failures = 0

Write-Step "Baseline PostgreSQL ($Iterations iteracji na scenariusz, PG-001..PG-004)"
try {
    Invoke-NativeChecked -Command "npm" -Arguments @("run", "baseline:postgres", "--", "$Iterations") -WorkingDirectory $repoRoot
    Write-Ok "Baseline PostgreSQL zakonczony."
} catch {
    $failures += 1
    Write-ErrMsg "Baseline PostgreSQL nie powiodl sie: $($_.Exception.Message)"
    Write-Host "Sprawdz: czy PostgreSQL dziala i czy wykonano setup_postgres_data.ps1."
}

Write-Step "Baseline REST ($Iterations iteracji na scenariusz; API startowane przez runner ze swiezym seedem)"
try {
    Invoke-NativeChecked -Command "npm" -Arguments @("run", "baseline:rest", "--", "$Iterations") -WorkingDirectory $repoRoot
    Write-Ok "Baseline REST zakonczony."
} catch {
    $failures += 1
    Write-ErrMsg "Baseline REST nie powiodl sie: $($_.Exception.Message)"
    Write-Host "Sprawdz: czy port REST_API_PORT (domyslnie 4100) jest wolny i czy istnieje seed (npm run data:rest-seed)."
}

Write-Step "Najnowsze pliki wynikowe w results/raw/"
Get-ChildItem (Join-Path $repoRoot "results\raw") -File -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending | Select-Object -First 4 |
    ForEach-Object { Write-Host "  $($_.Name)" }

if ($failures -gt 0) { exit 1 }
Write-Ok "Wszystkie dostepne baseline'y wykonane."
