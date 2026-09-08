import { ResourceTemplate, type McpServer } from "@modelcontextprotocol/server";
import { getPostgresSqlPool } from "../../adapters/postgresSqlPool.js";

type TableNameRow = {
  table_name: string;
};

type ColumnRow = {
  column_name: string;
  data_type: string;
  character_maximum_length: number | null;
  numeric_precision: number | null;
  numeric_scale: number | null;
  is_nullable: "YES" | "NO";
  column_default: string | null;
  is_primary_key: boolean;
};

export type SchemaColumnRow = ColumnRow & { table_name: string };

const LIST_TABLES_SQL = `
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_type = 'BASE TABLE'
ORDER BY table_name;
`;

const COLUMNS_FOR_TABLE_SQL = `
SELECT
  c.column_name,
  c.data_type,
  c.character_maximum_length,
  c.numeric_precision,
  c.numeric_scale,
  c.is_nullable,
  c.column_default,
  CASE WHEN pk.column_name IS NOT NULL THEN true ELSE false END AS is_primary_key
FROM information_schema.columns c
LEFT JOIN (
  SELECT
    kcu.table_name,
    kcu.column_name
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu
    ON tc.constraint_name = kcu.constraint_name
   AND tc.table_schema = kcu.table_schema
  WHERE tc.constraint_type = 'PRIMARY KEY'
    AND tc.table_schema = 'public'
) pk
  ON pk.table_name = c.table_name
 AND pk.column_name = c.column_name
WHERE c.table_schema = 'public'
  AND c.table_name = $1
ORDER BY c.ordinal_position;
`;

const COLUMNS_FOR_ALL_TABLES_SQL = `
SELECT
  c.table_name,
  c.column_name,
  c.data_type,
  c.character_maximum_length,
  c.numeric_precision,
  c.numeric_scale,
  c.is_nullable,
  c.column_default,
  CASE WHEN pk.column_name IS NOT NULL THEN true ELSE false END AS is_primary_key
FROM information_schema.columns c
JOIN information_schema.tables t
  ON t.table_schema = c.table_schema
 AND t.table_name = c.table_name
 AND t.table_type = 'BASE TABLE'
LEFT JOIN (
  SELECT
    kcu.table_name,
    kcu.column_name
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu
    ON tc.constraint_name = kcu.constraint_name
   AND tc.table_schema = kcu.table_schema
  WHERE tc.constraint_type = 'PRIMARY KEY'
    AND tc.table_schema = 'public'
) pk
  ON pk.table_name = c.table_name
 AND pk.column_name = c.column_name
WHERE c.table_schema = 'public'
ORDER BY c.table_name, c.ordinal_position;
`;

function formatColumnType(column: ColumnRow): string {
  const baseType = column.data_type;

  if (
    column.character_maximum_length !== null &&
    column.character_maximum_length > 0
  ) {
    return `${baseType}(${column.character_maximum_length})`;
  }

  if (
    column.numeric_precision !== null &&
    column.numeric_precision > 0 &&
    column.numeric_scale !== null
  ) {
    return `${baseType}(${column.numeric_precision},${column.numeric_scale})`;
  }

  return baseType;
}

function formatColumnLine(column: ColumnRow): string {
  const parts: string[] = [`- ${column.column_name} ${formatColumnType(column)}`];

  parts.push(column.is_nullable === "NO" ? "NOT NULL" : "NULL");

  if (column.is_primary_key) {
    parts.push("PRIMARY KEY");
  }

  if (column.column_default !== null) {
    parts.push(`DEFAULT ${column.column_default}`);
  }

  return parts.join(" ");
}

function buildExampleQueries(tableName: string, columns: ColumnRow[]): string[] {
  const examples: string[] = [`SELECT * FROM ${tableName} LIMIT 10;`];

  if (columns.length > 0) {
    const previewColumns = columns
      .slice(0, Math.min(4, columns.length))
      .map((column) => column.column_name)
      .join(", ");

    examples.push(`SELECT ${previewColumns} FROM ${tableName} LIMIT 5;`);
  }

  return examples;
}

function buildTableResourceText(
  tableName: string,
  columns: ColumnRow[]
): string {
  const lines: string[] = [];

  lines.push(`Table: ${tableName}`);
  lines.push("");
  lines.push("Columns:");

  for (const column of columns) {
    lines.push(formatColumnLine(column));
  }

  lines.push("");
  lines.push("Example queries:");

  for (const example of buildExampleQueries(tableName, columns)) {
    lines.push(example);
  }

  return lines.join("\n");
}

export function buildSchemaResourceText(rows: SchemaColumnRow[]): string {
  const tables = new Map<string, ColumnRow[]>();
  for (const row of rows) {
    const columns = tables.get(row.table_name) ?? [];
    columns.push(row);
    tables.set(row.table_name, columns);
  }

  const lines: string[] = [];
  lines.push("Schema: public");
  lines.push(`Tables (${tables.size}): ${[...tables.keys()].join(", ")}`);

  for (const [tableName, columns] of tables) {
    lines.push("");
    lines.push(buildTableResourceText(tableName, columns));
  }

  return lines.join("\n");
}

export function registerPostgresSchemaResources(server: McpServer): void {
  const pool = getPostgresSqlPool();

  server.registerResource(
    "postgres-table",
    new ResourceTemplate("postgres://tables/{table_name}", {
      list: async () => {
        const result = await pool.query<TableNameRow>(LIST_TABLES_SQL);

        return {
          resources: result.rows.map((row) => ({
            uri: `postgres://tables/${row.table_name}`,
            name: row.table_name,
            description: `Table: ${row.table_name}`,
            mimeType: "text/plain"
          }))
        };
      }
    }),
    {
      description:
        "Structure of a PostgreSQL table in the public schema. Use the URI postgres://tables/<table_name> to read column definitions and example SELECT statements.",
      mimeType: "text/plain"
    },
    async (uri, variables) => {
      const rawName = variables["table_name"];
      const tableName = Array.isArray(rawName) ? rawName[0] : rawName;

      if (typeof tableName !== "string" || tableName.length === 0) {
        throw new Error(`Invalid table_name in URI: ${uri.href}`);
      }

      const result = await pool.query<ColumnRow>(COLUMNS_FOR_TABLE_SQL, [
        tableName
      ]);

      if (result.rows.length === 0) {
        throw new Error(`Unknown PostgreSQL table: ${tableName}`);
      }

      const text = buildTableResourceText(tableName, result.rows);

      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "text/plain",
            text
          }
        ]
      };
    }
  );

  server.registerResource(
    "postgres-schema",
    "postgres://schema",
    {
      description:
        "Full structure of the PostgreSQL public schema in a single document: every table with column definitions (type, NOT NULL, PRIMARY KEY, DEFAULT) and example SELECT statements. Read this once instead of reading each postgres://tables/{table_name} resource separately.",
      mimeType: "text/plain"
    },
    async (uri) => {
      const result = await pool.query<SchemaColumnRow>(COLUMNS_FOR_ALL_TABLES_SQL);

      if (result.rows.length === 0) {
        throw new Error("No tables found in PostgreSQL schema: public");
      }

      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "text/plain",
            text: buildSchemaResourceText(result.rows)
          }
        ]
      };
    }
  );
}
