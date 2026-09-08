import "dotenv/config";
import { McpServer, StdioServerTransport } from "@modelcontextprotocol/server";
import { registerPostgresSqlTools } from "./tools.js";
import { registerPostgresSchemaResources } from "./resources.js";

const server = new McpServer({
  name: process.env.MCP_SQL_SERVER_NAME ?? "research-mcp-sql-server",
  version: process.env.MCP_SQL_SERVER_VERSION ?? "0.1.0"
});

registerPostgresSqlTools(server);
registerPostgresSchemaResources(server);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("MCP SQL server failed:", error);
  process.exit(1);
});
