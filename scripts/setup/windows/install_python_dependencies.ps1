
. "$PSScriptRoot\_common.ps1"
$repoRoot = Get-RepoRoot
$venvDir = Join-Path $repoRoot ".venv"
$requirements = Join-Path $repoRoot "scripts\plots\requirements.txt"

$MinPythonMinor = 10
$MaxPythonMinor = 13
$PreferredPythonMinors = @(12, 13, 11, 10)

function Get-PythonMinorVersion([string]$VersionOutput) {
    if ("$VersionOutput" -match "Python 3\.(\d+)") {
        return [int]$Matches[1]
    }
    return $null
}

function Test-PythonMinorSupported([int]$Minor) {
    return $Minor -ge $MinPythonMinor -and $Minor -le $MaxPythonMinor
}

function Get-VenvPythonMinor([string]$VenvPythonPath) {
    if (-not (Test-Path $VenvPythonPath)) { return $null }
    $verOut = & $VenvPythonPath --version 2>&1
    return Get-PythonMinorVersion "$verOut"
}

function Find-SupportedPython {
    if (Test-CommandExists "py") {
        foreach ($minor in $PreferredPythonMinors) {
            $verOut = & py "-3.$minor" --version 2>&1
            if ($LASTEXITCODE -ne 0) { continue }
            $detected = Get-PythonMinorVersion "$verOut"
            if ($null -ne $detected -and (Test-PythonMinorSupported $detected)) {
                return @{
                    Command = "py"
                    Arguments = @("-3.$minor")
                    VersionText = "$verOut"
                    Minor = $detected
                }
            }
        }
    }

    foreach ($candidate in @("python", "python3")) {
        if (-not (Test-CommandExists $candidate)) { continue }
        $verOut = & $candidate --version 2>&1
        $detected = Get-PythonMinorVersion "$verOut"
        if ($null -ne $detected -and (Test-PythonMinorSupported $detected)) {
            return @{
                Command = $candidate
                Arguments = @()
                VersionText = "$verOut"
                Minor = $detected
            }
        }
    }

    return $null
}

Write-Step "Szukanie interpretera Python ($MinPythonMinor-$MaxPythonMinor, preferowany 3.12)"
$python = Find-SupportedPython
if (-not $python) {
    Write-ErrMsg "Nie znaleziono obslugiwanej wersji Pythona ($MinPythonMinor.$MaxPythonMinor)."
    Write-Host "Naprawa: winget install Python.Python.3.12"
    Write-Host "Uwaga: domyslny Python 3.14 nie ma jeszcze wheel-i dla matplotlib/pandas z requirements.txt."
    exit 1
}
Write-Ok "Python: $($python.VersionText) ($($python.Command) $($python.Arguments -join ' '))"

$venvPython = Join-Path $venvDir "Scripts\python.exe"
$existingMinor = Get-VenvPythonMinor $venvPython
if ($null -ne $existingMinor -and -not (Test-PythonMinorSupported $existingMinor)) {
    Write-WarnMsg "Istniejacy venv uzywa Pythona 3.$existingMinor (nieobslugiwany). Usuwam $venvDir i tworze od nowa."
    Remove-Item -Recurse -Force $venvDir
    $existingMinor = $null
}

Write-Step "Tworzenie venv w .venv/ (pomijane, jesli istnieje i ma poprawna wersje)"
if (-not (Test-Path $venvPython)) {
    $venvArgs = @($python.Arguments + @("-m", "venv", $venvDir))
    Invoke-NativeChecked -Command $python.Command -Arguments $venvArgs
    Write-Ok "Utworzono venv."
} else {
    Write-Ok "venv juz istnieje -- pomijam tworzenie (Python 3.$existingMinor)."
}

if (-not (Test-Path $requirements)) {
    Write-ErrMsg "Brak pliku $requirements -- nie mozna zainstalowac zaleznosci."
    exit 1
}

Write-Step "Instalacja zaleznosci z scripts/plots/requirements.txt"
Invoke-NativeChecked -Command $venvPython -Arguments @("-m", "pip", "install", "--upgrade", "pip", "--quiet")
Invoke-NativeChecked -Command $venvPython -Arguments @("-m", "pip", "install", "-r", $requirements)
Write-Ok "Zaleznosci Python zainstalowane w .venv/."
Write-Host "Interpreter do skryptow: $venvPython"
