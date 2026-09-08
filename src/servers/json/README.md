# Serwer MCP: json (pliki JSON + JSONPath)

Własny serwer plikowy dla lokalnych dokumentów JSON; porównywany z gotowym serwerem
json-mcp na **tych samych fixture'ach**.

| | |
|---|---|
| Narzędzia | `health_check`, `json_list_files()`, `json_read_file({file})`, `json_query({file, path})` — JSONPath (jsonpath-plus@10.3.0), `json_update_value({file, path, value})` — wymaga dokładnie 1 dopasowania |
| Zasoby | `json://files` (lista plików), `json://files/{name}/schema` (wyinferowany schemat: klucze + typy — do czytania przed konstrukcją JSONPath) |
| Uruchomienie | `npm run server:json` |
| Konfiguracja hosta | [`config/mcp/mcp-server-json.json`](../../../config/mcp/mcp-server-json.json) |
| Dane | `datasets/json/` (generator: `npm run data:json`, stały seed; wartości referencyjne: `products.expected.json`) |
| Env | opcjonalne `JSON_DATA_DIR` (domyślnie `datasets/json`), `JSON_WORK_DIR` (domyślnie `datasets/.work/json`); **nie wymaga `POSTGRES_*`** (lazy sekcja postgres w env.ts) |

**Semantyka zapisu (kluczowa dla determinizmu):** `json_update_value`
NIGDY nie modyfikuje fixture'a — pracuje na kopii roboczej w `datasets/.work/json/`
(tworzonej z wzorca przy pierwszym zapisie; katalog poza kontrolą wersji). Odczyty
preferują kopię roboczą, jeśli istnieje (read-your-writes). Runner odtwarza kopię
przed każdą iteracją scenariusza mutującego.

## Testy i weryfikacja

1. **Testy jednostkowe rdzenia** (bez serwera, na realnych fixture'ach):
   `tests/unit/jsonTools.test.ts` — listowanie/odczyt/JSONPath/aktualizacja na kopii,
   walidacja ścieżek (path traversal), inferencja schematu.
2. **Runner MCP-only:** `npm run mcp:json [-- <iteracje>]` — scenariusze JSON-001…004
   (`scenarios/mcp/json.yaml`), rozgrzewka 2 iteracje, wyniki do `results/raw/<runId>/`.
3. **Smoke test — mcp-interviewer (OPCJONALNY):**
   `scripts/run/run_server_interviews.ps1 -Server json` → raport w
   `results/raw/external/mcp-interviewer/json/`; objęty też warunkowym testem
   `tests/integration/mcpInterviewer.smoke.test.ts`.
4. **MCP+LLM:** scenariusze w `scenarios/mcp-llm/json.yaml`, przebiegi wspólnym
   runnerem: `npm run llm:all -- --server json`.
