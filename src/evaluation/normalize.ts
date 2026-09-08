import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  adaptLegacyMeasurement,
  adaptTokenComparisonEntry,
  asObject,
  bool,
  extractRunId,
  mapLegacyScenarioId,
  mapLegacyVariant,
  num,
  pickNumber,
  pickString,
  str
} from "../shared/legacyMapping.js";
import {
  makeResultRecord,
  recordsToCsv,
  resultRecordSchema,
  type ResultRecord,
  type TokenUsage
} from "../shared/resultRecord.js";
import { EVALUATION_SOURCES, type Category, type EvaluationSource, type Variant } from "../shared/types.js";

export { extractRunId, mapLegacyScenarioId, mapLegacyVariant };

export type NormalizeWarning = { file: string; message: string };

export type NormalizeResult = {
  records: ResultRecord[];
  warnings: NormalizeWarning[];
  counts: {
    own: number;
    legacy: number;
    external: number;
    skippedFiles: number;
  };
};

export type NormalizeOptions = {
  campaign?: string;
  rawDir: string;
  outDir: string;
};

const JSONL_MAPPED_KEYS = new Set([
  "scenario_id", "scenarioId", "task_id", "task", "id", "name",
  "mode", "exposure", "exposure_mode", "model",
  "latency_ms", "latencyMs", "latency", "duration_ms",
  "prompt_tokens", "tokens_in", "input_tokens", "promptTokens",
  "completion_tokens", "tokens_out", "output_tokens", "outputTokens",
  "total_tokens", "tokens_total", "totalTokens",
  "accuracy", "score", "correct", "success",
  "tool_calls", "num_tool_calls", "toolCalls",
  "tool_selection_correct", "toolSelectionCorrect",
  "iteration", "run", "trial"
]);

function adaptExternalJsonlLine(
  raw: unknown,
  runId: string,
  lineNumber: number,
  source: EvaluationSource
): ResultRecord | null {
  const obj = asObject(raw);
  if (!obj) {
    return null;
  }

  const promptTokens = pickNumber(obj, ["prompt_tokens", "tokens_in", "input_tokens", "promptTokens"]);
  const outputTokens = pickNumber(obj, ["completion_tokens", "tokens_out", "output_tokens", "outputTokens"]);
  let totalTokens = pickNumber(obj, ["total_tokens", "tokens_total", "totalTokens"]);
  if (totalTokens === null && promptTokens !== null && outputTokens !== null) {
    totalTokens = promptTokens + outputTokens;
  }
  const tokenUsage: TokenUsage | null =
    promptTokens !== null || outputTokens !== null || totalTokens !== null
      ? { promptTokens, outputTokens, totalTokens }
      : null;

  const accuracy = pickNumber(obj, ["accuracy", "score"]);
  const success = bool(obj["success"]) ?? bool(obj["correct"]) ?? (accuracy !== null ? accuracy >= 0.5 : false);

  const externalScores: Record<string, number> = {};
  const externalLabels: Record<string, string> = {};
  if (accuracy !== null) {
    externalScores["accuracy"] = accuracy;
  }
  for (const [key, value] of Object.entries(obj)) {
    if (JSONL_MAPPED_KEYS.has(key)) {
      continue;
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      externalScores[key] = value;
    } else if (typeof value === "string" && value.length <= 200) {
      externalLabels[key] = value;
    } else if (typeof value === "boolean") {
      externalLabels[key] = String(value);
    }
  }
  const mode = pickString(obj, ["mode", "exposure", "exposure_mode"]);
  if (mode) {
    externalLabels["mode"] = mode;
  }

  return makeResultRecord(
    {
      runId,
      scenarioId:
        pickString(obj, ["scenario_id", "scenarioId", "task_id", "task", "id", "name"]) ??
        `EXT-${lineNumber}`,
      category: "cross",
      variant: "mcp_llm",
      iteration: pickNumber(obj, ["iteration", "run", "trial"]) ?? lineNumber,
      success,
      deterministic: false,
      evaluationSource: source
    },
    {
      latencyMs: pickNumber(obj, ["latency_ms", "latencyMs", "duration_ms", "latency"]),
      tokenUsage,
      numberOfToolCalls: pickNumber(obj, ["tool_calls", "num_tool_calls", "toolCalls"]),
      toolSelectionCorrect: bool(obj["tool_selection_correct"]) ?? bool(obj["toolSelectionCorrect"]),
      metadata: {
        model: pickString(obj, ["model"]),
        serverVersion: null,
        sdkVersion: null,
        repoCommit: null,
        os: null
      },
      externalScores: Object.keys(externalScores).length > 0 ? externalScores : null,
      externalLabels: Object.keys(externalLabels).length > 0 ? externalLabels : null
    }
  );
}

function isEvaluationSource(value: string): value is EvaluationSource {
  return (EVALUATION_SOURCES as readonly string[]).includes(value);
}

const VALID_CATEGORIES = new Set(["sql", "json", "excel", "blender", "websearch", "rest", "cross", "usability"]);
const VALID_VARIANTS = new Set(["baseline", "mcp", "mcp_llm", "third_party_mcp_llm", "llm_only"]);

function adaptExternalImportFile(
  raw: unknown,
  runId: string,
  warnings: NormalizeWarning[],
  file: string
): ResultRecord[] {
  const obj = asObject(raw);
  if (!obj || !Array.isArray(obj["records"])) {
    warnings.push({ file, message: "Nieprawidlowy format *.external.json (wymagane pola: framework, records[])." });
    return [];
  }
  const frameworkName = str(obj["framework"]) ?? "external";
  const source: EvaluationSource = isEvaluationSource(frameworkName) ? frameworkName : "external";
  const defaults = asObject(obj["defaults"]) ?? {};

  const records: ResultRecord[] = [];
  (obj["records"] as unknown[]).forEach((entry, index) => {
    const rec = asObject(entry);
    if (!rec) {
      warnings.push({ file, message: `records[${index}]: pominieto (nie jest obiektem).` });
      return;
    }
    const merged: Record<string, unknown> = { ...defaults, ...rec };

    const category = str(merged["category"]);
    const variant = str(merged["variant"]);
    if (!category || !VALID_CATEGORIES.has(category) || !variant || !VALID_VARIANTS.has(variant)) {
      warnings.push({
        file,
        message: `records[${index}]: pominieto — brak poprawnych pol category/variant (w rekordzie lub defaults).`
      });
      return;
    }

    const tokenUsageRaw = asObject(merged["tokenUsage"]);
    const tokenUsage: TokenUsage | null = tokenUsageRaw
      ? {
          promptTokens: pickNumber(tokenUsageRaw, ["promptTokens"]),
          outputTokens: pickNumber(tokenUsageRaw, ["outputTokens"]),
          totalTokens: pickNumber(tokenUsageRaw, ["totalTokens"])
        }
      : null;

    const scoresRaw = asObject(merged["scores"]);
    const externalScores: Record<string, number> = {};
    if (scoresRaw) {
      for (const [key, value] of Object.entries(scoresRaw)) {
        const numeric = num(value);
        if (numeric !== null) {
          externalScores[key] = numeric;
        }
      }
    }
    const labelsRaw = asObject(merged["labels"]);
    const externalLabels: Record<string, string> = {};
    if (labelsRaw) {
      for (const [key, value] of Object.entries(labelsRaw)) {
        const text = str(value);
        if (text !== null) {
          externalLabels[key] = text;
        }
      }
    }
    if (source === "external") {
      externalLabels["framework"] = frameworkName;
    }

    const serverKindRaw = str(merged["serverKind"]);
    records.push(
      makeResultRecord(
        {
          runId: str(merged["runId"]) ?? runId,
          scenarioId: str(merged["scenarioId"]) ?? `EXT-${index + 1}`,
          category: category as Category,
          variant: variant as Variant,
          iteration: num(merged["iteration"]) ?? index + 1,
          success: bool(merged["success"]) ?? false,
          deterministic: bool(merged["deterministic"]) ?? false,
          evaluationSource: source
        },
        {
          scenarioName: str(merged["scenarioName"]),
          serverKind: serverKindRaw === "own" || serverKindRaw === "third_party" ? serverKindRaw : null,
          serverName: str(merged["serverName"]),
          prompt: str(merged["prompt"]),
          latencyMs: num(merged["latencyMs"]),
          errorCode: str(merged["errorCode"]),
          errorMessage: str(merged["errorMessage"]),
          toolCallRequested: bool(merged["toolCallRequested"]),
          toolCallSuccess: bool(merged["toolCallSuccess"]),
          toolName: str(merged["toolName"]),
          numberOfToolCalls: num(merged["numberOfToolCalls"]),
          resultCount: num(merged["resultCount"]),
          argumentCorrectness: num(merged["argumentCorrectness"]),
          toolSelectionCorrect: bool(merged["toolSelectionCorrect"]),
          finalAnswerValidJson: bool(merged["finalAnswerValidJson"]),
          finalAnswerCorrect: bool(merged["finalAnswerCorrect"]) ?? num(merged["finalAnswerCorrect"]),
          resultIntegrationScore: num(merged["resultIntegrationScore"]),
          tokenUsage,
          timestamp: str(merged["timestamp"]),
          metadata: {
            model: str(merged["model"]),
            serverVersion: str(merged["serverVersion"]),
            sdkVersion: null,
            repoCommit: null,
            os: null
          },
          externalScores: Object.keys(externalScores).length > 0 ? externalScores : null,
          externalLabels: Object.keys(externalLabels).length > 0 ? externalLabels : null
        }
      )
    );
  });
  return records;
}

async function readJson(filePath: string): Promise<unknown> {
  return JSON.parse(await readFile(filePath, "utf8")) as unknown;
}

async function listDir(dir: string): Promise<import("node:fs").Dirent[]> {
  try {
    return await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

function isLegacyMeasurementsFile(name: string): boolean {
  return name.endsWith(".json") && name.includes("-measurements-");
}

function isTokenComparisonFile(name: string): boolean {
  return name.endsWith(".json") && name.includes("token-comparison");
}

async function collectLegacyShapeFile(
  filePath: string,
  source: EvaluationSource,
  result: NormalizeResult
): Promise<void> {
  const name = path.basename(filePath);
  const runId = extractRunId(name);
  let parsed: unknown;
  try {
    parsed = await readJson(filePath);
  } catch (error) {
    result.warnings.push({ file: filePath, message: `Nieparsowalny JSON: ${(error as Error).message}` });
    result.counts.skippedFiles += 1;
    return;
  }

  if (isTokenComparisonFile(name)) {
    const entries = Array.isArray(parsed) ? parsed : [parsed];
    entries.forEach((entry, index) => {
      const record = adaptTokenComparisonEntry(entry, runId, index + 1, source);
      if (record) {
        result.records.push(record);
        if (source === "legacy") { result.counts.legacy += 1; } else { result.counts.own += 1; }
      } else {
        result.warnings.push({
          file: filePath,
          message: `Wpis ${index}: brak sekcji llmOnly lub scenarioId (starszy format token-comparison) — pominieto; dane pozostaja w raw.`
        });
      }
    });
    return;
  }

  const entries = Array.isArray(parsed) ? parsed : [parsed];
  entries.forEach((entry, index) => {
    const record = adaptLegacyMeasurement(entry, runId, source);
    if (record) {
      result.records.push(record);
      if (source === "legacy") { result.counts.legacy += 1; } else { result.counts.own += 1; }
    } else {
      result.warnings.push({ file: filePath, message: `Wpis ${index}: nieznany wariant lub brak scenarioId — pominieto.` });
    }
  });
}

async function collectOwnRunDir(dirPath: string, result: NormalizeResult): Promise<void> {
  const measurementsPath = path.join(dirPath, "measurements.json");
  let parsed: unknown;
  try {
    parsed = await readJson(measurementsPath);
  } catch (error) {
    result.warnings.push({ file: measurementsPath, message: `Nieparsowalny JSON: ${(error as Error).message}` });
    result.counts.skippedFiles += 1;
    return;
  }
  const entries = Array.isArray(parsed) ? parsed : [parsed];
  entries.forEach((entry, index) => {
    const validated = resultRecordSchema.safeParse(entry);
    if (validated.success) {
      result.records.push(validated.data);
      result.counts.own += 1;
    } else {
      result.warnings.push({
        file: measurementsPath,
        message: `Rekord ${index} niezgodny ze schematem rekordu pomiaru: ${validated.error.issues[0]?.message ?? "blad walidacji"}`
      });
    }
  });
}

async function collectExternalDir(externalDir: string, result: NormalizeResult): Promise<void> {
  for (const frameworkEntry of await listDir(externalDir)) {
    if (!frameworkEntry.isDirectory()) {
      continue;
    }
    const frameworkName = frameworkEntry.name;
    const source: EvaluationSource = isEvaluationSource(frameworkName) ? frameworkName : "external";
    const frameworkDir = path.join(externalDir, frameworkName);

    for (const fileEntry of await listDir(frameworkDir)) {
      if (!fileEntry.isFile()) {
        continue;
      }
      const filePath = path.join(frameworkDir, fileEntry.name);
      const runId = `${frameworkName}-${extractRunId(fileEntry.name)}`;

      if (fileEntry.name.endsWith(".jsonl")) {
        const content = await readFile(filePath, "utf8");
        content.split(/\r?\n/).forEach((line, index) => {
          const trimmed = line.trim();
          if (trimmed === "") {
            return;
          }
          let parsed: unknown;
          try {
            parsed = JSON.parse(trimmed);
          } catch {
            result.warnings.push({ file: filePath, message: `Linia ${index + 1}: nieparsowalny JSON — pominieto.` });
            return;
          }
          const record = adaptExternalJsonlLine(parsed, runId, index + 1, source);
          if (record) {
            result.records.push(record);
            result.counts.external += 1;
          }
        });
      } else if (fileEntry.name.endsWith(".external.json")) {
        let parsed: unknown;
        try {
          parsed = await readJson(filePath);
        } catch (error) {
          result.warnings.push({ file: filePath, message: `Nieparsowalny JSON: ${(error as Error).message}` });
          result.counts.skippedFiles += 1;
          continue;
        }
        const records = adaptExternalImportFile(parsed, runId, result.warnings, filePath);
        result.records.push(...records);
        result.counts.external += records.length;
      } else if (fileEntry.name.endsWith(".json")) {
        result.warnings.push({
          file: filePath,
          message: "Surowy plik frameworka bez adaptera — przeksztalc do formatu *.external.json (docs/methodology/results-format.md)."
        });
        result.counts.skippedFiles += 1;
      }
    }
  }
}

export async function collectRecords(rawDir: string, campaign?: string): Promise<NormalizeResult> {
  const result: NormalizeResult = {
    records: [],
    warnings: [],
    counts: { own: 0, legacy: 0, external: 0, skippedFiles: 0 }
  };

  for (const entry of await listDir(rawDir)) {
    const entryPath = path.join(rawDir, entry.name);

    if (campaign) {
      if (!entry.isDirectory()) continue;
      const manifest = await readFile(path.join(entryPath,"manifest.json"),"utf8").then(JSON.parse,()=>null);
      if (manifest?.campaignId !== campaign) continue;
      await collectOwnRunDir(entryPath,result);
      continue;
    }

    if (entry.isFile()) {
      if (isLegacyMeasurementsFile(entry.name) || isTokenComparisonFile(entry.name)) {
        await collectLegacyShapeFile(entryPath, "own", result);
      } else if (entry.name.endsWith(".json")) {
        result.counts.skippedFiles += 1;
      }
      continue;
    }

    if (!entry.isDirectory()) {
      continue;
    }
    if (entry.name === "legacy") {
      for (const legacyEntry of await listDir(entryPath)) {
        if (!legacyEntry.isFile()) {
          continue;
        }
        if (isLegacyMeasurementsFile(legacyEntry.name) || isTokenComparisonFile(legacyEntry.name)) {
          await collectLegacyShapeFile(path.join(entryPath, legacyEntry.name), "legacy", result);
        } else if (legacyEntry.name.endsWith(".json") || legacyEntry.name.endsWith(".csv")) {
          result.counts.skippedFiles += 1;
        }
      }
    } else if (entry.name === "external") {
      await collectExternalDir(entryPath, result);
    } else {
      const hasMeasurements = (await listDir(entryPath)).some(
        (child) => child.isFile() && child.name === "measurements.json"
      );
      if (hasMeasurements) {
        await collectOwnRunDir(entryPath, result);
      }
    }
  }

  result.records.sort((a, b) =>
    a.runId.localeCompare(b.runId) ||
    a.scenarioId.localeCompare(b.scenarioId) ||
    a.variant.localeCompare(b.variant) ||
    a.evaluationSource.localeCompare(b.evaluationSource) ||
    a.iteration - b.iteration
  );
  return result;
}

export async function runNormalize(options: NormalizeOptions): Promise<NormalizeResult> {
  const result = await collectRecords(options.rawDir, options.campaign);
  await mkdir(options.outDir, { recursive: true });

  await writeFile(path.join(options.outDir, "measurements.csv"), recordsToCsv(result.records), "utf8");
  await writeFile(
    path.join(options.outDir, "measurements.json"),
    JSON.stringify(result.records, null, 2),
    "utf8"
  );
  await writeFile(
    path.join(options.outDir, "normalize-report.json"),
    JSON.stringify({ generatedAt: new Date().toISOString(), counts: result.counts, warnings: result.warnings }, null, 2),
    "utf8"
  );
  return result;
}

function parseCliOptions(argv: string[]): NormalizeOptions {
  const options: NormalizeOptions = { rawDir: "results/raw", outDir: "results/normalized" };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--campaign" && argv[index + 1]) {
      options.campaign=argv[++index]!;
      if (!/^[a-zA-Z0-9_-]+$/.test(options.campaign)) throw new Error("Invalid campaign ID");
      if (!argv.includes("--out")) options.outDir=path.join("results/normalized",options.campaign);
    } else if (argv[index] === "--raw" && argv[index + 1]) {
      options.rawDir = argv[index + 1] as string;
      index += 1;
    } else if (argv[index] === "--out" && argv[index + 1]) {
      options.outDir = argv[index + 1] as string;
      index += 1;
    }
  }
  return options;
}

const entryPoint = process.argv[1];
if (entryPoint && import.meta.url === pathToFileURL(path.resolve(entryPoint)).href) {
  runNormalize(parseCliOptions(process.argv.slice(2)))
    .then((result) => {
      console.log(JSON.stringify({ counts: result.counts, warningCount: result.warnings.length, output: "results/normalized/" }, null, 2));
      if (result.warnings.length > 0) {
        console.warn(`Ostrzezenia (${result.warnings.length}) — szczegoly w results/normalized/normalize-report.json`);
      }
    })
    .catch((error) => {
      console.error("Normalizacja nie powiodla sie:", error);
      process.exit(1);
    });
}
