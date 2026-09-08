import "dotenv/config";
import { McpServer, StdioServerTransport } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { env } from "../../config/env.js";
import { registerJsonResources } from "./resources.js";
import { registerJsonTools } from "./tools.js";

const server = new McpServer({
  name: process.env.MCP_JSON_SERVER_NAME ?? "research-mcp-json-server",
  version: process.env.MCP_JSON_SERVER_VERSION ?? "0.1.0"
});

server.registerTool(
  "health_check",
  {
    description: "Check whether the JSON MCP server is running and which dataset directory it serves.",
    inputSchema: z.object({})
  },
  async () => {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            status: "ok",
            server: process.env.MCP_JSON_SERVER_NAME ?? "research-mcp-json-server",
            dataDir: env.json.dataDir,
            workDir: env.json.workDir,
            timestamp: new Date().toISOString()
          })
        }
      ]
    };
  }
);

registerJsonTools(server);
registerJsonResources(server);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("MCP JSON server failed:", error);
  process.exit(1);
});
