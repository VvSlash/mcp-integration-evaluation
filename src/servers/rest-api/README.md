# Serwer MCP: rest-api (wrapper nad lokalnym REST API)

Wrapper MCP nad aplikacją `src/rest-api/`. Cel badawczy: pomiar czystego narzutu MCP
nad HTTP — porównanie REST-005 (bezpośrednie HTTP vs przez MCP vs przez MCP+LLM)
na TEJ SAMEJ aplikacji.

| | |
|---|---|
| Narzędzia (1:1 z endpointami — wariant kontrolny) | `rest_health_check` → GET /health, `rest_get_products({category?, limit?})` → GET /products, `rest_get_product({id})` → GET /products/:id, `rest_get_orders({status?, limit?})` → GET /orders, `rest_create_order({productId, quantity, customerName})` → POST /orders |
| Zasób | `rest://openapi` — specyfikacja OpenAPI 3 lokalnego API (badanie: czy LLM czyta spec przed wywołaniami — `resourceReadCount`); spójność z endpointami pilnuje test |
| Kody błędów | `REST_HTTP_<status>` (odpowiedź poza oczekiwanym statusem), `REST_API_UNAVAILABLE` (API nie działa — `npm run rest-api`) |
| Uruchomienie | `npm run server:rest` (wymaga działającego API; runner MCP-only startuje je sam) |
| Konfiguracja hosta | [`config/mcp/mcp-server-rest.json`](../../../config/mcp/mcp-server-rest.json) |
| Env | `REST_API_PORT` (4100) / `REST_API_BASE_URL` (sekcja `restApi` w env.ts) |

## Testy i weryfikacja

1. **Test integracyjny rdzenia narzędzi** (zawsze, bez zależności):
   `tests/integration/restMcpTools.test.ts` — funkcje 1:1 przeciwko prawdziwej
   aplikacji in-process + spójność `rest://openapi` z endpointami lokalnego API.
2. **Runner MCP-only:** `npm run mcp:rest [-- <iteracje>]` — REST-001…004
   (`scenarios/mcp/rest.yaml`); runner sam startuje API ze świeżym seedem
   (REST-004 mutuje stan) i pisze rekordy pomiarowe do `results/raw/<runId>/`.
3. **Smoke — mcp-interviewer (OPCJONALNY):**
   `scripts/run/run_server_interviews.ps1 -Server rest-api` → raport w
   `results/raw/external/mcp-interviewer/rest-api/`; także warunkowy test
   `tests/integration/mcpInterviewer.smoke.test.ts`.
4. **MCP+LLM:** scenariusze w `scenarios/mcp-llm/rest.yaml`, przebiegi wspólnym
   runnerem: `npm run llm:all -- --server rest-api`.
