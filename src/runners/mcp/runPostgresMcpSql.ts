import path from "node:path";
import { performance } from "node:perf_hooks";
import { Client, StdioClientTransport } from "@modelcontextprotocol/client";
import { summarizeMeasurements, type Measurement } from "../../evaluation/metrics.js";
import { makeResultRecord, type ResultRecord } from "../../shared/resultRecord.js";
import { buildRunManifest, newRunId, writeRunResults } from "../../shared/resultsWriter.js";
import { loadScenariosFromFile, type Scenario } from "../../shared/scenarioLoader.js";

const SCENARIOS_FILE = path.join("scenarios", "mcp", "sql-minimal.yaml");
const WARMUP_ITERATIONS = 2;

type ToolContentItem = {
  type: string;
  text?: string;
};

type ToolResultLike = {
  isError?: boolean;
  content?: ToolContentItem[];
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

function scenarioSql(scenario: Scenario): string {
  const sql = scenario.expected_arguments["sql"];
  if (typeof sql !== "string" || sql.trim() === "") {
    throw new Error(
      `Scenariusz ${scenario.id}: brak deterministycznego SQL w expected_arguments.sql (wymagany dla runnera MCP-only sql-minimal).`
    );
  }
  return sql;
}

function parseRowCount(result: ToolResultLike): number | null {
  const text = result.content?.find((item) => item.type === "text")?.text;
  if (!text) {
    return null;
  }
  try {
    const parsed = JSON.parse(text) as { rowCount?: unknown };
    return typeof parsed.rowCount === "number" ? parsed.rowCount : null;
  } catch {
    return null;
  }
}

async function createMcpClient(): Promise<Client> {
  const client = new Client({
    name: "postgres-mcp-sql-evaluation-runner",
    version: "0.1.0"
  });

  const transport = new StdioClientTransport({
    command: "node",
    args: ["dist/servers/sql-minimal/server.js"]
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
    (scenario) => scenario.variant === "mcp" && scenario.server === "sql-minimal"
  );
  if (scenarios.length === 0) {
    throw new Error(`Brak scenariuszy (variant=mcp, server=sql-minimal) w ${SCENARIOS_FILE}.`);
  }

  console.log(
    `Starting MCP-only (sql-minimal) evaluation: ${scenarios.length} scenarios, warmup ${WARMUP_ITERATIONS} iter/scenario.`
  );

  const client = await createMcpClient();
  const runId = newRunId();
  const records: ResultRecord[] = [];
  const measurementsForSummary: Measurement[] = [];

  try {
    for (const scenario of scenarios) {
      const sql = scenarioSql(scenario);
      const iterations = iterationsOverride ?? scenario.iterations;

      for (let warmup = 1; warmup <= WARMUP_ITERATIONS; warmup += 1) {
        try {
          await client.callTool({ name: "execute_read_query", arguments: { sql } });
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
            name: "execute_read_query",
            arguments: { sql }
          })) as ToolResultLike;
          latencyMs = Number((performance.now() - startedAt).toFixed(3));

          if (result.isError === true) {
            errorCode = "POSTGRES_QUERY_FAILED";
            errorMessage = result.content?.find((item) => item.type === "text")?.text ?? null;
          } else {
            success = true;
            resultCount = parseRowCount(result);
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
              serverName: "sql-minimal",
              latencyMs,
              errorCode,
              errorMessage,
              toolCallRequested: true,
              toolCallSuccess: success,
              toolName: "execute_read_query",
              toolArguments: { sql },
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
        serverVersions: { "sql-minimal": "own" },
        notes:
          "MCP-only sql-minimal (deterministyczne SQL ze scenarios/mcp/sql-minimal.yaml; rozgrzewka: 2 iteracje odrzucane), runner: runPostgresMcpSql.ts"
      }),
      extraFiles: { "summary.json": summaries }
    });

    console.log(JSON.stringify({
      variant: "mcp",
      serverName: "sql-minimal",
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
  console.error("PostgreSQL MCP (sql-minimal) runner failed:", error);
  process.exit(1);
});
