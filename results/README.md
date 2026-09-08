# results/ — wyniki pomiarów

Katalog jest w repozytorium pusty (same pliki `.gitkeep`) — jego zawartość powstaje
dopiero po uruchomieniu pomiarów. Poniżej opis struktury, którą tworzą runnery
i narzędzia przetwarzające wyniki.

| Katalog | Zawartość |
|---|---|
| `raw/` | surowe wyniki: **katalog per `runId`**, w każdym `measurements.json` i `measurements.csv`, `manifest.json` (metadane przebiegu) oraz artefakty scenariuszy. Wyniki importowane z zewnętrznych frameworków ewaluacyjnych trafiają do `raw/external/<framework>/` jako pliki `*.external.json`. |
| `normalized/` | znormalizowany `measurements.csv` — produkt `src/evaluation/normalize.ts`, jedyne wejście dla wykresów |
| `plots/` | wykresy generowane ze zbioru znormalizowanego, w podkatalogu per `runId` wraz z manifestem |
| `reports/` | raporty Markdown zestawiające wyniki pomiarów |

Kolejność przetwarzania:

1. przebieg pomiarowy (runnery z `src/runners/**`) zapisuje dane do `results/raw/<runId>/`,
2. `npm run normalize` scala całe `results/raw/**` do `results/normalized/measurements.csv`,
3. `.venv\Scripts\python.exe scripts\plots\generate_all_plots.py` tworzy wykresy
   w `results/plots/<runId>/`.

Plików w `raw/` nie edytujemy ręcznie — to zapis surowy przebiegu; wszelkie korekty
i przeliczenia wykonuje normalizator.
