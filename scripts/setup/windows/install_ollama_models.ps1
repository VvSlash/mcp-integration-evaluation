
. "$PSScriptRoot\_common.ps1"
$repoRoot = Get-RepoRoot

Write-Step "Sprawdzanie Ollamy"
if (-not (Test-CommandExists "ollama")) {
    Write-ErrMsg "Ollama nie jest zainstalowana lub nie ma jej w PATH."
    Write-Host "Naprawa: winget install Ollama.Ollama  (potem uruchom ponownie ten skrypt)."
    exit 1
}
Write-Ok "Ollama: $(& ollama --version 2>&1 | Select-Object -First 1)"

Write-Step "Odczyt zadanego modelu z config/ollama/ollama.json"
$configPath = Join-Path $repoRoot "config\ollama\ollama.json"
$desiredModel = "qwen3.5"
if (Test-Path $configPath) {
    $config = Get-Content $configPath -Raw | ConvertFrom-Json
    if ($config.model) { $desiredModel = [string]$config.model }
} else {
    Write-WarnMsg "Brak $configPath -- uzywam domyslnego '$desiredModel'."
}
Write-Ok "Zadany model: $desiredModel"

function Get-InstalledTags {
    $listOutput = & ollama list 2>&1
    $tags = @()
    foreach ($line in $listOutput) {
        $text = "$line".Trim()
        if ($text -eq "" -or $text -match "^NAME\s") { continue }
        $tags += ($text -split "\s+")[0]
    }
    return $tags
}

Write-Step "Sprawdzanie zainstalowanych modeli (ollama list)"
$tags = Get-InstalledTags
$modelBase = $desiredModel.Split(":")[0]
$resolved = $tags | Where-Object { $_ -eq $desiredModel } | Select-Object -First 1
if (-not $resolved) {
    $resolved = $tags | Where-Object { $_.Split(":")[0] -eq $modelBase } | Select-Object -First 1
}

if (-not $resolved) {
    Write-Step "Model '$desiredModel' nie jest zainstalowany -- pobieranie (ollama pull)"
    & ollama pull $desiredModel
    if ($LASTEXITCODE -ne 0) {
        Write-ErrMsg "ollama pull '$desiredModel' nie powiodlo sie (kod $LASTEXITCODE)."
        Write-Host "Naprawa: sprawdz dokladny tag w bibliotece modeli (https://ollama.com/library),"
        Write-Host "popraw pole 'model' w config/ollama/ollama.json i uruchom skrypt ponownie."
        exit 1
    }
    $tags = Get-InstalledTags
    $resolved = $tags | Where-Object { $_.Split(":")[0] -eq $modelBase } | Select-Object -First 1
}

if (-not $resolved) {
    Write-ErrMsg "Nie udalo sie ustalic taga modelu po instalacji. Sprawdz 'ollama list' recznie."
    exit 1
}
Write-Ok "Zweryfikowany tag modelu: $resolved"

Write-Step "Zapis faktycznego taga do .env (OLLAMA_MODEL) -- wymog R13"
Set-DotEnvValue -RepoRoot $repoRoot -Key "OLLAMA_MODEL" -Value $resolved

Write-Step "Smoke test API Ollamy"
$dotEnv = Read-DotEnv -RepoRoot $repoRoot
$baseUrl = $dotEnv["OLLAMA_BASE_URL"]
if (-not $baseUrl) { $baseUrl = "http://localhost:11434" }
try {
    $response = Invoke-RestMethod -Uri "$baseUrl/api/tags" -Method Get -TimeoutSec 5
    Write-Ok "API Ollamy odpowiada pod $baseUrl (modele: $(@($response.models).Count))."
} catch {
    Write-WarnMsg "API Ollamy nie odpowiada pod $baseUrl. Uruchom aplikacje Ollama lub 'ollama serve'."
}

Write-Ok "Model gotowy. Pelny test polaczenia: npm run check:ollama"
