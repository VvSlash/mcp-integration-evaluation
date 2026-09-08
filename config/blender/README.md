# config/blender/ — konfiguracja Blendera

| Plik | Rola |
|---|---|
| `VERSION` | przypięta wersja Blendera (wymóg powtarzalności). Konsumowana przez `scripts/setup/windows/install_blender.ps1`. |

**UWAGA — wersję zweryfikować ręcznie** przy pierwszej instalacji: wpis `4.5.3`
to kandydat (seria LTS 4.5); sprawdź dostępność na https://download.blender.org/release/
i w razie potrzeby zaktualizuj `VERSION` **przed** pomiarami. Po rozpoczęciu pomiarów
BLEND-* wersji nie zmieniamy (porównywalność wyników).

Docelowo dojdą tu: parametry renderu preview (domyślnie 320×240), port/host addonu
mostu oraz ścieżki scen — konsumowane przez `src/servers/blender/bridge.ts`.
Ścieżka binarki trafia do `.env` jako `BLENDER_PATH` (zapisuje ją `install_blender.ps1`).
