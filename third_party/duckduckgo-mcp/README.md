# duckduckgo-mcp — gotowy serwer Web Search MCP

**Zainstalowany:** `@oevortex/ddg_search@1.4.0` (pin: `../manifest.json` +
`version.json`). Wybrano wariant npm jako najaktywniej utrzymywany;
alternatywą pozostaje serwer nickclyde (PyPI 0.5.0).

| | |
|---|---|
| Uruchamianie | `npx -y @oevortex/ddg_search@1.4.0` (bez konfiguracji i kluczy) |
| Katalog | **1 narzędzie** (`web-search` z parametrem `mode`) / **1 274 znaki** — najmniejszy katalog w projekcie (kontrast z sql-mcp: 18 narzędzi / 27,7 tys. znaków) |
| Mapping rodzin | [duckduckgo-mcp.mapping.yaml](../../scenarios/third-party/duckduckgo-mcp.mapping.yaml): `web_search/fetch_content → [web-search]` (zdolności rozróżniane trybami `mode`, nie osobnymi narzędziami) |
| Scenariusze | [duckduckgo-mcp.yaml](../../scenarios/third-party/duckduckgo-mcp.yaml) — WEB-001…003; **wzorce DATOWANE** (2026-07-12) w [datasets/websearch/queries.yaml](../../datasets/websearch/queries.yaml); wszystkie mają `deterministic: false`, bo wyniki wyszukiwania zmieniają się w czasie — oceny są oznaczane jako sędziowane |
| Pomiary | `npm run llm:all -- --server duckduckgo-mcp [--iterations N]`; **jedyna zależność sieciowa projektu** — przy pełnych seriach planować odstępy między przebiegami, DuckDuckGo stosuje rate limiting |
| Config hosta | [config/mcp/mcp-third-party-duckduckgo-mcp.json](../../config/mcp/mcp-third-party-duckduckgo-mcp.json) |
| Usability | `scripts/run/run_usability_checks.ps1` dopisuje wiersz do `results/raw/usability.csv` |

**Z pierwszych przebiegów (1 iter.):** 1/3; narzędzie działa poprawnie (sonda z
`mode:"web"` zwraca wyniki), porażki to błędne argumenty modelu — konsolidacja
w jedno narzędzie z trybami przenosi trudność z wyboru narzędzia na dobór argumentów;
WEB-003 „zaliczony z pamięci" (`resultIntegrationScore=null`) — wzorzec wykrywany
przez metrykę.
