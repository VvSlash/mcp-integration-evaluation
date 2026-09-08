
param(
    [int]$Iterations = 10,
    [string]$Server = "all",
    [ValidateSet("scenario", "full")][string]$Catalog = "scenario",
    [switch]$WithLegacyRunners
)

. "$PSScriptRoot\..\setup\windows\_common.ps1"
$repoRoot = Get-RepoRoot

if (-not (Test-Path (Join-Path $repoRoot ".env"))) {
    Write-ErrMsg "Brak .env -- skopiuj .env.example, uzupelnij i uruchom install_ollama_models.ps1 (ustawia OLLAMA_MODEL)."
    exit 1
}

Write-Step "Weryfikacja polaczenia z Ollama (npm run check:ollama)"
try {
    Invoke-NativeChecked -Command "npm" -Arguments @("run", "check:ollama") -WorkingDirectory $repoRoot
    Write-Ok "Ollama odpowiada."
} catch {
    Write-ErrMsg "Ollama nie odpowiada: $($_.Exception.Message)"
    Write-Host "Naprawa: uruchom aplikacje Ollama (lub 'ollama serve') i scripts/setup/windows/install_ollama_models.ps1."
    exit 1
}

$failures = 0

Write-Step "Wspolny runner MCP+LLM: serwer(y) '$Server', katalog '$Catalog', $Iterations iteracji na scenariusz"
try {
    Invoke-NativeChecked -Command "npm" -Arguments @("run", "llm:all", "--", "--server", $Server, "--catalog", $Catalog, "--iterations", "$Iterations") -WorkingDirectory $repoRoot
    Write-Ok "Wspolny runner MCP+LLM zakonczony."
} catch {
    $failures += 1
    Write-ErrMsg "Wspolny runner MCP+LLM nie powiodl sie: $($_.Exception.Message)"
    Write-Host "Diagnostyka pojedynczego scenariusza: npm run llm:all -- --server <nazwa> --scenario <ID> --iterations 1"
}

if ($WithLegacyRunners) {
    Write-Step "Runnery dedykowane SQL (z wariantem referencyjnym llm_only)"
    foreach ($script in @("llm:postgres:mcp", "llm:postgres:mcp-sql")) {
        try {
            Invoke-NativeChecked -Command "npm" -Arguments @("run", $script) -WorkingDirectory $repoRoot
            Write-Ok "$script zakonczony."
        } catch {
            $failures += 1
            Write-ErrMsg "$script nie powiodl sie: $($_.Exception.Message)"
        }
    }
} else {
    Write-WarnMsg "Wariant referencyjny llm_only (porownania tokenowe SQL) licza runnery dedykowane -- dolacz przelacznikiem -WithLegacyRunners."
}

Write-Step "Najnowsze przebiegi w results/raw/"
Get-ChildItem (Join-Path $repoRoot "results\raw") -Directory -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -ne "legacy" -and $_.Name -ne "external" } |
    Sort-Object LastWriteTime -Descending | Select-Object -First 3 |
    ForEach-Object { Write-Host "  $($_.Name)" }

if ($failures -gt 0) { exit 1 }
Write-Ok "Wszystkie zlecone przebiegi MCP+LLM wykonane."
