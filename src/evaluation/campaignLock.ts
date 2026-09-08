import pg from "pg";
import { postgresPoolConfig } from "../config/postgresConnection.js";
export async function acquireCampaignLock() {
  const client=new pg.Client(postgresPoolConfig("admin"));await client.connect();
  try {
    const result=await client.query("SELECT pg_try_advisory_lock(66002426) AS acquired");
    if(!result.rows[0]?.acquired) throw new Error("Another campaign owns the fixture lock; do not run shared-fixture measurements concurrently");
  } catch(error){await client.end();throw error;}
  return async()=>{await client.end();};
}
