
. "$PSScriptRoot\_common.ps1"
$repoRoot = Get-RepoRoot

$minNodeMajor = 20

Write-Step "Sprawdzanie Node.js"
if (-not (Test-CommandExists "node")) {
    Write-ErrMsg "Node.js nie jest zainstalowany lub nie ma go w PATH."
    Write-Host "Naprawa: zainstaluj Node.js LTS >= $minNodeMajor, np.:  winget install OpenJS.NodeJS.LTS"
    exit 1
}
$nodeVersionRaw = (& node --version).TrimStart("v")
$nodeMajor = [int]($nodeVersionRaw.Split(".")[0])
if ($nodeMajor -lt $minNodeMajor) {
    Write-ErrMsg "Wykryto Node.js v$nodeVersionRaw -- wymagane >= $minNodeMajor.x."
    Write-Host "Naprawa: zaktualizuj Node.js (winget upgrade OpenJS.NodeJS.LTS)."
    exit 1
}
Write-Ok "Node.js v$nodeVersionRaw"

Write-Step "Sprawdzanie npm"
if (-not (Test-CommandExists "npm")) {
    Write-ErrMsg "npm niedostepny w PATH (powinien byc czescia instalacji Node.js)."
    exit 1
}
Write-Ok "npm $(& npm --version)"

Write-Step "Instalacja zaleznosci: npm ci (przypiete wersje z package-lock.json)"
try {
    Invoke-NativeChecked -Command "npm" -Arguments @("ci") -WorkingDirectory $repoRoot
    Write-Ok "npm ci zakonczone."
} catch {
    Write-ErrMsg "npm ci nie powiodlo sie: $($_.Exception.Message)"
    Write-Host "Naprawa: sprawdz spojnosc package.json z package-lock.json; w ostatecznosci 'npm install' i commit nowego locka."
    exit 1
}

Write-Step "Weryfikacja tsx (runner TypeScript uzywany przez wszystkie skrypty npm)"
$tsxPath = Join-Path $repoRoot "node_modules\.bin\tsx.cmd"
if (Test-Path $tsxPath) { Write-Ok "tsx dostepny ($tsxPath)" }
else { Write-WarnMsg "Nie znaleziono tsx w node_modules/.bin -- sprawdz devDependencies." }

Write-Ok "Zaleznosci Node gotowe."
