import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { getPostgresSqlPool } from "../../adapters/postgresSqlPool.js";

export function registerPostgresSqlTools(server: McpServer): void {
  const pool = getPostgresSqlPool();

  server.registerTool(
    "execute_read_query",
    {
      description:
        "Read data using SELECT statements. Pass a complete PostgreSQL SQL query in the `sql` field. Returns rowCount, rows and field names.",
      inputSchema: z.object({
        sql: z.string()
      })
    },
    async ({ sql }) => {
      try {
        const result = await pool.query(sql);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                rowCount: result.rowCount ?? result.rows.length,
                fields: result.fields.map((field) => field.name),
                rows: result.rows
              })
            }
          ]
        };
      } catch (error) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: JSON.stringify({
                code: "POSTGRES_QUERY_FAILED",
                message:
                  error instanceof Error ? error.message : "Unknown PostgreSQL error",
                sql
              })
            }
          ]
        };
      }
    }
  );

  server.registerTool(
    "execute_write_query",
    {
      description:
        "Modify data using INSERT, UPDATE or DELETE. Pass a complete PostgreSQL SQL query in the `sql` field. Returns rowCount, rows and field names.",
      inputSchema: z.object({
        sql: z.string()
      })
    },
    async ({ sql }) => {
      try {
        const result = await pool.query(sql);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                rowCount: result.rowCount ?? result.rows.length,
                fields: result.fields.map((field) => field.name),
                rows: result.rows
              })
            }
          ]
        };
      } catch (error) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: JSON.stringify({
                code: "POSTGRES_QUERY_FAILED",
                message:
                  error instanceof Error ? error.message : "Unknown PostgreSQL error",
                sql
              })
            }
          ]
        };
      }
    }
  );

  server.registerTool(
    "health_check",
    {
      description: "Check whether the alternative MCP SQL server and PostgreSQL connection are alive.",
      inputSchema: z.object({})
    },
    async () => {
      try {
        const result = await pool.query<{ now: Date }>("SELECT NOW() AS now");
        const row = result.rows[0];

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                status: "ok",
                databaseTime: row?.now.toISOString() ?? null
              })
            }
          ]
        };
      } catch (error) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: JSON.stringify({
                code: "POSTGRES_HEALTH_CHECK_FAILED",
                message:
                  error instanceof Error ? error.message : "Unknown PostgreSQL error"
              })
            }
          ]
        };
      }
    }
  );
}
