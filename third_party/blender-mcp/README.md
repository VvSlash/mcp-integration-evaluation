# blender-mcp — gotowy serwer Blender MCP

**Zainstalowany:** ahujasid/blender-mcp — **dwuczęściowo**: serwer MCP
`blender-mcp==1.6.4` (PyPI, venv `.venv/`) + `addon.py` z przypiętego klonu `repo/`
(commit **6e99eb5**; szczegóły pinu w `version.json`).
Wymaga Blendera **4.5.3** (pin `config/blender/VERSION`; instaluje `install_blender.ps1`).

| | |
|---|---|
| Most | addon TCP **:9876** wewnątrz Blendera GUI; start JEDNYM poleceniem: `powershell -ExecutionPolicy Bypass -File scripts/run/start_blender_bridge.ps1` (instalacja addonu CLI + autostart odroczonym timerem; log: `datasets/.work/blender-bridge.log`); runner sprawdza most i przerywa z instrukcją, gdy jest niedostępny |
| Uruchamianie serwera MCP | `third_party/blender-mcp/.venv/Scripts/blender-mcp.exe` (spawnuje runner) |
| Katalog | **22 narzędzia / 16 114 znaków**; 14 to integracje asset-store; tworzenie/materiały = `execute_blender_code` (dowolny Python w bpy — „maksymalna swoboda", analog sql-minimal) |
| Mapping rodzin | [blender-mcp.mapping.yaml](../../scenarios/third-party/blender-mcp.mapping.yaml) |
| Scenariusze | [blender-mcp.yaml](../../scenarios/third-party/blender-mcp.yaml) — BLEND-001…003; referencje scen: `datasets/blender/reference_scenes.yaml` |
| Pomiary | `npm run llm:all -- --server blender-mcp [--iterations N]` — **wymaga wcześniej uruchomionego mostu** |
| Config hosta | [config/mcp/mcp-third-party-blender-mcp.json](../../config/mcp/mcp-third-party-blender-mcp.json) |
| Usability | `scripts/run/run_usability_checks.ps1` dopisuje wiersz do `results/raw/usability.csv` — najbardziej złożony setup w projekcie |

**Z pierwszych przebiegów (1 iter.):** 1/3 (BLEND-003 zaliczony, integracja wyników 0.667);
`toolCallSuccess=true` we wszystkich — kod modelu wykonywał się w żywym Blenderze
(mutacje scen zaszły), porażki BLEND-001/002 to niedomknięty JSON przy ~26–28 tys. tokenów
promptu.

**Porównanie z serwerem własnym (BLEND-004):** te same prompty, katalog 22 vs 6 narzędzi,
tokeny promptu 3,3–3,8× wyższe u gotowca. `start_blender_bridge.ps1` startuje OBA mosty
(:9876 + :9877) w jednej instancji Blendera.
