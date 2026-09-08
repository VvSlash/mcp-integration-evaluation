# mcp-integration-evaluation

Środowisko badawcze do projektowania i ewaluacji serwerów **Model Context Protocol
(MCP)**. Porównuje integrację LLM przez MCP z bezpośrednim dostępem do źródeł danych
(baseline) w czterech wariantach: `baseline`, `MCP-only`, `MCP+LLM` oraz
`third-party MCP+LLM`, z modelem uruchamianym lokalnie przez Ollamę.

Środowisko docelowe: **Windows + PowerShell**. Wszystkie skrypty są idempotentne —
można je bezpiecznie uruchamiać wielokrotnie.

---

## 1. Co zawiera repozytorium

### Serwery własne (`src/servers/`)

| Serwer | Opis | Uruchomienie |
|---|---|---|
| `sql-controlled` | narzędzia domenowe na PostgreSQL (`pg_search_orders`…) | `npm run server:sql-controlled` |
| `sql-generic` | pięć ogólnych narzędzi tabelowych z celowo ubogimi opisami | `npm run server:sql-generic` |
| `sql-minimal` | surowe SQL + zasoby schematu (celowo bez guardów — wyłącznie dane syntetyczne) | `npm run server:sql-minimal` |
| `json` | operacje na plikach JSON (JSONPath; zapisy tylko na kopii roboczej) | `npm run server:json` |
| `rest-api` | wrapper MCP nad lokalnym REST API (5 narzędzi 1:1 + zasób `rest://openapi`) | `npm run server:rest` |
| `blender` | sterowanie Blenderem: 6 narzędzi + zasób `blender://scene` | `npm run server:blender` |

Serwer `blender` wymaga działającego mostu TCP — patrz [sekcja 5.1](#51-start-serwera-stdio).

### Gotowe serwery third-party (`third_party/`)

Pięć kategorii, wszystkie z mapowaniem rodzin narzędzi, scenariuszami i pomiarami
przez `npm run llm:all -- --server <nazwa>`:

| Kategoria | Pakiet |
|---|---|
| SQL | `@henkey/postgres-mcp-server@1.0.7` |
| JSON | `@modelcontextprotocol/server-filesystem@2026.7.10` (praca na kopii roboczej — fixture'y nietykane) |
| Excel | `excel-mcp-server==0.1.8` (pip-venv; ścieżki absolutne przez token `{{REPO}}` w promptach) |
| Web Search | `@oevortex/ddg_search@1.4.0` (jedyna zależność sieciowa; scenariusze niedeterministyczne) |
| Blender | `ahujasid@6e99eb5` + PyPI `blender-mcp==1.6.4` |

Inspekcja katalogu dowolnego serwera:
`npm run inspect:mcp -- --command "npx -y <pakiet>@<wersja> …"`.
Szczegóły: [third_party/README.md](third_party/README.md).

### Frameworki ewaluacyjne (opcjonalne, `third_party/eval-frameworks/`)

Siedem zewnętrznych frameworków jako alternatywne metody pomiaru obok własnego
pipeline'u: deepeval, mcpevals (lastmile), mcp-evals (node), MCPBench,
mcp-gating-eval, MCPMark, mcp-interviewer. Mapowanie metryk na format projektu:
[third_party/eval-frameworks/README.md](third_party/eval-frameworks/README.md).

Wyjątkiem jest `mcp-interviewer` — służy do inspekcji kontraktów serwerów
i instaluje się domyślnie przez `setup_all.ps1`.

---

## 2. Wymagania wstępne

| Zależność | Wymagana do | Instalacja |
|---|---|---|
| Node.js ≥ 20 + npm | wszystko | `winget install OpenJS.NodeJS.LTS` |
| PostgreSQL 17.7 | serwery SQL, baseline, pomiary | setup używa zgodnych binariów albo pobiera portable; tworzy prywatny klaster bez konta administratora istniejącej usługi |
| Python 3.10–3.13 | wykresy, fixture'y Excel | `winget install Python.Python.3.12` |
| Ollama + model Qwen | warianty MCP+LLM | `winget install Ollama.Ollama` |
| Blender *(opcjonalnie)* | scenariusze `BLEND-*` | instaluje skrypt setupu |
| Docker *(opcjonalnie)* | stack monitoringu frameworków | `winget install Docker.DockerDesktop` |
| git, jq *(opcjonalnie)* | część frameworków ewaluacyjnych | `winget install jqlang.jq` |

Python 3.14+ nie jest wspierany — brakuje dla niego gotowych pakietów numpy/matplotlib.

---

## 3. Instalacja

### Krok 0 — pobranie repozytorium

```powershell
git clone https://github.com/VvSlash/mcp-integration-evaluation.git
cd mcp-integration-evaluation
```

Setup zapisuje ustawienia usług w `.env`, a losowe poświadczenia bazy
w `.env.test.local`. Klucze płatnych API nie są potrzebne w zakresie podstawowym.

### Krok 1 — pełny setup jednym poleceniem

```powershell
powershell -ExecutionPolicy Bypass -File scripts/setup/windows/setup_all.ps1
```

| Flaga | Działanie |
|---|---|
| `-SkipPostgres` | pomija tworzenie i seedowanie bazy testowej |
| `-SkipOllama` | pomija weryfikację i pobranie modelu LLM |
| `-SkipThirdParty` | pomija pobieranie gotowych serwerów MCP |
| `-SkipBlender` | pomija instalację Blendera |
| `-WithEvalFrameworks` | dodatkowo instaluje frameworki ewaluacyjne |

Minimalny start (tylko serwery SQL i pomiary):
`setup_all.ps1 -SkipBlender -SkipThirdParty`.

### Krok 2 — kroki pojedynczo

`setup_all.ps1` wykonuje poniższe skrypty we właściwej kolejności; każdy można
uruchomić osobno i wielokrotnie.

| # | Skrypt (`scripts/setup/windows/`) | Co robi | Wymagania wstępne |
|---|---|---|---|
| 1 | `install_node_dependencies.ps1` | weryfikacja Node ≥ 20, `npm ci` (wersje przypięte), kontrola `tsx` | Node.js LTS |
| 2 | `install_python_dependencies.ps1` | venv `.venv/` + pandas, matplotlib, openpyxl; preferuje Python 3.12 przez `py -3.12` | CPython 3.10–3.13 |
| 3 | `install_ollama_models.ps1` | `ollama pull` modelu z `config/ollama/ollama.json`; **faktyczny tag zapisuje do `.env`** jako `OLLAMA_MODEL` | Ollama |
| 4 | `setup_postgres_data.ps1` | prywatny klaster PostgreSQL 17.7, tymczasowe konta i baza, sondy uprawnień; zatruty fixture ładowany wyłącznie w scenariuszach SEC | Node.js |
| 5 | `setup_excel_fixtures.ps1` | generuje `datasets/excel/sales.xlsx` + `sales.expected.json` (stały seed) | venv (tworzy sam w razie braku) |
| 6 | `download_third_party_mcp_servers.ps1 [-Only <nazwa>]` | pobiera i weryfikuje gotowce wg `third_party/manifest.json`; przypina wersje w `version.json` | npm / pip / git zależnie od serwera |
| 7 | `install_blender.ps1` | Blender w wersji z `config/blender/VERSION` (portable zip); zapisuje `BLENDER_PATH` do `.env` | internet przy pobieraniu |

Skrypt `_common.ps1` zawiera wspólne funkcje i nie uruchamia się go bezpośrednio.

Fixture'y JSON i seed REST generują polecenia npm: `npm run data:json`
i `npm run data:rest-seed` (deterministyczne, stały seed; `setup_all.ps1` wywołuje
je automatycznie).

### Krok 3 (opcjonalny) — frameworki ewaluacyjne

```powershell
powershell -ExecutionPolicy Bypass -File scripts/setup/windows/install_eval_frameworks.ps1
```

| Flaga | Działanie |
|---|---|
| `-Only <nazwa>` | tylko jeden framework (np. `-Only mcp-interviewer`) |
| `-SkipInstall` | bez instalacji — sam raport zgodności wymagań (`compatibility.json`) |
| `-WithMonitoring` | startuje Prometheus (`:9090`), Grafanę (`:3000`) i Jaegera (`:16686`) — wymaga Dockera |

Skrypt zakłada **osobny venv dla każdego frameworka**, odizolowany od projektowego
`.venv`, i sam szuka nowszego interpretera (`py -3.1x`), gdy framework wymaga
wyższej wersji Pythona niż projekt.

Bez kluczy API, z lokalną Ollamą, działają: `mcp-gating-eval`, `mcp-interviewer`
i `deepeval`. Pozostałe wymagają kluczy w `.env`; przebiegi z płatnym API są poza
zakresem podstawowym i należy je oznaczać w wynikach.

---

## 4. Weryfikacja instalacji

```powershell
npm run test:all                        # build, testy jednostkowe i testy z żywym środowiskiem
npm run check:ollama                    # połączenie z Ollamą
npm run verify:catalog -- --server all  # kontrakty serwerów (wymaga mostów Blendera)
```

---

## 5. Uruchamianie serwerów

### 5.1. Start serwera (stdio)

```powershell
npm run server:sql-controlled   # narzędzia domenowe
npm run server:sql-minimal      # surowe SQL + zasoby (tylko dane syntetyczne)
npm run server:sql-generic      # ogólne narzędzia tabelowe
npm run server:json             # pliki JSON + JSONPath (zapisy na kopii roboczej)
npm run rest-api                # lokalne REST API (aplikacja testowa, NIE serwer MCP; port 4100)
npm run server:rest             # wrapper MCP nad REST API (wymaga działającego rest-api)
npm run server:blender          # sterowanie Blenderem (wymaga mostu)
```

Most Blendera to jedna instancja Blendera GUI z dwoma addonami TCP: własnym
(`:9877`) i gotowca (`:9876`). Uruchamia je jedno polecenie:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/run/start_blender_bridge.ps1
```

Most musi działać **przed** pomiarami `llm:all -- --server blender-mcp`,
`--server blender` oraz przed przebiegami cross i `-Catalog full`.
Walidacja scen po przebiegach:
`npm run validate:blender-scene -- --reference <id>`.

### 5.2. Smoke test serwera

**Ręcznie (MCP Inspector):** podłącz konfigurację z
`config/mcp/mcp-server-postgres-*.json`, sprawdź listę narzędzi i zasobów,
wykonaj jedno wywołanie.

**Automatycznie (mcp-interviewer)** — lint schematów narzędzi i inspekcja,
bez LLM i bez klucza API:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/run/run_server_interviews.ps1
```

| Flaga | Działanie |
|---|---|
| `-Server all\|sql-controlled\|sql-minimal\|json\|rest-api\|blender` | wybór serwera (domyślnie wszystkie) |
| `-WithLlm` | dodatkowo testy funkcjonalne generowane przez LLM na lokalnej Ollamie |

Raporty trafiają do `results/raw/external/mcp-interviewer/<serwer>/`. Wymaga
wcześniejszego `install_eval_frameworks.ps1 -Only mcp-interviewer`. Ten sam smoke
test działa jako warunkowy przypadek `npm test`
(`tests/integration/mcpInterviewer.smoke.test.ts` — pomijany, gdy frameworka brak).

---

## 6. Pomiary

| Skrypt (`scripts/run/`) | Co mierzy | Flagi |
|---|---|---|
| `run_all_baselines.ps1` | baseline bez MCP: PostgreSQL i REST (runner sam startuje API ze świeżym seedem) | `-Iterations <n>` (domyślnie 30) |
| `run_all_mcp_only.ps1` | MCP-only bez LLM przez wspólny runner (`npm run mcp:all`): sql-controlled, sql-minimal, json i rest w jednym przebiegu | `-Iterations <n>`, `-Server all\|<nazwa>` |
| `run_all_mcp_llm.ps1` | MCP+LLM na Ollamie przez wspólny runner (`npm run llm:all`): własne serwery, gotowce i przebiegi cross | `-Iterations <n>`, `-Server`, `-Catalog scenario\|full`, `-WithLegacyRunners` |
| `run_usability_checks.ps1` | interaktywny protokół usability (10 pytań) | `-Server <nazwa>`, `-ServerKind own\|third_party` (oba wymagane), `-Performer`, `-ServerVersion` |

Serwer `blender` celowo nie występuje w wariancie MCP-only — scenariusze `BLEND-*`
są promptowe. `-Catalog full` mierzy zużycie tokenów przy pełnej ekspozycji katalogu
narzędzi.

Przebiegi LLM są niedeterministyczne i mogą trwać długo na modelu lokalnym.
Wyniki surowe trafiają do `results/raw/`.

Kampanie pomiarowe uruchamia się przez `npm run campaign` (pojedynczy przebieg)
lub `npm run campaign:suite` (pełna seria).

### Pomiary alternatywnymi frameworkami

Frameworki uruchamia się przeciwko tym samym serwerom i fixture'om, a ich wyniki
zapisuje w `results/raw/external/<framework>/` — `results.jsonl` z mcp-gating-eval
bez konwersji, pozostałe w formacie `*.external.json`.

### Normalizacja i wykresy

```powershell
npm run normalize
```

Scala `results/raw/**` (wyniki własne, starsze i zewnętrzne) do
`results/normalized/measurements.csv`. Źródło pomiaru rozróżnia kolumna
`evaluationSource` (`own`, `legacy` albo identyfikator frameworka).

```powershell
.venv\Scripts\python.exe scripts\plots\generate_all_plots.py
```

Zapisuje wykresy do `results/plots/<runId>/` wraz z `manifest.json`. Brak danych
dla wariantu oznacza wykres pominięty z podanym powodem, a nie błąd przebiegu.

---

## 7. Struktura repozytorium

```text
src/servers/        własne serwery MCP
src/runners/        runnery: baseline / mcp / mcp-llm
src/evaluation/     metryki i normalizator
src/shared/         wspólny format wyników
src/rest-api/       lokalne REST API (aplikacja testowa)
scenarios/          scenariusze YAML (szablon: scenarios/TEMPLATE.yaml)
datasets/           dane syntetyczne (stały seed)
config/             konfiguracje MCP / Ollama / Blender / monitoring
scripts/            setup (windows), run, data, plots
third_party/        gotowe serwery MCP i frameworki ewaluacyjne
results/            raw/, normalized/, plots/, reports/ (puste do czasu pomiarów)
tests/              vitest: testy i plany testów (*.testplan.ts)
```

---

## 8. Rozwiązywanie problemów

- **`Failed to build 'matplotlib'` albo błąd kompilacji numpy** — venv powstał na
  Pythonie 3.14+, dla którego nie ma gotowych pakietów. Usuń `.venv/` i uruchom
  ponownie `install_python_dependencies.ps1`; skrypt wybierze Pythona 3.12, jeśli
  jest zainstalowany. Alternatywnie: `winget install Python.Python.3.12`.
- **Blender: „Nie można odnaleźć rekordu końca katalogu centralnego"** — niepełny
  lub uszkodzony zip w `third_party/blender/`. Uruchom ponownie
  `install_blender.ps1`; skrypt wykryje uszkodzenie, usunie zip i pobierze go od nowa.
- **Brak `jq`** (wymagany przez MCPBench) — `winget install jqlang.jq`.
- Każdy skrypt kończy się jawnym komunikatem `[BLAD]` wraz z instrukcją naprawy.
- Problemy z gotowcami są zapisywane w `third_party/<nazwa>/issues.json`.
- Sekrety trzymaj wyłącznie w `.env` — ten plik nie jest wersjonowany.
