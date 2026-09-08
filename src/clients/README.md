# src/clients/ — pomocnicze klienty

| Plik | Rola |
|---|---|
| `ollama/checkOllama.ts` | szybki test połączenia z Ollamą (`npm run check:ollama`) |
| `ollama/ollamaClient.ts` | wspólny klient chat + tool calling, metryki tokenowe per wywołanie, parametry generacji przypięte z `config/ollama/ollama.json` |
| `mcpClientFactory.ts` | katalog JEDNEGO lub WIELU serwerów naraz (rejestr serwerów + hooki), routing narzędzi po nazwie (kolizje logowane), specyfikacje narzędzi dla Ollamy, rozmiar katalogu |

Konsument: `src/runners/mcp-llm/runMcpLlmGeneric.ts` (`npm run llm:all`).
Konfiguracja: `.env` (`OLLAMA_BASE_URL`, `OLLAMA_MODEL` — faktyczny tag zapisuje
`install_ollama_models.ps1`) + `config/ollama/ollama.json`.
