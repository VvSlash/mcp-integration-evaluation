import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { loadScenariosFromDir } from "../shared/scenarioLoader.js";
import { runCampaign, type CampaignOptions } from "./runCampaign.js";
import { runNormalize } from "../evaluation/normalize.js";
import { sha256 } from "../shared/catalogSnapshot.js";
import { campaignProvenance } from "../evaluation/campaignProvenance.js";
import { OllamaChatClient } from "../clients/ollama/ollamaClient.js";

export async function suitePlan(campaign:string,phase:"pilot"|"final") {
  const {scenarios}=await loadScenariosFromDir("scenarios");
  const jobs:CampaignOptions[]=[];
  const add=(server:string,mode:CampaignOptions["mode"],ids:string[],catalog:"scenario"|"full"="scenario",security=false)=>{
    for(let run=1;run<=(phase==="final"&&!security?2:1);run++) jobs.push({campaign,phase,server,mode,scenarios:ids,catalog,
      iterations:security?1:mode==="baseline"||mode==="mcp"?(phase==="final"?30:2):(phase==="final"?10:1),
      warmups:security?0:mode==="baseline"||mode==="mcp"?2:phase==="final"?1:0,
      maxTurns:6,schema:"shared",resume:true,runId:`${campaign}-${run}-${mode}-${server}-${catalog}${security?"-security":""}`});
  };
  for(const server of ["sql","rest"]) add(server,"baseline",scenarios.filter(s=>s.variant==="baseline"&&s.category===server).map(s=>s.id));
  for(const server of ["sql-controlled","sql-generic","sql-minimal","json","rest-api"]) add(server,"mcp",scenarios.filter(s=>s.variant==="mcp"&&s.server===server).map(s=>s.id));
  const pilot:Record<string,string[]>={"sql-controlled":["SQL-001","SQL-007"],"sql-generic":["SQL-001","SQL-007"],"sql-minimal":["SQL-001","SQL-006","SQL-007"],json:["JSON-002","JSON-004"],"rest-api":["REST-003","REST-004"],blender:["BLEND-001"],cross:["XSRV-001","XSRV-002"],"sql-mcp":["SQL-001"],"json-mcp":["JSON-002","JSON-004"],"excel-mcp":["XLSX-001","XLSX-004"],"duckduckgo-mcp":["WEB-001"],"blender-mcp":["BLEND-001"]};
  for(const server of Object.keys(pilot)) {
    const all=scenarios.filter(s=>(s.server===server||(server==="cross"&&s.category==="cross"))&&(s.variant==="mcp_llm"||s.variant==="third_party_mcp_llm")&&!s.id.startsWith("SEC-")).map(s=>s.id);
    add(server,"llm",phase==="pilot"?pilot[server]!:all);
    if(phase==="final"&&["sql-controlled","sql-generic","sql-minimal","json","rest-api","blender","cross"].includes(server)) add(server,"llm",all,"full");
  }
  if(phase==="pilot") add("sql-controlled","llm",["SQL-001"],"full");
  for(const server of phase==="pilot"?["sql-controlled"]:["sql-controlled","json","rest-api","excel-mcp"]) {
    const ids=scenarios.filter(s=>s.server===server&&(s.variant==="mcp_llm"||s.variant==="third_party_mcp_llm")&&!s.id.startsWith("SEC-")&&!['JSON-004','REST-004','XLSX-004'].includes(s.id)).map(s=>s.id);
    add(server,"llm_only",phase==="pilot"?["SQL-001"]:ids);
  }
  for(const server of ["sql-controlled","sql-generic","sql-minimal","sql-mcp"]) add(server,"llm",["SEC-001","SEC-002","SEC-003"],"scenario",true);
  return {campaign,phase,jobs,measuredAttempts:jobs.reduce((n,j)=>n+j.scenarios.length*j.iterations,0),qualitativeSecurityAttempts:12};
}

async function main() {
  const args=process.argv.slice(2),get=(key:string,fallback:string)=>args.includes(key)?args[args.indexOf(key)+1]??fallback:fallback;
  const phase=get("--phase","pilot");if(phase!=="pilot"&&phase!=="final")throw new Error("Invalid phase");
  const campaign=get("--campaign",phase==="pilot"?"pilot":"final");
  if(!/^[a-zA-Z0-9_-]+$/.test(campaign))throw new Error("Invalid campaign ID");
  const plan=await suitePlan(campaign,phase);
  const out=path.join("results/raw",`${campaign}-suite`);await mkdir(out,{recursive:true});
  await writeFile(path.join(out,"plan.json"),JSON.stringify(plan,null,2));
  if(args.includes("--plan")){console.log(JSON.stringify({plan:path.join(out,"plan.json"),jobs:plan.jobs.length,attempts:plan.measuredAttempts}));return;}
  const selected=args.includes("--only")?plan.jobs.filter(job=>job.runId!.includes(get("--only",""))):plan.jobs;
  const outcomes:unknown[]=[];
  for(const job of selected) {
    const exists=await readFile(path.join("results/raw",job.runId!,"manifest.json"),"utf8").then(()=>true,()=>false);
    console.log(`SUITE ${job.runId}`);
    try {const result=await runCampaign({...job,resume:exists});outcomes.push({runId:result.runId,status:"completed",records:result.records.length});}
    catch(error){outcomes.push({runId:job.runId,status:"interrupted",reason:error instanceof Error?error.message:String(error)});}
    await writeFile(path.join(out,"suite-progress.json"),JSON.stringify({campaign,outcomes},null,2));
  }
  const normalized=await runNormalize({campaign,rawDir:"results/raw",outDir:path.join("results/normalized",campaign)});
  console.log(JSON.stringify({campaign,outcomes,normalized:normalized.records.length,warnings:normalized.warnings}));
  if(outcomes.some(outcome=>(outcome as {status:string}).status==="interrupted")||normalized.warnings.length)process.exitCode=1;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main().catch(error=>{console.error(error);process.exitCode=1;});
