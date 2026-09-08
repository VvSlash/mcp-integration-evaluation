# Serwer MCP: sql-generic (ogólne narzędzia tabelaryczne)

Pięć narzędzi tabelarycznych: health_check, list_tables, read_table, filter_rows, count_rows. Opisy są celowo ubogie: to cecha badawcza. Brak zasobów, surowego SQL, złączeń i agregacji serwerowej. Podobnie jak w wariancie controlled dostęp odbywa się wyłącznie przez narzędzia; różnicą jest projekt kontraktu.

`npm run server:sql-generic` uruchamia serwer STDIO. Konfiguracja: POSTGRES_URL_RO, opcjonalnie MCP_EVAL_DATABASE. Kampania wymaga MCP_EVAL_REQUIRE_ROLES=1. Tabela orders i jej kolumny muszą być obecne w information_schema; identyfikatory są sprawdzane i cytowane, wartości parametryzowane. Limit 1–50; read_table ma offset, stabilną kolejność pierwszej kolumny (id) malejąco. Ta kolejność nie oznacza ogólnej gwarancji sortowania po dacie.

Scenariusze SQL-001…004/007 mają te same prompty co controlled/minimal. Wielokolumnowe filtry i agregaty wymagają obliczeń klienta/modelu na odczytanych danych. Runner deterministyczny wykonuje jawny plan porównywalnego wyniku. Inspekcja: npm run inspect:mcp -- sql-generic. Test buildera: tests/unit/postgresGenericAdapter.test.ts.
