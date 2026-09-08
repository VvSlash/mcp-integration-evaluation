import "dotenv/config";

function getRequiredEnv(name: string): string {
  const value = process.env[name];

  if (!value || value.trim() === "") {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function getOptionalEnv(name: string, defaultValue: string): string {
  const rawValue = process.env[name];

  if (!rawValue || rawValue.trim() === "") {
    return defaultValue;
  }

  return rawValue;
}

function getOptionalNumberEnv(name: string, defaultValue: number): number {
  const rawValue = process.env[name];

  if (!rawValue || rawValue.trim() === "") {
    return defaultValue;
  }

  const value = Number(rawValue);

  if (!Number.isFinite(value)) {
    throw new Error(`Environment variable ${name} must be a number.`);
  }

  return value;
}

function getOptionalBooleanEnv(name: string, defaultValue: boolean): boolean {
  const rawValue = process.env[name];

  if (!rawValue || rawValue.trim() === "") {
    return defaultValue;
  }

  return rawValue.toLowerCase() === "true";
}

export type PostgresConfig = {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  ssl: boolean;
  queryTimeoutMs: number;
};

let postgresConfigCache: PostgresConfig | null = null;

const restApiPort = getOptionalNumberEnv("REST_API_PORT", 4100);

export const env = {
  get postgres(): PostgresConfig {
    if (!postgresConfigCache) {
      postgresConfigCache = {
        host: getRequiredEnv("POSTGRES_HOST"),
        port: getOptionalNumberEnv("POSTGRES_PORT", 5432),
        database: getRequiredEnv("POSTGRES_DB"),
        user: getRequiredEnv("POSTGRES_USER"),
        password: getRequiredEnv("POSTGRES_PASSWORD"),
        ssl: getOptionalBooleanEnv("POSTGRES_SSL", false),
        queryTimeoutMs: getOptionalNumberEnv("POSTGRES_QUERY_TIMEOUT_MS", 3000)
      };
    }
    return postgresConfigCache;
  },
  tools: {
    maxLimit: getOptionalNumberEnv("TOOL_MAX_LIMIT", 50)
  },
  json: {
    dataDir: getOptionalEnv("JSON_DATA_DIR", "datasets/json"),
    workDir: getOptionalEnv("JSON_WORK_DIR", "datasets/.work/json")
  },
  blender: {
    bridgeHost: getOptionalEnv("MCP_EVAL_BLENDER_HOST", "127.0.0.1"),
    bridgePort: getOptionalNumberEnv("MCP_EVAL_BLENDER_PORT", 9877),
    commandTimeoutMs: getOptionalNumberEnv("BLENDER_COMMAND_TIMEOUT_MS", 15000),
    renderTimeoutMs: getOptionalNumberEnv("BLENDER_RENDER_TIMEOUT_MS", 120000)
  },
  restApi: {
    port: restApiPort,
    seedPath: getOptionalEnv("REST_API_SEED_PATH", "datasets/rest-api/seed.json"),
    baseUrl: getOptionalEnv("REST_API_BASE_URL", `http://localhost:${restApiPort}`)
  },
  ollama: {
    baseUrl: getOptionalEnv("OLLAMA_BASE_URL", "http://localhost:11434"),
    model: getOptionalEnv("OLLAMA_MODEL", "qwen3.5")
  }
};
