# config/mcp/ — konfiguracje hostów MCP

Wszystkie pliki konfiguracji hostów/klientów MCP projektu (własne serwery + gotowce).
Format zgodny z konwencją `mcpServers` (command / args / cwd / env). Konsumenci:
MCP Inspector, Claude Desktop (opcjonalnie) oraz `src/clients/mcpClientFactory.ts`.

| Plik | Serwer |
|---|---|
| `mcp-server-postgres-tools.json` | własny SQL controlled (`src/servers/sql-controlled/`) |
| `mcp-server-postgres-sql.json` | własny SQL minimal (`src/servers/sql-minimal/`) |
| `mcp-server-postgres-generic.json` | własny SQL generic (`src/servers/sql-generic/`) |
| `mcp-server-json.json` | własny JSON (`src/servers/json/`) |
| `mcp-server-rest.json` | własny REST wrapper (`src/servers/rest-api/`) |
| `mcp-server-blender.json` | własny Blender (`src/servers/blender/`) |
| `mcp-third-party-<nazwa>.json` | gotowce (sql, json, excel, duckduckgo, blender); wersje przypinane wg `third_party/<nazwa>/version.json` |

Uwagi:
- hasła w plikach dotyczą wyłącznie lokalnej, syntetycznej bazy testowej;
  prawdziwe sekrety trzymamy w `.env`,
- konfiguracje gotowców uruchamiają pakiety w przypiętych wersjach
  (np. `npx -y <pakiet>@<wersja>` / `uvx <pakiet>==<wersja>`), pobieranych przez
  `scripts/setup/windows/download_third_party_mcp_servers.ps1`.
