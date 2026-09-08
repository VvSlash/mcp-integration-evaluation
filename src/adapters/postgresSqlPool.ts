import pg from "pg";
import { postgresPoolConfig } from "../config/postgresConnection.js";

const { Pool } = pg;

let sharedPool: pg.Pool | null = null;

export function getPostgresSqlPool(): pg.Pool {
  if (sharedPool === null) {
    sharedPool = new Pool(postgresPoolConfig("rw"));
  }

  return sharedPool;
}

export async function closePostgresSqlPool(): Promise<void> {
  if (sharedPool !== null) {
    await sharedPool.end();
    sharedPool = null;
  }
}
