# config/monitoring/ — stack obserwowalności (OPCJONALNY)

Prometheus + Grafana + Jaeger przez Docker Compose — zgodnie z rekomendacjami README
frameworków ewaluacyjnych: pakiet `mcp-evals` (mclenhard) zaleca dokładnie taki stack
z OpenTelemetry; `mcpevals` (lastmile) wywodzi wszystkie metryki z trace'ów OTel
(kierowanych tu do Jaegera przez OTLP 4317/4318).

| Plik | Rola |
|---|---|
| `docker-compose.monitoring.yml` | definicja stacku (wersje obrazów przypięte) |
| `prometheus.yml` | scrape config (target: eksporter OTel frameworka, port 9464 — zweryfikować po instalacji) |

Uruchomienie: `scripts/setup/windows/install_eval_frameworks.ps1 -WithMonitoring`
(wymaga Docker Desktop). UI: Prometheus `:9090`, Grafana `:3000` (admin/admin, tylko
localhost), Jaeger `:16686`.

Uwaga metodyczna: stack służy debugowaniu i obserwacji przebiegów frameworków
zewnętrznych; **nie jest** źródłem danych raportu końcowego — kanonicznym źródłem
pozostaje `results/normalized/measurements.csv`. Docker jest zależnością opcjonalną —
jego brak nie blokuje instalacji samych frameworków.
