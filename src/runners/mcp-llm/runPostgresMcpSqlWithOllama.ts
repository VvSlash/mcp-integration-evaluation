import "dotenv/config";
import { performance } from "node:perf_hooks";
import { Client, StdioClientTransport } from "@modelcontextprotocol/client";
import {
  adaptLegacyMeasurement,
  adaptTokenComparisonEntry
} from "../../shared/legacyMapping.js";
import { buildRunManifest, writeRunResults } from "../../shared/resultsWriter.js";

type OllamaMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content?: string;
  tool_calls?: OllamaToolCall[];
  tool_name?: string;
};

type OllamaToolCall = {
  type?: "function";
  function: {
    name: string;
    arguments: Record<string, unknown>;
  };
};

type OllamaToolDefinition = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties: Record<string, unknown>;
      required?: string[];
    };
  };
};

type OllamaChatResponse = {
  model: string;
  message: OllamaMessage;
  done: boolean;

  total_duration?: number;
  load_duration?: number;

  prompt_eval_count?: number;
  prompt_eval_duration?: number;

  eval_count?: number;
  eval_duration?: number;
};

type OllamaUsage = {
  promptEvalCount: number | null;
  evalCount: number | null;
  totalTokens: number | null;
  totalDurationNs: number | null;
  promptEvalDurationNs: number | null;
  evalDurationNs: number | null;
};

type McpTokenUsage = {
  firstCall: OllamaUsage;
  finalCall: OllamaUsage | null;
  totalPromptTokens: number | null;
  totalOutputTokens: number | null;
  totalTokens: number | null;
};

type LlmOnlyRunResult = {
  prompt: string;
  variant: "llm-only";
  success: boolean;
  finalAnswerValidJson: boolean;
  errorCode: string | null;
  errorMessage: string | null;
  latencyMs: number;
  tokenUsage: OllamaUsage | null;
  finalAnswer?: unknown;
  rawResponse?: OllamaChatResponse;
};

type TokenDelta = {
  additionalPromptTokens: number | null;
  additionalOutputTokens: number | null;
  additionalTotalTokens: number | null;
};

type ScenarioRunResult = {
  prompt: string;
  success: boolean;
  toolCallRequested: boolean;
  toolCallSuccess: boolean;
  toolResultCount: number | null;
  finalAnswerSuccess: boolean;
  finalAnswerValidJson: boolean;
  errorCode: string | null;
  errorMessage: string | null;
  latencyMs: number;
  tokenUsage?: McpTokenUsage;
  usedTool?: string;
  sql?: string;
  toolArguments?: Record<string, unknown>;
  toolResult?: unknown;
  finalAnswer?: unknown;
  firstModelMessage?: OllamaMessage;
  rawFinalResponse?: OllamaChatResponse;
};

type Scenario = {
  id: string;
  name: string;
  prompt: string;
};

type ScenarioComparisonResult = {
  prompt: string;
  scenarioId: string;
  scenarioName: string;
  llmOnly: LlmOnlyRunResult;
  llmWithMcp: ScenarioRunResult;
  delta: TokenDelta;
};

type ErrorCategory =
  | "OK"
  | "NO_TOOL_CALL"
  | "POSTGRES_QUERY_FAILED"
  | "EMPTY_FINAL_LLM_RESPONSE"
  | "INVALID_FINAL_JSON"
  | "OTHER";

type SqlLlmMeasurement = {
  scenarioId: string;
  scenarioName: string;
  variant: "mcp-llm-sql";
  iteration: number;
  latencyMs: number;
  success: boolean;
  errorCategory: ErrorCategory;
  errorCode: string | null;
  errorMessage: string | null;
  toolCallRequested: boolean;
  toolCallSuccess: boolean;
  finalAnswerValidJson: boolean;
  toolResultCount: number | null;
  usedTool: string | null;
  sql: string | null;
  postgresErrorCode: string | null;
  postgresErrorMessage: string | null;
  totalPromptTokens: number | null;
  totalOutputTokens: number | null;
  totalTokens: number | null;
  timestamp: string;
};

type SqlLlmSummary = {
  scenarioId: string;
  scenarioName: string;
  variant: "mcp-llm-sql";
  iterations: number;
  successful: number;
  failed: number;
  successRate: number;
  errorRate: number;
  countOk: number;
  countNoToolCall: number;
  countPostgresQueryFailed: number;
  countEmptyFinalLlmResponse: number;
  countInvalidFinalJson: number;
  countOther: number;
  minLatencyMs: number | null;
  avgLatencyMs: number | null;
  medianLatencyMs: number | null;
  p95LatencyMs: number | null;
  p99LatencyMs: number | null;
  maxLatencyMs: number | null;
  avgPromptTokens: number | null;
  avgOutputTokens: number | null;
  avgTotalTokens: number | null;
};

type McpToolResultLike = {
  isError?: boolean;
  content?: Array<{
    type: string;
    text?: string;
  }>;
  structuredContent?: unknown;
};

const ollamaBaseUrl = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
const ollamaModel = process.env.OLLAMA_MODEL ?? "qwen3.5";

const DEFAULT_ITERATIONS = 100;
const DEFAULT_TEMPERATURE = 0.7;

function parseTemperature(): number {
  const raw = process.env.OLLAMA_TEMPERATURE;

  if (raw === undefined || raw.trim() === "") {
    return DEFAULT_TEMPERATURE;
  }

  const value = Number(raw);

  if (!Number.isFinite(value) || value < 0) {
    throw new Error(
      `OLLAMA_TEMPERATURE must be a non-negative number, got: ${raw}`
    );
  }

  return value;
}

function parseIterations(): number {
  const raw = process.argv[2];

  if (raw === undefined || raw.trim() === "") {
    return DEFAULT_ITERATIONS;
  }

  const value = Number(raw);

  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(
      `Iteration argument must be a positive integer, got: ${raw}`
    );
  }

  return value;
}

const ollamaTemperature = parseTemperature();

const executeReadQueryTool: OllamaToolDefinition = {
  type: "function",
  function: {
    name: "execute_read_query",
    description:
      "Execute a PostgreSQL SELECT query. Pass a complete SQL string in the `sql` argument. Use this tool whenever the user asks about orders, customers, statuses, amounts, or any data stored in the PostgreSQL database. Do not answer from memory.",
    parameters: {
      type: "object",
      properties: {
        sql: {
          type: "string",
          description:
            "A complete PostgreSQL SQL query (typically a SELECT statement)."
        }
      },
      required: ["sql"]
    }
  }
};

const scenarios: Scenario[] = [
  {
    id: "PG-001",
    name: "Search paid orders",
    prompt: "Find up to 5 paid orders and summarize how many were returned."
  },
  {
    id: "PG-002",
    name: "Search shipped orders",
    prompt: "Find shipped orders. Return only structured JSON."
  },
  {
    id: "PG-003",
    name: "Search orders by amount range",
    prompt:
      "Find orders with total amount between 300 and 1000 PLN. Return the number of matching records and the most relevant fields."
  },
  {
    id: "PG-004",
    name: "Search recent orders without status filter",
    prompt: "Find recent orders without filtering by status. Limit the result to 10 records."
  }
];

async function createMcpClient(): Promise<Client> {
  const client = new Client({
    name: "ollama-postgres-mcp-sql-runner",
    version: "0.1.0"
  });

  const transport = new StdioClientTransport({
    command: "node",
    args: ["dist/servers/sql-minimal/server.js"]
  });

  await client.connect(transport);

  return client;
}

async function fetchOrdersSchemaText(client: Client): Promise<string> {
  const list = await client.listResources();

  const ordersResource = list.resources.find(
    (resource) => resource.uri === "postgres://tables/orders"
  );

  if (ordersResource === undefined) {
    const available = list.resources.map((resource) => resource.uri).join(", ");
    throw new Error(
      `Resource postgres://tables/orders was not advertised by the SQL MCP server. Available: ${available}`
    );
  }

  const read = await client.readResource({ uri: "postgres://tables/orders" });

  const textContent = read.contents.find(
    (item) => "text" in item && typeof item.text === "string"
  );

  if (textContent === undefined || !("text" in textContent)) {
    throw new Error("Resource postgres://tables/orders did not return any text content.");
  }

  return textContent.text;
}

async function callOllama(
  messages: OllamaMessage[],
  tools?: OllamaToolDefinition[],
  forceJson = false
): Promise<OllamaChatResponse> {
  const body: Record<string, unknown> = {
    model: ollamaModel,
    stream: false,
    messages,
    options: {
      temperature: ollamaTemperature
    }
  };

  if (tools !== undefined) {
    body.tools = tools;
  }

  if (forceJson) {
    body.format = "json";
  }

  const response = await fetch(`${ollamaBaseUrl}/api/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Ollama request failed: ${response.status} ${text}`);
  }

  return await response.json() as OllamaChatResponse;
}

function extractToolResultText(result: McpToolResultLike): string {
  if (result.structuredContent !== undefined) {
    return JSON.stringify(result.structuredContent);
  }

  const textItem = result.content?.find(
    (item) => item.type === "text" && typeof item.text === "string"
  );

  if (textItem?.text) {
    return textItem.text;
  }

  return JSON.stringify(result);
}

async function executeMcpTool(
  client: Client,
  toolCall: OllamaToolCall
): Promise<{ text: string; isError: boolean }> {
  if (toolCall.function.name !== "execute_read_query") {
    throw new Error(`Unsupported tool requested by LLM: ${toolCall.function.name}`);
  }

  const result = (await client.callTool({
    name: toolCall.function.name,
    arguments: toolCall.function.arguments
  })) as McpToolResultLike;

  const text = extractToolResultText(result);
  const isError = Boolean(result.isError) || text.trim().length === 0;

  return { text, isError };
}

function toolResultCountFromText(toolResultText: string): number | null {
  const parsed = safeJsonParse(toolResultText);

  if (typeof parsed === "object" && parsed !== null) {
    const candidate = parsed as { rowCount?: unknown; rows?: unknown };

    if (typeof candidate.rowCount === "number") {
      return candidate.rowCount;
    }

    if (Array.isArray(candidate.rows)) {
      return candidate.rows.length;
    }
  }

  return null;
}

function extractSqlFromToolCall(toolCall: OllamaToolCall): string | undefined {
  const sql = toolCall.function.arguments["sql"];

  if (typeof sql === "string") {
    return sql;
  }

  return undefined;
}

function buildFallbackAnswer(
  toolCall: OllamaToolCall,
  toolResultText: string
) {
  const parsed = safeJsonParse(toolResultText) as {
    rowCount?: number;
    rows?: unknown[];
  };

  const resultCount =
    typeof parsed === "object" && parsed !== null
      ? typeof parsed.rowCount === "number"
        ? parsed.rowCount
        : Array.isArray(parsed.rows)
          ? parsed.rows.length
          : null
      : null;

  return {
    answer:
      "The SQL tool call succeeded, but the LLM returned an empty final response.",
    usedTool: toolCall.function.name,
    sql: extractSqlFromToolCall(toolCall) ?? null,
    resultCount,
    reasoningSummary:
      "Fallback answer generated by the SQL evaluation runner based on the MCP tool result."
  };
}

function isValidJsonObject(value: unknown): boolean {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sumAvailableNumbers(values: Array<number | null | undefined>): number | null {
  const knownValues = values.filter((value): value is number => typeof value === "number");

  if (knownValues.length === 0) {
    return null;
  }

  return knownValues.reduce((sum, value) => sum + value, 0);
}

function buildMcpTokenUsage(
  firstUsage: OllamaUsage,
  finalUsage: OllamaUsage | null
): McpTokenUsage {
  return {
    firstCall: firstUsage,
    finalCall: finalUsage,
    totalPromptTokens: sumAvailableNumbers([
      firstUsage.promptEvalCount,
      finalUsage?.promptEvalCount
    ]),
    totalOutputTokens: sumAvailableNumbers([
      firstUsage.evalCount,
      finalUsage?.evalCount
    ]),
    totalTokens: sumAvailableNumbers([
      firstUsage.totalTokens,
      finalUsage?.totalTokens
    ])
  };
}

function subtractNullable(
  left: number | null | undefined,
  right: number | null | undefined
): number | null {
  if (typeof left !== "number" || typeof right !== "number") {
    return null;
  }

  return left - right;
}

function buildTokenDelta(
  llmOnly: LlmOnlyRunResult,
  llmWithMcp: ScenarioRunResult
): TokenDelta {
  return {
    additionalPromptTokens: subtractNullable(
      llmWithMcp.tokenUsage?.totalPromptTokens,
      llmOnly.tokenUsage?.promptEvalCount
    ),
    additionalOutputTokens: subtractNullable(
      llmWithMcp.tokenUsage?.totalOutputTokens,
      llmOnly.tokenUsage?.evalCount
    ),
    additionalTotalTokens: subtractNullable(
      llmWithMcp.tokenUsage?.totalTokens,
      llmOnly.tokenUsage?.totalTokens
    )
  };
}

function extractPostgresError(toolResult: unknown): {
  code: string | null;
  message: string | null;
} {
  if (typeof toolResult !== "object" || toolResult === null) {
    return { code: null, message: null };
  }

  const candidate = toolResult as { code?: unknown; message?: unknown };

  return {
    code: typeof candidate.code === "string" ? candidate.code : null,
    message: typeof candidate.message === "string" ? candidate.message : null
  };
}

function categorizeRunResult(run: ScenarioRunResult): ErrorCategory {
  if (run.errorCode === "NO_TOOL_CALL") {
    return "NO_TOOL_CALL";
  }

  if (run.errorCode === "EMPTY_FINAL_LLM_RESPONSE") {
    return "EMPTY_FINAL_LLM_RESPONSE";
  }

  if (run.toolCallRequested && !run.toolCallSuccess) {
    return "POSTGRES_QUERY_FAILED";
  }

  if (run.toolCallSuccess && !run.finalAnswerValidJson) {
    return "INVALID_FINAL_JSON";
  }

  if (run.success) {
    return "OK";
  }

  return "OTHER";
}

function buildMeasurementFromRun(
  scenario: Scenario,
  run: ScenarioRunResult,
  iteration: number,
  timestamp: string
): SqlLlmMeasurement {
  const category = categorizeRunResult(run);
  const sql =
    run.sql ??
    (typeof run.toolArguments?.["sql"] === "string"
      ? (run.toolArguments["sql"] as string)
      : null);

  const pgError =
    run.toolCallRequested && !run.toolCallSuccess
      ? extractPostgresError(run.toolResult)
      : { code: null, message: null };

  return {
    scenarioId: scenario.id,
    scenarioName: scenario.name,
    variant: "mcp-llm-sql",
    iteration,
    latencyMs: run.latencyMs,
    success: category === "OK",
    errorCategory: category,
    errorCode: run.errorCode,
    errorMessage: run.errorMessage,
    toolCallRequested: run.toolCallRequested,
    toolCallSuccess: run.toolCallSuccess,
    finalAnswerValidJson: run.finalAnswerValidJson,
    toolResultCount: run.toolResultCount,
    usedTool: run.usedTool ?? null,
    sql,
    postgresErrorCode: pgError.code,
    postgresErrorMessage: pgError.message,
    totalPromptTokens: run.tokenUsage?.totalPromptTokens ?? null,
    totalOutputTokens: run.tokenUsage?.totalOutputTokens ?? null,
    totalTokens: run.tokenUsage?.totalTokens ?? null,
    timestamp
  };
}

function percentile(values: number[], p: number): number | null {
  if (values.length === 0) {
    return null;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  const idx = Math.max(0, Math.min(index, sorted.length - 1));
  const value = sorted[idx];
  return value ?? null;
}

function average(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function round(value: number | null): number | null {
  if (value === null) {
    return null;
  }

  return Number(value.toFixed(3));
}

function countByCategory(
  measurements: SqlLlmMeasurement[]
): Record<ErrorCategory, number> {
  const counts: Record<ErrorCategory, number> = {
    OK: 0,
    NO_TOOL_CALL: 0,
    POSTGRES_QUERY_FAILED: 0,
    EMPTY_FINAL_LLM_RESPONSE: 0,
    INVALID_FINAL_JSON: 0,
    OTHER: 0
  };

  for (const measurement of measurements) {
    counts[measurement.errorCategory] += 1;
  }

  return counts;
}

function summarizeSqlLlmMeasurements(
  measurements: SqlLlmMeasurement[]
): SqlLlmSummary[] {
  const groups = new Map<string, SqlLlmMeasurement[]>();

  for (const measurement of measurements) {
    const key = measurement.scenarioId;
    const current = groups.get(key) ?? [];
    current.push(measurement);
    groups.set(key, current);
  }

  return [...groups.values()].map((group) => {
    const first = group[0];
    if (first === undefined) {
      throw new Error("summarizeSqlLlmMeasurements: empty group");
    }

    const successful = group.filter((item) => item.success);
    const latencies = successful.map((item) => item.latencyMs);
    const counts = countByCategory(group);

    const promptTokens = group
      .map((item) => item.totalPromptTokens)
      .filter((value): value is number => typeof value === "number");
    const outputTokens = group
      .map((item) => item.totalOutputTokens)
      .filter((value): value is number => typeof value === "number");
    const totalTokens = group
      .map((item) => item.totalTokens)
      .filter((value): value is number => typeof value === "number");

    return {
      scenarioId: first.scenarioId,
      scenarioName: first.scenarioName,
      variant: "mcp-llm-sql",
      iterations: group.length,
      successful: successful.length,
      failed: group.length - successful.length,
      successRate: Number((successful.length / group.length).toFixed(4)),
      errorRate: Number(
        ((group.length - successful.length) / group.length).toFixed(4)
      ),
      countOk: counts.OK,
      countNoToolCall: counts.NO_TOOL_CALL,
      countPostgresQueryFailed: counts.POSTGRES_QUERY_FAILED,
      countEmptyFinalLlmResponse: counts.EMPTY_FINAL_LLM_RESPONSE,
      countInvalidFinalJson: counts.INVALID_FINAL_JSON,
      countOther: counts.OTHER,
      minLatencyMs: round(latencies.length > 0 ? Math.min(...latencies) : null),
      avgLatencyMs: round(average(latencies)),
      medianLatencyMs: round(percentile(latencies, 50)),
      p95LatencyMs: round(percentile(latencies, 95)),
      p99LatencyMs: round(percentile(latencies, 99)),
      maxLatencyMs: round(latencies.length > 0 ? Math.max(...latencies) : null),
      avgPromptTokens: round(average(promptTokens)),
      avgOutputTokens: round(average(outputTokens)),
      avgTotalTokens: round(average(totalTokens))
    };
  });
}

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }

  const text = String(value);

  if (text.includes(",") || text.includes("\"") || text.includes("\n")) {
    return `"${text.replaceAll("\"", "\"\"")}"`;
  }

  return text;
}

function sqlMeasurementsToCsv(measurements: SqlLlmMeasurement[]): string {
  const headers: Array<keyof SqlLlmMeasurement> = [
    "scenarioId",
    "scenarioName",
    "variant",
    "iteration",
    "latencyMs",
    "success",
    "errorCategory",
    "errorCode",
    "errorMessage",
    "toolCallRequested",
    "toolCallSuccess",
    "finalAnswerValidJson",
    "toolResultCount",
    "usedTool",
    "sql",
    "postgresErrorCode",
    "postgresErrorMessage",
    "totalPromptTokens",
    "totalOutputTokens",
    "totalTokens",
    "timestamp"
  ];

  const rows = measurements.map((measurement) =>
    headers.map((header) => csvEscape(measurement[header])).join(",")
  );

  return [headers.join(","), ...rows].join("\n");
}

function sqlSummariesToCsv(summaries: SqlLlmSummary[]): string {
  const headers: Array<keyof SqlLlmSummary> = [
    "scenarioId",
    "scenarioName",
    "variant",
    "iterations",
    "successful",
    "failed",
    "successRate",
    "errorRate",
    "countOk",
    "countNoToolCall",
    "countPostgresQueryFailed",
    "countEmptyFinalLlmResponse",
    "countInvalidFinalJson",
    "countOther",
    "minLatencyMs",
    "avgLatencyMs",
    "medianLatencyMs",
    "p95LatencyMs",
    "p99LatencyMs",
    "maxLatencyMs",
    "avgPromptTokens",
    "avgOutputTokens",
    "avgTotalTokens"
  ];

  const rows = summaries.map((summary) =>
    headers.map((header) => csvEscape(summary[header])).join(",")
  );

  return [headers.join(","), ...rows].join("\n");
}

function buildSystemPrompt(schemaText: string): string {
  const lines = [
    "You are an evaluation assistant for an MCP research prototype.",
    "You can inspect PostgreSQL table resources and execute SQL queries.",
    "Use the provided database schema to generate SQL.",
    "For order-related questions, call execute_read_query with a PostgreSQL SQL query.",
    "Do not answer from memory.",
    "After receiving query results, respond with a single valid JSON object.",
    "The final JSON must contain: answer, usedTool, sql, resultCount, reasoningSummary.",
    "An empty assistant message is not allowed after tool results.",
    "",
    "Available PostgreSQL schema:",
    "",
    schemaText
  ];

  return lines.join("\n");
}

async function runScenario(
  prompt: string,
  schemaText: string
): Promise<ScenarioRunResult> {
  const client = await createMcpClient();

  const startedAt = performance.now();

  try {
    const messages: OllamaMessage[] = [
      {
        role: "system",
        content: buildSystemPrompt(schemaText)
      },
      {
        role: "user",
        content: prompt
      }
    ];

    const firstResponse = await callOllama(messages, [executeReadQueryTool], false);

    const firstUsage = extractOllamaUsage(firstResponse);

    const toolCalls = firstResponse.message.tool_calls ?? [];

    if (toolCalls.length === 0) {
      const endedAt = performance.now();

      return {
        prompt,
        success: false,
        toolCallRequested: false,
        toolCallSuccess: false,
        toolResultCount: null,
        finalAnswerSuccess: false,
        finalAnswerValidJson: false,
        errorCode: "NO_TOOL_CALL",
        errorMessage: "The model did not call execute_read_query.",
        latencyMs: Number((endedAt - startedAt).toFixed(3)),
        tokenUsage: buildMcpTokenUsage(firstUsage, null),
        firstModelMessage: firstResponse.message
      };
    }

    const toolCall = toolCalls[0];
    if (toolCall === undefined) {
      throw new Error("Invariant: tool_calls non-empty but first entry missing.");
    }

    const sql = extractSqlFromToolCall(toolCall);

    const { text: toolResultText, isError: mcpToolError } = await executeMcpTool(
      client,
      toolCall
    );
    const toolResultParsed = safeJsonParse(toolResultText);
    const toolResultCount = toolResultCountFromText(toolResultText);
    const toolCallSuccess = !mcpToolError;

    messages.push({
      role: "assistant",
      content: firstResponse.message.content ?? "",
      tool_calls: toolCalls
    });

    messages.push({
      role: "tool",
      tool_name: toolCall.function.name,
      content: toolResultText
    });

    const finalResponse = await callOllama(messages, undefined, true);

    const finalUsage = extractOllamaUsage(finalResponse);

    const endedAt = performance.now();
    const latencyMs = Number((endedAt - startedAt).toFixed(3));

    const finalContent = finalResponse.message.content?.trim() ?? "";

    if (finalContent.length === 0) {
      const tokenUsage = buildMcpTokenUsage(firstUsage, finalUsage);

      const fallback: ScenarioRunResult = {
        prompt,
        success: false,
        toolCallRequested: true,
        toolCallSuccess,
        toolResultCount,
        finalAnswerSuccess: false,
        finalAnswerValidJson: false,
        errorCode: "EMPTY_FINAL_LLM_RESPONSE",
        errorMessage:
          "The tool call completed, but the LLM returned an empty final answer.",
        latencyMs,
        tokenUsage,
        usedTool: toolCall.function.name,
        toolArguments: toolCall.function.arguments,
        toolResult: toolResultParsed,
        finalAnswer: buildFallbackAnswer(toolCall, toolResultText),
        rawFinalResponse: finalResponse
      };

      if (sql !== undefined) {
        fallback.sql = sql;
      }

      return fallback;
    }

    const finalParsed = safeJsonParse(finalContent);
    const finalAnswerValidJson = isValidJsonObject(finalParsed);
    const finalAnswerSuccess = finalAnswerValidJson;
    const tokenUsage = buildMcpTokenUsage(firstUsage, finalUsage);

    const result: ScenarioRunResult = {
      prompt,
      success: toolCallSuccess && finalAnswerSuccess,
      toolCallRequested: true,
      toolCallSuccess,
      toolResultCount,
      finalAnswerSuccess,
      finalAnswerValidJson,
      errorCode: null,
      errorMessage: null,
      latencyMs,
      tokenUsage,
      usedTool: toolCall.function.name,
      toolArguments: toolCall.function.arguments,
      toolResult: toolResultParsed,
      finalAnswer: finalParsed
    };

    if (sql !== undefined) {
      result.sql = sql;
    }

    return result;
  } catch (error) {
    const endedAt = performance.now();

    return {
      prompt,
      success: false,
      toolCallRequested: false,
      toolCallSuccess: false,
      toolResultCount: null,
      finalAnswerSuccess: false,
      finalAnswerValidJson: false,
      errorCode: "LLM_MCP_SQL_SCENARIO_FAILED",
      errorMessage: error instanceof Error ? error.message : "Unknown error",
      latencyMs: Number((endedAt - startedAt).toFixed(3))
    };
  } finally {
    await client.close();
  }
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function nowForFileName(): string {
  return new Date()
    .toISOString()
    .replaceAll(":", "-")
    .replaceAll(".", "-");
}

function extractOllamaUsage(response: OllamaChatResponse): OllamaUsage {
  return {
    promptEvalCount: response.prompt_eval_count ?? null,
    evalCount: response.eval_count ?? null,
    totalTokens:
      typeof response.prompt_eval_count === "number" &&
      typeof response.eval_count === "number"
        ? response.prompt_eval_count + response.eval_count
        : null,
    totalDurationNs: response.total_duration ?? null,
    promptEvalDurationNs: response.prompt_eval_duration ?? null,
    evalDurationNs: response.eval_duration ?? null
  };
}

async function runLlmOnlyScenario(prompt: string): Promise<LlmOnlyRunResult> {
  const startedAt = performance.now();

  try {
    const messages: OllamaMessage[] = [
      {
        role: "system",
        content:
          [
            "You are an evaluation assistant.",
            "Return the final answer only as a valid JSON object.",
            "The final JSON must contain: answer, usedTool, sql, resultCount, reasoningSummary.",
            "You do not have access to external tools or databases in this variant.",
            "If external order data is needed, explicitly state that no external data access is available.",
            "Do not invent order records."
          ].join(" ")
      },
      {
        role: "user",
        content: prompt
      }
    ];

    const response = await callOllama(messages, undefined, true);
    const endedAt = performance.now();

    const content = response.message.content?.trim() ?? "";
    const parsed = safeJsonParse(content);
    const validJson = isValidJsonObject(parsed);

    return {
      prompt,
      variant: "llm-only",
      success: content.length > 0 && validJson,
      finalAnswerValidJson: validJson,
      errorCode: content.length === 0 ? "EMPTY_LLM_ONLY_RESPONSE" : null,
      errorMessage: content.length === 0 ? "The LLM-only response was empty." : null,
      latencyMs: Number((endedAt - startedAt).toFixed(3)),
      tokenUsage: extractOllamaUsage(response),
      finalAnswer: parsed,
      rawResponse: response
    };
  } catch (error) {
    const endedAt = performance.now();

    return {
      prompt,
      variant: "llm-only",
      success: false,
      finalAnswerValidJson: false,
      errorCode: "LLM_ONLY_SCENARIO_FAILED",
      errorMessage: error instanceof Error ? error.message : "Unknown error",
      latencyMs: Number((endedAt - startedAt).toFixed(3)),
      tokenUsage: null
    };
  }
}

async function loadOrdersSchemaText(): Promise<string> {
  const client = await createMcpClient();

  try {
    return await fetchOrdersSchemaText(client);
  } finally {
    await client.close();
  }
}

async function main() {
  const iterations = parseIterations();

  console.log(
    `Starting MCP+LLM SQL evaluation: ${scenarios.length} scenarios x ${iterations} iterations.`
  );
  console.log(
    `Ollama model: ${ollamaModel}, temperature: ${ollamaTemperature}.`
  );

  const schemaText = await loadOrdersSchemaText();

  console.log("Loaded postgres://tables/orders resource (preview):");
  console.log(schemaText.split("\n").slice(0, 12).join("\n"));
  console.log("---");

  const comparisons: ScenarioComparisonResult[] = [];
  const measurements: SqlLlmMeasurement[] = [];

  for (const scenario of scenarios) {
    const llmOnly = await runLlmOnlyScenario(scenario.prompt);

    let firstRun: ScenarioRunResult | null = null;

    for (let iteration = 1; iteration <= iterations; iteration += 1) {
      const run = await runScenario(scenario.prompt, schemaText);

      const measurement = buildMeasurementFromRun(
        scenario,
        run,
        iteration,
        new Date().toISOString()
      );

      measurements.push(measurement);

      if (firstRun === null) {
        firstRun = run;
      }

      console.log(
        `[${scenario.id}] iter ${iteration}/${iterations} category=${measurement.errorCategory} latencyMs=${measurement.latencyMs} sql=${measurement.sql ?? "<none>"}`
      );
    }

    if (firstRun === null) {
      throw new Error(
        `Invariant: no iteration ran for scenario ${scenario.id}. iterations=${iterations}`
      );
    }

    const comparison: ScenarioComparisonResult = {
      prompt: scenario.prompt,
      scenarioId: scenario.id,
      scenarioName: scenario.name,
      llmOnly,
      llmWithMcp: firstRun,
      delta: buildTokenDelta(llmOnly, firstRun)
    };

    comparisons.push(comparison);
  }

  const summaries = summarizeSqlLlmMeasurements(measurements);

  const runId = nowForFileName();
  const records = [
    ...measurements.flatMap((measurement) => {
      const record = adaptLegacyMeasurement(measurement, runId, "own");
      return record ? [record] : [];
    }),
    ...comparisons.flatMap((comparison, index) => {
      const record = adaptTokenComparisonEntry(comparison, runId, index + 1, "own");
      return record ? [record] : [];
    })
  ];

  const runDir = await writeRunResults({
    runId,
    records,
    manifest: buildRunManifest({
      runId,
      model: ollamaModel,
      serverVersions: { "sql-minimal": "own" },
      notes: "MCP+LLM (surowe SQL + zasoby schematu) + referencyjny llm_only, runner: runPostgresMcpSqlWithOllama.ts"
    }),
    extraFiles: {
      "summary.json": summaries,
      "tokenComparison.json": comparisons
    }
  });
  console.log(`Results dir: ${runDir}`);

  console.log("---");
  console.log(
    JSON.stringify(
      {
        variant: "mcp-llm-sql",
        scenarios: scenarios.length,
        iterationsPerScenario: iterations,
        totalMeasurements: measurements.length,
        temperature: ollamaTemperature,
        model: ollamaModel,
        summary: summaries
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error("Ollama MCP SQL evaluation failed:", error);
  process.exit(1);
});
