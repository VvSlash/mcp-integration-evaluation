import { describe, it, expect } from "vitest";
import { connectServers } from "../../src/clients/mcpClientFactory.js";
import { loadTestEnvironment } from "../../src/evaluation/testEnvironment.js";
import { probePrivileges, resetOrders, ordersSnapshot } from "../../src/evaluation/postgresFixture.js";
import { payloadData, rowsOf, loadFileReference } from "../../src/evaluation/taskOracle.js";
import { runTrajectory } from "../../src/evaluation/trajectory.js";
import { assessTrajectory } from "../../src/evaluation/assessTrajectory.js";
import { assessState } from "../../src/evaluation/campaignState.js";
import { readFile } from "node:fs/promises";
import { loadScenariosFromDir } from "../../src/shared/scenarioLoader.js";
import { runCampaign } from "../../src/runners/runCampaign.js";
import { runNormalize } from "../../src/evaluation/normalize.js";
import { scenarioSchema } from "../../src/shared/scenarioLoader.js";

describe.skipIf(process.env.MCP_TEST_DB!=="1")("isolated live campaign",()=>{
  it("executes the REST-to-JSON cross-server plan and resets it for the next trial",async()=>{
    loadTestEnvironment();
    const s=(await loadScenariosFromDir("scenarios")).scenarios.find(s=>s.id==="XSRV-001")!;
    const client=await connectServers(s.required_servers),reference=await loadFileReference();
    const seed=await readFile("datasets/json/summary.json","utf8");
    try {
      for(let iteration=0;iteration<2;iteration++) {
        await client.beforeIteration(s);
        expect(await readFile("datasets/.work/json/summary.json","utf8")).toBe(seed);
        let turn=0,summary={count:0,averagePrice:0};
        const chat=async(messages:any[])=>{
          let message:unknown;
          if(turn++===0)message={tool_calls:[{function:{name:"rest_get_products",arguments:{}}}]};
          else if(turn===2) {
            const products=rowsOf(JSON.parse(messages.at(-1).content));
            summary={count:products.length,averagePrice:Math.round(products.reduce((n,p)=>n+Number(p.price),0)/products.length*100)/100};
            message={tool_calls:Object.entries(summary).map(([key,value])=>({function:{name:"json_update_value",arguments:{file:"summary.json",path:`$.${key}`,value}}}))};
          } else message={content:JSON.stringify(summary)};
          return {message:message as any,promptTokens:1,outputTokens:1,durationMs:1};
        };
        const trace=await runTrajectory({client:{chat},host:client,prompt:s.prompt!,maxTurns:3});
        const state=await assessState(s,reference,null,s.required_servers);
        const score=assessTrajectory(s,trace,reference,s.expected_tools,state.task);
        expect(trace.calls.map(c=>c.server)).toEqual(["rest-api","json","json"]);
        expect(score).toMatchObject({taskSuccess:true,numberOfToolCalls:3,unnecessaryToolCalls:0,selectionCorrectCalls:3,successfulToolCalls:3});
        expect(await readFile("datasets/json/summary.json","utf8")).toBe(seed);
      }
    } finally {await client.beforeIteration(s);await client.close();}
  },60000);
  it("enforces RO at the source through the unguarded write handler",async()=>{
    loadTestEnvironment();
    expect((await probePrivileges("ro")).privilegeSeparationEnforced).toBe(true);
    expect((await probePrivileges("rw")).privilegeSeparationEnforced).toBe(true);
    const rw=process.env.POSTGRES_URL_RW;process.env.POSTGRES_URL_RW=process.env.POSTGRES_URL_RO!;
    const client=await connectServers(["sql-minimal"]);
    try {const result=await client.callTool("execute_write_query",{sql:"DELETE FROM orders WHERE false"});expect(result.isError).toBe(true);expect(JSON.stringify(result)).toMatch(/permission denied|odmowa dostępu/i);}
    finally {await client.close();process.env.POSTGRES_URL_RW=rw;}
  },30000);
  it("resets two mutating SQL iterations and routes duplicate health names",async()=>{
    loadTestEnvironment();const client=await connectServers(["sql-controlled","sql-generic","sql-minimal"]);
    try {
      expect(client.ollamaTools.filter(tool=>tool.function.name.endsWith("__health_check"))).toHaveLength(3);
      for(let n=0;n<2;n++) {
        await resetOrders();expect((await ordersSnapshot()).rows).toHaveLength(15);
        const result=await client.callTool("execute_write_query",{sql:"INSERT INTO orders (customer_name,customer_email,status,total_amount,currency) VALUES ('Test','test@example.com','pending',1,'PLN') RETURNING id"});
        expect(result.isError).not.toBe(true);expect(payloadData(result)).toEqual([{id:16}]);
      }
    } finally {await client.close();await resetOrders();}
  },30000);
  it("runs, resumes without duplicates, and normalizes only the selected campaign",async()=>{
    const campaign=`test-e2e-${Date.now()}`,runId=`${campaign}-run`;
    const options={campaign,phase:"test" as const,server:"json",scenarios:["JSON-004"],mode:"mcp" as const,catalog:"scenario" as const,iterations:2,warmups:0,maxTurns:2,runId,resume:false,schema:"none" as const};
    const result=await runCampaign(options);expect(result.records.map(record=>record.taskSuccess)).toEqual([true,true]);
    const resumed=await runCampaign({...options,resume:true});expect(resumed.records).toHaveLength(2);
    await expect(runCampaign({...options,resume:true,maxTurns:3})).rejects.toThrow("Resume refused");
    const normalized=await runNormalize({rawDir:"results/raw",outDir:`results/normalized/${campaign}`,campaign});
    expect(normalized.warnings).toEqual([]);expect(normalized.records).toHaveLength(2);expect(normalized.counts.legacy).toBe(0);
  },60000);
});
