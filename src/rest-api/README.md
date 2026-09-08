# src/rest-api/ — lokalne REST API (aplikacja testowa, NIE serwer MCP)

System zewnętrzny kategorii `rest`: opakowuje go serwer MCP z `src/servers/rest-api/`,
a porównanie REST-005 zestawia trzy drogi dostępu do TEJ SAMEJ aplikacji
(HTTP wprost / przez MCP / przez MCP+LLM).

| | |
|---|---|
| Framework | Express 5.1.0 |
| Pliki | `app.ts` — fabryka aplikacji (testy integracyjne startują ją na porcie efemerycznym), `server.ts` — proces (`npm run rest-api`) |
| Endpointy | `GET /health`, `GET /products?category=&limit=`, `GET /products/:id`, `GET /orders?status=&limit=`, `POST /orders` (400 przy złym body, 404 przy złym productId), `GET /metrics` |
| Stan | wyłącznie w pamięci, z seedu `datasets/rest-api/seed.json` (Zod; generator: `npm run data:rest-seed`) — **restart = reset** (deterministyczne iteracje) |
| `/metrics` | `{ requestCount, avgLatencyMs, perEndpoint }` — weryfikacja `unnecessaryToolCalls` w wariantach MCP; sam odczyt `/metrics` nie jest wliczany |
| Log | JSONL per żądanie → `results/raw/rest-api-access-<start>.jsonl` (niezależne źródło prawdy o wywołaniach) |
| Env | `REST_API_PORT` (domyślnie 4100), `REST_API_SEED_PATH` (opcjonalny) |

Testy: `tests/integration/restApi.test.ts`. Baseline:
`npm run baseline:rest [-- <iteracje>]` — runner sam startuje proces z `dist/`
(świeży seed per przebieg) i zapisuje rekordy pomiarowe do `results/raw/<runId>/`.
