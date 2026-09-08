import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { PostgresAdapter } from "../../adapters/postgresAdapter.js";
import { env } from "../../config/env.js";
const postgres = new PostgresAdapter("ro");
const orderStatusSchema = z.enum([
  "pending",
  "paid",
  "shipped",
  "cancelled",
  "refunded"
]);
export function registerPostgresTools(server: McpServer) {
  server.registerTool(
    "pg_health_check",
    {
      description: "Check whether the PostgreSQL database connection works.",
      inputSchema: z.object({})
    },
    async () => {
      try {
        const result = await postgres.healthCheck();

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result)
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
                message: error instanceof Error ? error.message : "Unknown PostgreSQL error"
              })
            }
          ]
        };
      }
    }
  );
  server.registerTool(
    "pg_search_orders",
    {
      description:
        "Search read-only order records in PostgreSQL using constrained filters.",
      inputSchema: z.object({
        status: orderStatusSchema.optional(),
        customerEmail: z.string().email().optional(),
        minAmount: z.number().nonnegative().optional(),
        maxAmount: z.number().nonnegative().optional(),
        limit: z.number().int().positive().max(env.tools.maxLimit).optional()
      })
    },
    async (args) => {
      try {
        const rows = await postgres.searchOrders({
          status: args.status,
          customerEmail: args.customerEmail,
          minAmount: args.minAmount,
          maxAmount: args.maxAmount,
          limit: args.limit
        });
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                count: rows.length,
                orders: rows
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
                code: "POSTGRES_SEARCH_ORDERS_FAILED",
                message: error instanceof Error ? error.message : "Unknown PostgreSQL error"
              })
            }
          ]
        };
      }
    }
  );

  server.registerTool(
    "pg_get_order_statistics",
    {
      description:
        "Aggregate read-only order statistics grouped by status or currency: order count, total and average total_amount per group. Optional created_at range filter (ISO 8601 timestamps).",
      inputSchema: z.object({
        groupBy: z.enum(["status", "currency"]),
        dateFrom: z.string().optional(),
        dateTo: z.string().optional()
      })
    },
    async (args) => {
      try {
        const rows = await postgres.getOrderStatistics({
          groupBy: args.groupBy,
          dateFrom: args.dateFrom,
          dateTo: args.dateTo
        });
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                groupBy: args.groupBy,
                groups: rows.length,
                statistics: rows
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
                code: "POSTGRES_ORDER_STATISTICS_FAILED",
                message: error instanceof Error ? error.message : "Unknown PostgreSQL error"
              })
            }
          ]
        };
      }
    }
  );
}
