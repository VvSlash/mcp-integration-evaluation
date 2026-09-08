import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  collectRecords,
  extractRunId,
  mapLegacyScenarioId,
  mapLegacyVariant,
  runNormalize,
  type NormalizeResult
} from "../../src/evaluation/normalize.js";

const fixturesRaw = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "__fixtures__",
  "normalize",
  "raw"
);

describe("mapowania legacy", () => {
  it("mapuje ID scenariuszy PG-00x na SQL-00x, inne zostawia bez zmian", () => {
    expect(mapLegacyScenarioId("PG-001")).toBe("SQL-001");
    expect(mapLegacyScenarioId("PG-004")).toBe("SQL-004");
    expect(mapLegacyScenarioId("SQL-005")).toBe("SQL-005");
    expect(mapLegacyScenarioId("JSON-001")).toBe("JSON-001");
  });

  it("mapuje warianty legacy na kanoniczne", () => {
    expect(mapLegacyVariant("baseline")?.variant).toBe("baseline");
    expect(mapLegacyVariant("mcp")?.serverName).toBe("sql-controlled");
    expect(mapLegacyVariant("mcp-llm")?.variant).toBe("mcp_llm");
    expect(mapLegacyVariant("mcp-llm-sql")?.serverName).toBe("sql-minimal");
    expect(mapLegacyVariant("llm-only")?.variant).toBe("llm_only");
    expect(mapLegacyVariant("nieznany")).toBeNull();
  });

  it("wyciaga runId z nazwy pliku legacy", () => {
    expect(extractRunId("postgres-baseline-measurements-2026-05-04T00-00-00-000Z.json"))
      .toBe("2026-05-04T00-00-00-000Z");
  });
});

describe("collectRecords (probka results/raw/)", () => {
  let result: NormalizeResult;

  beforeAll(async () => {
    result = await collectRecords(fixturesRaw);
  });

  it("scala wszystkie klasy zrodel: legacy + wlasne + zewnetrzne", () => {
    expect(result.counts.legacy).toBe(4);
    expect(result.counts.own).toBe(1);
    expect(result.counts.external).toBe(4);
    expect(result.records).toHaveLength(9);
  });

  it("rekordy legacy maja zmapowane ID i warianty oraz evaluationSource=legacy", () => {
    const legacyRecords = result.records.filter((record) => record.evaluationSource === "legacy");
    expect(legacyRecords.every((record) => record.scenarioId.startsWith("SQL-"))).toBe(true);

    const minimal = legacyRecords.find((record) => record.serverName === "sql-minimal");
    expect(minimal?.variant).toBe("mcp_llm");
    expect(minimal?.tokenUsage?.totalTokens).toBe(1816);
    expect(minimal?.toolName).toBe("execute_read_query");

    const llmOnly = legacyRecords.find((record) => record.variant === "llm_only");
    expect(llmOnly?.tokenUsage?.promptTokens).toBe(308);
    expect(llmOnly?.tokenUsage?.outputTokens).toBe(194);
    expect(llmOnly?.deterministic).toBe(false);
  });

  it("waliduje format wlasny schematem rekordu pomiaru", () => {
    const own = result.records.filter((record) => record.evaluationSource === "own");
    expect(own).toHaveLength(1);
    expect(own[0]?.toolName).toBe("pg_search_orders");
    expect(own[0]?.metadata.sdkVersion).toBe("2.0.0-alpha.2");
  });

  it("importuje results.jsonl z mcp-gating-eval (tokeny, accuracy, tryb w externalLabels)", () => {
    const gating = result.records.filter((record) => record.evaluationSource === "mcp-gating-eval");
    expect(gating).toHaveLength(2);

    const full = gating.find((record) => record.externalLabels?.["mode"] === "full");
    expect(full?.tokenUsage?.promptTokens).toBe(2100);
    expect(full?.tokenUsage?.totalTokens).toBe(2250);
    expect(full?.success).toBe(true);
    expect(full?.externalScores?.["accuracy"]).toBe(1.0);
    expect(full?.metadata.model).toBe("ollama/qwen3.5");

    const toggle = gating.find((record) => record.externalLabels?.["mode"] === "toggle");
    expect(toggle?.success).toBe(false);
    expect(toggle?.externalLabels?.["toggle_abuse"]).toBe("true");
  });

  it("importuje generyczny format *.external.json (deepeval) z defaults", () => {
    const deepeval = result.records.filter((record) => record.evaluationSource === "deepeval");
    expect(deepeval).toHaveLength(2);

    const first = deepeval.find((record) => record.iteration === 1);
    expect(first?.scenarioId).toBe("SQL-001");
    expect(first?.serverName).toBe("sql-controlled");
    expect(first?.externalScores?.["toolCorrectness"]).toBe(1.0);
    expect(first?.metadata.model).toBe("qwen3.5:latest");

    const second = deepeval.find((record) => record.iteration === 2);
    expect(second?.scenarioId).toBe("EXT-2");
    expect(second?.success).toBe(false);
  });

  it("nie zglasza ostrzezen dla poprawnej probki", () => {
    expect(result.warnings).toHaveLength(0);
  });
});

describe("runNormalize (zapis wynikow)", () => {
  let outDir: string;

  beforeAll(async () => {
    outDir = await mkdtemp(path.join(os.tmpdir(), "normalize-test-"));
  });

  afterAll(async () => {
    await rm(outDir, { recursive: true, force: true });
  });

  it("zapisuje measurements.csv, measurements.json i raport normalizacji", async () => {
    const result = await runNormalize({ rawDir: fixturesRaw, outDir });
    expect(result.records).toHaveLength(9);

    const csv = await readFile(path.join(outDir, "measurements.csv"), "utf8");
    const lines = csv.split("\n");
    expect(lines).toHaveLength(10);
    expect(lines[0]).toContain("runId,scenarioId");
    expect(lines[0]).toContain("evaluationSource");

    const json = JSON.parse(await readFile(path.join(outDir, "measurements.json"), "utf8")) as unknown[];
    expect(json).toHaveLength(9);

    const report = JSON.parse(await readFile(path.join(outDir, "normalize-report.json"), "utf8")) as {
      counts: { legacy: number };
    };
    expect(report.counts.legacy).toBe(4);
  });
});
