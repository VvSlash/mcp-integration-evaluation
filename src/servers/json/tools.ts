import { copyFile, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { JSONPath } from "jsonpath-plus";
import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { env } from "../../config/env.js";

export type JsonToolsConfig = {
  dataDir: string;
  workDir: string;
};

export function defaultJsonToolsConfig(): JsonToolsConfig {
  return { dataDir: env.json.dataDir, workDir: env.json.workDir };
}

export class JsonToolError extends Error {
  constructor(
    public readonly code:
      | "JSON_INVALID_FILE_NAME"
      | "JSON_FILE_NOT_FOUND"
      | "JSON_PARSE_ERROR"
      | "JSON_PATH_ERROR"
      | "JSON_PATH_NOT_FOUND"
      | "JSON_PATH_AMBIGUOUS",
    message: string
  ) {
    super(message);
    this.name = "JsonToolError";
  }
}

const FILE_NAME_PATTERN = /^[A-Za-z0-9._-]+\.json$/;

function resolveInside(dir: string, fileName: string): string {
  if (!FILE_NAME_PATTERN.test(fileName) || fileName.includes("..")) {
    throw new JsonToolError(
      "JSON_INVALID_FILE_NAME",
      `Invalid file name "${fileName}" — expected a plain *.json name without path separators.`
    );
  }
  const resolved = path.resolve(dir, fileName);
  if (!resolved.startsWith(path.resolve(dir) + path.sep)) {
    throw new JsonToolError("JSON_INVALID_FILE_NAME", `File "${fileName}" escapes base directory.`);
  }
  return resolved;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    return (await stat(filePath)).isFile();
  } catch {
    return false;
  }
}

async function parseJsonFile(filePath: string, fileName: string): Promise<unknown> {
  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch {
    throw new JsonToolError("JSON_FILE_NOT_FOUND", `File not found: ${fileName}`);
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch (error) {
    throw new JsonToolError(
      "JSON_PARSE_ERROR",
      `File ${fileName} is not valid JSON: ${(error as Error).message}`
    );
  }
}

export type JsonFileInfo = { file: string; sizeBytes: number };

export async function listJsonFiles(config: JsonToolsConfig): Promise<JsonFileInfo[]> {
  let entries;
  try {
    entries = await readdir(config.dataDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const files: JsonFileInfo[] = [];
  for (const entry of entries) {
    if (entry.isFile() && FILE_NAME_PATTERN.test(entry.name)) {
      const info = await stat(path.join(config.dataDir, entry.name));
      files.push({ file: entry.name, sizeBytes: info.size });
    }
  }
  return files.sort((a, b) => a.file.localeCompare(b.file));
}

export type ReadJsonResult = { file: string; source: "fixture" | "work"; json: unknown };

export async function readJsonFile(
  config: JsonToolsConfig,
  fileName: string
): Promise<ReadJsonResult> {
  const workPath = resolveInside(config.workDir, fileName);
  if (await fileExists(workPath)) {
    return { file: fileName, source: "work", json: await parseJsonFile(workPath, fileName) };
  }
  const dataPath = resolveInside(config.dataDir, fileName);
  return { file: fileName, source: "fixture", json: await parseJsonFile(dataPath, fileName) };
}

function runJsonPath(json: unknown, pathExpression: string, resultType: "value" | "all"): unknown[] {
  try {
    return JSONPath({ path: pathExpression, json: json as object, resultType, wrap: true }) as unknown[];
  } catch (error) {
    throw new JsonToolError(
      "JSON_PATH_ERROR",
      `Invalid JSONPath expression "${pathExpression}": ${(error as Error).message}`
    );
  }
}

export type QueryJsonResult = {
  file: string;
  source: "fixture" | "work";
  path: string;
  matches: number;
  results: unknown[];
};

export async function queryJsonFile(
  config: JsonToolsConfig,
  fileName: string,
  pathExpression: string
): Promise<QueryJsonResult> {
  const { source, json } = await readJsonFile(config, fileName);
  const results = runJsonPath(json, pathExpression, "value");
  return { file: fileName, source, path: pathExpression, matches: results.length, results };
}

export type UpdateJsonResult = {
  file: string;
  workFile: string;
  path: string;
  previousValue: unknown;
  newValue: unknown;
  updated: true;
};

export async function updateJsonValue(
  config: JsonToolsConfig,
  fileName: string,
  pathExpression: string,
  value: unknown
): Promise<UpdateJsonResult> {
  const workPath = resolveInside(config.workDir, fileName);

  if (!(await fileExists(workPath))) {
    const dataPath = resolveInside(config.dataDir, fileName);
    if (!(await fileExists(dataPath))) {
      throw new JsonToolError("JSON_FILE_NOT_FOUND", `File not found: ${fileName}`);
    }
    await mkdir(config.workDir, { recursive: true });
    await copyFile(dataPath, workPath);
  }

  const json = await parseJsonFile(workPath, fileName);
  const matches = runJsonPath(json, pathExpression, "all") as Array<{
    value: unknown;
    parent: Record<string | number, unknown> | null;
    parentProperty: string | number | null;
  }>;

  if (matches.length === 0) {
    throw new JsonToolError("JSON_PATH_NOT_FOUND", `JSONPath "${pathExpression}" matched nothing in ${fileName}.`);
  }
  if (matches.length > 1) {
    throw new JsonToolError(
      "JSON_PATH_AMBIGUOUS",
      `JSONPath "${pathExpression}" matched ${matches.length} values in ${fileName} — expected exactly one.`
    );
  }

  const match = matches[0];
  if (!match || match.parent === null || match.parentProperty === null) {
    throw new JsonToolError("JSON_PATH_ERROR", `JSONPath "${pathExpression}" points at the document root — cannot update.`);
  }

  const previousValue = match.value;
  match.parent[match.parentProperty] = value;
  await writeFile(workPath, JSON.stringify(json, null, 2), "utf8");

  return {
    file: fileName,
    workFile: workPath,
    path: pathExpression,
    previousValue,
    newValue: value,
    updated: true
  };
}

type ToolSuccess = { content: Array<{ type: "text"; text: string }> };
type ToolFailure = { isError: true; content: Array<{ type: "text"; text: string }> };

function ok(payload: unknown): ToolSuccess {
  return { content: [{ type: "text", text: JSON.stringify(payload) }] };
}

function fail(error: unknown): ToolFailure {
  const code = error instanceof JsonToolError ? error.code : "JSON_TOOL_FAILED";
  const message = error instanceof Error ? error.message : "Unknown JSON tool error";
  return { isError: true, content: [{ type: "text", text: JSON.stringify({ code, message }) }] };
}

export function registerJsonTools(
  server: McpServer,
  config: JsonToolsConfig = defaultJsonToolsConfig()
): void {
  server.registerTool(
    "json_list_files",
    {
      description: "List the JSON files available in the dataset directory, with sizes in bytes.",
      inputSchema: z.object({})
    },
    async () => {
      try {
        const files = await listJsonFiles(config);
        return ok({ count: files.length, files });
      } catch (error) {
        return fail(error);
      }
    }
  );

  server.registerTool(
    "json_read_file",
    {
      description:
        "Read the full content of a JSON file from the dataset directory (working copy takes precedence if it exists). Pass just the file name, e.g. products.json.",
      inputSchema: z.object({ file: z.string() })
    },
    async ({ file }) => {
      try {
        const result = await readJsonFile(config, file);
        const count = Array.isArray(result.json) ? result.json.length : null;
        return ok({ file: result.file, source: result.source, count, json: result.json });
      } catch (error) {
        return fail(error);
      }
    }
  );

  server.registerTool(
    "json_query",
    {
      description:
        'Query a JSON file with a JSONPath expression, e.g. $[?(@.price > 100)] for a top-level array or $.app.features for nested objects. Returns the matching values.',
      inputSchema: z.object({ file: z.string(), path: z.string() })
    },
    async ({ file, path: pathExpression }) => {
      try {
        return ok(await queryJsonFile(config, file, pathExpression));
      } catch (error) {
        return fail(error);
      }
    }
  );

  server.registerTool(
    "json_update_value",
    {
      description:
        "Update a single value in a JSON file. The JSONPath expression must match exactly one value, e.g. $[?(@.id==17)].price. Writes go to a working copy — the original fixture file is never modified.",
      inputSchema: z.object({
        file: z.string(),
        path: z.string(),
        value: z.union([z.string(), z.number(), z.boolean(), z.null()])
      })
    },
    async ({ file, path: pathExpression, value }) => {
      try {
        return ok(await updateJsonValue(config, file, pathExpression, value));
      } catch (error) {
        return fail(error);
      }
    }
  );
}
