# sql-mcp — gotowy serwer SQL/PostgreSQL MCP

**Zainstalowany:** `@henkey/postgres-mcp-server@1.0.7` (pin: `../manifest.json` +
`version.json`). Zastąpił rozważanego wcześniej
`@modelcontextprotocol/server-postgres`, który jest oznaczony w npm jako deprecated.

| | |
|---|---|
| Uruchamianie | `npx -y @henkey/postgres-mcp-server@1.0.7 --connection-string postgresql://…` (runner buduje connection string z `env.postgres` — **ta sama baza `orders`** co serwery własne) |
| Katalog | **18 narzędzi / 27 749 znaków schematów** (inspekcja `npm run inspect:mcp`); meta-narzędzia z parametrem `operation` |
| Mapping rodzin | [scenarios/third-party/sql-mcp.mapping.yaml](../../scenarios/third-party/sql-mcp.mapping.yaml): `db_read → [pg_execute_sql, pg_execute_query]`, `db_write → [pg_execute_mutation, pg_execute_sql]`, `schema_inspect → [pg_manage_schema]` |
| Scenariusze | [scenarios/third-party/sql-mcp.yaml](../../scenarios/third-party/sql-mcp.yaml) — SQL-001…005, te same prompty co serwery własne |
| Pomiary | `npm run llm:all -- --server sql-mcp [--iterations N] [--num-ctx N]` (wariant `third_party_mcp_llm`; rekordy z `serverKind=third_party` i `metadata.serverVersion`) |
| Config hosta | [config/mcp/mcp-third-party-sql-mcp.json](../../config/mcp/mcp-third-party-sql-mcp.json) |
| Usability | `scripts/run/run_usability_checks.ps1` dopisuje wiersz do `results/raw/usability.csv` |

**Znane ograniczenia (z pierwszych przebiegów):** katalog ~22 tys. tokenów promptu
przekracza domyślne `num_ctx=8192` lokalnego modelu (stąd błędy formatu odpowiedzi) —
warto podnieść `--num-ctx`; model bez wcześniejszego odczytu schematu halucynuje kolumny,
co prowadzi do pętli nieudanych zapytań aż do limitu tur.
