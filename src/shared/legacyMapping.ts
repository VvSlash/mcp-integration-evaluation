import {
  makeResultRecord,
  type ResultRecord,
  type TokenUsage
} from "./resultRecord.js";
import type { EvaluationSource, Variant } from "./types.js";

export function asObject(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function bool(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

export function str(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

export function pickNumber(obj: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = num(obj[key]);
    if (value !== null) {
      return value;
    }
  }
  return null;
}

export function pickString(obj: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = str(obj[key]);
    if (value !== null) {
      return value;
    }
  }
  return null;
}

export function mapLegacyScenarioId(scenarioId: string): string {
  const match = /^PG-(\d+)$/.exec(scenarioId);
  return match ? `SQL-${match[1]}` : scenarioId;
}

export type LegacyVariantInfo = {
  variant: Variant;
  serverName: string | null;
  serverKind: "own" | null;
  deterministic: boolean;
};

export function mapLegacyVariant(variant: string): LegacyVariantInfo | null {
  switch (variant) {
    case "baseline":
      return { variant: "baseline", serverName: null, serverKind: null, deterministic: true };
    case "mcp":
      return { variant: "mcp", serverName: "sql-controlled", serverKind: "own", deterministic: true };
    case "mcp-llm":
      return { variant: "mcp_llm", serverName: "sql-controlled", serverKind: "own", deterministic: false };
    case "mcp-llm-sql":
      return { variant: "mcp_llm", serverName: "sql-minimal", serverKind: "own", deterministic: false };
    case "llm-only":
      return { variant: "llm_only", serverName: null, serverKind: null, deterministic: false };
    default:
      return null;
  }
}

export function extractRunId(fileName: string): string {
  const match = /(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)/.exec(fileName);
  if (match?.[1]) {
    return match[1];
  }
  const dotIndex = fileName.lastIndexOf(".");
  return dotIndex > 0 ? fileName.slice(0, dotIndex) : fileName;
}

function legacyTokenUsage(obj: Record<string, unknown>): TokenUsage | null {
  const promptTokens = pickNumber(obj, ["totalPromptTokens"]);
  const outputTokens = pickNumber(obj, ["totalOutputTokens"]);
  const totalTokens = pickNumber(obj, ["totalTokens"]);
  if (promptTokens === null && outputTokens === null && totalTokens === null) {
    return null;
  }
  return { promptTokens, outputTokens, totalTokens };
}

export function adaptLegacyMeasurement(
  raw: unknown,
  runId: string,
  source: EvaluationSource,
  overrides: Partial<ResultRecord> = {}
): ResultRecord | null {
  const obj = asObject(raw);
  if (!obj) {
    return null;
  }
  const variantInfo = mapLegacyVariant(str(obj["variant"]) ?? "");
  const scenarioId = str(obj["scenarioId"]);
  if (!variantInfo || !scenarioId) {
    return null;
  }

  const firstCallMs = num(obj["firstCallDurationMs"]);
  const finalCallMs = num(obj["finalCallDurationMs"]);
  const stageLatencies =
    firstCallMs !== null || finalCallMs !== null
      ? { llmFirstResponseMs: firstCallMs, toolExecutionMs: null, llmFinalResponseMs: finalCallMs }
      : null;

  let toolArguments: Record<string, unknown> | null = null;
  const rawArgs = obj["toolArguments"];
  if (typeof rawArgs === "string") {
    try {
      toolArguments = asObject(JSON.parse(rawArgs));
    } catch {
      toolArguments = null;
    }
  } else {
    toolArguments = asObject(rawArgs);
  }

  return makeResultRecord(
    {
      runId,
      scenarioId: mapLegacyScenarioId(scenarioId),
      category: "sql",
      variant: variantInfo.variant,
      iteration: num(obj["iteration"]) ?? 1,
      success: bool(obj["success"]) ?? false,
      deterministic: variantInfo.deterministic,
      evaluationSource: source
    },
    {
      scenarioName: str(obj["scenarioName"]),
      serverKind: variantInfo.serverKind,
      serverName: variantInfo.serverName,
      latencyMs: num(obj["latencyMs"]),
      stageLatencies,
      errorCode: str(obj["errorCode"]),
      errorMessage: str(obj["errorMessage"]),
      toolCallRequested: bool(obj["toolCallRequested"]),
      toolCallSuccess: bool(obj["toolCallSuccess"]),
      toolName: str(obj["usedTool"]),
      toolArguments,
      resultCount: num(obj["resultCount"]) ?? num(obj["toolResultCount"]),
      finalAnswerValidJson: bool(obj["finalAnswerValidJson"]),
      tokenUsage: legacyTokenUsage(obj),
      timestamp: str(obj["timestamp"]),
      ...overrides
    }
  );
}

export function adaptTokenComparisonEntry(
  raw: unknown,
  runId: string,
  iteration: number,
  source: EvaluationSource,
  overrides: Partial<ResultRecord> = {}
): ResultRecord | null {
  const entry = asObject(raw);
  const llmOnly = entry ? asObject(entry["llmOnly"]) : null;
  const scenarioId = entry ? str(entry["scenarioId"]) : null;
  if (!entry || !llmOnly || !scenarioId) {
    return null;
  }

  const tokenUsageRaw = asObject(llmOnly["tokenUsage"]);
  const tokenUsage: TokenUsage | null = tokenUsageRaw
    ? {
        promptTokens: pickNumber(tokenUsageRaw, ["promptEvalCount", "promptTokens"]),
        outputTokens: pickNumber(tokenUsageRaw, ["evalCount", "outputTokens"]),
        totalTokens: pickNumber(tokenUsageRaw, ["totalTokens"])
      }
    : null;

  return makeResultRecord(
    {
      runId,
      scenarioId: mapLegacyScenarioId(scenarioId),
      category: "sql",
      variant: "llm_only",
      iteration,
      success: bool(llmOnly["success"]) ?? false,
      deterministic: false,
      evaluationSource: source
    },
    {
      scenarioName: str(entry["scenarioName"]),
      prompt: str(entry["prompt"]) ?? str(llmOnly["prompt"]),
      latencyMs: num(llmOnly["latencyMs"]),
      errorCode: str(llmOnly["errorCode"]),
      errorMessage: str(llmOnly["errorMessage"]),
      finalAnswerValidJson: bool(llmOnly["finalAnswerValidJson"]),
      tokenUsage,
      ...overrides
    }
  );
}
