# excel-mcp — gotowy serwer Excel MCP

**Zainstalowany:** `excel-mcp-server==0.1.8` (haris-musa, PyPI; pin: `../manifest.json` +
`version.json`). Instalacja w dedykowanym venv (`.venv/`) przez tryb
**pip-venv** skryptu pobierania. **Nie wymaga instalacji MS Excel.**

| | |
|---|---|
| Uruchamianie | `third_party/excel-mcp/.venv/Scripts/excel-mcp-server.exe stdio`; **tryb stdio wymaga ścieżek ABSOLUTNYCH** w `filepath` — scenariusze używają tokenu `{{REPO}}` rozwijanego przez runner |
| Katalog | **25 narzędzi / 13 322 znaki** (inspekcja `npm run inspect:mcp`) |
| Mapping rodzin | [excel-mcp.mapping.yaml](../../scenarios/third-party/excel-mcp.mapping.yaml): `sheet_list → get_workbook_metadata`, `read_range/search → read_data_from_excel` (bez dedykowanego search — filtrowanie w kontekście), `write → [write_data_to_excel, create_worksheet]` |
| Fixture'y | `datasets/excel/sales.xlsx` + `sales.expected.json` (generator: `setup_excel_fixtures.ps1`, stały seed); pomiary na **kopii roboczej** `datasets/.work/excel-mcp/` — fixture pozostaje nietknięty |
| Scenariusze | [excel-mcp.yaml](../../scenarios/third-party/excel-mcp.yaml) — XLSX-001…004 |
| Pomiary | `npm run llm:all -- --server excel-mcp [--iterations N]` |
| Config hosta | [config/mcp/mcp-third-party-excel-mcp.json](../../config/mcp/mcp-third-party-excel-mcp.json) |
| Usability | `scripts/run/run_usability_checks.ps1` dopisuje wiersz do `results/raw/usability.csv` |

**Z pierwszych przebiegów (1 iter.):** 1/4 (XLSX-001 zaliczony — arkusze zgodne z referencją);
dobór narzędzi bezbłędny, porażki XLSX-002…004 to niedomknięty JSON po przetworzeniu
220 wierszy z metadanymi w kontekście (koszt braku agregacji po stronie serwera).
