# Serwer MCP: sql-minimal (surowe SQL + zasoby schematu)

Wariant „maksymalna swoboda LLM": surowe zapytania SQL + schemat bazy udostępniany
przez zasoby MCP. Bada zdolność LLM do samodzielnego generowania SQL.

> **OSTRZEŻENIE (świadoma decyzja badawcza):** brak walidacji read-only, parsera SQL
> i allow-listy tabel. `execute_write_query` wykonuje dowolny SQL. Serwer przeznaczony
> **wyłącznie do danych syntetycznych w izolowanym środowisku testowym**.
> Nie podłączać go do żadnej realnej bazy i nie uzupełniać brakujących zabezpieczeń.

| | |
|---|---|
| Narzędzia | `execute_read_query({ sql })`, `execute_write_query({ sql })`, `health_check` |
| Zasoby | `postgres://tables/{table_name}` (kolumny: typ, NOT NULL, PK, DEFAULT + przykładowe SELECT) oraz zbiorczy `postgres://schema` (cały schemat public w jednym odczycie; test renderu: `tests/unit/schemaResource.test.ts`) |
| Runner MCP-only | `npm run mcp:postgres:sql [-- <iteracje>]` (deterministyczne SQL ze `scenarios/mcp/sql-minimal.yaml`, rozgrzewka 2 iteracje, wyniki do `results/raw/<runId>/`) |
| Uruchomienie | `npm run server:sql-minimal` (alias: `npm run dev:sql`) |
| Konfiguracja hosta | [`config/mcp/mcp-server-postgres-sql.json`](../../../config/mcp/mcp-server-postgres-sql.json) |
| Dane | tabela `orders` (`datasets/postgres/`, seed odtwarzalny: `setup_postgres_data.ps1`) |
| Env | `POSTGRES_*`, `MCP_SQL_SERVER_NAME/_VERSION` (`.env`) |

## Testy i weryfikacja

1. **Testy jednostkowe/integracyjne (kanoniczne):** plany w
   `tests/unit/sqlMinimalTools.testplan.ts` i
   `tests/integration/sqlMinimalServer.stdio.testplan.ts`.
2. **Smoke test — MCP Inspector** (ręczny): narzędzia + zasoby + 1 odczyt.
3. **Smoke test — mcp-interviewer (OPCJONALNY, automatyczny):**

   ```powershell
   powershell -ExecutionPolicy Bypass -File scripts/run/run_server_interviews.ps1 -Server sql-minimal
   ```

   Uwaga: lint zgłosi zapewne szerokie schematy (`sql: string`) — to **oczekiwana
   właściwość wariantu badawczego**, nie defekt; należy to odnotować w interpretacji,
   a nie zmieniać narzędzi. Raport:
   `results/raw/external/mcp-interviewer/sql-minimal/`. Test warunkowy:
   `tests/integration/mcpInterviewer.smoke.test.ts`.
4. **Pomiary alternatywne (OPCJONALNE):** `mcp-gating-eval` oraz porównanie z gotowym
   serwerem SQL MCP na tych samych scenariuszach; import wyników: `npm run normalize`.
