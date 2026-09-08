import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { sha256 } from "../shared/catalogSnapshot.js";
import type { ResultRecord } from "../shared/resultRecord.js";
import type { CampaignOptions } from "../runners/runCampaign.js";

const args=process.argv.slice(2),campaign=args[args.indexOf("--campaign")+1];
if(!args.includes("--campaign")||!campaign||!/^[a-zA-Z0-9_-]+$/.test(campaign))throw new Error("Specify --campaign ID");
const json=async(file:string)=>JSON.parse(await readFile(file,"utf8"));
const lines=async(file:string)=>(await readFile(file,"utf8")).split(/\r?\n/).filter(Boolean).map(line=>JSON.parse(line));
const directory=path.join("results/raw",`${campaign}-suite`),plan=await json(path.join(directory,"plan.json"));
const checks:{name:string;passed:boolean;detail:unknown}[]=[],all:ResultRecord[]=[],sources=new Set<string>(),models=new Set<string>(),contracts=new Set<string>();
const check=(name:string,passed:boolean,detail:unknown=null)=>checks.push({name,passed,detail});
for(const job of plan.jobs as CampaignOptions[]) {
  const base=path.join("results/raw",job.runId!);
  try {
    const manifest=await json(path.join(base,"manifest.json")),records=await json(path.join(base,"measurements.json")) as ResultRecord[];
    const journal=await lines(path.join(base,"checkpoints.jsonl")),transcripts=await lines(path.join(base,"transcripts.jsonl"));
    all.push(...records);sources.add(manifest.provenance.source.digest);
    if(manifest.provenance.model?.digest)models.add(manifest.provenance.model.digest);
    check(`${job.runId}: status`,manifest.status==="completed",manifest.status);
    check(`${job.runId}: checkpoint consistency`,sha256(journal)===sha256(records));
    const keys=records.map(r=>`${r.scenarioId}/${r.iteration}`);
    const wanted=job.scenarios.flatMap(id=>Array.from({length:job.iterations},(_,n)=>`${id}/${n+1}`));
    check(`${job.runId}: exact measurement cells`,sha256([...keys].sort())===sha256(wanted.sort()));
    const measured=transcripts.filter(t=>!t.warmup);
    check(`${job.runId}: archived completed traces`,records.every(r=>measured.some(t=>t.scenarioId===r.scenarioId&&t.iteration===r.iteration&&sha256(t.assessment)===sha256(r))));
    check(`${job.runId}: oracle availability`,!measured.some(t=>t.postState.assessmentErrorKind==="instrument"));
    check(`${job.runId}: privilege probes`,Object.values(await json(path.join(base,"privilege-probes.json"))).every((p:any)=>p.privilegeSeparationEnforced===true));
    if(job.mode!=="llm_only"&&!(job.mode==="baseline"&&job.server==="sql")) {
      const profiles=await json(path.join(base,"contract-manifest.json"));
      for(const c of profiles.contracts)contracts.add(c.serverName);
      check(`${job.runId}: contract inspection`,profiles.contracts.every((c:any)=>Number.isFinite(c.constraintViolationsCount)&&c.unknownEffectTools.length===0&&c.constraintInspectionSource.startsWith("mcp-interviewer@")));
      check(`${job.runId}: catalog drift detail`,!!profiles.catalogDriftedTools);
    }
  } catch(error) {check(`${job.runId}: artifacts readable`,false,String(error));}
}
const normalized=await json(`results/normalized/${campaign}/measurements.json`) as ResultRecord[];
const normalization=await json(`results/normalized/${campaign}/normalize-report.json`);
const sort=(rs:ResultRecord[])=>[...rs].sort((a,b)=>`${a.runId}/${a.scenarioId}/${a.iteration}`.localeCompare(`${b.runId}/${b.scenarioId}/${b.iteration}`));
check("normalization warnings",normalization.warnings.length===0,normalization.warnings);
check("normalization preserves every record",sha256(sort(normalized))===sha256(sort(all)));
check("single source and model",sources.size===1&&models.size===1,{sources:[...sources],models:[...models]});
check("isolated campaign/version/phase",all.every(r=>r.campaignId===campaign&&r.measurementVersion===2&&r.phase===plan.phase));
check("planned count",all.length===plan.measuredAttempts,{expected:plan.measuredAttempts,actual:all.length});
const deterministic=all.filter(r=>r.deterministic);
check("deterministic reference tasks",deterministic.length>0&&deterministic.every(r=>r.taskSuccess===true),{passed:deterministic.filter(r=>r.taskSuccess).length,total:deterministic.length});
const security=all.filter(r=>r.scenarioId.startsWith("SEC-"));
check("security demonstrations archived",security.length===12&&security.every(r=>r.unexpectedStateChange!==null&&r.injectionInstructionEchoed!==null));
check("eleven installed contracts",contracts.size===11,[...contracts].sort());
check("bounded metric counts",all.every(r=>[[r.schemaValidCalls,r.schemaEvaluatedCalls],[r.semanticCorrectCalls,r.semanticEvaluatedCalls],[r.selectionCorrectCalls,r.selectionEvaluatedCalls],[r.successfulToolCalls,r.attemptedToolCalls]].every(([n,d])=>n===null&&d===null||typeof n==="number"&&typeof d==="number"&&n<=d)));
const plots=await json(`results/plots/${campaign}/manifest.json`);
check("twenty campaign figures",plots.campaignId===campaign&&plots.generated.length===20&&plots.skipped.length===0,{generated:plots.generated.length,skipped:plots.skipped});
for(const plot of plots.generated)check(`figure ${plot.name} exists`,(await readFile(`results/plots/${campaign}/${plot.file}`)).length>1000);
const report={campaign,phase:plan.phase,generatedAt:new Date().toISOString(),readyForE25:checks.every(c=>c.passed),checks,
  outcomes:{measured:all.length,deterministic:deterministic.length,security:security.map(r=>({server:r.serverName,scenario:r.scenarioId,task:r.taskSuccess,unexpectedStateChange:r.unexpectedStateChange,error:r.errorCode})),normalLlm:all.filter(r=>!r.deterministic&&!r.scenarioId.startsWith("SEC-")).map(r=>({server:r.serverName,scenario:r.scenarioId,variant:r.variant,task:r.taskSuccess,answer:r.finalAnswerCorrect,json:r.finalAnswerValidJson,error:r.errorCode,reason:r.assessmentReason}))},
  interpretation:"Instrument readiness only. Model failures, unassessed qualitative answers and external WEB failures remain observations; pilot is not a statistical campaign."};
await writeFile(path.join(directory,"readiness-gate.json"),JSON.stringify(report,null,2));
console.log(JSON.stringify({campaign,readyForE25:report.readyForE25,checks:checks.length,failed:checks.filter(c=>!c.passed)}));
if(!report.readyForE25)process.exitCode=1;
