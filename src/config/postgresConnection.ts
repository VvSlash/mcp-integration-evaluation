import type pg from "pg";
import { env } from "./env.js";

export type DatabaseRole = "ro" | "rw" | "admin";

export function postgresPoolConfig(role: DatabaseRole = "rw"): pg.PoolConfig {
  const connectionString = process.env[role === "ro" ? "POSTGRES_URL_RO" : role === "rw" ? "POSTGRES_URL_RW" : "POSTGRES_URL_ADMIN"];
  if (!connectionString && role !== "admin" && process.env.MCP_EVAL_REQUIRE_ROLES === "1") {
    throw new Error(`POSTGRES_URL_${role.toUpperCase()} is required for the measurement campaign.`);
  }
  const database = process.env.MCP_EVAL_DATABASE;
  if (connectionString) {
    const parsed = new URL(connectionString);
    if (database) parsed.pathname = `/${database}`;
    return { connectionString: parsed.toString(), statement_timeout: 3000, query_timeout: 3000, connectionTimeoutMillis: 3000 };
  }
  const config = env.postgres;
  return {
    host: config.host, port: config.port, database: database ?? config.database,
    user: config.user, password: config.password,
    ssl: config.ssl ? { rejectUnauthorized: false } : false,
    statement_timeout: config.queryTimeoutMs, query_timeout: config.queryTimeoutMs,
    connectionTimeoutMillis: config.queryTimeoutMs
  };
}

export function postgresConnectionUrl(role: DatabaseRole): string {
  const config = postgresPoolConfig(role);
  if (config.connectionString) return config.connectionString;
  return `postgresql://${encodeURIComponent(config.user ?? "")}:${encodeURIComponent(String(config.password ?? ""))}@${config.host}:${config.port}/${encodeURIComponent(config.database ?? "")}`;
}
