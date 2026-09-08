import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";
import { env } from "../../config/env.js";
import { summarizeMeasurements, type Measurement } from "../../evaluation/metrics.js";
import { makeResultRecord, type ResultRecord } from "../../shared/resultRecord.js";
import { buildRunManifest, newRunId, writeRunResults } from "../../shared/resultsWriter.js";
import { loadScenariosFromFile, type Scenario } from "../../shared/scenarioLoader.js";

const SCENARIOS_FILE = path.join("scenarios", "baseline", "rest.yaml");
const WARMUP_ITERATIONS = 2;
const HEALTH_POLL_ATTEMPTS = 40;
const HEALTH_POLL_INTERVAL_MS = 250;

type HttpCall = {
  method: "GET" | "POST";
  path: string;
  expectedStatus: number;
  body: Record<string, unknown> | null;
};

function parseIterationsOverride(): number | null {
  const rawValue = process.argv[2];
  if (!rawValue) {
    return null;
  }
  const value = Number(rawValue);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error("Iterations argument must be a positive integer.");
  }
  return value;
}

function scenarioHttpCall(scenario: Scenario): HttpCall {
  const args = scenario.expected_arguments;
  const method = args["method"];
  const requestPath = args["path"];
  const expectedStatus = args["expectedStatus"];
  if (
    (method !== "GET" && method !== "POST") ||
    typeof requestPath !== "string" || !requestPath.startsWith("/") ||
    typeof expectedStatus !== "number"
  ) {
    throw new Error(
      `Scenariusz ${scenario.id}: expected_arguments musi zawierać method (GET/POST), path (/...) i expectedStatus.`
    );
  }
  const body = args["body"];
  return {
    method,
    path: requestPath,
    expectedStatus,
    body: typeof body === "object" && body !== null ? (body as Record<string, unknown>) : null
  };
}

function parseResultCount(payload: unknown): number | null {
  if (typeof payload !== "object" || payload === null) {
    return null;
  }
  const record = payload as Record<string, unknown>;
  if (Array.isArray(record["items"])) {
    return record["items"].length;
  }
  if (typeof record["id"] === "number") {
    return 1;
  }
  return null;
}

async function startRestApi(baseUrl: string): Promise<ChildProcess> {
  const child = spawn("node", [path.join("dist", "rest-api", "server.js")], {
    stdio: ["ignore", "ignore", "inherit"]
  });

  for (let attempt = 1; attempt <= HEALTH_POLL_ATTEMPTS; attempt += 1) {
    if (child.exitCode !== null) {
      break;
    }
    try {
      const response = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(500) });
      if (response.ok) {
        return child;
      }
    } catch {
    }
    await delay(HEALTH_POLL_INTERVAL_MS);
  }

  child.kill();
  throw new Error(
    `Lokalne REST API nie wstalo pod ${baseUrl} (czy port ${env.restApi.port} jest wolny i czy wykonano npm run build?).`
  );
}

async function main() {
  const iterationsOverride = parseIterationsOverride();
  const baseUrl = `http://localhost:${env.restApi.port}`;

  const { scenarios: allScenarios, warnings } = await loadScenariosFromFile(SCENARIOS_FILE);
  for (const warning of warnings) {
    console.warn(`[loader] ${warning}`);
  }
  const scenarios = allScenarios.filter(
    (scenario) => scenario.variant === "baseline" && scenario.category === "rest"
  );
  if (scenarios.length === 0) {
    throw new Error(`Brak scenariuszy (variant=baseline, category=rest) w ${SCENARIOS_FILE}.`);
  }

  console.log(
    `Starting REST baseline: ${scenarios.length} scenarios, warmup ${WARMUP_ITERATIONS} iter/scenario (API: ${baseUrl}).`
  );

  const apiProcess = await startRestApi(baseUrl);
  const runId = newRunId();
  const records: ResultRecord[] = [];
  const measurementsForSummary: Measurement[] = [];

  try {
    for (const scenario of scenarios) {
      const call = scenarioHttpCall(scenario);
      const iterations = iterationsOverride ?? scenario.iterations;
      const requestInit: RequestInit = call.body
        ? {
            method: call.method,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(call.body)
          }
        : { method: call.method };

      for (let warmup = 1; warmup <= WARMUP_ITERATIONS; warmup += 1) {
        try {
          await fetch(`${baseUrl}${call.path}`, requestInit);
        } catch {
        }
      }

      for (let iteration = 1; iteration <= iterations; iteration += 1) {
        const startedAt = performance.now();
        let latencyMs: number;
        let success = false;
        let errorCode: string | null = null;
        let errorMessage: string | null = null;
        let resultCount: number | null = null;

        try {
          const response = await fetch(`${baseUrl}${call.path}`, requestInit);
          const payload: unknown = await response.json().catch(() => null);
          latencyMs = Number((performance.now() - startedAt).toFixed(3));

          if (response.status === call.expectedStatus) {
            success = true;
            resultCount = parseResultCount(payload);
          } else {
            errorCode = `REST_HTTP_${response.status}`;
            errorMessage = `Expected status ${call.expectedStatus}, got ${response.status}.`;
          }
        } catch (error) {
          latencyMs = Number((performance.now() - startedAt).toFixed(3));
          errorCode = "REST_API_UNAVAILABLE";
          errorMessage = error instanceof Error ? error.message : "Unknown HTTP error";
        }

        const timestamp = new Date().toISOString();
        records.push(
          makeResultRecord(
            {
              runId,
              scenarioId: scenario.id,
              category: "rest",
              variant: "baseline",
              iteration,
              success,
              deterministic: true,
              evaluationSource: "own"
            },
            {
              scenarioName: scenario.name,
              latencyMs,
              errorCode,
              errorMessage,
              toolArguments: scenario.expected_arguments,
              resultCount,
              timestamp
            }
          )
        );
        measurementsForSummary.push({
          scenarioId: scenario.id,
          scenarioName: scenario.name,
          variant: "baseline",
          iteration,
          latencyMs,
          success,
          errorCode,
          errorMessage,
          resultCount,
          timestamp
        });
      }

      console.log(`[${scenario.id}] done (${iterations} iterations).`);
    }

    const summaries = summarizeMeasurements(measurementsForSummary);

    const runDir = await writeRunResults({
      runId,
      records,
      manifest: buildRunManifest({
        runId,
        notes:
          "Baseline REST (bezposrednie HTTP, API startowane przez runner ze swiezym seedem; scenariusze scenarios/baseline/rest.yaml; rozgrzewka: 2 iteracje), runner: runRestBaseline.ts"
      }),
      extraFiles: { "summary.json": summaries }
    });

    console.log(JSON.stringify({
      variant: "baseline",
      category: "rest",
      scenarios: scenarios.length,
      totalMeasurements: records.length,
      resultsDir: runDir,
      summary: summaries
    }, null, 2));
  } finally {
    apiProcess.kill();
  }
}

main().catch((error) => {
  console.error("REST baseline runner failed:", error);
  process.exit(1);
});
