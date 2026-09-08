
param([int]$TimeoutSec = 60)

. "$PSScriptRoot\..\setup\windows\_common.ps1"
$repoRoot = Get-RepoRoot

$dotEnv = Read-DotEnv -RepoRoot $repoRoot
$blenderExe = $dotEnv["BLENDER_PATH"]
if (-not $blenderExe -or -not (Test-Path $blenderExe)) {
    $portable = Get-ChildItem (Join-Path $repoRoot "third_party\blender\*\blender.exe") -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($portable) { $blenderExe = $portable.FullName }
}
if (-not $blenderExe -or -not (Test-Path $blenderExe)) {
    Write-ErrMsg "Nie znaleziono Blendera -- uruchom scripts/setup/windows/install_blender.ps1."
    exit 1
}
Write-Ok "Blender: $blenderExe"

$ownAddonPath = Join-Path $repoRoot "src\servers\blender\addon\mcp_eval_addon.py"
if (-not (Test-Path $ownAddonPath)) {
    Write-ErrMsg "Brak $ownAddonPath (wlasny addon) -- uszkodzone repo?"
    exit 1
}
$thirdPartyAddonPath = Join-Path $repoRoot "third_party\blender-mcp\repo\addon.py"
$withThirdParty = Test-Path $thirdPartyAddonPath
if (-not $withThirdParty) {
    Write-WarnMsg "Brak addonu gotowca ($thirdPartyAddonPath) -- most :9876 pominiety."
    Write-WarnMsg "Pomiary gotowca wymagaja: download_third_party_mcp_servers.ps1 -Only blender-mcp."
}

$ownPort = 9877
if ($dotEnv["MCP_EVAL_BLENDER_PORT"]) { $ownPort = [int]$dotEnv["MCP_EVAL_BLENDER_PORT"] }

function Test-Bridge([int]$Port) {
    try {
        $client = New-Object System.Net.Sockets.TcpClient
        $ok = $client.ConnectAsync("127.0.0.1", $Port).Wait(1000)
        $client.Close()
        return $ok
    } catch { return $false }
}

$requiredPorts = @($ownPort)
if ($withThirdParty) { $requiredPorts = @(9876) + $requiredPorts }

$missing = @($requiredPorts | Where-Object { -not (Test-Bridge $_) })
if ($missing.Count -eq 0) {
    Write-Ok "Wszystkie wymagane mosty juz nasluchuja ($($requiredPorts -join ', ')) -- nic do zrobienia."
    exit 0
}
$up = @($requiredPorts | Where-Object { Test-Bridge $_ })
if ($up.Count -gt 0) {
    Write-ErrMsg "Czesc mostow dziala ($($up -join ', ')), brakuje: $($missing -join ', ')."
    Write-Host "Dziala Blender z niepelnym zestawem addonow -- zamknij okno Blendera i uruchom skrypt ponownie."
    exit 1
}

Write-Step "Instalacja/wlaczenie addonow mostow w Blenderze (CLI)"
$ensureScript = Join-Path $PSScriptRoot "ensure_blender_addon.py"
$addonArgs = @("--background", "--python", $ensureScript, "--", $ownAddonPath)
if ($withThirdParty) { $addonArgs += $thirdPartyAddonPath }
$prevEap = $ErrorActionPreference
$ErrorActionPreference = "Continue"
$installOut = & $blenderExe @addonArgs
$installExit = $LASTEXITCODE
$ErrorActionPreference = $prevEap
$ownOk = "$installOut" -match "ADDON_OK mcp_eval_addon"
$thirdOk = (-not $withThirdParty) -or ("$installOut" -match "ADDON_OK addon")
if ($installExit -eq 0 -and $ownOk -and $thirdOk) {
    Write-Ok "Addony zainstalowane i wlaczone (zapisane w preferencjach)."
} else {
    Write-ErrMsg "Instalacja addonow nie powiodla sie (kod $installExit, own=$ownOk, gotowiec=$thirdOk):"
    "$installOut" -split "`n" | Select-Object -Last 8 | ForEach-Object { Write-Host "  $_" }
    exit 1
}

Write-Step "Start Blendera GUI (mosty: $($requiredPorts -join ', '))"
New-Item -ItemType Directory -Force -Path (Join-Path $repoRoot "datasets\.work") | Out-Null
$bridgeLog = Join-Path $repoRoot "datasets\.work\blender-bridge.log"
Remove-Item $bridgeLog -Force -ErrorAction SilentlyContinue
$autostartScript = Join-Path $PSScriptRoot "start_bridge_autostart.py"
$env:MCP_EVAL_BLENDER_PORT = "$ownPort"
$process = Start-Process -FilePath $blenderExe -ArgumentList "--python", "`"$autostartScript`"" -WorkingDirectory $repoRoot -WindowStyle Hidden -PassThru
Write-Ok "Blender uruchomiony (PID $($process.Id)) -- zamkniecie okna zatrzymuje mosty; log: datasets/.work/blender-bridge.log"

Write-Step "Oczekiwanie na mosty TCP ($($requiredPorts -join ', '); max $TimeoutSec s)"
$deadline = (Get-Date).AddSeconds($TimeoutSec)
while ((Get-Date) -lt $deadline) {
    $missing = @($requiredPorts | Where-Object { -not (Test-Bridge $_) })
    if ($missing.Count -eq 0) {
        Write-Ok "Mosty dzialaja: $($requiredPorts | ForEach-Object { "127.0.0.1:$_" })."
        Write-Host "Pomiary: npm run llm:all -- --server blender (wlasny) / --server blender-mcp (gotowiec)"
        exit 0
    }
    Start-Sleep -Milliseconds 500
}
Write-ErrMsg "Mosty nie wstaly w ${TimeoutSec}s (brakuje: $($missing -join ', ')) -- sprawdz okno Blendera i log datasets/.work/blender-bridge.log."
exit 1
