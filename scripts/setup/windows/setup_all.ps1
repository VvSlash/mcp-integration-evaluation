
param(
    [switch]$SkipBlender,
    [switch]$SkipThirdParty,
    [switch]$SkipOllama,
    [switch]$SkipPostgres,
    [switch]$WithEvalFrameworks
)

. "$PSScriptRoot\_common.ps1"
$repoRoot = Get-RepoRoot

$steps = @()
$steps += @{ Name = "Zaleznosci Node";      Script = "install_node_dependencies.ps1";        Skip = $false }
$steps += @{ Name = "Zaleznosci Python";    Script = "install_python_dependencies.ps1";      Skip = $false }
$steps += @{ Name = "Model Ollama";         Script = "install_ollama_models.ps1";            Skip = [bool]$SkipOllama }
$steps += @{ Name = "Baza PostgreSQL";      Script = "setup_postgres_data.ps1";              Skip = [bool]$SkipPostgres }
$steps += @{ Name = "Fixture'y Excel";      Script = "setup_excel_fixtures.ps1";             Skip = $false }
$steps += @{ Name = "Gotowce MCP";          Script = "download_third_party_mcp_servers.ps1"; Skip = [bool]$SkipThirdParty }
$steps += @{ Name = "Blender";              Script = "install_blender.ps1";                  Skip = [bool]$SkipBlender }
$steps += @{ Name = "Inspektor kontraktow mcp-interviewer (wymagany)"; Script = "install_eval_frameworks.ps1"; Arguments = @("-Only", "mcp-interviewer"); Skip = [bool]$WithEvalFrameworks }
$steps += @{ Name = "Pelny zestaw frameworkow (OPCJONALNE)"; Script = "install_eval_frameworks.ps1"; Skip = (-not $WithEvalFrameworks) }

$summary = @()
foreach ($step in $steps) {
    if ($step.Skip) {
        Write-WarnMsg "Pomijam krok: $($step.Name)"
        $summary += "[POMINIETO] $($step.Name)"
        continue
    }
    Write-Host ""
    Write-Host ("=" * 70) -ForegroundColor DarkCyan
    Write-Step "KROK: $($step.Name)  ($($step.Script))"
    $stepArguments = @($step.Arguments | Where-Object { $_ })
    & powershell -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot $step.Script) @stepArguments
    if ($LASTEXITCODE -eq 0) {
        $summary += "[OK]        $($step.Name)"
    } else {
        $summary += "[BLAD]      $($step.Name) -- napraw wg komunikatow i uruchom ponownie (idempotentne)"
    }
}

Write-Host ""
Write-Step "KROK: Fixture'y JSON + seed REST API (generatory deterministyczne)"
try {
    Invoke-NativeChecked -Command "npm" -Arguments @("run", "data:json") -WorkingDirectory $repoRoot
    Invoke-NativeChecked -Command "npm" -Arguments @("run", "data:rest-seed") -WorkingDirectory $repoRoot
    $summary += "[OK]        Fixture'y JSON + seed REST"
} catch {
    Write-ErrMsg $_.Exception.Message
    $summary += "[BLAD]      Fixture'y JSON + seed REST"
}

Write-Host ""
Write-Host ("=" * 70) -ForegroundColor DarkCyan
Write-Step "PODSUMOWANIE SETUPU"
$summary | ForEach-Object { Write-Host "  $_" }
Write-Host ""
Write-Host "Nastepne kroki: smoke test serwerow (MCP Inspector),"
Write-Host "potem pilot: npm run campaign:suite -- --phase pilot --campaign pilot-local"
if (@($summary | Where-Object { $_ -like '[[]BLAD]*' }).Count -gt 0) { exit 1 }
