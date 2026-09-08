import "dotenv/config";
import { McpServer, StdioServerTransport } from "@modelcontextprotocol/server";
import { registerPostgresTools } from "./tools.js";
import * as z from "zod/v4";

const server = new McpServer({
  name: process.env.MCP_SERVER_NAME ?? "research-mcp-server",
  version: process.env.MCP_SERVER_VERSION ?? "0.1.0"
});

server.registerTool(
  "health_check",
  {
    description: "Check whether the MCP server is running.",
    inputSchema: z.object({})
  },
  async () => {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            status: "ok",
            server: process.env.MCP_SERVER_NAME ?? "research-mcp-server",
            timestamp: new Date().toISOString()
          })
        }
      ]
    };
  }
);
registerPostgresTools(server);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("MCP server failed:", error);
  process.exit(1);
});
