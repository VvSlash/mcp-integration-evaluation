import { config } from "dotenv";

export function loadTestEnvironment(file = ".env.test.local") {
  const loaded = config({ path: file, override: true, quiet: true });
  if (loaded.error) throw new Error("Test environment missing: run npm run setup:test-db first.");
  for(const key of ["POSTGRES_URL_RO","POSTGRES_URL_RW"]) if(!loaded.parsed?.[key]) process.env[key]="";
}
