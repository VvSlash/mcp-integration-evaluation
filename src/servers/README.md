# src/servers/ — własne serwery MCP

Wszystkie własne serwery: TypeScript, SDK `@modelcontextprotocol/server@2.0.0-alpha.2`,
wzorzec `registerTool` + Zod / `registerResource` + `ResourceTemplate`,
transport stdio, uruchamianie przez `tsx`, konfiguracja przez `src/config/env.ts` + `.env`.

| Katalog | Serwer | Uruchomienie |
|---|---|---|
| `sql-controlled/` | narzędzia domenowe (`pg_health_check`, `pg_search_orders`, `pg_get_order_statistics`) | `npm run dev` / `npm run server:sql-controlled` |
| `sql-minimal/` | surowe SQL + zasoby schematu (`execute_read_query`/`execute_write_query`, `postgres://tables/{t}`, `postgres://schema`) | `npm run dev:sql` / `npm run server:sql-minimal` |
| `sql-generic/` | narzędzia tabelaryczne z celowo ubogimi opisami (`list_tables`, `read_table`, `filter_rows`, `count_rows`) | `npm run server:sql-generic` |
| `json/` | pliki JSON w `datasets/json/` (JSONPath — jsonpath-plus); zapisy tylko na kopii roboczej `datasets/.work/json/` | `npm run server:json` |
| `blender/` | minimalne sterowanie Blenderem przez most TCP do addonu | `npm run server:blender` |
| `rest-api/` | wrapper MCP nad lokalnym REST API (5 narzędzi 1:1 + `rest://openapi`) | `npm run server:rest` (API: `npm run rest-api`) |

**Ostrzeżenie (sql-minimal)**: serwer świadomie nie ma walidacji read-only, parsera SQL
ani allow-listy tabel — to wariant badawczy przeznaczony wyłącznie do syntetycznych
danych w izolowanym środowisku. Nie należy dodawać do niego zabezpieczeń.

Każdy serwer ma własny `README.md` z procedurą uruchomienia i testów — w tym smoke
testem OPCJONALNYM frameworkiem mcp-interviewer
(`scripts/run/run_server_interviews.ps1` + warunkowy test
`tests/integration/mcpInterviewer.smoke.test.ts`).

Konfiguracje hostów: `config/mcp/`.
