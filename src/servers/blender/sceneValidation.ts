import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import * as z from "zod/v4";

export type SceneObjectSummary = {
  name: string;
  type: string;
  location?: number[];
  dimensions?: number[];
  material?: { name?: string; baseColorHex?: string | null } | null;
  viewDirection?: number[];
};

export type SceneSummary = {
  count?: number;
  activeCamera?: string | null;
  objects: SceneObjectSummary[];
};

export const referenceExpectedObjectSchema = z.looseObject({
  type: z.string(),
  shape: z.string().optional(),
  name_contains: z.string().optional(),
  material: z
    .looseObject({
      base_color_hex: z.string().optional(),
      color_tolerance: z.number().optional()
    })
    .optional()
});

export const referenceSceneSchema = z.looseObject({
  id: z.string(),
  description: z.string().optional(),
  expected_objects: z.array(referenceExpectedObjectSchema),
  camera: z
    .looseObject({
      looks_at_object: z.string().optional(),
      tolerance_deg: z.number().optional()
    })
    .optional(),
  notes: z.string().optional()
});

export type ReferenceExpectedObject = z.output<typeof referenceExpectedObjectSchema>;
export type ReferenceScene = z.output<typeof referenceSceneSchema>;

export async function loadReferenceScenes(filePath: string): Promise<ReferenceScene[]> {
  const raw = await readFile(filePath, "utf8");
  const parsed = parse(raw) as { scenes?: unknown[] };
  if (!Array.isArray(parsed?.scenes)) {
    throw new Error(`${filePath}: oczekiwano klucza 'scenes' z listą opisów referencyjnych.`);
  }
  return parsed.scenes.map((doc, index) => {
    const validated = referenceSceneSchema.safeParse(doc);
    if (!validated.success) {
      const issue = validated.error.issues[0];
      throw new Error(
        `${filePath} [scena ${index}]: ${issue?.path.join(".") ?? "?"}: ${issue?.message ?? "błąd walidacji"}`
      );
    }
    return validated.data;
  });
}

export function findReferenceScene(scenes: ReferenceScene[], id: string): ReferenceScene | null {
  return scenes.find((scene) => scene.id === id) ?? null;
}

export function hexToRgb(hex: string): [number, number, number] | null {
  const match = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!match?.[1]) {
    return null;
  }
  const value = match[1];
  return [
    parseInt(value.slice(0, 2), 16) / 255,
    parseInt(value.slice(2, 4), 16) / 255,
    parseInt(value.slice(4, 6), 16) / 255
  ];
}

export function colorWithinTolerance(actualHex: string, expectedHex: string, tolerance = 0.2): boolean {
  const actual = hexToRgb(actualHex);
  const expected = hexToRgb(expectedHex);
  if (!actual || !expected) {
    return false;
  }
  return actual.every((channel, index) => Math.abs(channel - (expected[index] ?? 0)) <= tolerance);
}

function nameNeedle(expected: ReferenceExpectedObject): string | null {
  return (expected.name_contains ?? expected.shape ?? null)?.toLowerCase() ?? null;
}

export function objectMatches(object: SceneObjectSummary, expected: ReferenceExpectedObject): boolean {
  if (object.type.toUpperCase() !== expected.type.toUpperCase()) {
    return false;
  }
  const needle = nameNeedle(expected);
  if (needle !== null && !object.name.toLowerCase().includes(needle)) {
    return false;
  }
  if (expected.material?.base_color_hex) {
    const actualHex = object.material?.baseColorHex;
    if (!actualHex) {
      return false;
    }
    if (!colorWithinTolerance(actualHex, expected.material.base_color_hex, expected.material.color_tolerance ?? 0.2)) {
      return false;
    }
  }
  return true;
}

function vectorAngleDeg(a: number[], b: number[]): number | null {
  if (a.length !== 3 || b.length !== 3) {
    return null;
  }
  const dot = a.reduce((sum, value, index) => sum + value * (b[index] ?? 0), 0);
  const lengthA = Math.hypot(...a);
  const lengthB = Math.hypot(...b);
  if (lengthA === 0 || lengthB === 0) {
    return null;
  }
  const cos = Math.min(1, Math.max(-1, dot / (lengthA * lengthB)));
  return (Math.acos(cos) * 180) / Math.PI;
}

export type SceneCheck = { label: string; passed: boolean; details: string };

export type SceneValidationResult = { referenceId: string; passed: boolean; checks: SceneCheck[] };

export function validateSceneAgainstReference(summary: SceneSummary, reference: ReferenceScene): SceneValidationResult {
  const checks: SceneCheck[] = [];
  const used = new Set<string>();

  for (const [index, expected] of reference.expected_objects.entries()) {
    const needle = nameNeedle(expected);
    const label = `obiekt ${index + 1}: ${expected.type}${needle ? ` ~"${needle}"` : ""}`;
    const match = summary.objects.find((object) => !used.has(object.name) && objectMatches(object, expected));
    if (match) {
      used.add(match.name);
      checks.push({ label, passed: true, details: `dopasowano "${match.name}"` });
    } else {
      checks.push({
        label,
        passed: false,
        details: `brak wolnego obiektu spełniającego oczekiwanie (scena: ${summary.objects.map((o) => `${o.name}[${o.type}]`).join(", ") || "pusta"})`
      });
    }
  }

  const lookTarget = reference.camera?.looks_at_object;
  if (lookTarget) {
    const toleranceDeg = reference.camera?.tolerance_deg ?? 15;
    const label = `kamera patrzy na ~"${lookTarget}" (tolerancja ${toleranceDeg}°)`;
    const camera = summary.objects.find(
      (object) => object.type.toUpperCase() === "CAMERA" && object.viewDirection && object.location
    );
    const target = summary.objects.find(
      (object) =>
        object.type.toUpperCase() !== "CAMERA" &&
        object.location &&
        object.name.toLowerCase().includes(lookTarget.toLowerCase())
    );
    if (!camera || !target) {
      checks.push({
        label,
        passed: false,
        details: !camera ? "brak kamery z viewDirection w podsumowaniu" : `brak obiektu ~"${lookTarget}"`
      });
    } else {
      const toTarget = (target.location as number[]).map((value, index) => value - ((camera.location as number[])[index] ?? 0));
      const angle = vectorAngleDeg(camera.viewDirection as number[], toTarget);
      const passed = angle !== null && angle <= toleranceDeg;
      checks.push({
        label,
        passed,
        details: angle === null ? "nie można wyznaczyć kąta" : `kąt ${angle.toFixed(1)}°`
      });
    }
  }

  return { referenceId: reference.id, passed: checks.every((check) => check.passed), checks };
}
