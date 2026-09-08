# Własny serwer Blender MCP

Minimalny, badawczy serwer sterujący Blenderem — kontrapunkt dla gotowego serwera
ahujasid/blender-mcp w porównaniu **BLEND-004**: **6 wąskich, typowanych
narzędzi + 1 zasób** kontra 22 narzędzia gotowca z dowolnym exec Pythona
(`execute_blender_code`). Celowo **bez** health_check, narzędzi usuwania obiektów
i tworzenia świateł — luka w katalogu narzędzi oraz jego rozmiar są przedmiotem
porównania.

## Architektura

```
LLM (Ollama) → serwer MCP (stdio, ten katalog) → TCP 127.0.0.1:9877 (NDJSON)
             → addon/mcp_eval_addon.py w działającym Blenderze GUI → bpy
```

- **`addon/mcp_eval_addon.py`** — własny minimalny addon: nasłuch TCP (wątek per
  klient), każda komenda wykonywana w wątku głównym przez jednorazowy
  `bpy.app.timers.register`; autostart nasłuchu odroczonym timerem w `register()`.
  Protokół: operacje na scenie + komendy administracyjne
  `ping`/`reset_scene` (używane przez hooki `serverRegistry.ts`, NIE są narzędziami MCP).
- **`bridge.ts`** — klient TCP (serializacja poleceń, timeouty; kody:
  `BLENDER_BRIDGE_UNAVAILABLE`, `TOOL_TIMEOUT`, kody addonu 1:1).
- **`tools.ts`** — `blender_create_cube`, `blender_create_sphere`,
  `blender_set_material`, `blender_set_camera`, `blender_render_preview`
  (domyślnie 320×240 — render bywa wolny), `blender_get_scene_summary`.
- **`resources.ts`** — zasób `blender://scene` (tekstowe podsumowanie sceny).
- **`sceneValidation.ts`** — automatyczna walidacja scen względem
  `datasets/blender/reference_scenes.yaml` (CLI: `npm run validate:blender-scene`).

## Uruchomienie

| | |
|---|---|
| Most (oba addony) | `powershell -ExecutionPolicy Bypass -File scripts/run/start_blender_bridge.ps1` |
| Serwer MCP | `npm run server:blender` (runner spawnuje z `dist/`) |
| Pomiary | `npm run llm:all -- --server blender [--iterations N]` (najpierw most!) |
| Walidacja sceny | `npm run validate:blender-scene -- --reference BLEND-001-reference` |
| Config hosta | `config/mcp/mcp-server-blender.json` |
| Konfiguracja | `env.blender` (`MCP_EVAL_BLENDER_HOST/PORT`, timeouty — `.env.example`) |

Izolacja stanu sceny: hook `beforeIteration` w `serverRegistry.ts`
odtwarza przed iteracją BLEND odpowiednik domyślnej sceny (Cube+Light+Camera),
a przed XSRV-002 scenę pustą — operacją administracyjną `reset_scene` mostu.

## Wariant alternatywny (fallback)

`blender --background --python <skrypt>` per wywołanie — świadomie
niezaimplementowany: koszt startu Blendera przy każdym wywołaniu narzędzia
fałszowałby pomiar latencji, a stan sceny nie przetrwałby między wywołaniami.
Procedura awaryjna dla środowisk bez GUI: wygenerować skrypt bpy z parametrów
narzędzia i uruchomić go wsadowo — opisane tu wyłącznie jako kierunek.

Scenariusze: `scenarios/mcp-llm/blender.yaml` (prompty 1:1 z gotowcem — wymóg
BLEND-004) + `XSRV-002` w `scenarios/mcp-llm/cross.yaml`. Testy jednostkowe:
`tests/unit/blenderBridge.test.ts`, `tests/unit/sceneValidation.test.ts`.
