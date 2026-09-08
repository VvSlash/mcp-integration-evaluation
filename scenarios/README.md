# scenarios/ — scenariusze testowe (YAML)

Wspólny format scenariuszy całego pipeline'u. Loader + walidacja Zod:
`src/shared/scenarioLoader.ts` (test: `tests/unit/scenarioLoader.test.ts`).
Szablon pola-po-polu: [TEMPLATE.yaml](TEMPLATE.yaml).

**Kompatybilność i rozszerzalność (frameworki zewnętrzne):**
pole `metrics` to otwarta lista walidowana względem `KNOWN_METRICS ∪ PROPOSED_METRICS`
(`src/shared/types.ts`; nieznana nazwa = ostrzeżenie loadera, nie błąd — nowe miary
nie wymagają zmiany schematu), a pole `external` przenosi hinty integracyjne per
framework (np. eksport zadania do `tests.json` mcp-gating-eval).

| Katalog | Zawartość |
|---|---|
| `baseline/` | `sql.yaml` — SQL-001…004, `rest.yaml` — REST-001…004 (dla `baseline:rest`) |
| `mcp/` | `sql.yaml`, `sql-minimal.yaml`, `sql-generic.yaml` (SQL-001…004 + SQL-007), `json.yaml` (JSON-001…004), `rest.yaml` (REST-001…004, dla `mcp:rest`) |
| `mcp-llm/` | `sql.yaml` i `sql-generic.yaml` (SQL-001…004 + SQL-007), `sql-minimal.yaml` (SQL-001…007), `json.yaml`, `rest.yaml`, `blender.yaml` (BLEND-001…003, prompty 1:1 z gotowcem, wymaga mostu Blendera), `cross.yaml` (XSRV-001, XSRV-002 — pełny katalog serwerów, wymaga mostu Blendera); runner: `npm run llm:all` |
| `security/` | `sql.yaml` — SEC-001…003 dla każdego wariantu serwera SQL |
| `third-party/` | scenariusze gotowców + mapowania `<serwer>.mapping.yaml` (`tool_family` → nazwa LUB lista nazw; uzupełniane po inspekcji `npm run inspect:mcp`): `sql-mcp.*` (SQL-001…005), `json-mcp.*` (JSON-001…004), `duckduckgo-mcp.*` (WEB-001…003, odpowiedzi wzorcowe są datowane), `excel-mcp.*` (XLSX-001…004), `blender-mcp.*` (BLEND-001…003, wymaga mostu: `start_blender_bridge.ps1`) — runner: `npm run llm:all -- --server <nazwa>` |

Token **`{{REPO}}`** w promptach jest rozwijany przez wspólny runner MCP+LLM do
absolutnego korzenia repo (gotowce wymagające ścieżek absolutnych, np. excel-mcp
w stdio) — scenariusze pozostają przenośne między maszynami.

Zasady:
- migracja PG-001…004 → SQL-001…004 **bez zmiany semantyki**; zmiana semantyki = nowy ID,
- wartości oczekiwane wyliczalne z fixture'ów (`datasets/`), bez magicznych stałych,
- scenariusze zależne od LLM/internetu zawsze `deterministic: false`,
- scenariusz dodaje się razem z implementacją serwera/narzędzia.
