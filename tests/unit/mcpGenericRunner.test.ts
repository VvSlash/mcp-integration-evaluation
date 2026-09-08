import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  OWN_SERVERS,
  parseToolErrorCode,
  parseToolResultCount
} from "../../src/runners/mcp/serverRegistry.js";
import { loadScenariosFromDir } from "../../src/shared/scenarioLoader.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function textResult(payload: unknown): { content: Array<{ type: "text"; text: string }> } {
  return { content: [{ type: "text", text: JSON.stringify(payload) }] };
}

describe("rejestr serwerów (serverRegistry)", () => {
  it("pokrywa wszystkie serwery używane w scenariuszach scenarios/mcp/**", async () => {
    const { scenarios } = await loadScenariosFromDir(path.join(repoRoot, "scenarios", "mcp"));
    const usedServers = [...new Set(scenarios.map((scenario) => scenario.server))];
    for (const server of usedServers) {
      expect(server, "scenariusz mcp bez pola server").not.toBeNull();
      expect(
        OWN_SERVERS[server as string],
        `serwer "${server}" ze scenariuszy nie jest zarejestrowany w serverRegistry.ts`
      ).toBeDefined();
    }
  });

  it("każdy wpis rejestru spawnuje kompilat z dist/ (porównywalność z runnerami dedykowanymi)", () => {
    for (const [name, runtime] of Object.entries(OWN_SERVERS)) {
      expect(runtime.spawn.command, name).toBe("node");
      expect(runtime.spawn.args[0], name).toContain("dist");
    }
  });
});

describe("parseToolResultCount (ujednolicone heurystyki)", () => {
  it.each([
    [{ count: 60, files: [] }, 60],
    [{ matches: 10, results: [] }, 10],
    [{ rowCount: 5, rows: [] }, 5],
    [{ groupBy: "status", groups: 5, statistics: [] }, 5],
    [{ items: [1, 2, 3], total: 20 }, 3],
    [{ updated: true, file: "x.json" }, 1],
    [{ id: 11, status: "pending" }, 1],
    [{ status: "ok" }, null]
  ])("payload %o → %o", (payload, expected) => {
    expect(parseToolResultCount(textResult(payload))).toBe(expected);
  });

  it("zwraca null dla nie-JSON i pustych odpowiedzi", () => {
    expect(parseToolResultCount({ content: [{ type: "text", text: "not-json" }] })).toBeNull();
    expect(parseToolResultCount({})).toBeNull();
  });
});

describe("parseToolErrorCode", () => {
  it("wyciąga kod z payloadu; fallback dla braku kodu", () => {
    expect(parseToolErrorCode(textResult({ code: "REST_HTTP_404", message: "x" }))).toBe("REST_HTTP_404");
    expect(parseToolErrorCode(textResult({ message: "x" }))).toBe("TOOL_ERROR");
    expect(parseToolErrorCode({}, "MCP_CALL_FAILED")).toBe("MCP_CALL_FAILED");
  });
});
