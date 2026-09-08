import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, writeFile } from "node:fs/promises";
const exec=promisify(execFile);
const instance=`bootstrap-${Date.now()}`;
const environment={...process.env,MCP_TEST_INSTANCE:instance,MCP_TEST_POSTGRES_PORT:"55433",POSTGRES_URL_RO:"",POSTGRES_URL_RW:""};
const events:unknown[]=[];
async function step(name:string,args:string[]=[]) {
  const started=new Date().toISOString();
  const result=await exec(process.execPath,["dist/evaluation/bootstrapPostgres.js",...args],{env:environment,windowsHide:true,timeout:120000});
  const evidence=JSON.parse(result.stdout);
  if(!args.length&&(!evidence.ro.privilegeSeparationEnforced||!evidence.rw.privilegeSeparationEnforced)) throw new Error("Privilege probes failed");
  events.push({name,started,finished:new Date().toISOString(),evidence});
}
let failure:string|null=null;
try {await step("fresh initdb/database/roles");await step("idempotent repeated setup");await step("stop",["--stop"]);await step("restart");}
catch(error){failure=error instanceof Error?error.message:String(error);}
finally{try{await step("final stop",["--stop"]);}catch(error){failure??=String(error);}}
const out=`results/raw/${instance}`;await mkdir(out,{recursive:true});
await writeFile(`${out}/setup-verification.json`,JSON.stringify({instance,events,failure,scope:"Fresh cluster, users and database on preinstalled pinned binaries; no clean-VM dependency claim"},null,2));
console.log(JSON.stringify({output:out,steps:events.length,failure}));if(failure)process.exitCode=1;
