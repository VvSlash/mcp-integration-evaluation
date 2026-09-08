param([string]$Only = "")

. "$PSScriptRoot\_common.ps1"
$repoRoot = Get-RepoRoot
$manifestPath = Join-Path $repoRoot "third_party\manifest.json"

if (-not (Test-Path $manifestPath)) {
    Write-ErrMsg "Brak $manifestPath -- manifest definiuje liste gotowcow do pobrania."
    exit 1
}
$manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json

function Write-VersionJson {
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

function Add-Issue {
    param([string]$Dir, [string]$Name, [string]$Symptom)
    $issuesPath = Join-Path $Dir "issues.json"
    $issues = if (Test-Path $issuesPath) { @(Get-Content $issuesPath -Raw -Encoding UTF8 | ConvertFrom-Json) } else { @() }
    $issues += [pscustomobject]@{
        date    = (Get-Date -Format "yyyy-MM-dd HH:mm")
        server  = $Name
        symptom = $Symptom
    }
    Set-Content -Path $issuesPath -Value (ConvertTo-Json @($issues) -Depth 5) -Encoding UTF8
    Write-WarnMsg "Zapisano problem do third_party/$Name/issues.json."
}

$failures = 0
foreach ($server in $manifest.servers) {
    $name = [string]$server.name
    if ($Only -and $name -ne $Only) { continue }

    $dir = Join-Path $repoRoot "third_party\$name"
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
    Write-Step "[$name] rodzaj: $($server.kind), zrodlo: $($server.source), pin: $($server.pinnedVersion)"

    try {
        switch ($server.kind) {
            "npm" {
                if (-not (Test-CommandExists "npm")) { throw "npm niedostepny -- uruchom install_node_dependencies.ps1" }
                $spec = if ($server.pinnedVersion -and $server.pinnedVersion -ne "latest") { "$($server.source)@$($server.pinnedVersion)" } else { $server.source }
                $resolved = (& npm view $spec version 2>&1 | Select-Object -Last 1)
                if ($LASTEXITCODE -ne 0) { throw "npm view '$spec' nie powiodlo sie: $resolved" }
                $resolved = "$resolved".Trim()
                & npm cache add "$($server.source)@$resolved" 2>&1 | Out-Null
                Write-Ok "[$name] zweryfikowano w rejestrze npm: $($server.source)@$resolved (prefetch do cache)."
                Write-VersionJson -Dir $dir -Name $name -Kind "npm (uruchamianie: npx -y $($server.source)@$resolved)" `
                    -Source $server.source -ResolvedVersion $resolved -Notes ([string]$server.notes)
            }
            "pip" {
                $py = Join-Path $repoRoot ".venv\Scripts\python.exe"
                if (-not (Test-Path $py)) { throw "Brak venv -- uruchom install_python_dependencies.ps1" }
                $spec = if ($server.pinnedVersion -and $server.pinnedVersion -ne "latest") { "$($server.source)==$($server.pinnedVersion)" } else { $server.source }
                $distDir = Join-Path $dir "dist"
                New-Item -ItemType Directory -Force -Path $distDir | Out-Null
                & $py -m pip download $spec --no-deps -d $distDir --quiet
                if ($LASTEXITCODE -ne 0) { throw "pip download '$spec' nie powiodlo sie." }
                $artifact = Get-ChildItem $distDir | Sort-Object LastWriteTime -Descending | Select-Object -First 1
                $resolved = if ($artifact -and $artifact.Name -match "-(\d+[^-]*)-py|-(\d+[^-]*)\.tar") { if ($Matches[1]) { $Matches[1] } else { $Matches[2] } } else { [string]$server.pinnedVersion }
                Write-Ok "[$name] pobrano artefakt: $($artifact.Name)"
                Write-VersionJson -Dir $dir -Name $name -Kind "pip/uvx (uruchamianie: uvx $($server.source)==$resolved)" `
                    -Source $server.source -ResolvedVersion $resolved -Notes ([string]$server.notes)
            }
            "pip-venv" {
                $sysPython = $null
                if (Test-CommandExists "py") {
                    foreach ($minor in @(12, 13, 11, 10)) {
                        & py "-3.$minor" --version *> $null
                        if ($LASTEXITCODE -eq 0) { $sysPython = @{ Cmd = "py"; Args = @("-3.$minor") }; break }
                    }
                }
                if (-not $sysPython -and (Test-CommandExists "python")) { $sysPython = @{ Cmd = "python"; Args = @() } }
                if (-not $sysPython) { throw "Brak Pythona 3.10-3.13 (winget install Python.Python.3.12)." }

                $venvDir = Join-Path $dir ".venv"
                $venvPy = Join-Path $venvDir "Scripts\python.exe"
                if (-not (Test-Path $venvPy)) {
                    & $sysPython.Cmd @($sysPython.Args + @("-m", "venv", $venvDir))
                    if ($LASTEXITCODE -ne 0) { throw "Tworzenie venv nie powiodlo sie." }
                }
                $spec = if ($server.pinnedVersion -and $server.pinnedVersion -ne "latest") { "$($server.source)==$($server.pinnedVersion)" } else { [string]$server.source }
                & $venvPy -m pip install --upgrade pip --quiet
                & $venvPy -m pip install $spec --quiet
                if ($LASTEXITCODE -ne 0) { throw "pip install '$spec' w venv nie powiodlo sie." }
                $resolved = (& $venvPy -m pip show $server.source 2>$null | Select-String "^Version:").ToString().Split(":")[1].Trim()
                Write-Ok "[$name] zainstalowano $($server.source)==$resolved w $venvDir"
                Write-VersionJson -Dir $dir -Name $name -Kind "pip-venv (uruchamianie: third_party/$name/.venv/Scripts/<skrypt-konsolowy>)" `
                    -Source $server.source -ResolvedVersion $resolved -Notes ([string]$server.notes)
            }
            "git" {
                if (-not (Test-CommandExists "git")) { throw "git niedostepny w PATH." }
                $repoDir = Join-Path $dir "repo"
                if (-not (Test-Path (Join-Path $repoDir ".git"))) {
                    & git clone --depth 50 $server.source $repoDir
                    if ($LASTEXITCODE -ne 0) { throw "git clone '$($server.source)' nie powiodl sie." }
                } else {
                    & git -C $repoDir fetch --depth 50 origin 2>&1 | Out-Null
                    Write-Ok "[$name] repo juz sklonowane -- fetch wykonany."
                }
                if ($server.pinnedVersion -and $server.pinnedVersion -ne "latest") {
                    & git -C $repoDir checkout --quiet $server.pinnedVersion
                    if ($LASTEXITCODE -ne 0) { throw "checkout '$($server.pinnedVersion)' nie powiodl sie." }
                }
                $sha = (& git -C $repoDir rev-parse HEAD).Trim()
                Write-Ok "[$name] commit: $sha"
                Write-VersionJson -Dir $dir -Name $name -Kind "git clone (third_party/$name/repo)" `
                    -Source $server.source -ResolvedVersion $sha -Notes ([string]$server.notes)
            }
            default { throw "Nieznany rodzaj instalacji: '$($server.kind)' (dozwolone: npm, pip, pip-venv, git)." }
        }
    } catch {
        $failures += 1
        Write-ErrMsg "[$name] $($_.Exception.Message)"
        Add-Issue -Dir $dir -Name $name -Symptom "Objaw: $($_.Exception.Message). Pin: $($server.pinnedVersion). Zrodlo: $($server.source)."
    }
}

if ($failures -gt 0) {
    Write-WarnMsg "Zakonczono z $failures problemami -- szczegoly w third_party/*/issues.json."
    Write-Host "Dalsze kroki: zweryfikuj nazwe/dostepnosc pakietu, zaktualizuj third_party/manifest.json, uruchom ponownie."
    exit 1
}
Write-Ok "Wszystkie gotowce pobrane/zweryfikowane. Wersje: third_party/*/version.json."
