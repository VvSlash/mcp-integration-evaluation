# src/shared/ — wspólne typy i narzędzia pipeline'u

| Plik | Rola |
|---|---|
| `types.ts` | wspólne typy i stałe: Variant, Category, ServerKind, EvaluationSource, kody błędów, **KNOWN_METRICS/PROPOSED_METRICS** |
| `resultRecord.ts` | wspólny format wyników (m.in. `evaluationSource`, `externalScores`, `externalLabels`, `timestamp`), schemat Zod, manifest przebiegu, spłaszczanie i CSV |
| `legacyMapping.ts` | mapowanie kształtu wyników z runnerów na wspólny rekord (PG→SQL, warianty); jedno źródło prawdy dla normalizatora ORAZ zapisu w runnerach |
| `resultsWriter.ts` | zapis przebiegu: `results/raw/<runId>/` (measurements.json/csv + manifest.json + artefakty) z walidacją rekordów |
| `scenarioLoader.ts` | loader YAML scenariuszy + walidacja Zod (strict), domyślne iteracje 30/10, otwarte `metrics`, pole `external`, mapping `tool_family` |
| `timing.ts` | pomiar latencji (stageLatencies), rozgrzewka, tokeny z Ollamy |

Konsumenci: `src/runners/**` (zapis wyników), `src/evaluation/normalize.ts`
(`npm run normalize`), wspólne runnery MCP i MCP+LLM (loader scenariuszy).
Testy: `tests/unit/{resultRecord,normalize,scenarioLoader,orderStatisticsQuery}.test.ts`.
