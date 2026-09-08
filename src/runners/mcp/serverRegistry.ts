import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { env } from "../../config/env.js";
import { postgresConnectionUrl } from "../../config/postgresConnection.js";
import { createRestApiApp } from "../../rest-api/app.js";
import type { Server } from "node:http";
import { closeSharedBridge, getSharedBridge } from "../../servers/blender/bridge.js";
import type { Scenario } from "../../shared/scenarioLoader.js";

export type SpawnSpec = { command: string; args: string[]; env?: Record<string, string> };

export type ServerRuntime = {
  spawn: SpawnSpec | (() => SpawnSpec);
  beforeAll?: () => Promise<() => Promise<void>>;
  beforeIteration?: (scenario: Scenario) => Promise<void>;
};

export function resolveSpawn(runtime: ServerRuntime): SpawnSpec {
  const spec = typeof runtime.spawn === "function" ? runtime.spawn() : runtime.spawn;
  const inherited: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) if (value !== undefined && /^(POSTGRES_URL_(RO|RW)|MCP_EVAL_DATABASE|MCP_EVAL_REQUIRE_ROLES|REST_API_|JSON_|MCP_EVAL_BLENDER_|BLENDER_)/.test(key)) inherited[key] = value;
  return { ...spec, env: { BLENDER_MCP_DISABLE_TELEMETRY:"1", ...spec.env, ...inherited } };
}

const HEALTH_POLL_ATTEMPTS = 40;
const HEALTH_POLL_INTERVAL_MS = 250;

let ownedRestServer: Server | null = null;
async function stopOwnedRest() {
  const server = ownedRestServer; ownedRestServer = null;
  if (server) await new Promise<void>((resolve,reject) => { server.close(error=>error?reject(error):resolve()); server.closeAllConnections(); });
}
async function resetOwnedRest() {
  await stopOwnedRest();
  ownedRestServer = await new Promise<Server>((resolve,reject) => {
    const server = createRestApiApp().listen(env.restApi.port, "127.0.0.1", ()=>resolve(server));
    server.once("error",reject);
  });
}
async function startLocalRestApi(): Promise<() => Promise<void>> {
  await resetOwnedRest();
  return stopOwnedRest;
}

async function resetJsonWorkingCopy(scenario: Scenario): Promise<void> {
  await restoreJsonDirectory(env.json.workDir);
}

async function restoreJsonDirectory(directory: string) {
  const { mkdir, readdir, copyFile } = await import("node:fs/promises");
  const allowed = path.resolve("datasets/.work") + path.sep, target = path.resolve(directory);
  if (!target.startsWith(allowed)) throw new Error("Fixture reset requires a directory inside datasets/.work");
  await rm(target,{recursive:true,force:true});
  await mkdir(target,{recursive:true});
  for (const entry of await readdir(env.json.dataDir,{withFileTypes:true})) if (entry.isFile() && entry.name.endsWith(".json")) await copyFile(path.join(env.json.dataDir,entry.name),path.join(target,entry.name));
}

function scenarioUsesOwnBlender(scenario: Scenario): boolean {
  return scenario.server === "blender" || scenario.server === "blender-mcp" || scenario.expected_tools.some((tool) => tool.startsWith("blender_"));
}

async function resetOwnBlenderScene(scenario: Scenario): Promise<void> {
  if (!scenarioUsesOwnBlender(scenario)) {
    return;
  }
  const mode = scenario.category === "blender" ? "default" : "empty";
  await getSharedBridge().command("reset_scene", { mode });
}

async function ensureOwnBlenderBridge(): Promise<() => Promise<void>> {
  const bridge = getSharedBridge();
  try {
    await bridge.command("ping", {}, 2500);
  } catch {
    throw new Error(
      `Most własnego addonu Blendera (TCP ${bridge.address}) nie odpowiada — uruchom: powershell -ExecutionPolicy Bypass -File scripts/run/start_blender_bridge.ps1 (Blender GUI z OBOMA addonami) i powtórz przebieg.`
    );
  }
  return async () => {
    await closeSharedBridge();
  };
}

export const OWN_SERVERS: Record<string, ServerRuntime> = {
  "sql-generic": {
    spawn: { command: "node", args: [path.join("dist", "servers", "sql-generic", "server.js")] }
  },
  "sql-controlled": {
    spawn: { command: "node", args: [path.join("dist", "servers", "sql-controlled", "server.js")] }
  },
  "sql-minimal": {
    spawn: { command: "node", args: [path.join("dist", "servers", "sql-minimal", "server.js")] }
  },
  json: {
    spawn: { command: "node", args: [path.join("dist", "servers", "json", "server.js")] },
    beforeIteration: resetJsonWorkingCopy
  },
  "rest-api": {
    spawn: { command: "node", args: [path.join("dist", "servers", "rest-api", "server.js")] },
    beforeAll: startLocalRestApi,
    beforeIteration: resetOwnedRest
  },
  blender: {
    spawn: { command: "node", args: [path.join("dist", "servers", "blender", "server.js")] },
    beforeAll: ensureOwnBlenderBridge,
    beforeIteration: resetOwnBlenderScene
  }
};

type ManifestServer = { name: string; source: string; pinnedVersion: string };

function readPinnedThirdParty(name: string): ManifestServer {
  const manifest = JSON.parse(readFileSync(path.join("third_party", "manifest.json"), "utf8")) as {
    servers?: ManifestServer[];
  };
  const entry = manifest.servers?.find((server) => server.name === name);
  if (!entry) {
    throw new Error(`Brak wpisu "${name}" w third_party/manifest.json.`);
  }
  if (!entry.pinnedVersion || entry.pinnedVersion === "latest") {
    throw new Error(
      `Gotowiec "${name}" nie ma przypiętej wersji w third_party/manifest.json — uruchom download_third_party_mcp_servers.ps1 i wpisz rozwiązaną wersję.`
    );
  }
  return entry;
}

function npxSpawn(parts: string[]): SpawnSpec {
  return process.platform === "win32"
    ? { command: "cmd", args: ["/c", "npx", ...parts] }
    : { command: "npx", args: parts };
}

const JSON_MCP_WORK_DIR = path.join("datasets", ".work", "json-mcp");

async function prepareJsonMcpWorkDir(): Promise<() => Promise<void>> {
  const { mkdir, readdir, copyFile } = await import("node:fs/promises");
  await mkdir(JSON_MCP_WORK_DIR, { recursive: true });
  for (const entry of await readdir(env.json.dataDir, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith(".json")) {
      await copyFile(path.join(env.json.dataDir, entry.name), path.join(JSON_MCP_WORK_DIR, entry.name));
    }
  }
  return async () => {
  };
}

async function resetJsonMcpWorkFile(scenario: Scenario): Promise<void> {
  await restoreJsonDirectory(JSON_MCP_WORK_DIR);
}

export const THIRD_PARTY_SERVERS: Record<string, ServerRuntime> = {
  "sql-mcp": {
    spawn: () => {
      const entry = readPinnedThirdParty("sql-mcp");
      const connectionString = postgresConnectionUrl("rw");
      return npxSpawn(["-y", `${entry.source}@${entry.pinnedVersion}`, "--connection-string", connectionString]);
    }
  },
  "json-mcp": {
    spawn: () => {
      const entry = readPinnedThirdParty("json-mcp");
      return npxSpawn(["-y", `${entry.source}@${entry.pinnedVersion}`, JSON_MCP_WORK_DIR]);
    },
    beforeAll: prepareJsonMcpWorkDir,
    beforeIteration: resetJsonMcpWorkFile
  },
  "duckduckgo-mcp": {
    spawn: () => {
      const entry = readPinnedThirdParty("duckduckgo-mcp");
      return npxSpawn(["-y", `${entry.source}@${entry.pinnedVersion}`]);
    }
  },
  "excel-mcp": {
    spawn: {
      command: path.join("third_party", "excel-mcp", ".venv", "Scripts", "excel-mcp-server.exe"),
      args: ["stdio"]
    },
    beforeAll: prepareExcelMcpWorkDir,
    beforeIteration: resetExcelMcpWorkFile
  },
  "blender-mcp": {
    spawn: {
      command: path.join("third_party", "blender-mcp", ".venv", "Scripts", "blender-mcp.exe"),
      args: []
    },
    beforeAll: ensureBlenderBridge,
    beforeIteration: resetOwnBlenderScene
  }
};

const BLENDER_BRIDGE_PORT = 9876;

async function ensureBlenderBridge(): Promise<() => Promise<void>> {
  const { connect } = await import("node:net");
  const reachable = await new Promise<boolean>((resolve) => {
    const socket = connect({ host: "127.0.0.1", port: BLENDER_BRIDGE_PORT }, () => {
      socket.destroy();
      resolve(true);
    });
    socket.setTimeout(1500, () => {
      socket.destroy();
      resolve(false);
    });
    socket.on("error", () => resolve(false));
  });
  if (!reachable) {
    throw new Error(
      `Most Blendera (addon TCP :${BLENDER_BRIDGE_PORT}) nie odpowiada — uruchom: powershell -ExecutionPolicy Bypass -File scripts/run/start_blender_bridge.ps1 (Blender GUI z autostartem addonu) i powtorz przebieg.`
    );
  }
  return async () => {
  };
}

const EXCEL_MCP_WORK_DIR = path.join("datasets", ".work", "excel-mcp");

async function prepareExcelMcpWorkDir(): Promise<() => Promise<void>> {
  const { mkdir, copyFile } = await import("node:fs/promises");
  await mkdir(EXCEL_MCP_WORK_DIR, { recursive: true });
  await copyFile(
    path.join("datasets", "excel", "sales.xlsx"),
    path.join(EXCEL_MCP_WORK_DIR, "sales.xlsx")
  );
  return async () => {
  };
}

async function resetExcelMcpWorkFile(scenario: Scenario): Promise<void> {
  const { copyFile } = await import("node:fs/promises");
  await copyFile(
    path.join("datasets", "excel", "sales.xlsx"),
    path.join(EXCEL_MCP_WORK_DIR, "sales.xlsx")
  );
}

export type ResolvedServer = {
  runtime: ServerRuntime;
  serverKind: "own" | "third_party";
  serverVersion: string;
};

export function resolveServer(name: string): ResolvedServer | null {
  const own = OWN_SERVERS[name];
  if (own) {
    return { runtime: own, serverKind: "own", serverVersion: "own" };
  }
  const thirdParty = THIRD_PARTY_SERVERS[name];
  if (thirdParty) {
    const entry = readPinnedThirdParty(name);
    return {
      runtime: thirdParty,
      serverKind: "third_party",
      serverVersion: `${entry.source}@${entry.pinnedVersion}`
    };
  }
  return null;
}

type ToolContentItem = { type: string; text?: string };
export type ToolResultLike = { isError?: boolean; content?: ToolContentItem[] };

export function toolResultText(result: ToolResultLike): string | null {
  return result.content?.find((item) => item.type === "text")?.text ?? null;
}

export function parseToolResultCount(result: ToolResultLike): number | null {
  const text = toolResultText(result);
  if (!text) {
    return null;
  }
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    for (const key of ["count", "matches", "rowCount", "groups"]) {
      if (typeof parsed[key] === "number") {
        return parsed[key];
      }
    }
    if (Array.isArray(parsed["items"])) {
      return parsed["items"].length;
    }
    if (parsed["updated"] === true) {
      return 1;
    }
    if (typeof parsed["id"] === "number") {
      return 1;
    }
    return null;
  } catch {
    return null;
  }
}

export function parseToolErrorCode(result: ToolResultLike, fallback = "TOOL_ERROR"): string {
  const text = toolResultText(result);
  if (text) {
    try {
      const parsed = JSON.parse(text) as { code?: unknown };
      if (typeof parsed.code === "string") {
        return parsed.code;
      }
    } catch {
    }
  }
  return fallback;
}
