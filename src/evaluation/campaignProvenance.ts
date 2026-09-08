import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { sha256 } from "../shared/catalogSnapshot.js";
import type { OllamaChatClient } from "../clients/ollama/ollamaClient.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

export async function sourceHashes() {
  const files:Record<string,string>={};
  const walk=async(directory:string)=>{
    for(const entry of (await readdir(directory,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))) {
      if(entry.name.startsWith(".")||entry.name==="__pycache__"||entry.name.endsWith(".pyc")) continue;
      const filename=path.join(directory,entry.name);
      if(entry.isDirectory()) await walk(filename);
      else if(entry.isFile()) files[filename.replaceAll("\\","/")]=sha256((await readFile(filename)).toString("base64"));
    }
  };
  for(const directory of ["src","scenarios","datasets","config","scripts"]) await walk(directory);
  for(const filename of ["package.json","package-lock.json","third_party/manifest.json","third_party/eval-frameworks.manifest.json"]) files[filename]=sha256(await readFile(filename,"utf8"));
  return {algorithm:"sha256(base64(file bytes)); text lockfiles sha256(utf8)",files,digest:sha256(files)};
}
export async function campaignProvenance(client:OllamaChatClient|null,configuration:unknown) {
  let model:unknown=null;
  const version=async(command:string,args:string[])=>promisify(execFile)(command,args,{timeout:10000,windowsHide:true}).then(r=>r.stdout.trim().split(/\r?\n/)[0],()=>null);
  const instance=await readFile("datasets/.work/postgres/instance.json","utf8").then(JSON.parse,()=>null);
  const runtime={node:process.version,postgresCluster:instance?.version??null,
    python:await version(process.platform==="win32"?".venv/Scripts/python.exe":".venv/bin/python",["--version"]),
    blender:process.env.BLENDER_PATH?await version(process.env.BLENDER_PATH,["--version"]):null,
    ollama:client?await fetch(`${client.baseUrl}/api/version`,{signal:AbortSignal.timeout(3000)}).then(r=>r.json()).catch(()=>null):null};
  if(client) {
    const response=await fetch(`${client.baseUrl}/api/tags`,{signal:AbortSignal.timeout(5000)});
    if(!response.ok) throw new Error("Cannot record model digest");
    const tags=await response.json() as {models:{name:string;digest:string}[]};
    model=tags.models.find(model=>model.name===client.model||model.name===`${client.model}:latest`);
    if(!model) throw new Error(`Model ${client.model} is not locally installed`);
  }
  return {configuration,configurationHash:sha256(configuration),source:await sourceHashes(),model,
    generationOptions:client?.generationOptions??null,timeoutMs:client?.timeoutMs??null,
    thinkingMode:"model default; complete assistant message preserved",hardware:{platform:os.platform(),release:os.release(),arch:os.arch(),cpu:os.cpus()[0]?.model,logicalCpus:os.cpus().length,memoryBytes:os.totalmem()},runtime,measurementVersion:2};
}
