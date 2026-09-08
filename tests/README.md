# tests/ — testy projektu (vitest)

| Katalog | Zakres |
|---|---|
| `unit/` | adaptery, narzędzia serwerów, loader scenariuszy, metryki, normalizator |
| `integration/` | serwer MCP ↔ klient (stdio, prawdziwa baza testowa), lokalne REST API |
| `e2e/` | pełny mini-przebieg pipeline'u na małej próbce (1 scenariusz) |
| `usability/` | skrypty pomiaru czasu setupu / liczby kroków |

## Konwencja planów testów `*.testplan.ts`

Pliki `*.testplan.ts` to **plany testów** (opis tego, co ma być przetestowane i z jakimi
plikami projektu test jest powiązany). Vitest ich nie zbiera, dzięki czemu
`npm test` (`vitest run --passWithNoTests`) pozostaje zielony przed implementacją.

**Implementując test, zmień rozszerzenie `X.testplan.ts` → `X.test.ts`** i zastąp
plan rzeczywistymi przypadkami (`describe`/`it`). Zasada projektu: `npm test` zielony
na każdym commicie do gałęzi głównej.

## Testy zaimplementowane

Pełny zestaw uruchamia `npm run test:all` (build, `npm test`, `npm run test:integration`).
Testy integracyjne wymagają uprzedniego `npm run setup:test-db` i zainstalowanych
zależności MCP. W `integration/campaignReliability.test.ts` sprawdzamy role PostgreSQL,
dwa resety po mutacji SQL, wznowienie bez duplikatów z odmową po zmianie konfiguracji
oraz pełny plan REST→JSON wykonany dwa razy. Model w ostatnim teście jest kontrolowanym
źródłem wywołań; serwery, transport i zmiany plików są rzeczywiste. Dodatkowo pilot
wykonuje oba XSRV z lokalnym modelem, w tym scenę Blendera.

Test dziennika w `unit/measurementV2.test.ts` dowodzi odrzucenia urwanego zapisu
i niezmienności poprawnego prefiksu; nie deklaruje automatycznej naprawy uszkodzonego
dziennika.

| Plik | Zakres | Warunek uruchomienia |
|---|---|---|
| `unit/resultRecord.test.ts` | wspólny format wyników | zawsze |
| `unit/normalize.test.ts` | normalizator na próbce (`unit/__fixtures__/normalize/`) | zawsze |
| `integration/mcpInterviewer.smoke.test.ts` | automatyczny smoke test serwerów własnych (`sql-controlled`, `sql-minimal`, `json`) opcjonalnym frameworkiem mcp-interviewer (lint schematów, bez LLM i bez bazy) | **pomijany**, gdy framework niezainstalowany (`install_eval_frameworks.ps1 -Only mcp-interviewer`) |
| `integration/restApi.test.ts` | lokalne REST API in-process na porcie efemerycznym: endpointy, walidacja POST, `/metrics`, log JSONL, determinizm seedu | zawsze |
| `integration/restMcpTools.test.ts` | rdzeń narzędzi serwera REST API MCP (mapowanie 1:1, kody REST_HTTP_*/REST_API_UNAVAILABLE) + spójność zasobu `rest://openapi` z endpointami | zawsze |
| `unit/scenarioLoader.test.ts`, `unit/orderStatisticsQuery.test.ts`, `unit/schemaResource.test.ts`, `unit/jsonTools.test.ts` | loader scenariuszy, builder statystyk, render `postgres://schema`, rdzeń narzędzi JSON | zawsze |
| `unit/mcpGenericRunner.test.ts` | zaplecze wspólnego runnera MCP-only: rejestr serwerów pokrywa scenariusze `scenarios/mcp/**`, ujednolicone parsery liczności wyniku i kodów błędów | zawsze |
| `unit/llmMetrics.test.ts` | czyste metryki MCP+LLM: ekstrakcja finalnego JSON, argumentCorrectness (1/0.5/0; sql/path → null), resultIntegrationScore | zawsze |

Testy korzystające z narzędzi opcjonalnych muszą być warunkowe (`describe.skipIf`) —
czyste środowisko bez frameworków ma pozostać zielone.
