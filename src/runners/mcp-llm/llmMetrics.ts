
export function extractFinalJson(text: string): unknown | null {
  const candidates: string[] = [text.trim()];
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  if (fenced?.[1]) {
    candidates.push(fenced[1].trim());
  }
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first >= 0 && last > first) {
    candidates.push(text.slice(first, last + 1));
  }
  for (const candidate of candidates) {
    try {
      const parsed: unknown = JSON.parse(candidate);
      if (typeof parsed === "object" && parsed !== null) {
        return parsed;
      }
    } catch {
    }
  }
  return null;
}

function valuesEqual(a: unknown, b: unknown): boolean {
  if (typeof a === "number" && typeof b === "string") {
    return Number(b) === a;
  }
  if (typeof a === "string" && typeof b === "number") {
    return Number(a) === b;
  }
  return JSON.stringify(a) === JSON.stringify(b);
}

export function scoreArgumentCorrectness(
  expected: Record<string, unknown>,
  actual: Record<string, unknown> | null
): number | null {
  const expectedKeys = Object.keys(expected);
  if (expectedKeys.some((key) => key === "sql" || key === "path")) {
    return null;
  }
  if (actual === null) {
    return 0;
  }
  const actualKeys = Object.keys(actual);
  if (expectedKeys.length === 0) {
    return actualKeys.length === 0 ? 1 : 0.5;
  }

  const presentKeys = expectedKeys.filter((key) => key in actual);
  if (presentKeys.length === 0) {
    return 0;
  }
  const allKeysPresent = presentKeys.length === expectedKeys.length;
  const allValuesMatch =
    allKeysPresent && expectedKeys.every((key) => valuesEqual(expected[key], actual[key]));
  const noExtraKeys = actualKeys.every((key) => expectedKeys.includes(key));

  if (allValuesMatch && noExtraKeys) {
    return 1;
  }
  return 0.5;
}

const GENERIC_STRINGS = new Set(["ok", "true", "false", "null", "status", "pending"]);

export function sampleToolValues(payload: unknown, limit = 12): string[] {
  const samples = new Set<string>();
  const visit = (value: unknown, depth: number): void => {
    if (samples.size >= limit || depth > 5 || value === null) {
      return;
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      samples.add(String(value));
    } else if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed.length >= 3 && !GENERIC_STRINGS.has(trimmed.toLowerCase())) {
        samples.add(trimmed);
      }
    } else if (Array.isArray(value)) {
      for (const item of value) {
        visit(item, depth + 1);
      }
    } else if (typeof value === "object") {
      for (const item of Object.values(value as Record<string, unknown>)) {
        visit(item, depth + 1);
      }
    }
  };
  visit(payload, 0);
  return [...samples].slice(0, limit);
}

export function scoreResultIntegration(toolPayload: unknown, finalAnswer: string): number | null {
  const samples = sampleToolValues(toolPayload);
  if (samples.length === 0) {
    return null;
  }
  const found = samples.filter((sample) => finalAnswer.includes(sample)).length;
  return Number((found / samples.length).toFixed(3));
}
