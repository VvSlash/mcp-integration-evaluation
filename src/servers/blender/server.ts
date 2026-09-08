import "dotenv/config";
import { McpServer, StdioServerTransport } from "@modelcontextprotocol/server";
import { registerBlenderResources } from "./resources.js";
import { registerBlenderTools } from "./tools.js";

const server = new McpServer({
  name: process.env.MCP_BLENDER_SERVER_NAME ?? "research-mcp-blender-server",
  version: process.env.MCP_BLENDER_SERVER_VERSION ?? "0.1.0"
});

registerBlenderTools(server);
registerBlenderResources(server);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("MCP Blender server failed:", error);
  process.exit(1);
});
