param(
    [Parameter(Mandatory = $true)][string]$Server,
    [Parameter(Mandatory = $true)][ValidateSet("own", "third_party")][string]$ServerKind,
    [string]$Performer = "czlowiek",
    [string]$ServerVersion = ""
)

. "$PSScriptRoot\..\setup\windows\_common.ps1"
$repoRoot = Get-RepoRoot

if (-not $ServerVersion) {
    if ($ServerKind -eq "own") {
        $sha = (& git -C $repoRoot rev-parse --short HEAD 2>$null)
        if ($LASTEXITCODE -eq 0) { $ServerVersion = "own@$("$sha".Trim())" } else { $ServerVersion = "own@unknown" }
    } else {
        $manifestPath = Join-Path $repoRoot "third_party\manifest.json"
        $entry = if (Test-Path $manifestPath) {
            (Get-Content $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json).servers | Where-Object { $_.name -eq $Server }
        } else { $null }
        $ServerVersion = if ($entry) { "$($entry.source)@$($entry.pinnedVersion)" } else { "UZUPELNIJ (brak wpisu w third_party/manifest.json)" }
    }
}

function Read-NumberAnswer([string]$Question, [double]$Min, [double]$Max) {
    while ($true) {
        $raw = Read-Host $Question
        $value = 0.0
        if ([double]::TryParse($raw, [ref]$value) -and $value -ge $Min -and $value -le $Max) { return $value }
        Write-WarnMsg "Podaj liczbe z zakresu $Min-$Max."
    }
}

Write-Step "Protokol usability -- serwer: $Server ($ServerKind), wykonujacy: $Performer"
Write-Host "Skala Likerta: 1 = bardzo zle/trudno, 3 = neutralnie, 5 = bardzo dobrze/latwo."
Write-Host ""

$questions = @(
    @{ Key = "installationTimeMinutes";              Q = " 1. Czas instalacji (min)";                                Min = 0; Max = 100000 },
    @{ Key = "manualStepsCount";                     Q = " 2. Liczba recznych krokow";                               Min = 0; Max = 100000 },
    @{ Key = "setupFailureCount";                    Q = " 3. Liczba bledow w setupie";                              Min = 0; Max = 100000 },
    @{ Key = "timeToFirstSuccessfulRun";             Q = " 4. Czas do pierwszego poprawnego tool calla (min)";       Min = 0; Max = 100000 },
    @{ Key = "documentationClarityScore";            Q = " 5. Zrozumialosc dokumentacji (1-5)";                      Min = 1; Max = 5 },
    @{ Key = "toolListClarityScore";                 Q = " 6. Zrozumialosc listy narzedzi (1-5)";                    Min = 1; Max = 5 },
    @{ Key = "debuggabilityScore";                   Q = " 7. Latwosc debugowania (1-5)";                            Min = 1; Max = 5 },
    @{ Key = "scenarioAdditionEaseScore";            Q = " 8. Latwosc dodania scenariusza (1-5)";                    Min = 1; Max = 5 },
    @{ Key = "agentImplementationDifficultyScore";   Q = " 9. Latwosc podlaczenia do runnera LLM (1-5)";             Min = 1; Max = 5 },
    @{ Key = "maintainabilityScore";                 Q = "10. Subiektywna ocena uzytecznosci (1-5)";                 Min = 1; Max = 5 }
)

$answers = [ordered]@{}
foreach ($item in $questions) {
    $answers[$item.Key] = Read-NumberAnswer -Question $item.Q -Min $item.Min -Max $item.Max
}

Write-Host ""
Write-Host "Notatki jakosciowe (Enter, aby pominac):"
$noteSurprised = Read-Host "  - co zaskoczylo"
$noteBlocked   = Read-Host "  - co zablokowalo"
$noteHelped    = Read-Host "  - co ulatwilo"

$date = Get-Date -Format "yyyy-MM-dd"

$rawDir = Join-Path $repoRoot "results\raw"
New-Item -ItemType Directory -Force -Path $rawDir | Out-Null
$csvPath = Join-Path $rawDir "usability.csv"
$header = "date,server,serverKind,serverVersion,performer," + (($questions | ForEach-Object { $_.Key }) -join ",") + ",noteSurprised,noteBlocked,noteHelped"
if (-not (Test-Path $csvPath)) {
    Set-Content -Path $csvPath -Value $header -Encoding UTF8
}
$notes = @($noteSurprised, $noteBlocked, $noteHelped) | ForEach-Object { '"' + ("$_" -replace '"', '""') + '"' }
$row = "$date,$Server,$ServerKind,""$ServerVersion"",""$Performer""," + (($questions | ForEach-Object { $answers[$_.Key] }) -join ",") + "," + ($notes -join ",")
Add-Content -Path $csvPath -Value $row -Encoding UTF8
Write-Ok "Dopisano pomiar do results/raw/usability.csv"

Write-WarnMsg "Zastrzezenie metodyczne: oceny jednoosobowe sa obciazone -- w raporcie oznaczac jako jakosciowe."
