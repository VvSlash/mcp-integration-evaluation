import { performance } from "node:perf_hooks";
import { PostgresAdapter } from "../../adapters/postgresAdapter.js";
import {
  type Measurement,
  summarizeMeasurements
} from "../../evaluation/metrics.js";
import { postgresSearchOrdersScenarios as scenarios } from "../../evaluation/postgresScenarios.js";
import { adaptLegacyMeasurement } from "../../shared/legacyMapping.js";
import { buildRunManifest, writeRunResults } from "../../shared/resultsWriter.js";
function parseIterations(): number {
  const rawValue = process.argv[2];

  if (!rawValue) {
    return 100;
  }

  const value = Number(rawValue);

  if (!Number.isInteger(value) || value <= 0) {
    throw new Error("Iterations argument must be a positive integer.");
  }

  return value;
}

function nowForFileName(): string {
  return new Date()
    .toISOString()
    .replaceAll(":", "-")
    .replaceAll(".", "-");
}

async function main() {
  const iterations = parseIterations();
  const postgres = new PostgresAdapter();
  const measurements: Measurement[] = [];

  try {
    await postgres.healthCheck();

    for (const scenario of scenarios) {
      for (let iteration = 1; iteration <= iterations; iteration += 1) {
        const startedAt = performance.now();

        try {
          const orders = await postgres.searchOrders(scenario.arguments);
          const endedAt = performance.now();

          measurements.push({
            scenarioId: scenario.id,
            scenarioName: scenario.name,
            variant: "baseline",
            iteration,
            latencyMs: Number((endedAt - startedAt).toFixed(3)),
            success: true,
            errorCode: null,
            errorMessage: null,
            resultCount: orders.length,
            timestamp: new Date().toISOString()
          });
        } catch (error) {
          const endedAt = performance.now();

          measurements.push({
            scenarioId: scenario.id,
            scenarioName: scenario.name,
            variant: "baseline",
            iteration,
            latencyMs: Number((endedAt - startedAt).toFixed(3)),
            success: false,
            errorCode: "BASELINE_POSTGRES_QUERY_FAILED",
            errorMessage: error instanceof Error ? error.message : "Unknown error",
            resultCount: null,
            timestamp: new Date().toISOString()
          });
        }
      }
    }

    const summaries = summarizeMeasurements(measurements);

    const runId = nowForFileName();
    const records = measurements.flatMap((measurement) => {
      const record = adaptLegacyMeasurement(measurement, runId, "own");
      return record ? [record] : [];
    });

    const runDir = await writeRunResults({
      runId,
      records,
      manifest: buildRunManifest({
        runId,
        notes: "baseline PostgreSQL (bez MCP), runner: runPostgresBaseline.ts"
      }),
      extraFiles: { "summary.json": summaries }
    });

    console.log(JSON.stringify({
      variant: "baseline",
      scenarios: scenarios.length,
      iterationsPerScenario: iterations,
      totalMeasurements: measurements.length,
      resultsDir: runDir,
      summary: summaries
    }, null, 2));
  } finally {
    await postgres.close();
  }
}

main().catch((error) => {
  console.error("PostgreSQL baseline runner failed:", error);
  process.exit(1);
});
