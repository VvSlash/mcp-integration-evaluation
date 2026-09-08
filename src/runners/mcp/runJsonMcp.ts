import { rm } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { Client, StdioClientTransport } from "@modelcontextprotocol/client";
import { env } from "../../config/env.js";
import { summarizeMeasurements, type Measurement } from "../../evaluation/metrics.js";
import { makeResultRecord, type ResultRecord } from "../../shared/resultRecord.js";
import { buildRunManifest, newRunId, writeRunResults } from "../../shared/resultsWriter.js";
import { loadScenariosFromFile, type Scenario } from "../../shared/scenarioLoader.js";

const SCENARIOS_FILE = path.join("scenarios", "mcp", "json.yaml");
const WARMUP_ITERATIONS = 2;

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
    const parsed = JSON.parse(text) as { count?: unknown; matches?: unknown; updated?: unknown };
    if (typeof parsed.count === "number") {
      return parsed.count;
    }
    if (typeof parsed.matches === "number") {
      return parsed.matches;
    }
    if (parsed.updated === true) {
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
  return "JSON_TOOL_FAILED";
}

async function resetWorkingCopy(scenario: Scenario): Promise<void> {
  const file = scenario.expected_arguments["file"];
  if (typeof file === "string" && file !== "") {
    await rm(path.join(env.json.workDir, file), { force: true });
  }
}

async function createMcpClient(): Promise<Client> {
  const client = new Client({ name: "json-mcp-evaluation-runner", version: "0.1.0" });
  const transport = new StdioClientTransport({
    command: "node",
    args: ["dist/servers/json/server.js"]
  });
  await client.connect(transport);
  return client;
}

async function main() {
  const iterationsOverride = parseIterationsOverride();

  const { scenarios: allScenarios, warnings } = await loadScenariosFromFile(SCENARIOS_FILE);
  for (const warning of warnings) {
    console.warn(`[loader] ${warning}`);
  }
  const scenarios = allScenarios.filter(
    (scenario) => scenario.variant === "mcp" && scenario.server === "json"
  );
  if (scenarios.length === 0) {
    throw new Error(`Brak scenariuszy (variant=mcp, server=json) w ${SCENARIOS_FILE}.`);
  }

  console.log(
    `Starting MCP-only (json) evaluation: ${scenarios.length} scenarios, warmup ${WARMUP_ITERATIONS} iter/scenario.`
  );

  const client = await createMcpClient();
  const runId = newRunId();
  const records: ResultRecord[] = [];
  const measurementsForSummary: Measurement[] = [];

  try {
    for (const scenario of scenarios) {
      const toolName = scenarioTool(scenario);
      const iterations = iterationsOverride ?? scenario.iterations;
      const isMutating = toolName === "json_update_value";

      for (let warmup = 1; warmup <= WARMUP_ITERATIONS; warmup += 1) {
        try {
          if (isMutating) {
            await resetWorkingCopy(scenario);
          }
          await client.callTool({ name: toolName, arguments: scenario.expected_arguments });
        } catch {
        }
      }

      for (let iteration = 1; iteration <= iterations; iteration += 1) {
        if (isMutating) {
          await resetWorkingCopy(scenario);
        }

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
              serverName: "json",
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
        serverVersions: { json: "own" },
        notes:
          "MCP-only json (deterministyczne argumenty ze scenarios/mcp/json.yaml; rozgrzewka: 2 iteracje; kopia robocza odtwarzana przed iteracjami mutujacymi), runner: runJsonMcp.ts"
      }),
      extraFiles: { "summary.json": summaries }
    });

    console.log(JSON.stringify({
      variant: "mcp",
      serverName: "json",
      scenarios: scenarios.length,
      totalMeasurements: records.length,
      resultsDir: runDir,
      summary: summaries
    }, null, 2));
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error("JSON MCP runner failed:", error);
  process.exit(1);
});
