import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterAll, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const interviewerExe = path.join(
  repoRoot,
  "third_party", "eval-frameworks", "mcp-interviewer", ".venv", "Scripts", "mcp-interviewer.exe"
);
const tsxCli = path.join(repoRoot, "node_modules", "tsx", "dist", "cli.mjs");
const interviewerAvailable = existsSync(interviewerExe) && existsSync(tsxCli);

function loadDotEnv(): Record<string, string> {
  const envPath = path.join(repoRoot, ".env");
  const result: Record<string, string> = {};
  if (!existsSync(envPath)) {
    return result;
  }
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) {
      continue;
    }
    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex < 1) {
      continue;
    }
    result[trimmed.slice(0, separatorIndex).trim()] = trimmed.slice(separatorIndex + 1).trim();
  }
  return result;
}

const FALLBACK_ENV: Record<string, string> = {
  POSTGRES_HOST: "localhost",
  POSTGRES_PORT: "5432",
  POSTGRES_DB: "mcp_research",
  POSTGRES_USER: "smoke-test",
  POSTGRES_PASSWORD: "smoke-test"
};

const toForwardSlashes = (value: string): string => value.replaceAll("\\", "/");

const workDirs: string[] = [];

afterAll(async () => {
  for (const dir of workDirs) {
    await rm(dir, { recursive: true, force: true });
  }
});

describe.skipIf(!interviewerAvailable)(
  "mcp-interviewer — automatyczny smoke test serwerów własnych (OPCJONALNY)",
  () => {
    const servers = ["sql-controlled", "sql-minimal", "json", "rest-api", "blender"] as const;

    for (const server of servers) {
      it(
        `przeprowadza wywiad serwera ${server} bez LLM i zapisuje raport md+json`,
        async () => {
          const workDir = await mkdtemp(path.join(os.tmpdir(), `mcp-interview-${server}-`));
          workDirs.push(workDir);

          const serverEnv = { ...FALLBACK_ENV, ...loadDotEnv() };
          const envFileContent = Object.entries(serverEnv)
            .map(([key, value]) => `${key}=${value}`)
            .join("\n");
          await writeFile(path.join(workDir, ".env"), envFileContent, "utf8");

          const serverEntry = toForwardSlashes(
            path.join(repoRoot, "src", "servers", server, "server.ts")
          );
          const serverCommand = `node "${toForwardSlashes(tsxCli)}" "${serverEntry}"`;

          await execFileAsync(interviewerExe, [serverCommand], {
            cwd: workDir,
            env: { ...process.env, PYTHONUTF8: "1" },
            timeout: 150_000
          });

          const jsonPath = path.join(workDir, "mcp-interview.json");
          const mdPath = path.join(workDir, "mcp-interview.md");
          expect(existsSync(jsonPath), "brak mcp-interview.json").toBe(true);
          expect(existsSync(mdPath), "brak mcp-interview.md").toBe(true);

          const report = JSON.parse(await readFile(jsonPath, "utf8")) as unknown;
          expect(report).toBeTypeOf("object");
          expect(report).not.toBeNull();
        },
        180_000
      );
    }
  }
);
