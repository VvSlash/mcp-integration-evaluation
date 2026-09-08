# third_party/eval-frameworks/ — zewnętrzne frameworki ewaluacji MCP (opcjonalne)

Frameworki zintegrowane jako **kompatybilne, opcjonalne alternatywy** dla własnego
pipeline'u pomiarowego. Własna metoda (`src/runners/` + `src/evaluation/`) pozostaje
kanoniczna; frameworki dają **alternatywny pomiar poszczególnych metryk** (mapowanie
w tabeli poniżej). Wyniki frameworków importuje do wspólnego formatu normalizator
(`npm run normalize`, katalog wejściowy: `results/raw/external/<framework>/`).

Instalacja i weryfikacja wymagań: `scripts/setup/windows/install_eval_frameworks.ps1`
(manifest: `../eval-frameworks.manifest.json`; per framework generowane są `version.json`
i `compatibility.json`, a przy problemach `issues.json`).

| Framework | Instalacja | Wymagania kluczowe | Co daje projektowi (alternatywa dla) | Zgodność z lokalnym LLM |
|---|---|---|---|---|
| `deepeval` (confident-ai) | pip, venv w `deepeval/.venv` | Python ≥ 3.9 | ToolCorrectness → `toolSelectionAccuracy`; ArgumentCorrectness → `argumentCorrectness`; TaskCompletion / metryki MCP → `finalAnswerCorrectness` (LLM-as-a-judge dla WEB/Blender) | TAK (custom provider / `deepeval set-ollama`) |
| `mcpevals-lastmile` (lastmile-ai/mcp-eval) | pip `mcpevals`, venv | Python ≥ 3.10, **wymaga klucza API** (Anthropic/OpenAI/Google) | latencja/tokeny/koszt z trace'ów OTel → `latencyMs`/`tokenUsage`; path efficiency → `unnecessaryToolCalls`; raporty JSON/HTML/MD | NIE (płatne API — takie przebiegi oznaczać w wynikach) |
| `mcp-evals-node` (mclenhard) | npm lokalnie w `mcp-evals-node/` | Node ≥ 20, klucz OpenAI/Anthropic; **monitoring: Prometheus+Grafana+Jaeger (Docker)** → `config/monitoring/` | oceny 1–5 (accuracy/completeness/relevance/clarity/reasoning) → `finalAnswerCorrectness` + `externalScores`; metryki OTel narzędzi | do weryfikacji (endpoint zgodny z OpenAI przez AI SDK) |
| `mcpbench` (modelscope) | git clone + `pip -r requirements.txt`, venv | **Python ≥ 3.11**, Node, **jq** | benchmark accuracy/latency/tokeny dla web search i DB → niezależne potwierdzenie wyników pomiaru własnego | do weryfikacji (konfigurowalne endpointy) |
| `mcp-gating-eval` (pavansgill) | git clone + `pip install -e`, venv | **Python ≥ 3.11** | tryby full/toggle/act → pomiar tokenów przy 1 vs N narzędziach; `results.jsonl` importowany wprost przez normalizator | **TAK — Ollama przez `base_url`** (bez kluczy) |
| `mcpmark` (eval-sys) | git clone + `pip install -e`, venv | Python (minimalna wersja nieudokumentowana — sprawdzić `pyproject`); klucze API per usługa; zadania browser: ręczny krok `playwright install` | benchmark stress-testowy (127 zadań; suity **Postgres i Filesystem** zbieżne z kategoriami sql/json): pass@1/pass@k → `successRate`, pass^k/avg@k → powtarzalność, tokeny i tury | prawdopodobnie (LiteLLM: `ollama/<model>` — zweryfikować) |
| `mcp-interviewer` (Microsoft) | pip `mcp-interviewer`, venv | Python ≥ 3.10 (przykłady: 3.12); klucz API tylko dla `--test`/`--judge` | **ocena jakości samego serwera**: lint schematów narzędzi (limity OpenAI ≤128 narzędzi/≤64 znaki), testy funkcjonalne, statystyki wywołań → rozmiar katalogu narzędzi, ocena usability; smoke test obok MCP Inspectora | **TAK — OpenAI-compatible `base_url` (Ollama)**; lint działa bez LLM |

## Wymagania środowiskowe

- **Node ≥ 20** — spełnione przez `install_node_dependencies.ps1` (wymusza ≥ 20).
- **Python** — projektowy `install_python_dependencies.ps1` akceptuje ≥ 3.10, a MCPBench
  i mcp-gating-eval wymagają **≥ 3.11** — dlatego `install_eval_frameworks.ps1` szuka
  interpretera per framework (launcher `py -3.13…-3.11`) i tworzy **osobne venv-y**
  (unikamy też konfliktów zależności z projektowym `.venv` — pandas/matplotlib).
- **jq** (MCPBench) — NIE jest instalowane przez setup projektu; skrypt wykrywa brak
  i podaje naprawę (`winget install jqlang.jq`).
- **Klucze API** — projekt domyślnie ich nie ma (zakres: lokalny LLM). Frameworki
  oznaczone „wymaga klucza" działają dopiero po ustawieniu zmiennych w `.env`
  (placeholdery w `.env.example`); takie przebiegi należy oznaczać w wynikach.
- **Ollama (endpoint zgodny z OpenAI)** — dostępny w środowisku pod
  `http://localhost:11434/v1`; skrypt sprawdza `/v1/models`.
- **Docker** (stack monitoringu mcp-evals; opcjonalny wariant izolacji przebiegów
  MCPMark przez `build-docker.sh`) — opcjonalny; brak nie blokuje instalacji.
- **Playwright** (tylko suita browser w MCPMark) — ręczny krok `playwright install`
  po instalacji; poza zakresem projektu (używamy suit Postgres/Filesystem).

Szczegółowy, aktualny wynik weryfikacji per framework: `<nazwa>/compatibility.json`
(generowany przy każdym uruchomieniu skryptu, także w trybie `-SkipInstall`).

## Zasady użycia

1. Wersje przypięte (`version.json`); wyniki zawierają wersję frameworka.
2. Frameworki uruchamiamy **przeciwko naszym własnym serwerom i fixture'om**
   (porównywalność); wyniki lądują w `results/raw/external/<framework>/`.
3. Rekordy z frameworków mają `evaluationSource` ≠ `own` — raport końcowy zawsze
   odróżnia pomiar własny od alternatywnego.
4. Awarie → `<nazwa>/issues.json`; kod frameworków nie jest modyfikowany.
