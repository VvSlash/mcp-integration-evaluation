import { access, mkdir, readFile, writeFile, appendFile, unlink, readdir } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { loadTestEnvironment } from "./testEnvironment.js";

const exec = promisify(execFile);
const instance=process.env.MCP_TEST_INSTANCE??"";
if(instance&&!/^[a-z0-9_-]+$/.test(instance)) throw new Error("Invalid test instance name");
const credentialFile=instance?`.env.test.${instance}.local`:".env.test.local";
const root = path.resolve(`datasets/.work/postgres${instance?`-${instance}`:""}`);
const data = path.join(root, "data");
const marker = path.join(root, "instance.json");
const exists = async (file: string) => access(file).then(() => true, () => false);
const control = (command: string, args: string[]) => new Promise<void>((resolve, reject) => {
  const child = spawn(command, args, { stdio: "ignore", windowsHide: true });
  child.once("error", reject);
  child.once("exit", code => code === 0 ? resolve() : reject(new Error(`pg_ctl failed (${code}); inspect datasets/.work/postgres/postgres.log`)));
});

async function findBinaries() {
  const pin=JSON.parse(await readFile("config/postgres/windows-binaries.json","utf8")) as {version:string};
  const suffix = process.platform === "win32" ? ".exe" : "";
  const candidates = [process.env.POSTGRES_BIN, path.resolve("third_party/postgres/pgsql/bin")].filter(Boolean) as string[];
  if (process.platform === "win32") {
    const base = path.join(process.env.ProgramFiles ?? "C:/Program Files", "PostgreSQL");
    for (const version of (await readdir(base).catch(() => [])).sort().reverse()) candidates.push(path.join(base, version, "bin"));
  } else {
    for (const dir of (process.env.PATH ?? "").split(path.delimiter)) candidates.push(dir);
    candidates.push("/usr/lib/postgresql/17/bin");
  }
  for (const dir of candidates) if (await exists(path.join(dir, `initdb${suffix}`)) && await exists(path.join(dir, `pg_ctl${suffix}`))) {
    const initdb=path.join(dir, `initdb${suffix}`);
    if(!(await exec(initdb,["--version"])).stdout.trim().endsWith(pin.version)) continue;
    return { initdb, ctl: path.join(dir, `pg_ctl${suffix}`) };
  }
  throw new Error("PostgreSQL binaries missing. On Windows run scripts/setup/windows/install_postgres_binaries.ps1; elsewhere install PostgreSQL 17 binaries or set POSTGRES_BIN. No database service/admin account is required.");
}

export async function bootstrapPostgres(action: "start" | "stop" = "start") {
  const binaries = await findBinaries();
  const present = await exists(marker);
  if (action === "stop") {
    if (!present) return { stopped: false, reason: "No repository-owned instance" };
    const ownership=JSON.parse(await readFile(marker,"utf8"));
    if(ownership.owner!=="mcp-integration-evaluation"||ownership.data!==data) throw new Error("Invalid instance ownership marker");
    const status = await exec(binaries.ctl, ["status", "-D", data]).then(() => true, () => false);
    if (status) await control(binaries.ctl, ["stop", "-D", data, "-m", "fast", "-w"]);
    return { stopped: status, dataRetained: true };
  }
  await mkdir(root, { recursive: true });
  if (!present) {
    if(await exists(credentialFile)) throw new Error(`Existing ${credentialFile} without an instance marker; refusing to replace it.`);
    if (await exists(data)) throw new Error("Unmarked PostgreSQL data directory exists; refusing to overwrite it.");
    const port = Number(process.env.MCP_TEST_POSTGRES_PORT ?? 55432);
    if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Invalid MCP_TEST_POSTGRES_PORT");
    const password = randomBytes(24).toString("hex");
    const pwfile = path.join(root, "init-password.tmp");
    await writeFile(pwfile, password, { mode: 0o600, flag: "wx" });
    try {
      await exec(binaries.initdb, ["-D", data, "-U", "mcp_test_admin", "--pwfile", pwfile, "--auth=scram-sha-256", "--encoding=UTF8", "--locale=C"], { timeout: 120000 });
    } finally { await unlink(pwfile).catch(() => undefined); }
    await appendFile(path.join(data, "postgresql.conf"), `\nlisten_addresses = '127.0.0.1'\nport = ${port}\ntimezone = 'UTC'\n`);
    const database = instance?`mcp_eval_${instance.replaceAll("-","_")}`:"mcp_eval_test";
    const adminUrl = `postgresql://mcp_test_admin:${password}@127.0.0.1:${port}/${database}`;
    await writeFile(credentialFile, `# Generated disposable test environment. Never commit.\nMCP_EVAL_DATABASE=${database}\nMCP_EVAL_REQUIRE_ROLES=1\nPOSTGRES_URL_ADMIN=${adminUrl}\n`, { mode: 0o600, flag: "wx" });
    await writeFile(marker, JSON.stringify({ owner: "mcp-integration-evaluation", data, port, database, createdAt: new Date().toISOString(), version: (await exec(binaries.initdb, ["--version"])).stdout.trim() }, null, 2));
  }
  const ownership = JSON.parse(await readFile(marker, "utf8"));
  if (ownership.owner !== "mcp-integration-evaluation" || ownership.data !== data) throw new Error("Invalid instance ownership marker");
  const started = await exec(binaries.ctl, ["status", "-D", data]).then(() => true, () => false);
  if (!started) await control(binaries.ctl, ["start", "-D", data, "-l", path.join(root, "postgres.log"), "-w", "-t", "30"]);
  loadTestEnvironment(credentialFile);
  const { setupWorkingDatabase } = await import("./postgresFixture.js");
  return { isolatedInstance: ownership, ...(await setupWorkingDatabase(credentialFile)) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  bootstrapPostgres(process.argv.includes("--stop") ? "stop" : "start").then(result => console.log(JSON.stringify(result, null, 2))).catch(error => {
    console.error(error instanceof Error ? error.message : "Test DB bootstrap failed"); process.exitCode = 1;
  });
}
