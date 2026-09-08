import "dotenv/config";
import { McpServer, StdioServerTransport } from "@modelcontextprotocol/server";
import { registerGenericTools } from "./tools.js";
const server = new McpServer({ name: "sql-generic", version: "0.1.0" });
const adapter = registerGenericTools(server);
server.connect(new StdioServerTransport()).catch(async () => { await adapter.close(); process.exitCode = 1; });
