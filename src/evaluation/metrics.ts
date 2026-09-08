export type Measurement = {
    scenarioId: string;
    scenarioName: string;
    variant: "baseline" | "mcp";
    iteration: number;
    latencyMs: number;
    success: boolean;
    errorCode: string | null;
    errorMessage: string | null;
    resultCount: number | null;
    timestamp: string;
  };
  
  export type ScenarioSummary = {
    scenarioId: string;
    scenarioName: string;
    variant: "baseline" | "mcp";
    iterations: number;
    successful: number;
    failed: number;
    errorRate: number;
    minLatencyMs: number | null;
    avgLatencyMs: number | null;
    medianLatencyMs: number | null;
    p95LatencyMs: number | null;
    p99LatencyMs: number | null;
    maxLatencyMs: number | null;
  };
  
  function percentile(values: number[], p: number): number | null {
    if (values.length === 0) {
      return null;
    }
  
    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.ceil((p / 100) * sorted.length) - 1;
    const idx = Math.max(0, Math.min(index, sorted.length - 1));
    const value = sorted[idx];
    return value ?? null;
  }
  
  function average(values: number[]): number | null {
    if (values.length === 0) {
      return null;
    }
  
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  }
  
  function round(value: number | null): number | null {
    if (value === null) {
      return null;
    }
  
    return Number(value.toFixed(3));
  }
  
  export function summarizeMeasurements(
    measurements: Measurement[]
  ): ScenarioSummary[] {
    const groups = new Map<string, Measurement[]>();
  
    for (const measurement of measurements) {
      const key = `${measurement.variant}:${measurement.scenarioId}`;
      const current = groups.get(key) ?? [];
      current.push(measurement);
      groups.set(key, current);
    }
  
    return [...groups.values()].map((group) => {
      const first = group[0];
      if (first === undefined) {
        throw new Error("summarizeMeasurements: empty group");
      }

      const successful = group.filter((item) => item.success);
      const latencies = successful.map((item) => item.latencyMs);
  
      return {
        scenarioId: first.scenarioId,
        scenarioName: first.scenarioName,
        variant: first.variant,
        iterations: group.length,
        successful: successful.length,
        failed: group.length - successful.length,
        errorRate: Number(((group.length - successful.length) / group.length).toFixed(4)),
        minLatencyMs: round(latencies.length > 0 ? Math.min(...latencies) : null),
        avgLatencyMs: round(average(latencies)),
        medianLatencyMs: round(percentile(latencies, 50)),
        p95LatencyMs: round(percentile(latencies, 95)),
        p99LatencyMs: round(percentile(latencies, 99)),
        maxLatencyMs: round(latencies.length > 0 ? Math.max(...latencies) : null)
      };
    });
  }
  
  function csvEscape(value: unknown): string {
    if (value === null || value === undefined) {
      return "";
    }
  
    const text = String(value);
  
    if (text.includes(",") || text.includes("\"") || text.includes("\n")) {
      return `"${text.replaceAll("\"", "\"\"")}"`;
    }
  
    return text;
  }
  
  export function measurementsToCsv(measurements: Measurement[]): string {
    const headers: Array<keyof Measurement> = [
      "scenarioId",
      "scenarioName",
      "variant",
      "iteration",
      "latencyMs",
      "success",
      "errorCode",
      "errorMessage",
      "resultCount",
      "timestamp"
    ];
  
    const rows = measurements.map((measurement) =>
      headers.map((header) => csvEscape(measurement[header])).join(",")
    );
  
    return [headers.join(","), ...rows].join("\n");
  }
  
  export function summariesToCsv(summaries: ScenarioSummary[]): string {
    const headers: Array<keyof ScenarioSummary> = [
      "scenarioId",
      "scenarioName",
      "variant",
      "iterations",
      "successful",
      "failed",
      "errorRate",
      "minLatencyMs",
      "avgLatencyMs",
      "medianLatencyMs",
      "p95LatencyMs",
      "p99LatencyMs",
      "maxLatencyMs"
    ];
  
    const rows = summaries.map((summary) =>
      headers.map((header) => csvEscape(summary[header])).join(",")
    );
  
    return [headers.join(","), ...rows].join("\n");
  }