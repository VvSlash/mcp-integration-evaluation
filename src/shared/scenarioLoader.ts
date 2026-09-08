import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { parse } from "yaml";
import * as z from "zod/v4";
import { CATEGORIES, KNOWN_METRICS, PROPOSED_METRICS, VARIANTS } from "./types.js";

export const expectedResultShapeSchema = z.looseObject({
  type: z.string().optional(),
  minCount: z.number().int().nonnegative().optional(),
  maxCount: z.number().int().nonnegative().optional(),
  fields: z.array(z.string()).optional()
});

export const scenarioSchema = z
  .strictObject({
    id: z.string().min(1),
    name: z.string().min(1),
    category: z.enum(CATEGORIES),
    variant: z.enum(VARIANTS),
    server: z.string().nullable().default(null),
    prompt: z.string().nullable().default(null),
    expected_tools: z.array(z.string()).default([]),
    expected_tool_family: z.string().nullable().default(null),
    expected_capability: z.string().nullable().default(null),
    expected_arguments: z.record(z.string(), z.unknown()).default({}),
    expected_result_shape: expectedResultShapeSchema.nullable().default(null),
    minimum_tool_calls: z.number().int().nonnegative().default(1),
    required_servers: z.array(z.string()).default([]),
    expected_outcome: z.enum(["completed", "unavailable"]).default("completed"),
    deterministic_plan: z.array(z.object({ tool: z.string(), arguments: z.record(z.string(), z.unknown()) })).default([]),
    result_transform: z.enum(["none", "amount_range", "status_statistics", "recent_orders"]).default("none"),
    success_criteria: z.array(z.string()).default([]),
    metrics: z.array(z.string()).default([]),
    iterations: z.number().int().positive().optional(),
    deterministic: z.boolean(),
    notes: z.string().nullable().default(null),
    external: z.record(z.string(), z.record(z.string(), z.unknown())).default({})
  })
  .transform((scenario) => ({
    ...scenario,
    iterations: scenario.iterations ?? (scenario.deterministic ? 30 : 10)
  }));

export type Scenario = z.output<typeof scenarioSchema>;

export type ScenarioLoadResult = {
  scenarios: Scenario[];
  warnings: string[];
};

const ACCEPTED_METRICS = new Set<string>([...KNOWN_METRICS, ...PROPOSED_METRICS]);

function validateMetrics(scenario: Scenario, file: string, warnings: string[]): void {
  for (const metric of scenario.metrics) {
    if (!ACCEPTED_METRICS.has(metric)) {
      warnings.push(
        `${file} [${scenario.id}]: nieznana metryka "${metric}" (spoza KNOWN_METRICS/PROPOSED_METRICS z src/shared/types.ts) — dopuszczona, zweryfikuj pisownię lub dopisz do types.ts.`
      );
    }
  }
}

function extractScenarioDocs(parsed: unknown, file: string): unknown[] {
  if (Array.isArray(parsed)) {
    return parsed;
  }
  if (typeof parsed === "object" && parsed !== null) {
    const container = parsed as Record<string, unknown>;
    if (Array.isArray(container["scenarios"])) {
      return container["scenarios"];
    }
    if (typeof container["id"] === "string") {
      return [parsed];
    }
  }
  throw new Error(
    `${file}: nieprawidłowa struktura — oczekiwano listy 'scenarios:', listy dokumentów albo pojedynczego scenariusza.`
  );
}

export async function loadScenariosFromFile(filePath: string): Promise<ScenarioLoadResult> {
  const raw = await readFile(filePath, "utf8");
  const parsed: unknown = parse(raw);
  const docs = extractScenarioDocs(parsed, filePath);

  const warnings: string[] = [];
  const scenarios = docs.map((doc, index) => {
    const validated = scenarioSchema.safeParse(doc);
    if (!validated.success) {
      const issue = validated.error.issues[0];
      throw new Error(
        `${filePath} [scenariusz ${index}]: niezgodny z formatem scenariusza — ${issue?.path.join(".") ?? "?"}: ${issue?.message ?? "błąd walidacji"}`
      );
    }
    validateMetrics(validated.data, filePath, warnings);
    return validated.data;
  });

  return { scenarios, warnings };
}

function isScenarioFile(name: string): boolean {
  if (!(name.endsWith(".yaml") || name.endsWith(".yml"))) {
    return false;
  }
  if (name === "TEMPLATE.yaml" || name.endsWith(".mapping.yaml")) {
    return false;
  }
  return true;
}

export async function loadScenariosFromDir(dirPath: string): Promise<ScenarioLoadResult> {
  const scenarios: Scenario[] = [];
  const warnings: string[] = [];
  const seen = new Map<string, string>();

  async function walk(current: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(entryPath);
      } else if (entry.isFile() && isScenarioFile(entry.name)) {
        const result = await loadScenariosFromFile(entryPath);
        warnings.push(...result.warnings);
        for (const scenario of result.scenarios) {
          const key = `${scenario.id}::${scenario.variant}::${scenario.server ?? ""}`;
          const previous = seen.get(key);
          if (previous) {
            throw new Error(
              `Duplikat scenariusza (id=${scenario.id}, variant=${scenario.variant}, server=${scenario.server ?? "—"}): ${previous} oraz ${entryPath}.`
            );
          }
          seen.set(key, entryPath);
          scenarios.push(scenario);
        }
      }
    }
  }

  await walk(dirPath);
  return { scenarios, warnings };
}

export const toolFamilyMappingSchema = z.strictObject({
  server: z.string().min(1),
  mapping: z.record(z.string(), z.union([z.string(), z.array(z.string()).min(1)]))
});
export type ToolFamilyMapping = z.output<typeof toolFamilyMappingSchema>;

export async function loadToolFamilyMapping(filePath: string): Promise<ToolFamilyMapping> {
  const raw = await readFile(filePath, "utf8");
  const validated = toolFamilyMappingSchema.safeParse(parse(raw));
  if (!validated.success) {
    const issue = validated.error.issues[0];
    throw new Error(
      `${filePath}: nieprawidłowy plik mapowania rodzin narzędzi — ${issue?.path.join(".") ?? "?"}: ${issue?.message ?? "błąd walidacji"}`
    );
  }
  return validated.data;
}
