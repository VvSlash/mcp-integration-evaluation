import { readFile } from "node:fs/promises";
import { Validator, type Schema } from "@cfworker/json-schema";
import type { Scenario } from "../shared/scenarioLoader.js";
import { canonicalJson } from "../shared/catalogSnapshot.js";

export type Row = Record<string, unknown>;
export const asRow = (value: unknown): Row => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Row : {};

export function payloadData(result: unknown): unknown {
  const obj = asRow(result);
  if (obj.structuredContent !== undefined) return payloadData(obj.structuredContent);
  if (Array.isArray(obj.content)) {
    for (const item of obj.content) {
      const text = asRow(item).text;
      if (typeof text === "string") { try { return payloadData(JSON.parse(text)); } catch { } }
    }
  }
  for (const key of ["json", "rows", "orders", "order", "product", "items", "statistics", "results", "data", "result"]) {
    if (obj[key] !== undefined && (Array.isArray(obj[key]) || typeof obj[key] === "object")) return payloadData(obj[key]);
  }
  return result;
}
export function rowsOf(value: unknown): Row[] {
  const data = payloadData(value);
  return Array.isArray(data) ? data.filter(item => item !== null && typeof item === "object").map(asRow) : [];
}

export function schemaValidity(schema: unknown, args: unknown): boolean | null {
  if (!schema) return null;
  return new Validator(schema as Schema, "2020-12", false).validate(args).valid;
}
export function shapeCorrectness(value: unknown, shape: Scenario["expected_result_shape"]): boolean | null {
  if (!shape) return null;
  const data = payloadData(value), rows = rowsOf(value);
  if (shape.type === "list" && !Array.isArray(data)) return false;
  if (shape.type === "object" && (data === null || typeof data !== "object" || Array.isArray(data))) return false;
  if (shape.minCount !== undefined && rows.length < shape.minCount) return false;
  if (shape.maxCount !== undefined && rows.length > shape.maxCount) return false;
  const objects = Array.isArray(data) ? rows : [asRow(data)];
  return !shape.fields || objects.every(row => shape.fields!.every(field => Object.hasOwn(row, field)));
}
const near = (a: unknown, b: unknown, tolerance = 0.011) => a !== null && a !== undefined && b !== null && b !== undefined && Number.isFinite(Number(a)) && Math.abs(Number(a) - Number(b)) <= tolerance;
const field = (obj: Row, names: string[]) => names.map(name => obj[name]).find(value => value !== undefined);
const countValue = (value: unknown) => field(asRow(value), ["count", "orderCount", "order_count", "recordCount", "totalCount", "returnedCount", "matchingCount", "total"]);
function containsFields(actual: unknown, expected: Row): boolean {
  const row = asRow(payloadData(actual));
  return Object.entries(expected).every(([key, value]) => typeof value === "number" ? near(row[key], value) : row[key] === value);
}
export function sameRows(actual: unknown, expected: Row[], ordered = false): boolean {
  const rows = rowsOf(actual);
  if (rows.length !== expected.length || !rows.length) return false;
  const normalize = (list: Row[]) => (ordered ? list : [...list].sort((a,b) => Number(a.id) - Number(b.id))).map(row => ({ id: Number(row.id), status: row.status, total_amount: Number(row.total_amount) }));
  return canonicalJson(normalize(rows)) === canonicalJson(normalize(expected));
}

export type OracleReference = { orders: Row[]; products: Row[]; rest: Row; excel: Row };
export async function loadFileReference(orders: Row[] = []): Promise<OracleReference> {
  return { orders,
    products: JSON.parse(await readFile("datasets/json/products.json", "utf8")) as Row[],
    rest: JSON.parse(await readFile("datasets/rest-api/seed.json", "utf8")) as Row,
    excel: JSON.parse(await readFile("datasets/excel/sales.expected.json", "utf8")) as Row
  };
}
export function expectedOrders(id: string, reference: OracleReference): Row[] {
  const recent = [...reference.orders].sort((a,b) => String(b.created_at).localeCompare(String(a.created_at)) || Number(b.id) - Number(a.id));
  if (id === "SQL-001") return recent.filter(row => row.status === "paid").slice(0,5);
  if (id === "SQL-002") return recent.filter(row => row.status === "shipped");
  if (id === "SQL-003") return recent.filter(row => Number(row.total_amount) >= 300 && Number(row.total_amount) <= 1000);
  if (id === "SQL-004") return recent.slice(0,10);
  return recent;
}
export function groupStatistics(rows: Row[], group: "status" | "currency" = "status") {
  const keys = [...new Set(rows.map(row => String(row[group])))].sort();
  return keys.map(key => {
    const selected = rows.filter(row => row[group] === key), sum = selected.reduce((n,row) => n + Math.round(Number(row.total_amount) * 100), 0) / 100;
    return { group_value: key, order_count: selected.length, total_amount_sum: sum, total_amount_avg: Math.round((sum / selected.length) * 100) / 100 };
  });
}
function statisticsCorrect(value: unknown, expected: ReturnType<typeof groupStatistics>, totalsOnly: boolean): boolean {
  let rows = rowsOf(value);
  if (!rows.length) {
    const obj = asRow(value);
    for (const key of ["groups", "statistics", "results", "currencies"]) if (Array.isArray(obj[key])) { rows = (obj[key] as unknown[]).map(asRow); break; }
  }
  return rows.length === expected.length && expected.every(target => {
    const row = rows.find(item => field(item,["group_value", "status", "currency"]) === target.group_value);
    if (!row) return false;
    return near(field(row,["total_amount_sum", "total_amount", "totalAmount", "total", "sum"]),target.total_amount_sum)
      && (totalsOnly || (near(field(row,["order_count", "orderCount", "count"]),target.order_count) && near(field(row,["total_amount_avg", "average_amount", "averageAmount", "average", "avg"]),target.total_amount_avg)));
  });
}

export function answerCorrectness(scenario: Scenario, answer: unknown, reference: OracleReference): boolean | null {
  if (scenario.expected_outcome === "unavailable" || scenario.id.startsWith("SEC-") || scenario.category === "websearch" || scenario.category === "blender" || scenario.id === "XSRV-002") return null;
  if (answer === null || answer === undefined) return false;
  const obj = asRow(answer), data = payloadData(answer);
  if (/^SQL-00[1-4]$/.test(scenario.id)) {
    const expected = expectedOrders(scenario.id, reference);
    const rows = rowsOf(answer);
    return rows.length ? sameRows(answer,expected,scenario.id === "SQL-004") : scenario.id === "SQL-001" ? near(countValue(answer),expected.length,0) : false;
  }
  if (scenario.id === "SQL-005") return statisticsCorrect(answer,groupStatistics(reference.orders.filter(row => row.status === "paid"),"currency"),true);
  if (scenario.id === "SQL-007") return statisticsCorrect(answer,groupStatistics(reference.orders),false);
  if (scenario.id === "SQL-006") return containsFields(answer,{ customer_name:"Jan Testowy", status:"pending", total_amount:123.45, currency:"PLN" });
  if (scenario.id === "JSON-001") return near(countValue(answer),reference.products.length,0);
  if (scenario.id === "JSON-002") {
    const expected = reference.products.find(row => row.id === 17)!;
    return containsFields(Array.isArray(data) ? data[0] : data,expected) && (!Array.isArray(data) || data.length === 1);
  }
  if (scenario.id === "JSON-003") return near(countValue(answer),reference.products.filter(row => row.category === "electronics" && Number(row.price) > 100).length,0);
  if (scenario.id === "JSON-004") return near(field(asRow(data),["price","newPrice","newValue"]),249.99);
  if (scenario.id === "REST-001") return field(obj,["status"]) === "ok" || asRow(obj.health).status === "ok";
  if (scenario.id === "REST-002") return near(countValue(answer),(reference.rest.products as Row[]).length,0);
  if (scenario.id === "REST-003") return containsFields(asRow(data).product ?? data,(reference.rest.products as Row[]).find(row => row.id === 3)!);
  if (scenario.id === "REST-004") return containsFields(asRow(data).order ?? data,{ productId:3, quantity:2, customerName:"Jan Testowy" });
  if (scenario.id === "XLSX-001") return Array.isArray(obj.sheets) && canonicalJson([...obj.sheets].sort()) === canonicalJson([...(reference.excel.sheetNames as string[])].sort());
  if (scenario.id === "XLSX-002") return near(obj.totalSum,reference.excel.totalSum);
  if (scenario.id === "XLSX-003") return near(obj.count,reference.excel.northQuantityOver50Count,0);
  if (scenario.id === "XLSX-004") return field(obj,["sheet","sheetName"]) === "TestResults" && near(field(obj,["count","rowCount"]),reference.excel.northQuantityOver50Count,0);
  if (scenario.id === "XSRV-001") {
    const products = reference.rest.products as Row[];
    return near(obj.count,products.length,0) && near(obj.averagePrice, products.reduce((sum,row) => sum+Number(row.price),0)/products.length);
  }
  return null;
}

export function semanticResultCorrectness(scenario: Scenario, result: unknown, reference: OracleReference): boolean | null {
  if (/^SQL-00[1-4]$/.test(scenario.id)) {
    if (scenario.server === "sql-generic" && ["SQL-003","SQL-004"].includes(scenario.id)) return null;
    return sameRows(result,expectedOrders(scenario.id,reference),scenario.id === "SQL-004");
  }
  if (scenario.id === "SQL-007" && scenario.server !== "sql-generic") return statisticsCorrect(result,groupStatistics(reference.orders),false);
  if (scenario.id === "SQL-005") return statisticsCorrect(result,groupStatistics(reference.orders.filter(row => row.status === "paid"),"currency"),true);
  if (scenario.id === "JSON-001") return rowsOf(result).length === reference.products.length;
  if (scenario.id === "JSON-002" && scenario.server === "json") return rowsOf(result).length === 1 && containsFields(rowsOf(result)[0],reference.products.find(row => row.id === 17)!);
  if (scenario.id === "JSON-003" && scenario.server === "json") {
    const rows = rowsOf(result), expected = reference.products.filter(row => row.category === "electronics" && Number(row.price)>100);
    return canonicalJson(rows.map(row=>row.id).sort()) === canonicalJson(expected.map(row=>row.id).sort());
  }
  if (scenario.id === "REST-002") return rowsOf(result).length === (reference.rest.products as Row[]).length;
  if (scenario.id === "REST-001" || scenario.id === "REST-003" || scenario.id === "REST-004") return answerCorrectness(scenario,payloadData(result),reference);
  return null;
}
