import { Client, StdioClientTransport } from "@modelcontextprotocol/client";

function parseCommand(argv: string[]): { command: string; args: string[] } {
  const index = argv.indexOf("--command");
  const raw = index >= 0 ? argv[index + 1] : undefined;
  if (!raw) {
    throw new Error('Podaj polecenie serwera: --command "npx -y <pakiet> ..."');
  }
  const parts = raw.match(/(?:[^\s"]+|"[^"]*")+/g)?.map((part) => part.replaceAll('"', "")) ?? [];
  const head = parts[0];
  if (!head) {
    throw new Error("Puste polecenie serwera.");
  }
  if (process.platform === "win32" && (head === "npx" || head === "uvx" || head === "npm")) {
    return { command: "cmd", args: ["/c", ...parts] };
  }
  return { command: head, args: parts.slice(1) };
}

async function main() {
  const spawnSpec = parseCommand(process.argv.slice(2));
  const client = new Client({ name: "mcp-catalog-inspector", version: "0.1.0" });

  try {
    await client.connect(new StdioClientTransport(spawnSpec));

    const toolsResult = (await client.listTools()) as {
      tools?: Array<{ name: string; description?: string; inputSchema?: unknown }>;
    };
    const tools = (toolsResult.tools ?? []).map((tool) => ({
      name: tool.name,
      description: tool.description ?? "",
      inputSchema: tool.inputSchema ?? null
    }));

    let resources: Array<{ uri: string; name?: string; description?: string }> = [];
    try {
      const resourcesResult = (await client.listResources()) as {
        resources?: Array<{ uri: string; name?: string; description?: string }>;
      };
      resources = resourcesResult.resources ?? [];
    } catch {
    }

    console.log(
      JSON.stringify(
        {
          command: spawnSpec,
          toolCount: tools.length,
          catalogSchemaChars: JSON.stringify(tools).length,
          tools,
          resourceCount: resources.length,
          resources
        },
        null,
        2
      )
    );
  } finally {
    await client.close().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error("MCP catalog inspection failed:", error);
  process.exit(1);
});
