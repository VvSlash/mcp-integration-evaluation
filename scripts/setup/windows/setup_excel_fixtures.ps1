
. "$PSScriptRoot\_common.ps1"
$repoRoot = Get-RepoRoot
$venvPython = Join-Path $repoRoot ".venv\Scripts\python.exe"
$generator = Join-Path $repoRoot "scripts\data\generate_excel_fixtures.py"

if (-not (Test-Path $generator)) {
    Write-ErrMsg "Brak generatora $generator."
    exit 1
}

if (-not (Test-Path $venvPython)) {
    Write-WarnMsg "Brak venv -- uruchamiam install_python_dependencies.ps1"
    & powershell -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "install_python_dependencies.ps1")
    if ($LASTEXITCODE -ne 0) { Write-ErrMsg "Instalacja zaleznosci Python nie powiodla sie."; exit 1 }
}

Write-Step "Weryfikacja openpyxl w venv"
& $venvPython -c "import openpyxl" 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-WarnMsg "openpyxl niedostepny -- doinstalowuje wymagania."
    Invoke-NativeChecked -Command $venvPython -Arguments @("-m", "pip", "install", "-r", (Join-Path $repoRoot "scripts\plots\requirements.txt"))
}

Write-Step "Generacja fixture'ow Excel (deterministyczny seed)"
Invoke-NativeChecked -Command $venvPython -Arguments @($generator) -WorkingDirectory $repoRoot

$xlsx = Join-Path $repoRoot "datasets\excel\sales.xlsx"
$expected = Join-Path $repoRoot "datasets\excel\sales.expected.json"
if ((Test-Path $xlsx) -and (Test-Path $expected)) {
    Write-Ok "Utworzono: datasets/excel/sales.xlsx oraz sales.expected.json"
} else {
    Write-ErrMsg "Generator zakonczyl sie, ale brakuje plikow wynikowych."
    exit 1
}
