param(
    [string]$Only = "",
    [switch]$WithMonitoring,
    [switch]$SkipInstall
)

. "$PSScriptRoot\_common.ps1"
$repoRoot = Get-RepoRoot
$manifestPath = Join-Path $repoRoot "third_party\eval-frameworks.manifest.json"
$baseDir = Join-Path $repoRoot "third_party\eval-frameworks"

if (-not (Test-Path $manifestPath)) {
    Write-ErrMsg "Brak $manifestPath."
    exit 1
}
$manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json
New-Item -ItemType Directory -Force -Path $baseDir | Out-Null

function Find-PythonForMin([string]$MinVersion) {
    $minParts = $MinVersion.Split("."); $minMinor = [int]$minParts[1]
    $candidates = @()
    for ($minor = 13; $minor -ge $minMinor; $minor--) { $candidates += ,@("py", @("-3.$minor")) }
    $candidates += ,@("python", @())
    $candidates += ,@("py", @("-3"))
    foreach ($candidate in $candidates) {
        $exe = $candidate[0]; $preArgs = $candidate[1]
        if (-not (Test-CommandExists $exe)) { continue }
        $out = $null
        try {
            $out = & $exe @preArgs --version 2>$null
        } catch {
            continue
        }
        if ($LASTEXITCODE -ne 0) { continue }
        if ("$out" -match "Python (3)\.(\d+)\.(\d+)") {
            if ([int]$Matches[2] -ge $minMinor) {
                return @{ Exe = $exe; PreArgs = $preArgs; Version = "3.$($Matches[2]).$($Matches[3])" }
            }
        }
    }
    return $null
}

function Test-ApiKeyPresent([hashtable]$DotEnv, [string]$KeyName) {
    $fromProcess = [Environment]::GetEnvironmentVariable($KeyName)
    if ($fromProcess -and $fromProcess.Trim() -ne "") { return $true }
    if ($DotEnv.ContainsKey($KeyName) -and $DotEnv[$KeyName] -and $DotEnv[$KeyName].Trim() -ne "") { return $true }
    return $false
}

function Test-OllamaOpenAiEndpoint([hashtable]$DotEnv) {
    $baseUrl = $DotEnv["OLLAMA_BASE_URL"]; if (-not $baseUrl) { $baseUrl = "http://localhost:11434" }
    try {
        $null = Invoke-RestMethod -Uri "$baseUrl/v1/models" -Method Get -TimeoutSec 4
        return $true
    } catch { return $false }
}

function Write-FrameworkVersionJson {
    param([string]$Dir, [string]$Name, [string]$Kind, [string]$Source, [string]$ResolvedVersion, [string]$Notes)
    $content = [ordered]@{
        name            = $Name
        installKind     = $Kind
        source          = $Source
        resolvedVersion = $ResolvedVersion
        verifiedAt      = (Get-Date -Format "yyyy-MM-dd HH:mm")
        notes           = $Notes
    }
    Set-Content -Path (Join-Path $Dir "version.json") -Value (ConvertTo-Json $content -Depth 5) -Encoding UTF8
}

function Add-FrameworkIssue {
    param([string]$Dir, [string]$Name, [string]$Symptom)
    $issuesPath = Join-Path $Dir "issues.json"
    $issues = if (Test-Path $issuesPath) { @(Get-Content $issuesPath -Raw -Encoding UTF8 | ConvertFrom-Json) } else { @() }
    $issues += [pscustomobject]@{
        date      = (Get-Date -Format "yyyy-MM-dd HH:mm")
        framework = $Name
        symptom   = $Symptom
    }
    Set-Content -Path $issuesPath -Value (ConvertTo-Json @($issues) -Depth 5) -Encoding UTF8
    Write-WarnMsg "Zapisano problem do third_party/eval-frameworks/$Name/issues.json"
}

$dotEnv = Read-DotEnv -RepoRoot $repoRoot
$ollamaOpenAiOk = Test-OllamaOpenAiEndpoint -DotEnv $dotEnv
$summary = @()
$failures = 0

foreach ($fw in $manifest.frameworks) {
    $name = [string]$fw.name
    if ($Only -and $name -ne $Only) { continue }
    $dir = Join-Path $baseDir $name
    New-Item -ItemType Directory -Force -Path $dir | Out-Null

    Write-Host ""
    Write-Host ("=" * 70) -ForegroundColor DarkCyan
    Write-Step "[$name] rodzaj: $($fw.kind), zrodlo: $($fw.source)"

    $checks = @()
    $blockers = @()

    if ($fw.pythonMin) {
        $python = Find-PythonForMin -MinVersion ([string]$fw.pythonMin)
        if ($python) { $checks += "[OK] Python >= $($fw.pythonMin) (znaleziono $($python.Version))" }
        else {
            $checks += "[BRAK] Python >= $($fw.pythonMin) -- naprawa: winget install Python.Python.3.12"
            $blockers += "python"
        }
    }
    if ($fw.nodeMin) {
        if (Test-CommandExists "node") {
            $nodeVer = (& node --version).TrimStart("v")
            if ([int]$nodeVer.Split(".")[0] -ge [int]$fw.nodeMin) { $checks += "[OK] Node >= $($fw.nodeMin) (znaleziono v$nodeVer)" }
            else { $checks += "[BRAK] Node >= $($fw.nodeMin) (jest v$nodeVer)"; $blockers += "node" }
        } else { $checks += "[BRAK] Node.js -- uruchom install_node_dependencies.ps1"; $blockers += "node" }
    }
    foreach ($dep in @($fw.systemDeps)) {
        $depName = ("$dep" -split "\s")[0]
        if ($depName -eq "docker") {
            if (Test-CommandExists "docker") { $checks += "[OK] docker (dla stacku monitoringu)" }
            else { $checks += "[UWAGA] docker niedostepny -- stack monitoringu (Prometheus/Grafana/Jaeger) nie wystartuje; instalacja frameworka mozliwa" }
        } elseif ($depName) {
            if (Test-CommandExists $depName) { $checks += "[OK] $depName" }
            else {
                $checks += "[BRAK] $depName -- naprawa: winget install $(if ($depName -eq 'jq') { 'jqlang.jq' } else { $depName })"
                $blockers += $depName
            }
        }
    }
    if ($fw.apiKeys) {
        $foundKey = $null
        foreach ($keyName in @($fw.apiKeys.candidates)) {
            if (Test-ApiKeyPresent -DotEnv $dotEnv -KeyName ([string]$keyName)) { $foundKey = $keyName; break }
        }
        if ($foundKey) { $checks += "[OK] klucz API: $foundKey (obecny; wartosci nie logujemy)" }
        elseif ($fw.apiKeys.required) {
            $checks += "[UWAGA] brak klucza API ($(@($fw.apiKeys.candidates) -join ' / ')) -- framework zainstaluje sie, ale przebiegi wymagaja klucza (platne API = oznaczony dodatek)"
        } else {
            $checks += "[OK] klucz API niewymagany (wsparcie modelu lokalnego: $($fw.apiKeys.localModelSupport))"
        }
        if ("$($fw.apiKeys.localModelSupport)" -match "^(tak|TAK)") {
            if ($ollamaOpenAiOk) { $checks += "[OK] endpoint Ollamy zgodny z OpenAI odpowiada (/v1/models)" }
            else { $checks += "[UWAGA] endpoint Ollamy /v1/models nie odpowiada -- uruchom Ollame przed przebiegami" }
        }
    }

    $checks | ForEach-Object { Write-Host "  $_" }

    $compat = [ordered]@{
        framework      = $name
        generatedAt    = (Get-Date -Format "yyyy-MM-dd HH:mm")
        checks         = @($checks)
        monitoring     = [string]$fw.monitoring
        metricsMapping = [string]$fw.metricsMapping
    }
    Set-Content -Path (Join-Path $dir "compatibility.json") -Value (ConvertTo-Json $compat -Depth 5) -Encoding UTF8

    if ($blockers.Count -gt 0) {
        $failures += 1
        Write-ErrMsg "[$name] wymagania niespelnione: $($blockers -join ', ') -- instalacje pominieto."
        Add-FrameworkIssue -Dir $dir -Name $name -Symptom "Wymagania niespelnione: $($blockers -join ', '). Szczegoly: compatibility.json."
        $summary += "[BLAD]      $name (wymagania: $($blockers -join ', '))"
        continue
    }
    if ($SkipInstall) {
        $summary += "[RAPORT]    $name (tylko weryfikacja zgodnosci -- compatibility.json)"
        continue
    }

    try {
        switch ($fw.kind) {
            "pip-venv" {
                $python = Find-PythonForMin -MinVersion ([string]$fw.pythonMin)
                $venvDir = Join-Path $dir ".venv"
                $venvPython = Join-Path $venvDir "Scripts\python.exe"
                if (-not (Test-Path $venvPython)) {
                    & $python.Exe @($python.PreArgs + @("-m", "venv", $venvDir))
                    if ($LASTEXITCODE -ne 0) { throw "Tworzenie venv nie powiodlo sie." }
                }
                $spec = if ($fw.pinnedVersion -and $fw.pinnedVersion -ne "latest") { "$($fw.source)==$($fw.pinnedVersion)" } else { [string]$fw.source }
                & $venvPython -m pip install --upgrade pip --quiet
                & $venvPython -m pip install $spec
                if ($LASTEXITCODE -ne 0) { throw "pip install '$spec' nie powiodlo sie." }
                $resolved = (& $venvPython -m pip show $fw.source 2>$null | Select-String "^Version:").ToString().Split(":")[1].Trim()
                Write-Ok "[$name] zainstalowano $($fw.source)==$resolved w $venvDir"
                Write-FrameworkVersionJson -Dir $dir -Name $name -Kind "pip-venv (interpreter: $venvPython)" -Source $fw.source -ResolvedVersion $resolved -Notes ([string]$fw.notes)
            }
            "npm-local" {
                $spec = if ($fw.pinnedVersion -and $fw.pinnedVersion -ne "latest") { "$($fw.source)@$($fw.pinnedVersion)" } else { [string]$fw.source }
                & npm install --prefix $dir $spec --no-fund --no-audit
                if ($LASTEXITCODE -ne 0) { throw "npm install '$spec' nie powiodlo sie." }
                $pkgJson = Join-Path $dir "node_modules\$($fw.source)\package.json"
                $resolved = if (Test-Path $pkgJson) { (Get-Content $pkgJson -Raw | ConvertFrom-Json).version } else { [string]$fw.pinnedVersion }
                Write-Ok "[$name] zainstalowano $($fw.source)@$resolved (lokalnie w $dir)"
                Write-FrameworkVersionJson -Dir $dir -Name $name -Kind "npm-local (node_modules w $dir, poza kontrola wersji)" -Source $fw.source -ResolvedVersion $resolved -Notes ([string]$fw.notes)
            }
            "git-pip" {
                if (-not (Test-CommandExists "git")) { throw "git niedostepny w PATH." }
                $repoDir = Join-Path $dir "repo"
                if (-not (Test-Path (Join-Path $repoDir ".git"))) {
                    & git clone --depth 50 $fw.source $repoDir
                    if ($LASTEXITCODE -ne 0) { throw "git clone '$($fw.source)' nie powiodl sie." }
                } else {
                    & git -C $repoDir fetch --depth 50 origin 2>&1 | Out-Null
                    Write-Ok "[$name] repo juz sklonowane -- fetch wykonany."
                }
                if ($fw.pinnedVersion -and $fw.pinnedVersion -ne "latest") {
                    & git -C $repoDir checkout --quiet $fw.pinnedVersion
                    if ($LASTEXITCODE -ne 0) { throw "checkout '$($fw.pinnedVersion)' nie powiodl sie." }
                }
                $sha = (& git -C $repoDir rev-parse HEAD).Trim()
                $python = Find-PythonForMin -MinVersion ([string]$fw.pythonMin)
                $venvDir = Join-Path $dir ".venv"
                $venvPython = Join-Path $venvDir "Scripts\python.exe"
                if (-not (Test-Path $venvPython)) {
                    & $python.Exe @($python.PreArgs + @("-m", "venv", $venvDir))
                    if ($LASTEXITCODE -ne 0) { throw "Tworzenie venv nie powiodlo sie." }
                }
                & $venvPython -m pip install --upgrade pip --quiet
                if ($fw.installMode -eq "requirements") {
                    $req = Join-Path $repoDir "requirements.txt"
                    if (-not (Test-Path $req)) { throw "Brak requirements.txt w sklonowanym repo." }
                    & $venvPython -m pip install -r $req
                } else {
                    & $venvPython -m pip install -e $repoDir
                }
                if ($LASTEXITCODE -ne 0) { throw "Instalacja pip w venv nie powiodla sie." }
                Write-Ok "[$name] commit: $sha, venv: $venvDir"
                Write-FrameworkVersionJson -Dir $dir -Name $name -Kind "git-pip ($($fw.installMode); interpreter: $venvPython)" -Source $fw.source -ResolvedVersion $sha -Notes ([string]$fw.notes)
            }
            default { throw "Nieznany rodzaj instalacji: '$($fw.kind)' (dozwolone: pip-venv, npm-local, git-pip)." }
        }
        $summary += "[OK]        $name"
    } catch {
        $failures += 1
        Write-ErrMsg "[$name] $($_.Exception.Message)"
        Add-FrameworkIssue -Dir $dir -Name $name -Symptom "Objaw: $($_.Exception.Message). Pin: $($fw.pinnedVersion). Zrodlo: $($fw.source)."
        $summary += "[BLAD]      $name (instalacja)"
    }
}

if ($WithMonitoring) {
    Write-Host ""
    Write-Step "Stack monitoringu: Prometheus + Grafana + Jaeger (config/monitoring/)"
    $composeFile = Join-Path $repoRoot "config\monitoring\docker-compose.monitoring.yml"
    if (-not (Test-Path $composeFile)) {
        Write-ErrMsg "Brak $composeFile."
        $summary += "[BLAD]      monitoring (brak pliku compose)"
    } elseif (-not (Test-CommandExists "docker")) {
        Write-ErrMsg "Docker niedostepny -- stack monitoringu wymaga Dockera (Docker Desktop: winget install Docker.DockerDesktop)."
        $summary += "[BLAD]      monitoring (brak dockera)"
    } else {
        & docker compose -f $composeFile up -d
        if ($LASTEXITCODE -eq 0) {
            Write-Ok "Monitoring dziala: Prometheus http://localhost:9090, Grafana http://localhost:3000 (admin/admin), Jaeger http://localhost:16686"
            $summary += "[OK]        monitoring (Prometheus/Grafana/Jaeger)"
        } else {
            Write-ErrMsg "docker compose up nie powiodl sie -- czy Docker Desktop jest uruchomiony?"
            $summary += "[BLAD]      monitoring (docker compose)"
        }
    }
}

Write-Host ""
Write-Host ("=" * 70) -ForegroundColor DarkCyan
Write-Step "PODSUMOWANIE (frameworki ewaluacyjne -- OPCJONALNE)"
$summary | ForEach-Object { Write-Host "  $_" }
Write-Host ""
Write-Host "Raporty zgodnosci: third_party/eval-frameworks/*/compatibility.json"
Write-Host "Import wynikow do wspolnego formatu: npm run normalize"
if ($failures -gt 0) { exit 1 }
