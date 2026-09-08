import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { postgresSearchOrdersScenarios } from "../../src/evaluation/postgresScenarios.js";
import {
  loadScenariosFromDir,
  loadScenariosFromFile,
  loadToolFamilyMapping
} from "../../src/shared/scenarioLoader.js";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, "..", "..");
const fixturesDir = path.join(testDir, "__fixtures__", "scenarios");

describe("loadScenariosFromFile", () => {
  it("stosuje domyślne iteracje (30 deterministyczne / 10 LLM)", async () => {
    const { scenarios } = await loadScenariosFromFile(path.join(fixturesDir, "valid-defaults.yaml"));
    expect(scenarios.find((s) => s.id === "FIX-001")?.iterations).toBe(30);
    expect(scenarios.find((s) => s.id === "FIX-002")?.iterations).toBe(10);
  });

  it("akceptuje metryki z PROPOSED_METRICS bez ostrzeżenia, nieznane — z ostrzeżeniem (nie błędem)", async () => {
    const { scenarios, warnings } = await loadScenariosFromFile(
      path.join(fixturesDir, "valid-defaults.yaml")
    );
    expect(scenarios).toHaveLength(2);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("totallyUnknownMetric");
    expect(warnings[0]).not.toContain("passAtK");
  });

  it("odrzuca scenariusz z wariantem spoza enuma", async () => {
    await expect(
      loadScenariosFromFile(path.join(fixturesDir, "invalid-variant.yaml"))
    ).rejects.toThrow(/variant/);
  });
});

describe("migracja PG-00x → SQL-00x (bez zmiany semantyki)", () => {
  it("scenarios/mcp/sql.yaml zawiera SQL-001…004 z argumentami identycznymi jak PG-001…004", async () => {
    const { scenarios } = await loadScenariosFromFile(
      path.join(repoRoot, "scenarios", "mcp", "sql.yaml")
    );

    for (const legacy of postgresSearchOrdersScenarios) {
      const migratedId = legacy.id.replace(/^PG-/, "SQL-");
      const migrated = scenarios.find((s) => s.id === migratedId);
      expect(migrated, `brak zmigrowanego scenariusza ${migratedId}`).toBeDefined();
      expect(migrated?.expected_arguments).toEqual(legacy.arguments);
      expect(migrated?.name).toBe(legacy.name);
      expect(migrated?.expected_tools).toContain(legacy.toolName);
      expect(migrated?.deterministic).toBe(true);
      expect(migrated?.iterations).toBe(30);
    }
  });

  it("scenarios/mcp-llm/sql.yaml zawiera prompty 1:1 z runnera (SQL-001) i SQL-007", async () => {
    const { scenarios } = await loadScenariosFromFile(
      path.join(repoRoot, "scenarios", "mcp-llm", "sql.yaml")
    );
    const sql001 = scenarios.find((s) => s.id === "SQL-001");
    expect(sql001?.prompt).toBe("Find up to 5 paid orders and summarize how many were returned.");
    expect(sql001?.external["mcp-gating-eval"]).toBeDefined();

    const sql007 = scenarios.find((s) => s.id === "SQL-007");
    expect(sql007?.expected_tools).toContain("pg_get_order_statistics");
    expect(sql007?.expected_capability).toBe("aggregation");
  });
});

describe("loadScenariosFromDir (całe scenarios/)", () => {
  it("ładuje wszystkie scenariusze repo bez błędów i bez ostrzeżeń o metrykach", async () => {
    const { scenarios, warnings } = await loadScenariosFromDir(path.join(repoRoot, "scenarios"));
    expect(scenarios).toHaveLength(92);
    expect(warnings).toEqual([]);
    expect(scenarios.filter((s) => s.id === "SQL-001")).toHaveLength(8);
    expect(scenarios.filter((s) => s.id.startsWith("BLEND-"))).toHaveLength(6);
  });

  it("BLEND-001…003: prompty własnego serwera IDENTYCZNE z gotowcem", async () => {
    const own = await loadScenariosFromFile(path.join(repoRoot, "scenarios", "mcp-llm", "blender.yaml"));
    const thirdParty = await loadScenariosFromFile(
      path.join(repoRoot, "scenarios", "third-party", "blender-mcp.yaml")
    );
    for (const scenario of own.scenarios) {
      const counterpart = thirdParty.scenarios.find((s) => s.id === scenario.id);
      expect(counterpart, `brak odpowiednika ${scenario.id} u gotowca`).toBeDefined();
      expect(scenario.prompt, `prompt ${scenario.id} różni się od gotowca`).toBe(counterpart?.prompt);
      expect(scenario.server).toBe("blender");
      expect(counterpart?.server).toBe("blender-mcp");
    }
  });

  it("wykrywa duplikat klucza (id, variant, server)", async () => {
    await expect(loadScenariosFromDir(path.join(fixturesDir, "dup"))).rejects.toThrow(/Duplikat/);
  });
});

describe("loadToolFamilyMapping", () => {
  it("wczytuje mapowanie tool_family → nazwa narzędzia gotowca", async () => {
    const mapping = await loadToolFamilyMapping(path.join(fixturesDir, "sql-mcp.mapping.yaml"));
    expect(mapping.server).toBe("sql-mcp");
    expect(mapping.mapping["db_read"]).toBe("query");
  });
});
