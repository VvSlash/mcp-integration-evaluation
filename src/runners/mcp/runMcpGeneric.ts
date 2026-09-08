import path from "node:path";
import { performance } from "node:perf_hooks";
import { Client, StdioClientTransport } from "@modelcontextprotocol/client";
import { summarizeMeasurements, type Measurement, type ScenarioSummary } from "../../evaluation/metrics.js";
import { makeResultRecord, type ResultRecord } from "../../shared/resultRecord.js";
import { buildRunManifest, newRunId, writeRunResults } from "../../shared/resultsWriter.js";
import { loadScenariosFromDir, type Scenario } from "../../shared/scenarioLoader.js";
import {
  OWN_SERVERS,
  parseToolErrorCode,
  parseToolResultCount,
  resolveSpawn,
  toolResultText,
  type ToolResultLike
} from "./serverRegistry.js";

const SCENARIOS_DIR = path.join("scenarios", "mcp");
const WARMUP_ITERATIONS = 2;

type CliOptions = { server: string; iterations: number | null };

function parseCliOptions(argv: string[]): CliOptions {
  const options: CliOptions = { server: "all", iterations: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--server" && argv[index + 1]) {
      options.server = argv[index + 1] as string;
      index += 1;
    } else if (arg === "--iterations" && argv[index + 1]) {
      const value = Number(argv[index + 1]);
      if (!Number.isInteger(value) || value <= 0) {
        throw new Error("--iterations must be a positive integer.");
      }
      options.iterations = value;
      index += 1;
    } else if (arg && /^\d+$/.test(arg)) {
      options.iterations = Number(arg);
    }
  }
  return options;
}

function scenarioTool(scenario: Scenario): string {
  const tool = scenario.expected_tools[0];
  if (!tool) {
    throw new Error(`Scenariusz ${scenario.id}: brak expected_tools (wymagane dla runnera MCP-only).`);
  }
  return tool;
}

async function runServer(
  serverName: string,
  scenarios: Scenario[],
  iterationsOverride: number | null,
  runId: string,
  records: ResultRecord[]
): Promise<{ server: string; summaries: ScenarioSummary[] }> {
  const runtime = OWN_SERVERS[serverName];
  if (!runtime) {
    throw new Error(
      `Serwer "${serverName}" nie jest zarejestrowany w serverRegistry.ts (dostepne: ${Object.keys(OWN_SERVERS).join(", ")}).`
    );
  }

  console.log(`\n=== Serwer: ${serverName} (${scenarios.length} scenariuszy) ===`);
  const cleanup = runtime.beforeAll ? await runtime.beforeAll() : null;
  const client = new Client({ name: "mcp-generic-evaluation-runner", version: "0.1.0" });
  const measurementsForSummary: Measurement[] = [];

  try {
    await client.connect(new StdioClientTransport(resolveSpawn(runtime)));

    for (const scenario of scenarios) {
      const toolName = scenarioTool(scenario);
      const iterations = iterationsOverride ?? scenario.iterations;

      for (let warmup = 1; warmup <= WARMUP_ITERATIONS; warmup += 1) {
        try {
          await runtime.beforeIteration?.(scenario);
          await client.callTool({ name: toolName, arguments: scenario.expected_arguments });
        } catch {
        }
      }

      for (let iteration = 1; iteration <= iterations; iteration += 1) {
        await runtime.beforeIteration?.(scenario);

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
            errorCode = parseToolErrorCode(result);
            errorMessage = toolResultText(result);
          } else {
            success = true;
            resultCount = parseToolResultCount(result);
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
              category: scenario.category,
              variant: "mcp",
              iteration,
              success,
              deterministic: true,
              evaluationSource: "own"
            },
            {
              scenarioName: scenario.name,
              serverKind: "own",
              serverName,
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

      console.log(`[${serverName}/${scenario.id}] done (${iterations} iterations).`);
    }
  } finally {
    await client.close().catch(() => undefined);
    if (cleanup) {
      await cleanup();
    }
  }

  return { server: serverName, summaries: summarizeMeasurements(measurementsForSummary) };
}

async function main() {
  const options = parseCliOptions(process.argv.slice(2));

  const { scenarios: allScenarios, warnings } = await loadScenariosFromDir(SCENARIOS_DIR);
  for (const warning of warnings) {
    console.warn(`[loader] ${warning}`);
  }

  const mcpScenarios = allScenarios.filter(
    (scenario) => scenario.variant === "mcp" && scenario.server !== null
  );
  const requestedServers =
    options.server === "all"
      ? [...new Set(mcpScenarios.map((scenario) => scenario.server as string))].sort()
      : [options.server];

  const byServer = new Map<string, Scenario[]>();
  for (const scenario of mcpScenarios) {
    const key = scenario.server as string;
    if (!requestedServers.includes(key)) {
      continue;
    }
    const bucket = byServer.get(key) ?? [];
    bucket.push(scenario);
    byServer.set(key, bucket);
  }
  if (byServer.size === 0) {
    throw new Error(
      `Brak scenariuszy variant=mcp dla serwera "${options.server}" w ${SCENARIOS_DIR}.`
    );
  }

  console.log(
    `Starting generic MCP-only evaluation: servers=[${[...byServer.keys()].join(", ")}], warmup ${WARMUP_ITERATIONS} iter/scenario.`
  );

  const runId = newRunId();
  const records: ResultRecord[] = [];
  const perServerSummaries: Array<{ server: string; summaries: ScenarioSummary[] }> = [];

  for (const [serverName, scenarios] of byServer) {
    perServerSummaries.push(
      await runServer(serverName, scenarios, options.iterations, runId, records)
    );
  }

  const runDir = await writeRunResults({
    runId,
    records,
    manifest: buildRunManifest({
      runId,
      serverVersions: Object.fromEntries([...byServer.keys()].map((name) => [name, "own"])),
      notes:
        "Wspolny runner MCP-only: scenariusze scenarios/mcp/**, rejestr serwerow serverRegistry.ts, rozgrzewka 2 iteracje; zastepuje w orkiestracji runnery dedykowane (pozostaja dostepne), runner: runMcpGeneric.ts"
    }),
    extraFiles: { "summary.json": perServerSummaries }
  });

  console.log(JSON.stringify({
    variant: "mcp",
    servers: [...byServer.keys()],
    totalMeasurements: records.length,
    resultsDir: runDir,
    summary: perServerSummaries
  }, null, 2));
}

main().catch((error) => {
  console.error("Generic MCP-only runner failed:", error);
  process.exit(1);
});
