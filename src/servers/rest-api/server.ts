import "dotenv/config";
import { McpServer, StdioServerTransport } from "@modelcontextprotocol/server";
import { env } from "../../config/env.js";
import { registerRestResources } from "./resources.js";
import { registerRestTools } from "./tools.js";

const server = new McpServer({
  name: process.env.MCP_REST_SERVER_NAME ?? "research-mcp-rest-server",
  version: process.env.MCP_REST_SERVER_VERSION ?? "0.1.0"
});

registerRestTools(server, env.restApi.baseUrl);
registerRestResources(server, env.restApi.baseUrl);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("MCP REST server failed:", error);
  process.exit(1);
});
