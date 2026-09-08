import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import { connectServers } from "../clients/mcpClientFactory.js";
import { OWN_SERVERS, THIRD_PARTY_SERVERS } from "../runners/mcp/serverRegistry.js";
import { compareCatalog, snapshotCatalog, type CatalogTool, type CatalogSnapshot } from "../shared/catalogSnapshot.js";

type JsonObject = Record<string, unknown>;
const object = (value: unknown): JsonObject => value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {};
const BOUNDS = ["enum", "const", "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "minLength", "maxLength", "pattern", "format", "minItems", "maxItems"];

export function describeSchema(schema: unknown) {
  let fields = 0, bounded = 0, required = 0, depth = 0;
  const visit = (value: unknown, level: number) => {
    if (!value || typeof value !== "object") return;
    depth = Math.max(depth, level);
    const current = object(value);
    required += Array.isArray(current.required) ? current.required.length : 0;
    for (const property of Object.values(object(current.properties))) {
      fields++;
      if (BOUNDS.some(key => object(property)[key] !== undefined)) bounded++;
      visit(property, level + 1);
    }
    if (current.items) visit(current.items, level + 1);
    for (const key of ["anyOf", "oneOf", "allOf"]) if (Array.isArray(current[key])) for (const part of current[key]) visit(part, level + 1);
  };
  visit(schema, 0);
  return { fields, bounded, required, depth };
}

export function toolEffect(server: string, tool: CatalogTool): "read" | "write" | "unknown" {
  if (server === "sql-controlled" || server === "sql-generic" || server === "duckduckgo-mcp") return "read";
  if (server === "sql-minimal") return tool.name === "health_check" ? "read" : "write";
  if (server === "json") return tool.name === "json_update_value" ? "write" : "read";
  if (server === "rest-api") return tool.name === "rest_create_order" ? "write" : "read";
  if (server === "blender") return tool.name === "blender_get_scene_summary" ? "read" : "write";
  if (server === "sql-mcp") return ["pg_execute_query", "pg_analyze_database", "pg_debug_database", "pg_monitor_database"].includes(tool.name) ? "read" : "write";
  if (["poll_hunyuan_job_status","poll_rodin_job_status","directory_tree","validate_excel_range","validate_formula_syntax"].includes(tool.name)) return "read";
  if (["set_texture","import_generated_asset","import_generated_asset_hunyuan","apply_formula","insert_columns","insert_rows","merge_cells","unmerge_cells"].includes(tool.name)) return "write";
  if (/^(read_|list_|get_|search_|describe_|find_)/.test(tool.name)) return "read";
  if (/(write|create|edit|delete|remove|move|execute|format|material|asset|download|generate|rename|copy)/.test(tool.name)) return "write";
  return "unknown";
}

export function analyzeContract(serverName: string, tools: CatalogTool[]) {
  const descriptions = tools.map(tool => describeSchema(tool.inputSchema));
  const fields = descriptions.reduce((sum, item) => sum + item.fields, 0);
  const bounded = descriptions.reduce((sum, item) => sum + item.bounded, 0);
  const effects = tools.map(tool => ({ name: tool.name, effect: toolEffect(serverName, tool) }));
  const violations = tools.flatMap(tool => [
    ...(tool.name.length > 64 ? [`${tool.name}: name exceeds 64 characters`] : []),
    ...(!tool.inputSchema || object(tool.inputSchema).type !== "object" ? [`${tool.name}: root inputSchema is not object`] : [])
  ]);
  if (tools.length > 128) violations.push("catalog exceeds 128 tools");
  const resources = ["sql-controlled", "sql-generic"].includes(serverName) ? ["public.orders"]
    : serverName === "json" ? ["datasets/json", "datasets/.work/json"]
      : serverName === "json-mcp" ? ["datasets/.work/json-mcp"] : [];
  return {
    serverName, toolsCount: tools.length, toolEffects: effects,
    stateChangingToolsCount: effects.filter(effect => effect.effect === "write").length,
    unknownEffectTools: effects.filter(effect => effect.effect === "unknown").map(effect => effect.name),
    schemaValidatedArgsRatio: fields ? bounded / fields : 0,
    allowListedResourcesCount: resources.length, allowedResources: resources,
    constraintViolationsCount: null as number|null, constraintViolations: [] as unknown[],
    localSanityChecks: violations, constraintInspectionSource: "not-inspected", effectClassification: "reviewed own implementation; third-party documented operation capability (not OS isolation)",
    fieldsCount: fields, boundedFieldsCount: bounded,
    requiredFieldsCount: descriptions.reduce((sum, item) => sum + item.required, 0),
    maxSchemaDepth: Math.max(0, ...descriptions.map(item => item.depth)),
    descriptionChars: tools.reduce((sum, tool) => sum + (tool.description?.length ?? 0), 0),
    catalogSchemaChars: JSON.stringify(tools).length,
    exposedTools: tools.map(tool => tool.name)
  };
}

export async function inspectContract(server:string,tools:CatalogTool[]) {
  const snapshot=snapshotCatalog(server,tools);
  const python=process.platform==="win32"?"third_party/eval-frameworks/mcp-interviewer/.venv/Scripts/python.exe":"third_party/eval-frameworks/mcp-interviewer/.venv/bin/python";
  const report=await new Promise<Record<string,unknown>>((resolve,reject)=>{
    const child=spawn(python,["scripts/data/inspect_catalog_constraints.py"],{stdio:["pipe","pipe","pipe"],env:{...process.env,PYTHONUTF8:"1"},windowsHide:true});
    let output="",errors="";
    const timer=setTimeout(()=>{child.kill();reject(new Error("Constraint inspection timed out"));},30000);
    child.stdout.on("data",data=>output+=data);child.stderr.on("data",data=>errors+=data);
    child.once("error",error=>{clearTimeout(timer);reject(error);});
    child.once("close",code=>{clearTimeout(timer);if(code!==0)reject(new Error(`mcp-interviewer static inspection failed: ${errors}`));else{try{resolve(JSON.parse(output));}catch(error){reject(error);}}});
    child.stdin.end(JSON.stringify(snapshot));
  });
  return {...analyzeContract(server,tools),constraintViolationsCount:Number(report.constraintViolationsCount),constraintViolations:report.violations as unknown[],constraintInspectionSource:`mcp-interviewer@${report.version} static-catalog`,interviewerReport:report};
}

export async function readCatalogBaseline(server: string): Promise<CatalogSnapshot | null> {
  try { return JSON.parse(await readFile(path.join("third_party", server, "catalog.baseline.json"), "utf8")) as CatalogSnapshot; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
}

async function main() {
  const args = process.argv.slice(2);
  const selected = args[args.indexOf("--server") + 1] ?? "all";
  const names = args.includes("--server") && selected !== "all" ? selected.split(",") : [...Object.keys(OWN_SERVERS), ...Object.keys(THIRD_PARTY_SERVERS)].sort();
  const output = args.includes("--out") ? args[args.indexOf("--out") + 1]! : path.join("results", "raw", `contract-${new Date().toISOString().replace(/[:.]/g, "-")}`);
  await mkdir(output, { recursive: true });
  const contracts: unknown[] = [], snapshots: CatalogSnapshot[] = [], failures: unknown[] = [];
  for (const name of names) {
    let catalog;
    try {
      catalog = await connectServers([name]);
      const snapshot = snapshotCatalog(name, catalog.rawCatalogs[name] ?? []);
      snapshots.push(snapshot);
      const baseline = Object.hasOwn(THIRD_PARTY_SERVERS, name) ? await readCatalogBaseline(name) : null;
      if (!baseline && args.includes("--initialize-baseline") && Object.hasOwn(THIRD_PARTY_SERVERS, name)) {
        await writeFile(path.join("third_party", name, "catalog.baseline.json"), JSON.stringify(snapshot, null, 2), { encoding: "utf8", flag: "wx" });
      }
      contracts.push({ ...await inspectContract(name, snapshot.tools), baselineAvailable: baseline !== null, ...(baseline ? compareCatalog(baseline, snapshot) : { catalogDriftDetected: null, catalogDriftedTools: [] }) });
      console.log(`${name}: ${snapshot.tools.length} tools, ${snapshot.digest}`);
    } catch (error) { failures.push({ server: name, error: error instanceof Error ? error.message : String(error) }); }
    finally { await catalog?.close(); }
  }
  await writeFile(path.join(output, "contract-manifest.json"), JSON.stringify({ contracts, failures }, null, 2));
  await writeFile(path.join(output, "catalog-snapshot.json"), JSON.stringify(snapshots, null, 2));
  console.log(JSON.stringify({ output, completed: contracts.length, failures }, null, 2));
  if (failures.length) process.exitCode = 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main().catch(error => { console.error(error); process.exitCode = 1; });
