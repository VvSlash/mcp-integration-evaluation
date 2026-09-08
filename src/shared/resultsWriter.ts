import { execSync } from "node:child_process";
import { mkdir, writeFile, appendFile } from "node:fs/promises";
import path from "node:path";
import {
  recordsToCsv,
  resultRecordSchema,
  runManifestSchema,
  type ResultRecord,
  type RunManifest
} from "./resultRecord.js";

export function newRunId(): string {
  return new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
}

export function getRepoCommit(): string | null {
  try {
    return execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim() || null;
  } catch {
    return null;
  }
}

export type BuildManifestOptions = {
  campaignId?: string | null;
  phase?: "pilot" | "final" | "test" | null;
  status?: "running" | "completed" | "interrupted";
  provenance?: Record<string, unknown> | null;
  runId: string;
  model?: string | null;
  serverVersions?: Record<string, string>;
  seed?: number | null;
  notes?: string | null;
};

export function buildRunManifest(options: BuildManifestOptions): RunManifest {
  return runManifestSchema.parse({
    campaignId: options.campaignId ?? null,
    phase: options.phase ?? null,
    status: options.status ?? "completed",
    provenance: options.provenance ?? null,
    runId: options.runId,
    createdAt: new Date().toISOString(),
    model: options.model ?? null,
    serverVersions: options.serverVersions ?? {},
    sdkVersion: "2.0.0-alpha.2",
    repoCommit: getRepoCommit(),
    seed: options.seed ?? null,
    os: process.platform,
    notes: options.notes ?? null
  });
}

export type WriteRunResultsOptions = {
  runId: string;
  records: ResultRecord[];
  manifest: RunManifest;
  extraFiles?: Record<string, unknown>;
  baseDir?: string;
};

export async function writeRunResults(options: WriteRunResultsOptions): Promise<string> {
  const baseDir = options.baseDir ?? path.join("results", "raw");
  const runDir = path.join(baseDir, options.runId);

  options.records.forEach((record, index) => {
    const validated = resultRecordSchema.safeParse(record);
    if (!validated.success) {
      throw new Error(
        `writeRunResults: rekord ${index} niezgodny ze schematem rekordu pomiaru: ${validated.error.issues[0]?.message ?? "blad walidacji"}`
      );
    }
  });

  await mkdir(runDir, { recursive: true });
  await writeFile(
    path.join(runDir, "measurements.json"),
    JSON.stringify(options.records, null, 2),
    "utf8"
  );
  await writeFile(path.join(runDir, "measurements.csv"), recordsToCsv(options.records), "utf8");
  await writeFile(
    path.join(runDir, "manifest.json"),
    JSON.stringify(options.manifest, null, 2),
    "utf8"
  );

  for (const [fileName, content] of Object.entries(options.extraFiles ?? {})) {
    await writeFile(path.join(runDir, fileName), JSON.stringify(content, null, 2), "utf8");
  }
  return runDir;
}

export async function appendRunEvent(runId: string, file: "tool-results.jsonl" | "transcripts.jsonl" | "checkpoints.jsonl" | "skipped.jsonl", event: unknown) {
  if (!/^[a-zA-Z0-9_-]+$/.test(runId)) throw new Error("Invalid runId");
  const directory = path.join("results", "raw", runId);
  await mkdir(directory, { recursive: true });
  await appendFile(path.join(directory, file), `${JSON.stringify(event)}\n`, "utf8");
}
