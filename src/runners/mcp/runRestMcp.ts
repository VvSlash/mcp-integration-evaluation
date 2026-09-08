import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";
import { Client, StdioClientTransport } from "@modelcontextprotocol/client";
import { env } from "../../config/env.js";
import { summarizeMeasurements, type Measurement } from "../../evaluation/metrics.js";
import { makeResultRecord, type ResultRecord } from "../../shared/resultRecord.js";
import { buildRunManifest, newRunId, writeRunResults } from "../../shared/resultsWriter.js";
import { loadScenariosFromFile, type Scenario } from "../../shared/scenarioLoader.js";

const SCENARIOS_FILE = path.join("scenarios", "mcp", "rest.yaml");
const WARMUP_ITERATIONS = 2;
const HEALTH_POLL_ATTEMPTS = 40;
const HEALTH_POLL_INTERVAL_MS = 250;

type ToolContentItem = { type: string; text?: string };
type ToolResultLike = { isError?: boolean; content?: ToolContentItem[] };

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

function scenarioTool(scenario: Scenario): string {
  const tool = scenario.expected_tools[0];
  if (!tool) {
    throw new Error(`Scenariusz ${scenario.id}: brak expected_tools (wymagane dla runnera MCP-only).`);
  }
  return tool;
}

function parseResultCount(result: ToolResultLike): number | null {
  const text = result.content?.find((item) => item.type === "text")?.text;
  if (!text) {
    return null;
  }
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    if (Array.isArray(parsed["items"])) {
      return parsed["items"].length;
    }
    if (typeof parsed["id"] === "number") {
      return 1;
    }
    return null;
  } catch {
    return null;
  }
}

function parseErrorCode(result: ToolResultLike): string {
  const text = result.content?.find((item) => item.type === "text")?.text;
  if (text) {
    try {
      const parsed = JSON.parse(text) as { code?: unknown };
      if (typeof parsed.code === "string") {
        return parsed.code;
      }
    } catch {
    }
  }
  return "REST_TOOL_FAILED";
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
    `Lokalne REST API nie wstalo pod ${baseUrl} (port ${env.restApi.port} zajety? brak npm run build?).`
  );
}

async function createMcpClient(): Promise<Client> {
  const client = new Client({ name: "rest-mcp-evaluation-runner", version: "0.1.0" });
  const transport = new StdioClientTransport({
    command: "node",
    args: [path.join("dist", "servers", "rest-api", "server.js")]
  });
  await client.connect(transport);
  return client;
}

async function main() {
  const iterationsOverride = parseIterationsOverride();
  const baseUrl = env.restApi.baseUrl;

  const { scenarios: allScenarios, warnings } = await loadScenariosFromFile(SCENARIOS_FILE);
  for (const warning of warnings) {
    console.warn(`[loader] ${warning}`);
  }
  const scenarios = allScenarios.filter(
    (scenario) => scenario.variant === "mcp" && scenario.server === "rest-api"
  );
  if (scenarios.length === 0) {
    throw new Error(`Brak scenariuszy (variant=mcp, server=rest-api) w ${SCENARIOS_FILE}.`);
  }

  console.log(
    `Starting MCP-only (rest-api) evaluation: ${scenarios.length} scenarios, warmup ${WARMUP_ITERATIONS} iter/scenario (API: ${baseUrl}).`
  );

  const apiProcess = await startRestApi(baseUrl);
  let client: Client | null = null;
  const runId = newRunId();
  const records: ResultRecord[] = [];
  const measurementsForSummary: Measurement[] = [];

  try {
    client = await createMcpClient();

    for (const scenario of scenarios) {
      const toolName = scenarioTool(scenario);
      const iterations = iterationsOverride ?? scenario.iterations;

      for (let warmup = 1; warmup <= WARMUP_ITERATIONS; warmup += 1) {
        try {
          await client.callTool({ name: toolName, arguments: scenario.expected_arguments });
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
          const result = (await client.callTool({
            name: toolName,
            arguments: scenario.expected_arguments
          })) as ToolResultLike;
          latencyMs = Number((performance.now() - startedAt).toFixed(3));

          if (result.isError === true) {
            errorCode = parseErrorCode(result);
            errorMessage = result.content?.find((item) => item.type === "text")?.text ?? null;
          } else {
            success = true;
            resultCount = parseResultCount(result);
          }
        } catch (error) {
          latencyMs = Number((performance.now() - startedAt).toFixed(3));
          errorCode = "MCP_CALL_FAILED";
          errorMessage = error instanceof Error ? error.message : "Unknown MCP error";
        }

        const timestamp = new Date().toISOString();
        records.push(
          makeResultRecord(
            {
              runId,
              scenarioId: scenario.id,
              category: "rest",
              variant: "mcp",
              iteration,
              success,
              deterministic: true,
              evaluationSource: "own"
            },
            {
              scenarioName: scenario.name,
              serverKind: "own",
              serverName: "rest-api",
              latencyMs,
              errorCode,
              errorMessage,
              toolCallRequested: true,
              toolCallSuccess: success,
              toolName,
              toolArguments: scenario.expected_arguments,
              numberOfToolCalls: 1,
              resultCount,
              timestamp
            }
          )
        );
        measurementsForSummary.push({
          scenarioId: scenario.id,
          scenarioName: scenario.name,
          variant: "mcp",
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
        serverVersions: { "rest-api": "own" },
        notes:
          "MCP-only rest-api (deterministyczne argumenty ze scenarios/mcp/rest.yaml; API startowane przez runner ze swiezym seedem; rozgrzewka: 2 iteracje), runner: runRestMcp.ts"
      }),
      extraFiles: { "summary.json": summaries }
    });

    console.log(JSON.stringify({
      variant: "mcp",
      serverName: "rest-api",
      scenarios: scenarios.length,
      totalMeasurements: records.length,
      resultsDir: runDir,
      summary: summaries
    }, null, 2));
  } finally {
    if (client) {
      await client.close();
    }
    apiProcess.kill();
  }
}

main().catch((error) => {
  console.error("REST MCP runner failed:", error);
  process.exit(1);
});
