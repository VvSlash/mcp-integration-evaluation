# src/runners/ — runnery ewaluacyjne

Warianty ewaluacji: `baseline` (bez MCP) → `mcp` (MCP-only, bez LLM)
→ `mcp_llm` (pełna ścieżka z Ollamą) → `third_party_mcp_llm` (gotowe serwery zewnętrzne).

| Katalog | Plik | Opis |
|---|---|---|
| `baseline/` | `runPostgresBaseline.ts`, `directPostgres.ts` | bezpośredni dostęp do PostgreSQL, bez warstwy MCP |
| `baseline/` | `runRestBaseline.ts` | scenariusze `scenarios/baseline/rest.yaml`; sam startuje API z `dist/` (świeży seed per przebieg) |
| `mcp/` | `runPostgresMcp.ts` (SQL controlled) | spawn `dist/servers/sql-controlled/server.js` |
| `mcp/` | `runPostgresMcpSql.ts` (SQL minimal) | sterowany scenariuszami YAML (loader z `src/shared/scenarioLoader.ts`), rozgrzewka 2 iteracje |
| `mcp/` | `runJsonMcp.ts` (serwer JSON) | scenariusze `scenarios/mcp/json.yaml`; kopia robocza odtwarzana przed iteracjami mutującymi (JSON-004) |
| `mcp/` | `runRestMcp.ts` (serwer REST API MCP) | scenariusze `scenarios/mcp/rest.yaml`; sam startuje lokalne API ze świeżym seedem + serwer MCP z `dist/` |
| `mcp/` | `runMcpGeneric.ts` + `serverRegistry.ts` (wspólny, wszystkie serwery) | `npm run mcp:all [-- --server X] [-- --iterations N]`; rejestr serwerów z hookami (REST API ze świeżym seedem, reset kopii JSON); **używany w orkiestracji** (`run_all_mcp_only.ps1`) — runnery dedykowane pozostają do debugowania i porównań |
| `mcp-llm/` | `runPostgresMcpWithOllama.ts`, `runPostgresMcpSqlWithOllama.ts` | dedykowane przebiegi MCP+LLM dla serwerów SQL |
| `mcp-llm/` | `runMcpLlmGeneric.ts` + `llmMetrics.ts` (wspólny, multi-serwer) | `npm run llm:all [-- --server X] [-- --scenario ID] [-- --catalog scenario\|full] [-- --iterations N]`; katalog 1 vs N serwerów (tryb zapisany w `externalLabels`), metryki LLM, scenariusz cross XSRV-001; przebiegi `llm_only` pozostają w runnerach dedykowanych |

Wszystkie runnery zapisują wyniki do `results/raw/<runId>/`
(measurements.json/csv + manifest.json + artefakty pomocnicze summary/tokenComparison)
przez `src/shared/resultsWriter.ts`; konwersja pomiarów przebiega tym samym adapterem,
którego używa normalizator (`src/shared/legacyMapping.ts`). Rekordy `llm_only`
z porównań tokenowych są pełnoprawnymi rekordami w measurements.json.

Orkiestracja: `scripts/run/*.ps1`. Wyniki: `results/raw/<runId>/`.
