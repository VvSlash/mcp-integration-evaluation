import pg from "pg";
import { postgresPoolConfig } from "../config/postgresConnection.js";

export type TableCatalog = Record<string, readonly string[]>;
export type GenericQuery = {
  table: string; column?: string | undefined; operator?: "eq" | "gt" | "lt" | "gte" | "lte" | undefined;
  value?: string | number | boolean | undefined; limit?: number | undefined; offset?: number | undefined;
};
const OPERATORS = { eq: "=", gt: ">", lt: "<", gte: ">=", lte: "<=" } as const;
const quote = (identifier: string) => `"${identifier.replaceAll('"', '""')}"`;

export function buildGenericQuery(operation: "read" | "filter" | "count", args: GenericQuery, catalog: TableCatalog) {
  if (!Object.hasOwn(catalog, args.table)) throw new Error("GENERIC_TABLE_NOT_ALLOWED");
  const columns = catalog[args.table]!;
  if (args.column && !columns.includes(args.column)) throw new Error("GENERIC_COLUMN_NOT_ALLOWED");
  if (operation === "filter" && (!args.column || !args.operator || args.value === undefined)) throw new Error("GENERIC_FILTER_REQUIRED");
  if (args.operator && !Object.hasOwn(OPERATORS, args.operator)) throw new Error("GENERIC_OPERATOR_NOT_ALLOWED");
  if (operation === "count" && ((args.column !== undefined) !== (args.value !== undefined))) throw new Error("GENERIC_COUNT_FILTER_INCOMPLETE");
  const limit = args.limit ?? 50, offset = args.offset ?? 0;
  if (!Number.isInteger(limit) || limit < 1 || limit > 50 || !Number.isInteger(offset) || offset < 0) throw new Error("GENERIC_INVALID_PAGE");
  const values: Array<string | number | boolean> = [];
  const filter = args.column && args.value !== undefined;
  const where = filter ? ` WHERE ${quote(args.column!)} ${OPERATORS[args.operator ?? "eq"]} $${values.push(args.value!)}` : "";
  const select = operation === "count" ? "COUNT(*)::int AS count" : "*";
  const page = operation === "count" ? "" : ` ORDER BY ${quote(columns[0]!)} DESC LIMIT $${values.push(limit)} OFFSET $${values.push(offset)}`;
  return { text: `SELECT ${select} FROM public.${quote(args.table)}${where}${page}`, values };
}

export class PostgresGenericAdapter {
  private readonly pool = new pg.Pool(postgresPoolConfig("ro"));
  async catalog(): Promise<TableCatalog> {
    const result = await this.pool.query<{ table_name: string; column_name: string }>(
      "SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position", ["orders"]
    );
    const catalog: TableCatalog = Object.create(null) as TableCatalog;
    for (const row of result.rows) catalog[row.table_name] = [...(catalog[row.table_name] ?? []), row.column_name];
    return catalog;
  }
  async query(operation: "read" | "filter" | "count", args: GenericQuery) {
    const query = buildGenericQuery(operation, args, await this.catalog());
    const result = await this.pool.query(query.text, query.values);
    return operation === "count" ? { count: Number(result.rows[0]?.count) } : { rows: result.rows, rowCount: result.rowCount };
  }
  async health() { await this.pool.query("SELECT 1"); return { status: "ok" }; }
  async close() { await this.pool.end(); }
}
