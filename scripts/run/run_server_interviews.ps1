param(
    [string]$Server = "all",
    [switch]$WithLlm
)

. "$PSScriptRoot\..\setup\windows\_common.ps1"
$repoRoot = Get-RepoRoot

$implementedServers = @("sql-controlled", "sql-minimal", "json", "rest-api", "blender")

$targets = if ($Server -eq "all") { $implementedServers } else { @($Server) }
foreach ($target in $targets) {
    if ($target -eq "blender" -and $WithLlm) {
        Write-WarnMsg "[blender] -WithLlm wywoluje narzedzia -- wymaga dzialajacego mostu TCP :9877."
    }
    if ($implementedServers -notcontains $target) {
        Write-ErrMsg "Nieznany serwer '$target'. Zaimplementowane: $($implementedServers -join ', ')."
        exit 1
    }
}

$interviewerExe = Join-Path $repoRoot "third_party\eval-frameworks\mcp-interviewer\.venv\Scripts\mcp-interviewer.exe"
if (-not (Test-Path $interviewerExe)) {
    Write-ErrMsg "mcp-interviewer nie jest zainstalowany ($interviewerExe)."
    Write-Host "Naprawa: powershell -ExecutionPolicy Bypass -File scripts/setup/windows/install_eval_frameworks.ps1 -Only mcp-interviewer"
    exit 1
}

$tsxCli = Join-Path $repoRoot "node_modules\tsx\dist\cli.mjs"
if (-not (Test-Path $tsxCli)) {
    Write-ErrMsg "Brak tsx w node_modules -- uruchom scripts/setup/windows/install_node_dependencies.ps1"
    exit 1
}

$dotEnv = Read-DotEnv -RepoRoot $repoRoot
if (-not (Test-Path (Join-Path $repoRoot ".env"))) {
    Write-ErrMsg "Brak .env w korzeniu repo -- serwer pod testem nie wystartuje (wymagane POSTGRES_*)."
    Write-Host "Naprawa: Copy-Item .env.example .env i uzupelnij POSTGRES_PASSWORD."
    exit 1
}

$llmArgs = @()
if ($WithLlm) {
    $baseUrl = $dotEnv["OLLAMA_BASE_URL"]; if (-not $baseUrl) { $baseUrl = "http://localhost:11434" }
    $model = $dotEnv["OLLAMA_MODEL"]
    if (-not $model) {
        Write-ErrMsg "Tryb -WithLlm wymaga OLLAMA_MODEL w .env (ustawia go install_ollama_models.ps1)."
        exit 1
    }
    try {
        $null = Invoke-RestMethod -Uri "$baseUrl/v1/models" -Method Get -TimeoutSec 4
    } catch {
        Write-ErrMsg "Endpoint Ollamy zgodny z OpenAI nie odpowiada ($baseUrl/v1). Uruchom Ollame."
        exit 1
    }
    $llmArgs = @("--client-kwargs", "base_url=$baseUrl/v1", "api_key=ollama", "--model", $model, "--test")
    Write-Ok "Tryb LLM: model '$model' przez $baseUrl/v1 (testy funkcjonalne --test)."
}

$failures = 0
foreach ($target in $targets) {
    Write-Host ""
    Write-Host ("=" * 70) -ForegroundColor DarkCyan
    Write-Step "Wywiad serwera: $target $(if ($WithLlm) { '(inspekcja + lint + testy LLM)' } else { '(inspekcja + lint, bez LLM)' })"

    $outDir = Join-Path $repoRoot "results\raw\external\mcp-interviewer\$target"
    New-Item -ItemType Directory -Force -Path $outDir | Out-Null

    $serverEntry = (Join-Path $repoRoot "src\servers\$target\server.ts") -replace "\\", "/"
    $tsxCliFwd = $tsxCli -replace "\\", "/"
    $serverCommand = "node `"$tsxCliFwd`" `"$serverEntry`""
    Write-Host "  Komenda serwera: $serverCommand"

    $prevLocation = Get-Location
    Set-Location $repoRoot
    $env:PYTHONUTF8 = "1"
    try {
        & $interviewerExe @llmArgs $serverCommand
        $exitCode = $LASTEXITCODE
    } finally {
        Set-Location $prevLocation
        Remove-Item Env:\PYTHONUTF8 -ErrorAction SilentlyContinue
    }

    $reportMd = Join-Path $outDir "mcp-interview.md"
    $reportJson = Join-Path $outDir "mcp-interview.json"
    foreach ($reportName in @("mcp-interview.md", "mcp-interview.json")) {
        $generated = Join-Path $repoRoot $reportName
        if (Test-Path $generated) {
            Move-Item -Force $generated (Join-Path $outDir $reportName)
        }
    }
    if (($exitCode -eq 0) -and (Test-Path $reportMd)) {
        Write-Ok "[$target] raport: results/raw/external/mcp-interviewer/$target/mcp-interview.{md,json}"
        if (-not (Test-Path $reportJson)) {
            Write-WarnMsg "[$target] brak mcp-interview.json (inna wersja frameworka?) -- sprawdz version.json."
        }
    } else {
        $failures += 1
        Write-ErrMsg "[$target] wywiad nie powiodl sie (kod $exitCode)."
        Write-Host "Diagnoza: uruchom recznie z korzenia repo (dotenv serwera wymaga .env w CWD):"
        Write-Host "  & `"$interviewerExe`" '$serverCommand'"
        $issuesPath = Join-Path $repoRoot "third_party\eval-frameworks\mcp-interviewer\issues.json"
        $issues = if (Test-Path $issuesPath) { @(Get-Content $issuesPath -Raw -Encoding UTF8 | ConvertFrom-Json) } else { @() }
        $issues += [pscustomobject]@{
            date    = (Get-Date -Format "yyyy-MM-dd HH:mm")
            server  = $target
            exitCode = $exitCode
            llmMode = [bool]$WithLlm
        }
        Set-Content -Path $issuesPath -Value (ConvertTo-Json @($issues) -Depth 5) -Encoding UTF8
    }
}

Write-Host ""
if ($failures -gt 0) {
    Write-ErrMsg "Zakonczono z $failures bledami."
    exit 1
}
Write-Ok "Wywiady zakonczone. Szerokie schematy sql-minimal (sql: string) to celowa wlasciwosc badawcza, nie defekt."
Write-Host "Import raportow do zbioru znormalizowanego: format *.external.json + npm run normalize."
