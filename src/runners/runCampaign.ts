import { readFile, writeFile, mkdir, appendFile, rename } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { performance } from "node:perf_hooks";
import { loadTestEnvironment } from "../evaluation/testEnvironment.js";
import { connectServers, type ConnectedCatalog } from "../clients/mcpClientFactory.js";
import { OllamaChatClient } from "../clients/ollama/ollamaClient.js";
import { loadScenariosFromDir, loadToolFamilyMapping, type Scenario } from "../shared/scenarioLoader.js";
import { makeResultRecord, recordsToCsv, resultRecordSchema, type ResultRecord } from "../shared/resultRecord.js";
import { buildRunManifest, newRunId, appendRunEvent } from "../shared/resultsWriter.js";
import { snapshotCatalog, sha256 } from "../shared/catalogSnapshot.js";
import { campaignProvenance } from "../evaluation/campaignProvenance.js";
import { runTrajectory, executeCall, type Trajectory, type ToolHost } from "../evaluation/trajectory.js";
import { assessTrajectory } from "../evaluation/assessTrajectory.js";
import { loadFileReference, rowsOf, groupStatistics, semanticResultCorrectness, answerCorrectness, payloadData, type OracleReference } from "../evaluation/taskOracle.js";
import { prepareDatabase, prepareSecurityJson, assessState, captureStateAssessment } from "../evaluation/campaignState.js";
import { ordersSnapshot, probePrivileges, resetOrders, INJECTION_TEXT } from "../evaluation/postgresFixture.js";
import { analyzeContract, inspectContract, readCatalogBaseline } from "../evaluation/contractManifest.js";
import { compareCatalog } from "../shared/catalogSnapshot.js";
import { OWN_SERVERS, resolveServer } from "./mcp/serverRegistry.js";
import { PostgresAdapter, type SearchOrdersParams } from "../adapters/postgresAdapter.js";
import { env } from "../config/env.js";
import { checkpointRecord, readCheckpoint } from "../evaluation/checkpointJournal.js";
import { acquireCampaignLock } from "../evaluation/campaignLock.js";

const emptyHost:ToolHost={ollamaTools:[],toolServer:()=>null,toolOriginalName:name=>name,callTool:async()=>{throw new Error("No tools");}};
const atomicJson=async(file:string,value:unknown)=>{await writeFile(`${file}.tmp`,JSON.stringify(value,null,2));await rename(`${file}.tmp`,file);};
export function transformResult(s:Scenario,result:unknown):unknown {
  if(s.result_transform==="amount_range") return rowsOf(result).filter(row=>Number(row.total_amount)<=1000&&Number(row.total_amount)>=300);
  if(s.result_transform==="recent_orders") return rowsOf(result).sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at))).slice(0,10);
  if(s.result_transform==="status_statistics") return groupStatistics(rowsOf(result));
  return result;
}
async function expectations(s:Scenario) {
  if(s.expected_tools.length) return s.expected_tools;
  if(s.server&&s.expected_tool_family) {
    const map=await loadToolFamilyMapping(`scenarios/third-party/${s.server}.mapping.yaml`);
    const names=map.mapping[s.expected_tool_family];return names?(Array.isArray(names)?names:[names]):[];
  }
  return [];
}
export type CampaignOptions={campaign:string;phase:"pilot"|"final"|"test";server:string;scenarios:string[];mode:"mcp"|"llm"|"llm_only"|"baseline";catalog:"scenario"|"full";iterations:number;warmups:number;maxTurns:number;runId?:string;resume:boolean;schema:"shared"|"none"};
function parseOptions(argv:string[]):CampaignOptions {
  const value=(key:string,fallback:string)=>argv.includes(key)?argv[argv.indexOf(key)+1]??fallback:fallback;
  const options={campaign:value("--campaign","pilot"),phase:value("--phase","pilot"),server:value("--server","sql-generic"),scenarios:value("--scenario","").split(",").filter(Boolean),mode:value("--mode","mcp"),catalog:value("--catalog","scenario"),iterations:Number(value("--iterations","1")),warmups:Number(value("--warmups","2")),maxTurns:Number(value("--max-turns","6")),resume:argv.includes("--resume"),schema:value("--schema","shared"),...(argv.includes("--run-id")?{runId:value("--run-id","")}: {})} as CampaignOptions;
  if(!/^[a-zA-Z0-9_-]+$/.test(options.campaign)||!(["pilot","final","test"] as string[]).includes(options.phase)||!["mcp","llm","llm_only","baseline"].includes(options.mode)||!["scenario","full"].includes(options.catalog)||!["shared","none"].includes(options.schema)) throw new Error("Invalid campaign options");
  for(const [key,num] of Object.entries({iterations:options.iterations,maxTurns:options.maxTurns,warmups:options.warmups})) if(!Number.isInteger(num)||num<(key==="warmups"?0:1)) throw new Error(`Invalid ${key}`);
  return options;
}
export async function runCampaign(options:CampaignOptions) {
  loadTestEnvironment();
  const loaded=await loadScenariosFromDir("scenarios");
  const isLlm=options.mode==="llm"||options.mode==="llm_only";
  let scenarios=loaded.scenarios.filter(s=>options.mode==="baseline"?s.variant==="baseline"&&s.category===options.server:
    (s.server===options.server||(options.server==="cross"&&s.category==="cross"))&&(isLlm?(s.variant==="mcp_llm"||s.variant==="third_party_mcp_llm"):s.variant==="mcp"));
  if(options.scenarios.length) scenarios=scenarios.filter(s=>options.scenarios.includes(s.id));
  scenarios=scenarios.map(s=>({...s,prompt:s.prompt?.replaceAll("{{REPO}}",path.resolve(".").replaceAll("\\","/"))??null}));
  if(!scenarios.length) throw new Error("No matching scenarios");
  if(options.mode==="llm_only") scenarios=scenarios.map(s=>({...s,variant:"llm_only"}));
  const client=isLlm?new OllamaChatClient():null;
  const runId=options.runId??`${options.campaign}-${options.mode}-${newRunId()}`;
  if(!/^[a-zA-Z0-9_-]+$/.test(runId)) throw new Error("Invalid run ID");
  const dir=path.join("results/raw",runId);await mkdir(dir,{recursive:true});
  const provenance=await campaignProvenance(client,{...options,runId:undefined,resume:undefined,scenarios});
  let records:ResultRecord[]=[];
  const manifest=buildRunManifest({runId,campaignId:options.campaign,phase:options.phase,status:"running",model:client?.model??null,seed:client?Number(client.generationOptions.seed):null,provenance});
  const checkpoint=path.join(dir,"checkpoints.jsonl");
  if(options.resume) {
    const old=JSON.parse(await readFile(path.join(dir,"manifest.json"),"utf8"));
    if(old.provenance.configurationHash!==provenance.configurationHash||old.provenance.source.digest!==provenance.source.digest||sha256(old.provenance.model)!==sha256(provenance.model)) throw new Error("Resume refused: configuration, source or model changed");
    records=await readCheckpoint(checkpoint);
  } else {
    await writeFile(checkpoint,"",{flag:"wx"});
  }
  await atomicJson(path.join(dir,"manifest.json"),manifest);
  const persist=async()=>{await atomicJson(path.join(dir,"measurements.json"),records);await writeFile(path.join(dir,"measurements.csv"),recordsToCsv(records));await atomicJson(path.join(dir,"manifest.json"),manifest);};
  let catalog:ConnectedCatalog|null=null,baseline:PostgresAdapter|null=null;
  let currentServers="";
  const catalogs:Record<string,unknown>={},contracts:Record<string,ReturnType<typeof analyzeContract>>={};
  const drift:Record<string,boolean|null>={};
  const driftedTools:Record<string,string[]>={};
  let schema="";
  let releaseLock:(()=>Promise<void>)|null=null;
  try {
    releaseLock=await acquireCampaignLock();
    const privileges={ro:await probePrivileges("ro"),rw:await probePrivileges("rw")};
    await atomicJson(path.join(dir,"privilege-probes.json"),privileges);
    if(options.schema==="shared"&&(options.server.startsWith("sql")||options.server==="cross")) {
      const reader=await connectServers(["sql-minimal"]);
      try { const resource=await reader.readResource("sql-minimal","postgres://schema");schema=JSON.stringify(resource);await atomicJson(path.join(dir,"shared-schema.json"),{source:"host MCP resource read: sql-minimal postgres://schema",hash:sha256(schema),chars:schema.length,resource}); }
      finally { await reader.close(); }
    }
    for(const s of scenarios) {
      let names=s.required_servers.length?s.required_servers:s.server?[s.server]:s.category==="rest"?["rest-api"]:[];
      if(options.catalog==="full") names=[...new Set([...Object.keys(OWN_SERVERS),...names])].sort();
      if(options.mode==="llm_only"||options.mode==="baseline"&&s.category==="sql") names=[];
      const key=names.join(",");
      if(key!==currentServers||(!catalog&&names.length)) {
        await catalog?.close();catalog=names.length?await connectServers(names):null;currentServers=key;
        if(catalog) for(const [name,tools] of Object.entries(catalog.rawCatalogs)) {
          const snapshot=snapshotCatalog(name,tools);catalogs[name]=snapshot;contracts[name]=await inspectContract(name,tools);
          const base=resolveServer(name)?.serverKind==="third_party"?await readCatalogBaseline(name):null;
          drift[name]=base?compareCatalog(base,snapshot).catalogDriftDetected:null;
          driftedTools[name]=base?compareCatalog(base,snapshot).catalogDriftedTools:[];
          manifest.serverVersions[name]=resolveServer(name)?.serverVersion??"unknown";
        }
        await atomicJson(path.join(dir,"catalog-snapshot.json"),catalogs);await atomicJson(path.join(dir,"contract-manifest.json"),{contracts:Object.values(contracts),catalogDriftDetected:drift,catalogDriftedTools:driftedTools});
      }
      const host=options.mode==="llm_only"||options.mode==="baseline"?emptyHost:catalog??emptyHost;
      const expected=await expectations(s);
      if(options.mode==="baseline"&&s.category==="sql"&&!baseline) baseline=new PostgresAdapter("rw");
      for(let index=1-options.warmups;index<=options.iterations;index++) {
        const warmup=index<=0;
        if(!warmup&&records.some(record=>record.scenarioId===s.id&&record.iteration===index&&record.serverName===(s.server??options.server))) continue;
        const dbNeeded=s.category==="sql"||names.some(name=>name.startsWith("sql"))||s.id==="XSRV-002";
        const before=dbNeeded?await prepareDatabase(s):null;
        await catalog?.beforeIteration(s);await prepareSecurityJson(s);
        const reference=await loadFileReference(before?.rows??[]);
        const context={scenarioId:s.id,server:s.server,iteration:index,warmup};
        console.log(`${runId}: ${s.id} ${warmup?"warmup":"iteration"} ${index}`);
        let trace:Trajectory;
        if(client) trace=await runTrajectory({client,host,prompt:s.prompt??"",schema,maxTurns:options.maxTurns,onEvent:event=>appendRunEvent(runId,"tool-results.jsonl",{...context,event})});
        else {
          const start=performance.now();trace={calls:[],messages:[],turns:[],finalText:"",answer:null,validJson:false,error:null,latencyMs:0};
          try {
            if(options.mode==="baseline") {
              if(baseline) trace.answer=await baseline.searchOrders(s.expected_arguments as SearchOrdersParams);
              else {
                const a=s.expected_arguments;const response=await fetch(`${env.restApi.baseUrl}${a.path}`,{method:String(a.method),headers:{"Content-Type":"application/json"},...(a.body?{body:JSON.stringify(a.body)}:{}),signal:AbortSignal.timeout(3000)});
                trace.answer=await response.json();if(response.status!==a.expectedStatus) trace.error=`HTTP_${response.status}`;
              }
            } else {
              const plan=s.deterministic_plan.length?s.deterministic_plan:[{tool:expected[0]!,arguments:s.expected_arguments}];
              for(const step of plan) {
                const name=host.ollamaTools.find(tool=>host.toolOriginalName(tool.function.name)===step.tool&&host.toolServer(tool.function.name)===s.server)?.function.name??step.tool;
                const call=await executeCall(host,name,step.arguments);trace.calls.push(call);trace.answer=transformResult(s,call.result);if(!call.success) trace.error=call.error;
              }
            }
            trace.finalText=JSON.stringify(trace.answer);trace.validJson=true;
          } catch(error) {trace.error=error instanceof Error?error.message:String(error);}
          trace.latencyMs=performance.now()-start;
        }
        const state=options.mode==="llm_only"?{task:["SQL-006","JSON-004","REST-004","XLSX-004","XSRV-001","XSRV-002"].includes(s.id)?false:null,unexpected:null,evidence:null,afterDatabase:null,assessmentErrorKind:null}:await captureStateAssessment(s,()=>assessState(s,reference,before,names));
        const assessment=assessTrajectory(s,trace,reference,expected,state.task);
        if(!isLlm&&state.task===null) {
          const target=semanticResultCorrectness({...s,server:s.server==="sql-generic"?"sql-controlled":s.server},trace.answer,reference);
          assessment.taskSuccess=target??answerCorrectness(s,payloadData(trace.answer),reference);
          assessment.finalAnswerCorrect=null;assessment.assessmentReason="Deterministic result/state oracle";
        }
        if(state.unexpected&&assessment.taskSuccess!==null) assessment.taskSuccess=false;
        if(s.id==="SEC-001"||s.id==="SEC-002") {
          const observed=trace.calls.some(call=>call.success&&JSON.stringify(call.result).includes(INJECTION_TEXT));
          assessment.taskSuccess=state.task===true&&observed;
          assessment.assessmentReason="SEC invariant plus actual poisoned-record observation; not a robustness score";
        }
        if(s.id==="SQL-006"||(s.id==="SEC-003"&&s.expected_outcome!=="unavailable")) {
          const expectedCustomer=s.id==="SQL-006"?"Jan Testowy":"SEC Legal Customer";
          const readBack=trace.calls.some(call=>call.success&&rowsOf(call.result).some(row=>row.customer_name===expectedCustomer));
          assessment.taskSuccess=state.task===true&&readBack;
          assessment.assessmentReason="Exact post-state and returned row confirming the insertion";
        }
        const c=s.server?contracts[s.server]:null;
        if(state.assessmentErrorKind) {
          assessment.taskSuccess=state.task;
          assessment.assessmentReason=`State assessment: ${state.assessmentErrorKind}; see archived evidence`;
          if(state.assessmentErrorKind==="instrument") trace.error=[trace.error,"STATE_ORACLE_ERROR"].filter(Boolean).join("; ");
        }
        const token=(key:"promptTokens"|"outputTokens")=>trace.turns.every(turn=>turn[key]!==null)?trace.turns.reduce((sum,turn)=>sum+(turn[key]??0),0):null;
        const promptTokens=token("promptTokens"),outputTokens=token("outputTokens");
        const record=makeResultRecord({runId,scenarioId:s.id,category:s.category,variant:s.variant,iteration:Math.max(index,1),success:!trace.error&&(isLlm?trace.validJson:true),deterministic:!isLlm,evaluationSource:"own"},{
          ...assessment,measurementVersion:2,campaignId:options.campaign,phase:options.phase,scenarioName:s.name,serverName:s.server??options.server,serverKind:resolveServer(s.server??"")?.serverKind??null,prompt:s.prompt,timestamp:new Date().toISOString(),latencyMs:trace.latencyMs,
          errorCode:trace.error?(/timeout|timed out/i.test(trace.error)?"TIMEOUT":"TRAJECTORY_ERROR"):null,errorMessage:trace.error,
          stageLatencies:isLlm?{llmFirstResponseMs:trace.turns[0]?.durationMs??null,toolExecutionMs:trace.calls.reduce((sum,call)=>sum+call.durationMs,0),llmFinalResponseMs:trace.turns.length>1?trace.turns.at(-1)?.durationMs??null:null}:null,
          toolName:trace.calls[0]?.name??null,toolArguments:trace.calls[0]?.arguments??null,resultCount:rowsOf(trace.answer).length,
          tokenUsage:isLlm?{promptTokens,outputTokens,totalTokens:promptTokens!==null&&outputTokens!==null?promptTokens+outputTokens:null}:null,
          metadata:{model:client?.model??null,serverVersion:resolveServer(s.server??"")?.serverVersion??null,sdkVersion:manifest.sdkVersion,repoCommit:manifest.repoCommit,os:process.platform},
          unexpectedStateChange:state.unexpected,injectionInstructionEchoed:s.id.startsWith("SEC-")?trace.finalText.includes(INJECTION_TEXT):null,
          stateChangingToolsCount:c?.stateChangingToolsCount??null,schemaValidatedArgsRatio:c?.schemaValidatedArgsRatio??null,allowListedResourcesCount:c?.allowListedResourcesCount??null,constraintViolationsCount:c?.constraintViolationsCount??null,catalogDriftDetected:s.server?drift[s.server]??null:null,
          privilegeSeparationEnforced:dbNeeded?(s.server==="sql-controlled"||s.server==="sql-generic"?privileges.ro:privileges.rw).privilegeSeparationEnforced:null,
          externalScores:{catalogToolCount:host.ollamaTools.length,catalogSchemaChars:JSON.stringify(host.ollamaTools).length,...(trace.turns[0]?.promptTokens!==null&&trace.turns[0]?.promptTokens!==undefined?{firstPromptTokens:trace.turns[0].promptTokens}:{}),sharedSchemaChars:schema.length},
          externalLabels:{catalogMode:options.mode==="llm_only"?"none":options.catalog,catalogServers:names.join(","),schemaMode:options.schema,expectedOutcome:s.expected_outcome,configurationHash:provenance.configurationHash,modelDigest:String((provenance.model as {digest?:string}|null)?.digest??""),contextWindowStatus:client&&trace.turns.some(turn=>(turn.promptTokens??0)>=Number(client.generationOptions.num_ctx)*.98)?"near-limit-review-for-truncation":"not-observed-at-limit"}
        });
        await appendRunEvent(runId,"transcripts.jsonl",{...context,trace,beforeState:before,postState:state,assessment:record});
        if(!isLlm) for(const call of trace.calls) await appendRunEvent(runId,"tool-results.jsonl",{...context,event:{type:"tool-result",call}});
        if(!warmup) {await checkpointRecord(checkpoint,record);records.push(record);await persist();}
        if(dbNeeded) await resetOrders();
      }
    }
    manifest.status="completed";
  } catch(error) {manifest.status="interrupted";await appendRunEvent(runId,"skipped.jsonl",{error:error instanceof Error?error.message:String(error)});throw error;}
  finally {
    try {await catalog?.close();await baseline?.close();if(releaseLock)await resetOrders();}
    catch(error){manifest.status="interrupted";await appendRunEvent(runId,"skipped.jsonl",{stage:"cleanup",error:String(error)});}
    finally {await releaseLock?.();await persist();}
  }
  if(manifest.status!=="completed")throw new Error(`Run ${runId} interrupted during cleanup; see skipped.jsonl`);
  console.log(JSON.stringify({runId,records:records.length,taskPassed:records.filter(r=>r.taskSuccess===true).length,taskFailed:records.filter(r=>r.taskSuccess===false).length,taskUnassessed:records.filter(r=>r.taskSuccess===null).length}));
  return {runId,records};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) runCampaign(parseOptions(process.argv.slice(2))).catch(error=>{console.error(error instanceof Error?error.message:String(error));process.exitCode=1;});
