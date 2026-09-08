import { open, readFile } from "node:fs/promises";
import { resultRecordSchema, type ResultRecord } from "../shared/resultRecord.js";

export async function checkpointRecord(file:string,record:ResultRecord) {
  resultRecordSchema.parse(record);
  const handle=await open(file,"a");
  try {await handle.write(`${JSON.stringify(record)}\n`);await handle.sync();} finally {await handle.close();}
}
export async function readCheckpoint(file:string):Promise<ResultRecord[]> {
  const journal=await readFile(file,"utf8");
  const lines=journal.split("\n");
  if(lines.at(-1)!=="") throw new Error("Truncated checkpoint journal; preserve the original and recover complete lines into a separate run");
  return lines.filter(Boolean).map(line=>resultRecordSchema.parse(JSON.parse(line)));
}
