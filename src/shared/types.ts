
export const VARIANTS = [
  "baseline",
  "mcp",
  "mcp_llm",
  "third_party_mcp_llm",
  "llm_only"
] as const;
export type Variant = (typeof VARIANTS)[number];

export const CATEGORIES = [
  "sql",
  "json",
  "excel",
  "blender",
  "websearch",
  "rest",
  "cross",
  "usability"
] as const;
export type Category = (typeof CATEGORIES)[number];

export const SERVER_KINDS = ["own", "third_party"] as const;
export type ServerKind = (typeof SERVER_KINDS)[number];

export const EVALUATION_SOURCES = [
  "own",
  "legacy",
  "deepeval",
  "mcpevals-lastmile",
  "mcp-evals-node",
  "mcpbench",
  "mcp-gating-eval",
  "mcpmark",
  "mcp-interviewer",
  "external"
] as const;
export type EvaluationSource = (typeof EVALUATION_SOURCES)[number];

export const KNOWN_METRICS = [
  "latencyMs",
  "successRate",
  "errorRate",
  "tokenUsage",
  "toolSelectionAccuracy",
  "argumentCorrectness",
  "resultShapeCorrectness",
  "finalAnswerValidJson",
  "finalAnswerCorrectness",
  "resultIntegrationScore",
  "numberOfToolCalls",
  "unnecessaryToolCalls",
  "retryCount",
  "timeoutCount"
] as const;
export type KnownMetric = (typeof KNOWN_METRICS)[number];

export const PROPOSED_METRICS = [
  "passAtK",
  "passHatK",
  "avgAtK",
  "turnsCount",
  "toggleAbuseCount",
  "toolCatalogTokenCost",
  "constraintViolationsCount",
  "pathEfficiencyScore",
  "backtrackingCount",
  "costPerInteraction",
  "judgeCompleteness",
  "judgeRelevance",
  "judgeClarity",
  "judgeReasoning",
  "resourceReadCount",
  "timeToFirstTokenMs"
] as const;
export type ProposedMetric = (typeof PROPOSED_METRICS)[number];

export const KNOWN_ERROR_CODES = [
  "POSTGRES_HEALTH_CHECK_FAILED",
  "POSTGRES_SEARCH_ORDERS_FAILED",
  "POSTGRES_QUERY_FAILED",
  "BASELINE_POSTGRES_QUERY_FAILED",
  "SQL_SYNTAX_ERROR",
  "SQL_SEMANTIC_ERROR",
  "TOOL_ERROR",
  "TOOL_NOT_FOUND",
  "TOOL_TIMEOUT",
  "LLM_NO_TOOL_CALL",
  "LLM_INVALID_JSON",
  "EMPTY_FINAL_LLM_RESPONSE",
  "MCP_TRANSPORT_ERROR"
] as const;
export type KnownErrorCode = (typeof KNOWN_ERROR_CODES)[number];
