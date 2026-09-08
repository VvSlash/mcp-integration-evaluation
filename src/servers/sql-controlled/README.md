# Serwer MCP: sql-controlled (narzędzia domenowe)

Wariant referencyjny „narzędzia domenowe": wąskie, dobrze opisane narzędzia
z walidowanymi parametrami (Zod). Porównywany z baseline i z wariantem sql-minimal.

| | |
|---|---|
| Narzędzia | `health_check`, `pg_health_check`, `pg_search_orders({ status?, customerEmail?, minAmount?, maxAmount?, limit? })`, `pg_get_order_statistics({ groupBy: status\|currency, dateFrom?, dateTo? })` (agregaty count/sum/avg; scenariusz SQL-007; test buildera: `tests/unit/orderStatisticsQuery.test.ts`) |
| Zasoby | brak (celowo — kontrast z sql-minimal) |
| Uruchomienie | `npm run server:sql-controlled` (alias: `npm run dev`) |
| Konfiguracja hosta | [`config/mcp/mcp-server-postgres-tools.json`](../../../config/mcp/mcp-server-postgres-tools.json) |
| Dane | tabela `orders` (`datasets/postgres/`, seed: `setup_postgres_data.ps1`) |
| Env | `POSTGRES_*`, `TOOL_MAX_LIMIT`, `MCP_SERVER_NAME/_VERSION` (`.env`) |

## Testy i weryfikacja

1. **Testy jednostkowe/integracyjne (kanoniczne):** plany w
   `tests/unit/sqlControlledTools.testplan.ts` i
   `tests/integration/sqlControlledServer.stdio.testplan.ts`.
2. **Smoke test — MCP Inspector** (ręczny): lista narzędzi, 1 wywołanie.
3. **Smoke test — mcp-interviewer (OPCJONALNY, automatyczny):** lint schematów narzędzi
   i inspekcja serwera bez LLM; z flagą `-WithLlm` także testy funkcjonalne na Ollamie:

   ```powershell
   powershell -ExecutionPolicy Bypass -File scripts/run/run_server_interviews.ps1 -Server sql-controlled
   ```

   Raport: `results/raw/external/mcp-interviewer/sql-controlled/`. Wymaga wcześniejszej
   instalacji: `install_eval_frameworks.ps1 -Only mcp-interviewer`. Jest też objęty
   warunkowym testem `tests/integration/mcpInterviewer.smoke.test.ts` (pomijanym, gdy
   framework nie jest zainstalowany).
4. **Pomiary alternatywne (OPCJONALNE):** `mcp-gating-eval` przeciwko temu serwerowi
   (tokeny przy różnej ekspozycji narzędzi); import wyników: `npm run normalize`.
