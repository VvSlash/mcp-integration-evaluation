# datasets/ — dane testowe i fixture'y

Zasada nadrzędna: **wyłącznie dane syntetyczne** — żadnych danych osobowych,
produkcyjnych ani sekretów. Każdy generator ma stały seed (powtarzalność).

| Katalog | Zawartość | Generacja |
|---|---|---|
| `postgres/` | `001_init_orders.sql` — tabela `orders` (seed deterministyczny w SQL), `002_roles.sql` — role bazy testowej, `003_injection_fixture.sql` — fixture scenariuszy bezpieczeństwa | `scripts/setup/windows/setup_postgres_data.ps1` |
| `json/` | `products.json`, `orders.json`, `config.json` + `products.expected.json` | `npm run data:json` |
| `excel/` | `sales.xlsx` (arkusze `Sales2025`, `Products`) + `sales.expected.json` | `scripts/setup/windows/setup_excel_fixtures.ps1` (wymaga Pythona) |
| `blender/` | YAML opisy scen referencyjnych (BLEND-001…003) | ręcznie + walidator `scripts/data/validate_blender_scene.py` |
| `websearch/` | `queries.yaml` — zapytania + datowane odpowiedzi wzorcowe | ręcznie; odpowiedzi wzorcowe są datowane i mogą się starzeć wraz ze zmianą treści w internecie |
| `rest-api/` | `seed.json` — produkty i zamówienia startowe lokalnego API | `npm run data:rest-seed` |
| `.work/` | kopie robocze plików mutowanych w scenariuszach (JSON update, Excel write) — odtwarzane przed iteracją; **poza kontrolą wersji** (`.gitignore`) | runnery |

Reguły: fixture'y są wersjonowane w repo (małe pliki); wartości oczekiwane w scenariuszach
muszą być wyliczalne z fixture'ów (pliki `*.expected.json` — bez magicznych stałych).
