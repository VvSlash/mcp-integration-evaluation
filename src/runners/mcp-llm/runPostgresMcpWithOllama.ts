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

type ScenarioComparisonResult = {
  prompt: string;
  scenarioId: string;
  scenarioName: string;
  llmOnly: LlmOnlyRunResult;
  llmWithMcp: ScenarioRunResult;
  delta: TokenDelta;
};

type Scenario = {
  id: string;
  name: string;
  prompt: string;
};

type ErrorCategory =
  | "OK"
  | "NO_TOOL_CALL"
  | "TOOL_CALL_FAILED"
  | "EMPTY_FINAL_LLM_RESPONSE"
  | "INVALID_FINAL_JSON"
  | "OTHER";

type LlmMcpMeasurement = {
  scenarioId: string;
  scenarioName: string;
  variant: "mcp-llm";
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
  toolArguments: string | null;
  totalPromptTokens: number | null;
  totalOutputTokens: number | null;
  totalTokens: number | null;
  firstCallPromptTokens: number | null;
  firstCallOutputTokens: number | null;
  firstCallTotalTokens: number | null;
  finalCallPromptTokens: number | null;
  finalCallOutputTokens: number | null;
  finalCallTotalTokens: number | null;
  firstCallDurationMs: number | null;
  finalCallDurationMs: number | null;
  timestamp: string;
};

type LlmMcpSummary = {
  scenarioId: string;
  scenarioName: string;
  variant: "mcp-llm";
  iterations: number;
  successful: number;
  failed: number;
  successRate: number;
  errorRate: number;
  countOk: number;
  countNoToolCall: number;
  countToolCallFailed: number;
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
  avgFirstCallTotalTokens: number | null;
  avgFinalCallTotalTokens: number | null;
  avgFirstCallDurationMs: number | null;
  avgFinalCallDurationMs: number | null;
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
  toolArguments?: Record<string, unknown>;
  toolResult?: unknown;
  finalAnswer?: unknown;
  firstModelMessage?: OllamaMessage;
  rawFinalResponse?: OllamaChatResponse;
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

const DEFAULT_ITERATIONS = 1;
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

const pgSearchOrdersTool: OllamaToolDefinition = {
  type: "function",
  function: {
    name: "pg_search_orders",
    description:
      "Search read-only order records in PostgreSQL using constrained filters. Use this tool when the user asks about orders, paid orders, shipped orders, cancelled orders, refunded orders, pending orders, customers, or order amounts.",
    parameters: {
      type: "object",
      properties: {
        status: {
          type: "string",
          enum: ["pending", "paid", "shipped", "cancelled", "refunded"],
          description: "Optional order status filter."
        },
        customerEmail: {
          type: "string",
          description: "Optional exact customer email filter."
        },
        minAmount: {
          type: "number",
          description: "Optional minimum order amount."
        },
        maxAmount: {
          type: "number",
          description: "Optional maximum order amount."
        },
        limit: {
          type: "integer",
          minimum: 1,
          maximum: 50,
          description: "Maximum number of returned records."
        }
      },
      required: []
    }
  }
};

async function createMcpClient(): Promise<Client> {
  const client = new Client({
    name: "ollama-postgres-mcp-runner",
    version: "0.1.0"
  });

  const transport = new StdioClientTransport({
    command: "node",
    args: ["dist/servers/sql-controlled/server.js"]
  });

  await client.connect(transport);

  return client;
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
  if (toolCall.function.name !== "pg_search_orders") {
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
  if (
    typeof parsed === "object" &&
    parsed !== null &&
    "count" in parsed &&
    typeof (parsed as { count: unknown }).count === "number"
  ) {
    return (parsed as { count: number }).count;
  }

  return null;
}

function buildFallbackAnswer(
  toolName: string,
  toolArguments: Record<string, unknown>,
  toolResultText: string
) {
  const parsed = safeJsonParse(toolResultText) as {
    count?: number;
  };

  const resultCount =
    typeof parsed === "object" &&
    parsed !== null &&
    typeof parsed.count === "number"
      ? parsed.count
      : null;

  return {
    answer:
      "The tool call succeeded, but the LLM returned an empty final response.",
    usedTool: toolName,
    toolArguments,
    resultCount,
    reasoningSummary:
      "Fallback answer generated by the evaluation runner based on the MCP tool result."
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

function nsToMs(ns: number | null | undefined): number | null {
  if (typeof ns !== "number" || !Number.isFinite(ns)) {
    return null;
  }
  return Number((ns / 1_000_000).toFixed(3));
}

function categorizeRunResult(run: ScenarioRunResult): ErrorCategory {
  if (run.errorCode === "NO_TOOL_CALL") {
    return "NO_TOOL_CALL";
  }

  if (run.errorCode === "EMPTY_FINAL_LLM_RESPONSE") {
    return "EMPTY_FINAL_LLM_RESPONSE";
  }

  if (run.toolCallRequested && !run.toolCallSuccess) {
    return "TOOL_CALL_FAILED";
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
): LlmMcpMeasurement {
  const category = categorizeRunResult(run);
  const firstCall = run.tokenUsage?.firstCall ?? null;
  const finalCall = run.tokenUsage?.finalCall ?? null;

  return {
    scenarioId: scenario.id,
    scenarioName: scenario.name,
    variant: "mcp-llm",
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
    toolArguments:
      run.toolArguments !== undefined ? JSON.stringify(run.toolArguments) : null,
    totalPromptTokens: run.tokenUsage?.totalPromptTokens ?? null,
    totalOutputTokens: run.tokenUsage?.totalOutputTokens ?? null,
    totalTokens: run.tokenUsage?.totalTokens ?? null,
    firstCallPromptTokens: firstCall?.promptEvalCount ?? null,
    firstCallOutputTokens: firstCall?.evalCount ?? null,
    firstCallTotalTokens: firstCall?.totalTokens ?? null,
    finalCallPromptTokens: finalCall?.promptEvalCount ?? null,
    finalCallOutputTokens: finalCall?.evalCount ?? null,
    finalCallTotalTokens: finalCall?.totalTokens ?? null,
    firstCallDurationMs: nsToMs(firstCall?.totalDurationNs ?? null),
    finalCallDurationMs: nsToMs(finalCall?.totalDurationNs ?? null),
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
  measurements: LlmMcpMeasurement[]
): Record<ErrorCategory, number> {
  const counts: Record<ErrorCategory, number> = {
    OK: 0,
    NO_TOOL_CALL: 0,
    TOOL_CALL_FAILED: 0,
    EMPTY_FINAL_LLM_RESPONSE: 0,
    INVALID_FINAL_JSON: 0,
    OTHER: 0
  };

  for (const measurement of measurements) {
    counts[measurement.errorCategory] += 1;
  }

  return counts;
}

function pickNumbers(
  measurements: LlmMcpMeasurement[],
  selector: (m: LlmMcpMeasurement) => number | null
): number[] {
  return measurements
    .map(selector)
    .filter((value): value is number => typeof value === "number");
}

function summarizeLlmMcpMeasurements(
  measurements: LlmMcpMeasurement[]
): LlmMcpSummary[] {
  const groups = new Map<string, LlmMcpMeasurement[]>();

  for (const measurement of measurements) {
    const key = measurement.scenarioId;
    const current = groups.get(key) ?? [];
    current.push(measurement);
    groups.set(key, current);
  }

  return [...groups.values()].map((group) => {
    const first = group[0];
    if (first === undefined) {
      throw new Error("summarizeLlmMcpMeasurements: empty group");
    }

    const successful = group.filter((item) => item.success);
    const latencies = successful.map((item) => item.latencyMs);
    const counts = countByCategory(group);

    const promptTokens = pickNumbers(group, (m) => m.totalPromptTokens);
    const outputTokens = pickNumbers(group, (m) => m.totalOutputTokens);
    const totalTokens = pickNumbers(group, (m) => m.totalTokens);
    const firstCallTotals = pickNumbers(group, (m) => m.firstCallTotalTokens);
    const finalCallTotals = pickNumbers(group, (m) => m.finalCallTotalTokens);
    const firstCallDurations = pickNumbers(group, (m) => m.firstCallDurationMs);
    const finalCallDurations = pickNumbers(group, (m) => m.finalCallDurationMs);

    return {
      scenarioId: first.scenarioId,
      scenarioName: first.scenarioName,
      variant: "mcp-llm",
      iterations: group.length,
      successful: successful.length,
      failed: group.length - successful.length,
      successRate: Number((successful.length / group.length).toFixed(4)),
      errorRate: Number(
        ((group.length - successful.length) / group.length).toFixed(4)
      ),
      countOk: counts.OK,
      countNoToolCall: counts.NO_TOOL_CALL,
      countToolCallFailed: counts.TOOL_CALL_FAILED,
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
      avgTotalTokens: round(average(totalTokens)),
      avgFirstCallTotalTokens: round(average(firstCallTotals)),
      avgFinalCallTotalTokens: round(average(finalCallTotals)),
      avgFirstCallDurationMs: round(average(firstCallDurations)),
      avgFinalCallDurationMs: round(average(finalCallDurations))
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

function llmMcpMeasurementsToCsv(measurements: LlmMcpMeasurement[]): string {
  const headers: Array<keyof LlmMcpMeasurement> = [
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
    "toolArguments",
    "totalPromptTokens",
    "totalOutputTokens",
    "totalTokens",
    "firstCallPromptTokens",
    "firstCallOutputTokens",
    "firstCallTotalTokens",
    "finalCallPromptTokens",
    "finalCallOutputTokens",
    "finalCallTotalTokens",
    "firstCallDurationMs",
    "finalCallDurationMs",
    "timestamp"
  ];

  const rows = measurements.map((measurement) =>
    headers.map((header) => csvEscape(measurement[header])).join(",")
  );

  return [headers.join(","), ...rows].join("\n");
}

function llmMcpSummariesToCsv(summaries: LlmMcpSummary[]): string {
  const headers: Array<keyof LlmMcpSummary> = [
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
    "countToolCallFailed",
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
    "avgTotalTokens",
    "avgFirstCallTotalTokens",
    "avgFinalCallTotalTokens",
    "avgFirstCallDurationMs",
    "avgFinalCallDurationMs"
  ];

  const rows = summaries.map((summary) =>
    headers.map((header) => csvEscape(summary[header])).join(",")
  );

  return [headers.join(","), ...rows].join("\n");
}

async function runScenario(prompt: string): Promise<ScenarioRunResult> {
  const client = await createMcpClient();

  const startedAt = performance.now();

  try {
    const messages: OllamaMessage[] = [
      {
        role: "system",
        content:
          [
            "You are an evaluation assistant for an MCP research prototype.",
            "Use the available tool when external order data is needed.",
            "After you receive tool results, you MUST respond with a single valid JSON object as your final message content.",
            "The final JSON must contain: answer, usedTool, toolArguments, resultCount, reasoningSummary.",
            "Do not invent order records. Base the answer only on tool results.",
            "An empty assistant message is not allowed after tool results."
          ].join(" ")
      },
      {
        role: "user",
        content: prompt
      }
    ];

    const firstResponse = await callOllama(messages, [pgSearchOrdersTool], false);

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
        errorMessage: "The model did not call pg_search_orders.",
        latencyMs: Number((endedAt - startedAt).toFixed(3)),
        tokenUsage: buildMcpTokenUsage(firstUsage, null),
        firstModelMessage: firstResponse.message
      };
    }

    const toolCall = toolCalls[0];
    if (toolCall === undefined) {
      throw new Error("Invariant: tool_calls non-empty but first entry missing.");
    }

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

      return {
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
        finalAnswer: buildFallbackAnswer(
          toolCall.function.name,
          toolCall.function.arguments,
          toolResultText
        ),
        rawFinalResponse: finalResponse
      };
    }

    const finalParsed = safeJsonParse(finalContent);
    const finalAnswerValidJson = isValidJsonObject(finalParsed);
    const finalAnswerSuccess = finalAnswerValidJson;
    const tokenUsage = buildMcpTokenUsage(firstUsage, finalUsage);

    return {
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
      errorCode: "LLM_MCP_SCENARIO_FAILED",
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

async function main() {
  const iterations = parseIterations();

  console.log(
    `Starting MCP+LLM (domain) evaluation: ${scenarios.length} scenarios x ${iterations} iterations.`
  );
  console.log(
    `Ollama model: ${ollamaModel}, temperature: ${ollamaTemperature}.`
  );

  const comparisons: ScenarioComparisonResult[] = [];
  const measurements: LlmMcpMeasurement[] = [];

  for (const scenario of scenarios) {
    const llmOnly = await runLlmOnlyScenario(scenario.prompt);

    let firstRun: ScenarioRunResult | null = null;

    for (let iteration = 1; iteration <= iterations; iteration += 1) {
      const run = await runScenario(scenario.prompt);

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
        `[${scenario.id}] iter ${iteration}/${iterations} category=${measurement.errorCategory} latencyMs=${measurement.latencyMs} usedTool=${measurement.usedTool ?? "<none>"}`
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

  const summaries = summarizeLlmMcpMeasurements(measurements);

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
      serverVersions: { "sql-controlled": "own" },
      notes: "MCP+LLM (narzedzia domenowe) + referencyjny llm_only, runner: runPostgresMcpWithOllama.ts"
    }),
    extraFiles: {
      "summary.json": summaries,
      "tokenComparison.json": comparisons
    }
  });

  console.log("---");
  console.log(
    JSON.stringify(
      {
        variant: "mcp-llm",
        scenarios: scenarios.length,
        iterationsPerScenario: iterations,
        totalMeasurements: measurements.length,
        temperature: ollamaTemperature,
        model: ollamaModel,
        resultsDir: runDir,
        summary: summaries
      },
      null,
      2
    )
  );
}

function extractOllamaUsage(response: OllamaChatResponse) {
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
            "The final JSON must contain: answer, usedTool, toolArguments, resultCount, reasoningSummary.",
            "You do not have access to external tools in this variant.",
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

main().catch((error) => {
  console.error("Ollama MCP evaluation failed:", error);
  process.exit(1);
});