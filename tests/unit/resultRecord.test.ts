import { describe, expect, it } from "vitest";
import {
  NORMALIZED_COLUMNS,
  flattenRecord,
  makeResultRecord,
  recordsToCsv,
  resultRecordSchema
} from "../../src/shared/resultRecord.js";

const core = {
  runId: "2026-07-07T00-00-00-000Z",
  scenarioId: "SQL-001",
  category: "sql",
  variant: "mcp_llm",
  iteration: 1,
  success: true,
  deterministic: false,
  evaluationSource: "own"
} as const;

describe("makeResultRecord", () => {
  it("buduje rekord ze stalym schematem — pola nieaplikowalne maja null, kluczy nie brakuje", () => {
    const record = makeResultRecord(core);
    const parsed = resultRecordSchema.safeParse(record);
    expect(parsed.success).toBe(true);
    expect(record.latencyMs).toBeNull();
    expect(record.tokenUsage).toBeNull();
    expect(record.metadata).toEqual({
      model: null,
      serverVersion: null,
      sdkVersion: null,
      repoCommit: null,
      os: null
    });
  });

  it("ignoruje nadpisania o wartosci undefined (nie psuja stalego schematu)", () => {
    const record = makeResultRecord(core, { latencyMs: undefined, errorCode: "TOOL_TIMEOUT" });
    expect(record.latencyMs).toBeNull();
    expect(record.errorCode).toBe("TOOL_TIMEOUT");
    expect(resultRecordSchema.safeParse(record).success).toBe(true);
  });

  it("odrzuca rekord z niepoprawnym wariantem lub kategoria", () => {
    const record = makeResultRecord(core);
    expect(resultRecordSchema.safeParse({ ...record, variant: "nope" }).success).toBe(false);
    expect(resultRecordSchema.safeParse({ ...record, category: "nope" }).success).toBe(false);
  });
});

describe("flattenRecord / recordsToCsv", () => {
  it("splaszcza tokenUsage i metadata do kolumn", () => {
    const record = makeResultRecord(core, {
      tokenUsage: { promptTokens: 100, outputTokens: 40, totalTokens: 140 },
      metadata: { model: "qwen3.5:latest", serverVersion: "own@abc", sdkVersion: "2.0.0-alpha.2", repoCommit: "abc", os: "windows" }
    });
    const flat = flattenRecord(record);
    expect(flat.promptTokens).toBe(100);
    expect(flat.totalTokens).toBe(140);
    expect(flat.model).toBe("qwen3.5:latest");
  });

  it("serializuje externalScores/externalLabels jako JSON w jednej kolumnie", () => {
    const record = makeResultRecord(core, {
      externalScores: { accuracy: 0.9 },
      externalLabels: { mode: "full" }
    });
    const flat = flattenRecord(record);
    expect(flat.externalScores).toBe("{\"accuracy\":0.9}");
    expect(flat.externalLabels).toBe("{\"mode\":\"full\"}");
  });

  it("CSV ma stala liste kolumn (15.3 + rozszerzenia addytywne) i escapuje przecinki/cudzyslowy", () => {
    const record = makeResultRecord(core, { scenarioName: "boom, with \"quotes\"" });
    const csv = recordsToCsv([record]);
    const lines = csv.split("\n");
    expect(lines[0]).toBe(NORMALIZED_COLUMNS.join(","));
    expect(lines).toHaveLength(2);
    for (const column of ["runId", "scenarioId", "category", "serverKind", "variant", "latencyMs", "promptTokens", "toolSelectionCorrect", "deterministic", "model", "timestamp"]) {
      expect(NORMALIZED_COLUMNS).toContain(column);
    }
    expect(csv).toContain("\"boom, with \"\"quotes\"\"\"");
  });
});
