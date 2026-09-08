import { Client, StdioClientTransport } from "@modelcontextprotocol/client";
import type { OllamaToolSpec } from "./ollama/ollamaClient.js";
import {
  OWN_SERVERS,
  THIRD_PARTY_SERVERS,
  resolveServer,
  resolveSpawn,
  type ToolResultLike
} from "../runners/mcp/serverRegistry.js";
import type { Scenario } from "../shared/scenarioLoader.js";
import type { CatalogTool } from "../shared/catalogSnapshot.js";

type ListedTool = { name: string; description?: string; inputSchema?: unknown };

export type ConnectedCatalog = {
  rawCatalogs: Record<string, CatalogTool[]>;
  toolOriginalName: (toolName: string) => string;
  readResource: (serverName: string, uri: string) => Promise<unknown>;
  servers: string[];
  ollamaTools: OllamaToolSpec[];
  toolCount: number;
  catalogSchemaChars: number;
  toolServer: (toolName: string) => string | null;
  callTool: (toolName: string, args: Record<string, unknown>) => Promise<ToolResultLike>;
  beforeIteration: (scenario: Scenario) => Promise<void>;
  close: () => Promise<void>;
};

export async function connectServers(serverNames: string[]): Promise<ConnectedCatalog> {
  const clients = new Map<string, Client>();
  const cleanups: Array<() => Promise<void>> = [];
  const toolToServer = new Map<string, string>();
  const originalNames = new Map<string, string>();
  const rawCatalogs: Record<string, CatalogTool[]> = {};
  const ollamaTools: OllamaToolSpec[] = [];

  const close = async (): Promise<void> => {
    for (const client of clients.values()) {
      await client.close().catch(() => undefined);
    }
    for (const cleanup of cleanups.reverse()) {
      await cleanup().catch(() => undefined);
    }
  };

  try {
    for (const serverName of serverNames) {
      const resolved = resolveServer(serverName);
      if (!resolved) {
        throw new Error(
          `Serwer "${serverName}" nie jest zarejestrowany w serverRegistry.ts (własne: ${Object.keys(OWN_SERVERS).join(", ")}; gotowce: ${Object.keys(THIRD_PARTY_SERVERS).join(", ")}).`
        );
      }
      const runtime = resolved.runtime;
      if (runtime.beforeAll) {
        cleanups.push(await runtime.beforeAll());
      }

      const client = new Client({ name: "mcp-llm-generic-runner", version: "0.1.0" });
      await client.connect(new StdioClientTransport(resolveSpawn(runtime)));
      clients.set(serverName, client);

      const listed = (await client.listTools()) as { tools?: ListedTool[] };
      rawCatalogs[serverName] = (listed.tools ?? []) as CatalogTool[];
    }
    const counts = new Map<string, number>();
    for (const tools of Object.values(rawCatalogs)) for (const tool of tools) counts.set(tool.name, (counts.get(tool.name) ?? 0) + 1);
    for (const [serverName, tools] of Object.entries(rawCatalogs)) {
      for (const tool of tools) {
        const name = (counts.get(tool.name) ?? 0) > 1 ? `${serverName.replaceAll("-", "_")}__${tool.name}` : tool.name;
        if (toolToServer.has(name)) throw new Error(`CATALOG_ALIAS_COLLISION: ${name}`);
        toolToServer.set(name, serverName);
        originalNames.set(name, tool.name);
        ollamaTools.push({
          type: "function",
          function: {
            name,
            description: tool.description ?? "",
            parameters: tool.inputSchema ?? { type: "object", properties: {} }
          }
        });
      }
    }
  } catch (error) {
    await close();
    throw error;
  }

  return {
    rawCatalogs,
    toolOriginalName: toolName => originalNames.get(toolName) ?? toolName,
    readResource: async (serverName, uri) => {
      const client = clients.get(serverName);
      if (!client) throw new Error(`Server is not connected: ${serverName}`);
      return client.readResource({ uri });
    },
    servers: [...serverNames],
    ollamaTools,
    toolCount: ollamaTools.length,
    catalogSchemaChars: JSON.stringify(ollamaTools).length,
    toolServer: (toolName) => toolToServer.get(toolName) ?? null,
    callTool: async (toolName, args) => {
      const serverName = toolToServer.get(toolName);
      const client = serverName ? clients.get(serverName) : undefined;
      if (!client) {
        throw new Error(`TOOL_NOT_FOUND: narzedzie "${toolName}" nie istnieje w katalogu [${[...toolToServer.keys()].join(", ")}].`);
      }
      return (await client.callTool({ name: originalNames.get(toolName) ?? toolName, arguments: args }, { timeout: 30000 })) as ToolResultLike;
    },
    beforeIteration: async (scenario) => {
      for (const serverName of serverNames) {
        await resolveServer(serverName)?.runtime.beforeIteration?.(scenario);
      }
    },
    close
  };
}
