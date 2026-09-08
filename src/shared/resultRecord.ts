import * as z from "zod/v4";
import { CATEGORIES, EVALUATION_SOURCES, SERVER_KINDS, VARIANTS } from "./types.js";
import { EMPTY_MEASUREMENT_V2, MEASUREMENT_V2_COLUMNS, measurementV2Fields } from "./measurementV2.js";

export const stageLatenciesSchema = z.object({
  llmFirstResponseMs: z.number().nullable(),
  toolExecutionMs: z.number().nullable(),
  llmFinalResponseMs: z.number().nullable()
});
export type StageLatencies = z.infer<typeof stageLatenciesSchema>;

export const tokenUsageSchema = z.object({
  promptTokens: z.number().nullable(),
  outputTokens: z.number().nullable(),
  totalTokens: z.number().nullable()
});
export type TokenUsage = z.infer<typeof tokenUsageSchema>;

export const resultMetadataSchema = z.object({
  model: z.string().nullable(),
  serverVersion: z.string().nullable(),
  sdkVersion: z.string().nullable(),
  repoCommit: z.string().nullable(),
  os: z.string().nullable()
});
export type ResultMetadata = z.infer<typeof resultMetadataSchema>;

export const resultRecordSchema = z.object({
  ...measurementV2Fields,
  runId: z.string().min(1),
  scenarioId: z.string().min(1),
  scenarioName: z.string().nullable(),
  category: z.enum(CATEGORIES),
  serverKind: z.enum(SERVER_KINDS).nullable(),
  serverName: z.string().nullable(),
  variant: z.enum(VARIANTS),
  iteration: z.number().int().positive(),
  prompt: z.string().nullable(),
  latencyMs: z.number().nullable(),
  stageLatencies: stageLatenciesSchema.nullable(),
  success: z.boolean(),
  errorCode: z.string().nullable(),
  errorMessage: z.string().nullable(),
  toolCallRequested: z.boolean().nullable(),
  toolCallSuccess: z.boolean().nullable(),
  toolName: z.string().nullable(),
  toolArguments: z.record(z.string(), z.unknown()).nullable(),
  numberOfToolCalls: z.number().int().nullable(),
  unnecessaryToolCalls: z.number().int().nullable(),
  retryCount: z.number().int().nullable(),
  resultCount: z.number().int().nullable(),
  resultShapeCorrect: z.boolean().nullable(),
  argumentCorrectness: z.number().min(0).max(1).nullable(),
  toolSelectionCorrect: z.boolean().nullable(),
  finalAnswerValidJson: z.boolean().nullable(),
  finalAnswerCorrect: z.union([z.boolean(), z.number().min(0).max(1)]).nullable(),
  resultIntegrationScore: z.number().min(0).max(1).nullable(),
  tokenUsage: tokenUsageSchema.nullable(),
  deterministic: z.boolean(),
  timestamp: z.string().nullable(),
  metadata: resultMetadataSchema,
  evaluationSource: z.enum(EVALUATION_SOURCES),
  externalScores: z.record(z.string(), z.number()).nullable(),
  externalLabels: z.record(z.string(), z.string()).nullable()
});
export type ResultRecord = z.infer<typeof resultRecordSchema>;

export const runManifestSchema = z.object({
  campaignId: z.string().nullable().default(null),
  phase: z.enum(["pilot", "final", "test"]).nullable().default(null),
  status: z.enum(["running", "completed", "interrupted"]).default("completed"),
  provenance: z.record(z.string(), z.unknown()).nullable().default(null),
  runId: z.string().min(1),
  createdAt: z.string(),
  model: z.string().nullable(),
  serverVersions: z.record(z.string(), z.string()),
  sdkVersion: z.string().nullable(),
  repoCommit: z.string().nullable(),
  seed: z.number().nullable(),
  os: z.string().nullable(),
  notes: z.string().nullable()
});
export type RunManifest = z.infer<typeof runManifestSchema>;

export type ResultRecordCore = {
  runId: string;
  scenarioId: string;
  category: ResultRecord["category"];
  variant: ResultRecord["variant"];
  iteration: number;
  success: boolean;
  deterministic: boolean;
  evaluationSource: ResultRecord["evaluationSource"];
};

const NULL_METADATA: ResultMetadata = {
  model: null,
  serverVersion: null,
  sdkVersion: null,
  repoCommit: null,
  os: null
};

export function makeResultRecord(
  core: ResultRecordCore,
  overrides: Partial<ResultRecord> = {}
): ResultRecord {
  const base: ResultRecord = {
    ...EMPTY_MEASUREMENT_V2,
    runId: core.runId,
    scenarioId: core.scenarioId,
    scenarioName: null,
    category: core.category,
    serverKind: null,
    serverName: null,
    variant: core.variant,
    iteration: core.iteration,
    prompt: null,
    latencyMs: null,
    stageLatencies: null,
    success: core.success,
    errorCode: null,
    errorMessage: null,
    toolCallRequested: null,
    toolCallSuccess: null,
    toolName: null,
    toolArguments: null,
    numberOfToolCalls: null,
    unnecessaryToolCalls: null,
    retryCount: null,
    resultCount: null,
    resultShapeCorrect: null,
    argumentCorrectness: null,
    toolSelectionCorrect: null,
    finalAnswerValidJson: null,
    finalAnswerCorrect: null,
    resultIntegrationScore: null,
    tokenUsage: null,
    deterministic: core.deterministic,
    timestamp: null,
    metadata: { ...NULL_METADATA },
    evaluationSource: core.evaluationSource,
    externalScores: null,
    externalLabels: null
  };

  for (const [key, value] of Object.entries(overrides)) {
    if (value !== undefined) {
      (base as Record<string, unknown>)[key] = value;
    }
  }
  return base;
}

export const NORMALIZED_COLUMNS = [
  ...MEASUREMENT_V2_COLUMNS,
  "runId",
  "scenarioId",
  "scenarioName",
  "category",
  "serverKind",
  "serverName",
  "variant",
  "iteration",
  "latencyMs",
  "success",
  "errorCode",
  "promptTokens",
  "outputTokens",
  "totalTokens",
  "toolCallRequested",
  "toolCallSuccess",
  "toolName",
  "numberOfToolCalls",
  "unnecessaryToolCalls",
  "retryCount",
  "resultCount",
  "resultShapeCorrect",
  "toolSelectionCorrect",
  "argumentCorrectness",
  "finalAnswerValidJson",
  "finalAnswerCorrect",
  "resultIntegrationScore",
  "deterministic",
  "model",
  "serverVersion",
  "sdkVersion",
  "repoCommit",
  "os",
  "evaluationSource",
  "externalScores",
  "externalLabels",
  "timestamp"
] as const;
export type NormalizedColumn = (typeof NORMALIZED_COLUMNS)[number];

type FlatValue = string | number | boolean | null;

export function flattenRecord(record: ResultRecord): Record<NormalizedColumn, FlatValue> {
  const finalAnswerCorrect: FlatValue =
    typeof record.finalAnswerCorrect === "boolean"
      ? record.finalAnswerCorrect
      : record.finalAnswerCorrect;

  return {
    ...Object.fromEntries(MEASUREMENT_V2_COLUMNS.map(key => [key, record[key] ?? null])) as typeof EMPTY_MEASUREMENT_V2,
    runId: record.runId,
    scenarioId: record.scenarioId,
    scenarioName: record.scenarioName,
    category: record.category,
    serverKind: record.serverKind,
    serverName: record.serverName,
    variant: record.variant,
    iteration: record.iteration,
    latencyMs: record.latencyMs,
    success: record.success,
    errorCode: record.errorCode,
    promptTokens: record.tokenUsage?.promptTokens ?? null,
    outputTokens: record.tokenUsage?.outputTokens ?? null,
    totalTokens: record.tokenUsage?.totalTokens ?? null,
    toolCallRequested: record.toolCallRequested,
    toolCallSuccess: record.toolCallSuccess,
    toolName: record.toolName,
    numberOfToolCalls: record.numberOfToolCalls,
    unnecessaryToolCalls: record.unnecessaryToolCalls,
    retryCount: record.retryCount,
    resultCount: record.resultCount,
    resultShapeCorrect: record.resultShapeCorrect,
    toolSelectionCorrect: record.toolSelectionCorrect,
    argumentCorrectness: record.argumentCorrectness,
    finalAnswerValidJson: record.finalAnswerValidJson,
    finalAnswerCorrect,
    resultIntegrationScore: record.resultIntegrationScore,
    deterministic: record.deterministic,
    model: record.metadata.model,
    serverVersion: record.metadata.serverVersion,
    sdkVersion: record.metadata.sdkVersion,
    repoCommit: record.metadata.repoCommit,
    os: record.metadata.os,
    evaluationSource: record.evaluationSource,
    externalScores: record.externalScores ? JSON.stringify(record.externalScores) : null,
    externalLabels: record.externalLabels ? JSON.stringify(record.externalLabels) : null,
    timestamp: record.timestamp
  };
}

function csvEscape(value: FlatValue): string {
  if (value === null) {
    return "";
  }
  const text = String(value);
  if (text.includes(",") || text.includes("\"") || text.includes("\n")) {
    return `"${text.replaceAll("\"", "\"\"")}"`;
  }
  return text;
}

export function recordsToCsv(records: ResultRecord[]): string {
  const rows = records.map((record) => {
    const flat = flattenRecord(record);
    return NORMALIZED_COLUMNS.map((column) => csvEscape(flat[column])).join(",");
  });
  return [NORMALIZED_COLUMNS.join(","), ...rows].join("\n");
}
