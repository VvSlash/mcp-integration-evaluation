# third_party/ — gotowe serwery MCP

Katalog na materiały gotowych (third-party) serwerów MCP testowanych w projekcie.
**Nie implementujemy tu odpowiedników** — przygotowujemy instalację, konfigurację,
fixture'y, scenariusze i zbieranie wyników.

| Podkatalog | Kategoria |
|---|---|
| `sql-mcp/` | SQL (PostgreSQL) |
| `json-mcp/` | JSON |
| `duckduckgo-mcp/` | Web Search |
| `excel-mcp/` | Excel |
| `blender-mcp/` | Blender |
| `eval-frameworks/` | **zewnętrzne frameworki ewaluacji MCP** (opcjonalne; osobny manifest `eval-frameworks.manifest.json` i skrypt `install_eval_frameworks.ps1`) — patrz `eval-frameworks/README.md` |

## Zasady

1. Instalację wykonuje `scripts/setup/windows/download_third_party_mcp_servers.ps1`
   sterowany plikiem `manifest.json`.
2. **Przypinanie wersji obowiązkowe**: po pobraniu w `<nazwa>/version.json` ląduje dokładna
   wersja npm / commit git + data. Wyniki pomiarów zawierają ją w `metadata.serverVersion`.
3. Problemy (serwer nie działa, inne narzędzia niż oczekiwano) → wpis w `<nazwa>/issues.json`
   (skrypt robi to automatycznie).
4. **Bez `node_modules/` w repo** — pakiety npm uruchamiamy przez `npx -y <pakiet>@<wersja>`,
   pip przez `uvx`/venv; klony git (`<nazwa>/repo/`) i artefakty (`<nazwa>/dist/`) są w `.gitignore`.
5. Nazwy narzędzi gotowców oceniamy przez `expected_tool_family` + mapping
   (`scenarios/third-party/<nazwa>.mapping.yaml`), nie przez sztywne nazwy.
6. Konfiguracje hostów: `config/mcp/mcp-third-party-<nazwa>.json`.
7. Ograniczenia każdego gotowca opisujemy w `<nazwa>/README.md`.
