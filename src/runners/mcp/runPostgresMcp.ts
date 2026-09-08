import { performance } from "node:perf_hooks";
import { Client, StdioClientTransport } from "@modelcontextprotocol/client";
import {
  type Measurement,
  summarizeMeasurements
} from "../../evaluation/metrics.js";
import { adaptLegacyMeasurement } from "../../shared/legacyMapping.js";
import { buildRunManifest, writeRunResults } from "../../shared/resultsWriter.js";
import { postgresSearchOrdersScenarios as scenarios } from "../../evaluation/postgresScenarios.js";

type ToolContentItem = {
  type: string;
  text?: string;
};

type ToolResultLike = {
  isError?: boolean;
  content?: ToolContentItem[];
  structuredContent?: unknown;
};

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

function extractResultCount(result: ToolResultLike): number | null {
  if (
    result.structuredContent &&
    typeof result.structuredContent === "object" &&
    "count" in result.structuredContent
  ) {
    const count = (result.structuredContent as { count?: unknown }).count;
    return typeof count === "number" ? count : null;
  }

  const textItem = result.content?.find(
    (item) => item.type === "text" && typeof item.text === "string"
  );

  if (!textItem?.text) {
    return null;
  }

  try {
    const parsed = JSON.parse(textItem.text) as {
      count?: unknown;
      orders?: unknown;
    };

    if (typeof parsed.count === "number") {
      return parsed.count;
    }

    if (Array.isArray(parsed.orders)) {
      return parsed.orders.length;
    }

    return null;
  } catch {
    return null;
  }
}

function extractErrorMessage(result: ToolResultLike): string | null {
  const textItem = result.content?.find(
    (item) => item.type === "text" && typeof item.text === "string"
  );

  if (!textItem?.text) {
    return null;
  }

  try {
    const parsed = JSON.parse(textItem.text) as {
      code?: unknown;
      message?: unknown;
    };

    if (typeof parsed.message === "string") {
      return parsed.message;
    }

    return textItem.text;
  } catch {
    return textItem.text;
  }
}

async function createMcpClient(): Promise<Client> {
  const client = new Client({
    name: "postgres-mcp-evaluation-runner",
    version: "0.1.0"
  });

  const transport = new StdioClientTransport({
    command: "node",
    args: ["dist/servers/sql-controlled/server.js"]
  });

  await client.connect(transport);

  return client;
}

async function assertRequiredToolExists(client: Client): Promise<void> {
  const toolsResult = await client.listTools();

  const toolNames = toolsResult.tools.map((tool) => tool.name);

  if (!toolNames.includes("pg_search_orders")) {
    throw new Error(
      `Required MCP tool pg_search_orders was not found. Available tools: ${toolNames.join(", ")}`
    );
  }
}

async function main() {
  const iterations = parseIterations();
  const measurements: Measurement[] = [];

  const client = await createMcpClient();

  try {
    await assertRequiredToolExists(client);

    for (const scenario of scenarios) {
      for (let iteration = 1; iteration <= iterations; iteration += 1) {
        const startedAt = performance.now();

        try {
          const result = await client.callTool({
            name: scenario.toolName,
            arguments: scenario.arguments
          }) as ToolResultLike;

          const endedAt = performance.now();

          const isToolError = result.isError === true;

          measurements.push({
            scenarioId: scenario.id,
            scenarioName: scenario.name,
            variant: "mcp",
            iteration,
            latencyMs: Number((endedAt - startedAt).toFixed(3)),
            success: !isToolError,
            errorCode: isToolError ? "MCP_TOOL_RETURNED_ERROR" : null,
            errorMessage: isToolError ? extractErrorMessage(result) : null,
            resultCount: isToolError ? null : extractResultCount(result),
            timestamp: new Date().toISOString()
          });
        } catch (error) {
          const endedAt = performance.now();

          measurements.push({
            scenarioId: scenario.id,
            scenarioName: scenario.name,
            variant: "mcp",
            iteration,
            latencyMs: Number((endedAt - startedAt).toFixed(3)),
            success: false,
            errorCode: "MCP_CALL_FAILED",
            errorMessage: error instanceof Error ? error.message : "Unknown MCP error",
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
        serverVersions: { "sql-controlled": "own" },
        notes: "MCP-only (deterministyczne argumenty), runner: runPostgresMcp.ts"
      }),
      extraFiles: { "summary.json": summaries }
    });

    console.log(JSON.stringify({
      variant: "mcp",
      scenarios: scenarios.length,
      iterationsPerScenario: iterations,
      totalMeasurements: measurements.length,
      resultsDir: runDir,
      summary: summaries
    }, null, 2));
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error("PostgreSQL MCP runner failed:", error);
  process.exit(1);
});