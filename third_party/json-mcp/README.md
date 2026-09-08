# json-mcp — gotowy serwer JSON/filesystem MCP

**Zainstalowany:** oficjalny `@modelcontextprotocol/server-filesystem@2026.7.10`
(pin: `../manifest.json` + `version.json`). Rozważany wcześniej
`json-mcp-server` okazał się serwerem split/merge o niedopasowanych rodzinach narzędzi.

| | |
|---|---|
| Uruchamianie | `npx -y @modelcontextprotocol/server-filesystem@2026.7.10 <katalog>`; runner wskazuje **kopię roboczą** `datasets/.work/json-mcp/` (te same pliki co `datasets/json/`); hooki kopiują fixture'y i odtwarzają plik przed iteracją mutującą, więc fixture'y pozostają nietknięte |
| Katalog | **14 narzędzi / 7 987 znaków schematów** (inspekcja `npm run inspect:mcp`) |
| Mapping rodzin | [json-mcp.mapping.yaml](../../scenarios/third-party/json-mcp.mapping.yaml): `read/query/filter → read_text_file…` (serwer **bez JSONPath** — filtrowanie odbywa się w kontekście modelu, w przeciwieństwie do własnego `json_query`), `update → [edit_file, write_file]` |
| Scenariusze | [json-mcp.yaml](../../scenarios/third-party/json-mcp.yaml) — JSON-001…004, te same prompty co serwer własny |
| Pomiary | `npm run llm:all -- --server json-mcp [--iterations N]` (wariant `third_party_mcp_llm`) |
| Config hosta | [config/mcp/mcp-third-party-json-mcp.json](../../config/mcp/mcp-third-party-json-mcp.json) |
| Usability | `scripts/run/run_usability_checks.ps1` dopisuje wiersz do `results/raw/usability.csv` |

**Z pierwszych przebiegów (1 iter.):** 2/4 sukcesów; model odkrywa katalog przez
`list_allowed_directories` (mierzony koszt), filtrowanie całych plików w kontekście
podnosi tokeny (JSON-003 ≈ 18,8 tys.), `edit_file` zapisał poprawną wartość mimo
niedomkniętej odpowiedzi.
