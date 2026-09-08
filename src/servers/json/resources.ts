import { ResourceTemplate, type McpServer } from "@modelcontextprotocol/server";
import {
  defaultJsonToolsConfig,
  listJsonFiles,
  readJsonFile,
  type JsonToolsConfig
} from "./tools.js";

const MAX_SCHEMA_DEPTH = 4;
const ARRAY_SAMPLE_SIZE = 20;

export function inferJsonSchema(value: unknown, depth = 0): unknown {
  if (value === null) {
    return "null";
  }
  if (Array.isArray(value)) {
    if (depth >= MAX_SCHEMA_DEPTH) {
      return "array";
    }
    const sampled = value.slice(0, ARRAY_SAMPLE_SIZE).map((item) => inferJsonSchema(item, depth + 1));
    const unique = new Map<string, unknown>();
    for (const item of sampled) {
      unique.set(JSON.stringify(item), item);
    }
    const itemTypes = [...unique.values()];
    return {
      array: itemTypes.length === 0 ? "unknown" : itemTypes.length === 1 ? itemTypes[0] : itemTypes,
      length: value.length
    };
  }
  if (typeof value === "object") {
    if (depth >= MAX_SCHEMA_DEPTH) {
      return "object";
    }
    const schema: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      schema[key] = inferJsonSchema(entry, depth + 1);
    }
    return schema;
  }
  return typeof value;
}

export function registerJsonResources(
  server: McpServer,
  config: JsonToolsConfig = defaultJsonToolsConfig()
): void {
  server.registerResource(
    "json-files",
    "json://files",
    {
      description:
        "List of JSON dataset files available to the json_* tools (name and size in bytes).",
      mimeType: "application/json"
    },
    async (uri) => {
      const files = await listJsonFiles(config);
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify({ count: files.length, files }, null, 2)
          }
        ]
      };
    }
  );

  server.registerResource(
    "json-file-schema",
    new ResourceTemplate("json://files/{name}/schema", {
      list: async () => {
        const files = await listJsonFiles(config);
        return {
          resources: files.map((info) => ({
            uri: `json://files/${info.file}/schema`,
            name: `${info.file} schema`,
            description: `Inferred structure (keys and value types) of ${info.file}`,
            mimeType: "application/json"
          }))
        };
      }
    }),
    {
      description:
        "Inferred schema (keys and value types) of a JSON dataset file. Read it before constructing JSONPath queries.",
      mimeType: "application/json"
    },
    async (uri, variables) => {
      const rawName = variables["name"];
      const fileName = Array.isArray(rawName) ? rawName[0] : rawName;
      if (typeof fileName !== "string" || fileName.length === 0) {
        throw new Error(`Invalid file name in URI: ${uri.href}`);
      }

      const { json, source } = await readJsonFile(config, fileName);
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify({ file: fileName, source, schema: inferJsonSchema(json) }, null, 2)
          }
        ]
      };
    }
  );
}
