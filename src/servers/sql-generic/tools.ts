import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { PostgresGenericAdapter } from "../../adapters/postgresGenericAdapter.js";

export function registerGenericTools(server: McpServer) {
  const adapter = new PostgresGenericAdapter();
  const value = z.union([z.string(), z.number(), z.boolean()]);
  const table = z.string().min(1), column = z.string().min(1);
  const limit = z.number().int().min(1).max(50).optional();
  const execute = async (action: () => Promise<unknown>) => {
    try { return { content: [{ type: "text" as const, text: JSON.stringify(await action()) }] }; }
    catch (error) { return { isError: true, content: [{ type: "text" as const, text: JSON.stringify({ code: "GENERIC_QUERY_FAILED", message: error instanceof Error ? error.message : "Query failed" }) }] }; }
  };
  server.registerTool("health_check", { description: "Check connection.", inputSchema: z.object({}) }, () => execute(() => adapter.health()));
  server.registerTool("list_tables", { description: "List tables.", inputSchema: z.object({}) }, () => execute(async () => ({ tables: Object.keys(await adapter.catalog()) })));
  server.registerTool("read_table", { description: "Read rows.", inputSchema: z.object({ table, limit, offset: z.number().int().nonnegative().optional() }) }, args => execute(() => adapter.query("read", args)));
  server.registerTool("filter_rows", { description: "Filter rows.", inputSchema: z.object({ table, column, operator: z.enum(["eq", "gt", "lt", "gte", "lte"]), value, limit }) }, args => execute(() => adapter.query("filter", args)));
  server.registerTool("count_rows", { description: "Count rows.", inputSchema: z.object({ table, column: column.optional(), value: value.optional() }) }, args => execute(() => adapter.query("count", args)));
  return adapter;
}
