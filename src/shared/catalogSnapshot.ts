import { createHash } from "node:crypto";

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
export const sha256 = (value: unknown) => createHash("sha256").update(typeof value === "string" ? value : canonicalJson(value)).digest("hex");
export type CatalogTool = { name: string; description?: string | undefined; inputSchema?: unknown; [key: string]: unknown };
export type CatalogSnapshot = {
  serverName: string; tools: CatalogTool[]; digest: string;
  hashes: Record<string, { schema: string; description: string; complete: string }>;
};
export function snapshotCatalog(serverName: string, tools: CatalogTool[]): CatalogSnapshot {
  const sorted = [...tools].sort((a, b) => a.name.localeCompare(b.name));
  return { serverName, tools: sorted, digest: sha256(sorted), hashes: Object.fromEntries(sorted.map(tool => [tool.name, { schema: sha256(tool.inputSchema ?? {}), description: sha256(tool.description ?? ""), complete: sha256(tool) }])) };
}
export function compareCatalog(baseline: CatalogSnapshot, current: CatalogSnapshot) {
  const names = [...new Set([...Object.keys(baseline.hashes), ...Object.keys(current.hashes)])].sort();
  const catalogDriftedTools = names.filter(name => baseline.hashes[name]?.complete !== current.hashes[name]?.complete);
  return { catalogDriftDetected: catalogDriftedTools.length > 0, catalogDriftedTools };
}
