# scripts/ — skrypty projektu

| Katalog | Zawartość |
|---|---|
| `setup/windows/` | instalatory i setup środowiska (PowerShell, idempotentne); w tym `install_eval_frameworks.ps1` — opcjonalne zewnętrzne frameworki ewaluacyjne z weryfikacją wymagań (`compatibility.json`) i stackiem monitoringu Prometheus/Grafana/Jaeger (`-WithMonitoring`, config w `config/monitoring/`) |
| `setup/linux/` | opcjonalne odpowiedniki bash (obecnie tylko README) |
| `install/` | miejsce na wspólne, wieloplatformowe helpery instalacyjne — kanoniczne instalatory są w `setup/windows/` |
| `data/` | generatory i walidatory fixture'ów: `generate_json_fixtures.ts`, `generate_rest_seed.ts`, `generate_excel_fixtures.py`, `generate_orders.ts` (deterministyczne seedy) oraz `validate_blender_scene.py` / `validate_blender_scene.ts`, `inspect_catalog_constraints.py`, `inspect_workbook_state.py` |
| `run/` | orkiestracja przebiegów pomiarowych + usability + `run_server_interviews.ps1` (automatyczny smoke test serwerów własnych opcjonalnym frameworkiem mcp-interviewer) |
| `plots/` | `generate_all_plots.py` — wykresy ze zbioru znormalizowanego oraz danych usability, zapisywane do `results/plots/<runId>/` razem z manifestem (uruchomienie: `.venv/Scripts/python.exe scripts/plots/generate_all_plots.py`); `campaign_plots.py` — funkcje rysujące; `requirements.txt` — przypięte wersje zależności |

Wymogi wobec skryptów: idempotencja, jawne komunikaty o brakach z instrukcją naprawy,
zero sekretów.

Normalizacja wyników: `npm run normalize` (`src/evaluation/normalize.ts`) scala
`results/raw/**` (wyniki własnych przebiegów oraz importy frameworków z
`results/raw/external/`) do `results/normalized/measurements.csv`.
