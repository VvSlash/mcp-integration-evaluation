
. "$PSScriptRoot\_common.ps1"
$repoRoot = Get-RepoRoot

Write-Step "Odczyt przypietej wersji z config/blender/VERSION"
$versionFile = Join-Path $repoRoot "config\blender\VERSION"
if (-not (Test-Path $versionFile)) {
    Write-ErrMsg "Brak pliku $versionFile z przypieta wersja Blendera."
    exit 1
}
$pinnedVersion = (Get-Content $versionFile -Raw).Trim()
$pinnedSeries = ($pinnedVersion.Split(".")[0..1]) -join "."
Write-Ok "Przypieta wersja: $pinnedVersion (seria $pinnedSeries)"

function Test-ZipIntegrity([string]$ZipPath) {
    if (-not (Test-Path $ZipPath)) { return $false }
    try {
        Add-Type -AssemblyName System.IO.Compression.FileSystem -ErrorAction Stop
        $archive = [System.IO.Compression.ZipFile]::OpenRead($ZipPath)
        $archive.Dispose()
        return $true
    } catch {
        return $false
    }
}

function Remove-CorruptZip([string]$ZipPath) {
    if (Test-Path $ZipPath) {
        Write-WarnMsg "Uszkodzony lub niepelny zip -- usuwam: $ZipPath"
        Remove-Item -Force $ZipPath
    }
}

function Get-BlenderVersion([string]$ExePath) {
    if (-not (Test-Path $ExePath)) { return $null }
    $out = (& $ExePath --version 2>&1) | Select-Object -First 1
    if ("$out" -match "Blender\s+(\d+\.\d+\.\d+)") { return $Matches[1] }
    return $null
}

Write-Step "Wykrywanie istniejacej instalacji"
$dotEnv = Read-DotEnv -RepoRoot $repoRoot
$candidatePaths = @()
if ($dotEnv["BLENDER_PATH"]) { $candidatePaths += $dotEnv["BLENDER_PATH"] }
$pathCmd = Get-Command "blender" -ErrorAction SilentlyContinue
if ($pathCmd) { $candidatePaths += $pathCmd.Source }
$candidatePaths += Get-ChildItem "C:\Program Files\Blender Foundation\Blender *\blender.exe" -ErrorAction SilentlyContinue |
    ForEach-Object { $_.FullName }
$candidatePaths += Get-ChildItem (Join-Path $repoRoot "third_party\blender\*\blender.exe") -ErrorAction SilentlyContinue |
    ForEach-Object { $_.FullName }

$resolvedExe = $null
$resolvedVersion = $null
foreach ($candidate in ($candidatePaths | Select-Object -Unique)) {
    $ver = Get-BlenderVersion $candidate
    if ($ver) {
        $resolvedExe = $candidate; $resolvedVersion = $ver
        if ($ver -eq $pinnedVersion) { break }
    }
}

if ($resolvedExe -and $resolvedVersion -eq $pinnedVersion) {
    Write-Ok "Znaleziono Blender $resolvedVersion : $resolvedExe"
} elseif ($resolvedExe) {
    Write-WarnMsg "Znaleziono Blender $resolvedVersion ($resolvedExe), ale przypieta wersja to $pinnedVersion."
    Write-WarnMsg "Pomiar z inna wersja narusza powtarzalnosc (R6). Pobieram wersje portable zgodna z pinem."
    $resolvedExe = $null
}

if (-not $resolvedExe) {
    Write-Step "Pobieranie Blender $pinnedVersion (portable zip) do third_party/blender/"
    $downloadDir = Join-Path $repoRoot "third_party\blender"
    New-Item -ItemType Directory -Force -Path $downloadDir | Out-Null
    $zipName = "blender-$pinnedVersion-windows-x64.zip"
    $zipPath = Join-Path $downloadDir $zipName
    $url = "https://download.blender.org/release/Blender$pinnedSeries/$zipName"
    $extractedDir = Join-Path $downloadDir "blender-$pinnedVersion-windows-x64"

    if (-not (Test-Path (Join-Path $extractedDir "blender.exe"))) {
        $zipValid = Test-ZipIntegrity $zipPath
        if ((Test-Path $zipPath) -and -not $zipValid) {
            Remove-CorruptZip $zipPath
        }
        if (-not (Test-Path $zipPath)) {
            Write-Host "  URL: $url"
            try {
                Invoke-WebRequest -Uri $url -OutFile $zipPath -UseBasicParsing
            } catch {
                Remove-CorruptZip $zipPath
                Write-ErrMsg "Pobieranie nie powiodlo sie: $($_.Exception.Message)"
                Write-Host "Naprawa: sprawdz dostepnosc wersji na https://download.blender.org/release/ i zaktualizuj config/blender/VERSION,"
                Write-Host "albo zainstaluj recznie: winget install BlenderFoundation.Blender i uruchom skrypt ponownie."
                exit 1
            }
            if (-not (Test-ZipIntegrity $zipPath)) {
                Remove-CorruptZip $zipPath
                Write-ErrMsg "Pobrany plik zip jest uszkodzony lub niepelny. Sprobuj ponownie lub pobierz recznie z $url"
                exit 1
            }
        } else {
            Write-Ok "Zip juz pobrany i poprawny -- pomijam pobieranie."
        }
        Write-Step "Rozpakowywanie archiwum"
        try {
            Expand-Archive -Path $zipPath -DestinationPath $downloadDir -Force
        } catch {
            Remove-CorruptZip $zipPath
            if (Test-Path $extractedDir) { Remove-Item -Recurse -Force $extractedDir }
            Write-ErrMsg "Rozpakowanie nie powiodlo sie: $($_.Exception.Message)"
            Write-Host "Naprawa: usunieto uszkodzony zip -- uruchom skrypt ponownie (pobierze od nowa)."
            exit 1
        }
    } else {
        Write-Ok "Rozpakowana instalacja portable juz istnieje."
    }

    $resolvedExe = Join-Path $extractedDir "blender.exe"
    $resolvedVersion = Get-BlenderVersion $resolvedExe
    if ($resolvedVersion -ne $pinnedVersion) {
        Write-ErrMsg "Zainstalowana wersja ($resolvedVersion) nie zgadza sie z pinem ($pinnedVersion)."
        exit 1
    }
    Write-Ok "Blender $resolvedVersion gotowy: $resolvedExe"
}

Write-Step "Zapis BLENDER_PATH do .env"
Set-DotEnvValue -RepoRoot $repoRoot -Key "BLENDER_PATH" -Value $resolvedExe

$BlenderMcpPipVersion = "1.6.4"
Write-Step "Serwer blender-mcp==$BlenderMcpPipVersion w third_party/blender-mcp/.venv (idempotentnie)"
$bmVenv = Join-Path $repoRoot "third_party\blender-mcp\.venv"
$bmPy = Join-Path $bmVenv "Scripts\python.exe"
if (-not (Test-Path $bmPy)) {
    $created = $false
    if (Test-CommandExists "py") {
        foreach ($minor in @(12, 13, 11, 10)) {
            & py "-3.$minor" --version *> $null
            if ($LASTEXITCODE -eq 0) { & py "-3.$minor" -m venv $bmVenv; $created = ($LASTEXITCODE -eq 0); break }
        }
    }
    if (-not $created -and (Test-CommandExists "python")) { & python -m venv $bmVenv }
}
if (Test-Path $bmPy) {
    & $bmPy -m pip install --quiet "blender-mcp==$BlenderMcpPipVersion"
    if ($LASTEXITCODE -eq 0) { Write-Ok "Serwer blender-mcp==$BlenderMcpPipVersion gotowy." }
    else { Write-WarnMsg "pip install blender-mcp nie powiodl sie -- sprawdz siec/Pythona." }
} else {
    Write-WarnMsg "Nie udalo sie utworzyc venv dla blender-mcp (brak Pythona 3.10-3.13?)."
}

Write-Host "Most (addon TCP :9876) uruchamia JEDNO polecenie: powershell -ExecutionPolicy Bypass -File scripts/run/start_blender_bridge.ps1"
Write-Ok "Instalacja Blendera zakonczona."
