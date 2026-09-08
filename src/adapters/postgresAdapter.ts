import pg from "pg";
import { env } from "../config/env.js";
import { postgresPoolConfig, type DatabaseRole } from "../config/postgresConnection.js";

const { Pool } = pg;

export type OrderStatus =
  | "pending"
  | "paid"
  | "shipped"
  | "cancelled"
  | "refunded";

export type SearchOrdersParams = {
  status?: OrderStatus | undefined;
  customerEmail?: string | undefined;
  minAmount?: number | undefined;
  maxAmount?: number | undefined;
  limit?: number | undefined;
};

export type OrderRow = {
  id: number;
  customer_name: string;
  customer_email: string;
  status: OrderStatus;
  total_amount: string;
  currency: string;
  created_at: Date;
};

export type OrderStatisticsGroupBy = "status" | "currency";

export type OrderStatisticsParams = {
  groupBy: OrderStatisticsGroupBy;
  dateFrom?: string | undefined;
  dateTo?: string | undefined;
};

export type OrderStatisticsRow = {
  group_value: string;
  order_count: number;
  total_amount_sum: string;
  total_amount_avg: string;
};

const ORDER_STATISTICS_COLUMNS: Record<OrderStatisticsGroupBy, string> = {
  status: "status",
  currency: "currency"
};

export function buildOrderStatisticsQuery(params: OrderStatisticsParams): {
  text: string;
  values: Array<string | null>;
} {
  const column = ORDER_STATISTICS_COLUMNS[params.groupBy];

  return {
    text: `
      SELECT
        ${column}::text AS group_value,
        COUNT(*)::int AS order_count,
        COALESCE(SUM(total_amount), 0)::text AS total_amount_sum,
        COALESCE(ROUND(AVG(total_amount), 2), 0)::text AS total_amount_avg
      FROM orders
      WHERE
        ($1::timestamp IS NULL OR created_at >= $1)
        AND ($2::timestamp IS NULL OR created_at <= $2)
      GROUP BY ${column}
      ORDER BY ${column}
    `,
    values: [params.dateFrom ?? null, params.dateTo ?? null]
  };
}

export class PostgresAdapter {
  private readonly pool: pg.Pool;

  constructor(role: DatabaseRole = "rw") {
    this.pool = new Pool(postgresPoolConfig(role));
  }

  async healthCheck(): Promise<{ status: "ok"; databaseTime: string }> {
    const result = await this.pool.query<{ now: Date }>("SELECT NOW() AS now");
    const row = result.rows[0];
    if (!row) {
      throw new Error("Health check returned no rows");
    }

    return {
      status: "ok",
      databaseTime: row.now.toISOString()
    };
  }

  async searchOrders(params: SearchOrdersParams): Promise<OrderRow[]> {
    const limit = Math.min(params.limit ?? 10, env.tools.maxLimit);

    const result = await this.pool.query<OrderRow>(
      `
      SELECT
        id,
        customer_name,
        customer_email,
        status,
        total_amount,
        currency,
        created_at
      FROM orders
      WHERE
        ($1::text IS NULL OR status = $1)
        AND ($2::text IS NULL OR customer_email = $2)
        AND ($3::numeric IS NULL OR total_amount >= $3)
        AND ($4::numeric IS NULL OR total_amount <= $4)
      ORDER BY created_at DESC
      LIMIT $5
      `,
      [
        params.status ?? null,
        params.customerEmail ?? null,
        params.minAmount ?? null,
        params.maxAmount ?? null,
        limit
      ]
    );

    return result.rows;
  }

  async getOrderStatistics(params: OrderStatisticsParams): Promise<OrderStatisticsRow[]> {
    const query = buildOrderStatisticsQuery(params);
    const result = await this.pool.query<OrderStatisticsRow>(query.text, query.values);
    return result.rows;
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

