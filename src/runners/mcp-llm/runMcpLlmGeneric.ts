import path from "node:path";
import { performance } from "node:perf_hooks";
import { connectServers, type ConnectedCatalog } from "../../clients/mcpClientFactory.js";
import {
  OllamaChatClient,
  loadOllamaGenerationOptions,
  type OllamaChatMessage,
  type OllamaToolCall
} from "../../clients/ollama/ollamaClient.js";
import { makeResultRecord, type ResultRecord } from "../../shared/resultRecord.js";
import { buildRunManifest, newRunId, writeRunResults } from "../../shared/resultsWriter.js";
import {
  loadScenariosFromDir,
  loadToolFamilyMapping,
  type Scenario
} from "../../shared/scenarioLoader.js";
import {
  OWN_SERVERS,
  parseToolResultCount,
  resolveServer,
  toolResultText,
  type ResolvedServer,
  type ToolResultLike
} from "../mcp/serverRegistry.js";
import { extractFinalJson, scoreArgumentCorrectness, scoreResultIntegration } from "./llmMetrics.js";

const SCENARIOS_DIR = path.join("scenarios", "mcp-llm");
const THIRD_PARTY_SCENARIOS_DIR = path.join("scenarios", "third-party");

type EffectiveExpectations = { tools: string[]; fromFamily: boolean };

const familyMappingCache = new Map<string, Record<string, string[]> | null>();

async function effectiveExpectations(scenario: Scenario): Promise<EffectiveExpectations> {
  if (scenario.expected_tools.length > 0) {
    return { tools: scenario.expected_tools, fromFamily: false };
  }
  if (!scenario.expected_tool_family || !scenario.server) {
    return { tools: [], fromFamily: false };
  }
  let mapping = familyMappingCache.get(scenario.server);
  if (mapping === undefined) {
    const mappingFile = path.join(THIRD_PARTY_SCENARIOS_DIR, `${scenario.server}.mapping.yaml`);
    try {
      const loaded = await loadToolFamilyMapping(mappingFile);
      mapping = Object.fromEntries(
        Object.entries(loaded.mapping).map(([family, tools]) => [
          family,
          Array.isArray(tools) ? tools : [tools]
        ])
      );
    } catch {
      mapping = null;
      console.warn(
        `[mapping] brak/nieczytelny ${mappingFile} — toolSelectionCorrect dla ${scenario.server} będzie null (uzupełnij po inspekcji: npm run inspect:mcp).`
      );
    }
    familyMappingCache.set(scenario.server, mapping);
  }
  return { tools: mapping?.[scenario.expected_tool_family] ?? [], fromFamily: true };
}

const SYSTEM_PROMPT = [
  "You are an evaluation agent with access to MCP tools.",
  "Use the available tools to complete the user's task.",
  "After you receive tool results, you MUST respond with a single valid JSON object as your final message content.",
  "Do not invent data. Base the answer only on tool results.",
  "An empty assistant message is not allowed after tool results."
].join(" ");

type CliOptions = {
  server: string;
  scenario: string | null;
  iterations: number | null;
  catalog: "scenario" | "full";
  maxTurns: number;
  warmup: number;
  numCtx: number | null;
};

function parseCliOptions(argv: string[]): CliOptions {
  const options: CliOptions = {
    server: "all",
    scenario: null,
    iterations: null,
    catalog: "scenario",
    maxTurns: 6,
    warmup: 0,
    numCtx: null
  };
  const takeNumber = (raw: string | undefined, flag: string): number => {
    const value = Number(raw);
    if (!Number.isInteger(value) || value <= 0) {
      throw new Error(`${flag} must be a positive integer.`);
    }
    return value;
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--server" && argv[index + 1]) {
      options.server = argv[++index] as string;
    } else if (arg === "--scenario" && argv[index + 1]) {
      options.scenario = argv[++index] as string;
    } else if (arg === "--iterations" && argv[index + 1]) {
      options.iterations = takeNumber(argv[++index], "--iterations");
    } else if (arg === "--max-turns" && argv[index + 1]) {
      options.maxTurns = takeNumber(argv[++index], "--max-turns");
    } else if (arg === "--num-ctx" && argv[index + 1]) {
      options.numCtx = takeNumber(argv[++index], "--num-ctx");
    } else if (arg === "--warmup" && argv[index + 1]) {
      const value = Number(argv[++index]);
      if (!Number.isInteger(value) || value < 0) {
        throw new Error("--warmup must be a non-negative integer.");
      }
      options.warmup = value;
    } else if (arg === "--catalog" && argv[index + 1]) {
      const value = argv[++index];
      if (value !== "scenario" && value !== "full") {
        throw new Error('--catalog must be "scenario" or "full".');
      }
      options.catalog = value;
    }
  }
  return options;
}

type IterationOutcome = {
  latencyMs: number;
  success: boolean;
  errorCode: string | null;
  errorMessage: string | null;
  toolCallRequested: boolean;
  toolCallSuccess: boolean | null;
  toolName: string | null;
  toolArguments: Record<string, unknown> | null;
  numberOfToolCalls: number;
  llmFirstResponseMs: number | null;
  llmFinalResponseMs: number | null;
  toolExecutionMs: number | null;
  promptTokens: number | null;
  outputTokens: number | null;
  finalAnswerValidJson: boolean;
  resultCount: number | null;
  resultIntegrationScore: number | null;
};

async function runIteration(
  scenario: Scenario,
  expectsTools: boolean,
  catalog: ConnectedCatalog,
  ollama: OllamaChatClient,
  maxTurns: number
): Promise<IterationOutcome> {
  const startedAt = performance.now();
  const userPrompt = (scenario.prompt ?? scenario.name).replaceAll("{{REPO}}", process.cwd());
  const messages: OllamaChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: userPrompt }
  ];

  let llmCalls = 0;
  let promptTokens: number | null = null;
  let outputTokens: number | null = null;
  let llmFirstResponseMs: number | null = null;
  let llmLastResponseMs: number | null = null;
  let toolExecutionMs = 0;
  let executedToolCalls = 0;
  let failedToolCalls = 0;
  let firstToolName: string | null = null;
  let firstToolArguments: Record<string, unknown> | null = null;
  let lastToolPayload: unknown = null;
  let lastToolResult: ToolResultLike | null = null;
  let finalContent = "";
  let fatalError: { code: string; message: string } | null = null;

  const addTokens = (prompt: number | null, output: number | null): void => {
    if (prompt !== null) {
      promptTokens = (promptTokens ?? 0) + prompt;
    }
    if (output !== null) {
      outputTokens = (outputTokens ?? 0) + output;
    }
  };

  try {
    for (let turn = 1; turn <= maxTurns; turn += 1) {
      const response = await ollama.chat(messages, catalog.ollamaTools);
      llmCalls += 1;
      addTokens(response.promptTokens, response.outputTokens);
      if (llmFirstResponseMs === null) {
        llmFirstResponseMs = response.durationMs;
      }
      llmLastResponseMs = response.durationMs;

      const toolCalls: OllamaToolCall[] = response.message.tool_calls ?? [];
      if (toolCalls.length === 0) {
        finalContent = response.message.content ?? "";
        break;
      }
      if (turn === maxTurns) {
        fatalError = {
          code: "LLM_MAX_TURNS_EXCEEDED",
          message: `Model nadal żąda narzędzi po ${maxTurns} turach.`
        };
        break;
      }

      messages.push({
        role: "assistant",
        content: response.message.content ?? "",
        tool_calls: toolCalls
      });

      for (const call of toolCalls) {
        const args = call.function.arguments ?? {};
        if (firstToolName === null) {
          firstToolName = call.function.name;
          firstToolArguments = args;
        }
        const toolStartedAt = performance.now();
        const result = await catalog.callTool(call.function.name, args).catch((error: unknown) => {
          fatalError = {
            code: "MCP_CALL_FAILED",
            message: error instanceof Error ? error.message : "Unknown MCP error"
          };
          return null;
        });
        toolExecutionMs += performance.now() - toolStartedAt;
        if (result === null) {
          break;
        }
        executedToolCalls += 1;
        const text = toolResultText(result) ?? "";
        if (result.isError === true) {
          failedToolCalls += 1;
        } else {
          lastToolResult = result;
          try {
            lastToolPayload = JSON.parse(text);
          } catch {
            lastToolPayload = text;
          }
        }
        messages.push({ role: "tool", content: text, tool_name: call.function.name });
      }
      if (fatalError) {
        break;
      }
    }
  } catch (error) {
    fatalError = {
      code: "LLM_REQUEST_FAILED",
      message: error instanceof Error ? error.message : "Unknown Ollama error"
    };
  }

  const latencyMs = Number((performance.now() - startedAt).toFixed(3));
  const finalJson = finalContent === "" ? null : extractFinalJson(finalContent);
  const toolCallRequested = firstToolName !== null;

  let errorCode: string | null = null;
  let errorMessage: string | null = null;
  if (fatalError) {
    errorCode = fatalError.code;
    errorMessage = fatalError.message;
  } else if (expectsTools && !toolCallRequested) {
    errorCode = "LLM_NO_TOOL_CALL";
    errorMessage = "Model nie zażądał żadnego narzędzia, choć scenariusz tego oczekuje.";
  } else if (finalJson === null) {
    errorCode = "LLM_INVALID_JSON";
    errorMessage = "Finalna odpowiedź nie jest poprawnym JSON-em.";
  }
  const success = errorCode === null;

  return {
    latencyMs,
    success,
    errorCode,
    errorMessage,
    toolCallRequested,
    toolCallSuccess: executedToolCalls > 0 ? failedToolCalls === 0 : null,
    toolName: firstToolName,
    toolArguments: firstToolArguments,
    numberOfToolCalls: executedToolCalls,
    llmFirstResponseMs,
    llmFinalResponseMs: llmCalls > 1 ? llmLastResponseMs : null,
    toolExecutionMs: executedToolCalls > 0 ? Number(toolExecutionMs.toFixed(3)) : null,
    promptTokens,
    outputTokens,
    finalAnswerValidJson: finalJson !== null,
    resultCount: lastToolResult ? parseToolResultCount(lastToolResult) : null,
    resultIntegrationScore:
      lastToolPayload !== null && finalContent !== ""
        ? scoreResultIntegration(lastToolPayload, finalContent)
        : null
  };
}

function buildRecord(
  scenario: Scenario,
  outcome: IterationOutcome,
  expectations: EffectiveExpectations,
  resolved: Pick<ResolvedServer, "serverKind" | "serverVersion">,
  context: { runId: string; iteration: number; catalog: ConnectedCatalog; catalogMode: string; model: string }
): ResultRecord {
  const expectsTools = expectations.tools.length > 0;
  const toolSelectionCorrect = expectsTools
    ? outcome.toolName !== null && expectations.tools.includes(outcome.toolName)
    : null;
  const argumentCorrectness = expectations.fromFamily
    ? null
    : outcome.toolCallRequested
      ? scoreArgumentCorrectness(scenario.expected_arguments, outcome.toolArguments)
      : expectsTools
        ? 0
        : null;
  const unnecessaryToolCalls =
    expectsTools && outcome.numberOfToolCalls > 0
      ? Math.max(0, outcome.numberOfToolCalls - Math.max(1, expectations.tools.length))
      : null;

  return makeResultRecord(
    {
      runId: context.runId,
      scenarioId: scenario.id,
      category: scenario.category,
      variant: scenario.variant,
      iteration: context.iteration,
      success: outcome.success,
      deterministic: false,
      evaluationSource: "own"
    },
    {
      scenarioName: scenario.name,
      serverKind: resolved.serverKind,
      serverName: scenario.server,
      prompt: scenario.prompt,
      latencyMs: outcome.latencyMs,
      stageLatencies: {
        llmFirstResponseMs: outcome.llmFirstResponseMs,
        toolExecutionMs: outcome.toolExecutionMs,
        llmFinalResponseMs: outcome.llmFinalResponseMs
      },
      errorCode: outcome.errorCode,
      errorMessage: outcome.errorMessage,
      toolCallRequested: outcome.toolCallRequested,
      toolCallSuccess: outcome.toolCallSuccess,
      toolName: outcome.toolName,
      toolArguments: outcome.toolArguments,
      numberOfToolCalls: outcome.numberOfToolCalls,
      unnecessaryToolCalls,
      resultCount: outcome.resultCount,
      argumentCorrectness,
      toolSelectionCorrect,
      finalAnswerValidJson: outcome.finalAnswerValidJson,
      resultIntegrationScore: outcome.resultIntegrationScore,
      tokenUsage:
        outcome.promptTokens !== null || outcome.outputTokens !== null
          ? {
              promptTokens: outcome.promptTokens,
              outputTokens: outcome.outputTokens,
              totalTokens:
                outcome.promptTokens !== null && outcome.outputTokens !== null
                  ? outcome.promptTokens + outcome.outputTokens
                  : null
            }
          : null,
      timestamp: new Date().toISOString(),
      metadata: {
        model: context.model,
        serverVersion: resolved.serverVersion,
        sdkVersion: "2.0.0-alpha.2",
        repoCommit: null,
        os: process.platform
      },
      externalScores: {
        catalogToolCount: context.catalog.toolCount,
        catalogSchemaChars: context.catalog.catalogSchemaChars
      },
      externalLabels: {
        catalogMode: context.catalogMode,
        catalogServers: context.catalog.servers.join("+")
      }
    }
  );
}

async function runGroup(
  groupLabel: string,
  serverNames: string[],
  scenarios: Scenario[],
  options: CliOptions,
  ollama: OllamaChatClient,
  runId: string,
  records: ResultRecord[]
): Promise<void> {
  console.log(`\n=== Grupa: ${groupLabel} (serwery: ${serverNames.join("+")}; ${scenarios.length} scenariuszy) ===`);
  const catalog = await connectServers(serverNames);
  const catalogMode = options.catalog;

  try {
    console.log(
      `Katalog: ${catalog.toolCount} narzedzi, ${catalog.catalogSchemaChars} znakow schematow.`
    );
    for (const scenario of scenarios) {
      const iterations = options.iterations ?? scenario.iterations;
      const expectations = await effectiveExpectations(scenario);
      const resolved: Pick<ResolvedServer, "serverKind" | "serverVersion"> =
        (scenario.server ? resolveServer(scenario.server) : null) ?? {
          serverKind: "own",
          serverVersion: "own"
        };
      const expectsTools = expectations.tools.length > 0;

      for (let warmup = 1; warmup <= options.warmup; warmup += 1) {
        await catalog.beforeIteration(scenario);
        await runIteration(scenario, expectsTools, catalog, ollama, options.maxTurns).catch(() => undefined);
      }

      for (let iteration = 1; iteration <= iterations; iteration += 1) {
        await catalog.beforeIteration(scenario);
        const outcome = await runIteration(scenario, expectsTools, catalog, ollama, options.maxTurns);
        records.push(
          buildRecord(scenario, outcome, expectations, resolved, {
            runId,
            iteration,
            catalog,
            catalogMode,
            model: ollama.model
          })
        );
        console.log(
          `[${groupLabel}/${scenario.id}] iter ${iteration}/${iterations} success=${outcome.success} tool=${outcome.toolName ?? "<none>"} latencyMs=${outcome.latencyMs} tokens=${outcome.promptTokens ?? "?"}+${outcome.outputTokens ?? "?"}${outcome.errorCode ? ` error=${outcome.errorCode}` : ""}`
        );
      }
    }
  } finally {
    await catalog.close();
  }
}

async function main() {
  const options = parseCliOptions(process.argv.slice(2));
  const ollama = new OllamaChatClient(
    options.numCtx !== null
      ? { generationOptions: { ...loadOllamaGenerationOptions(), num_ctx: options.numCtx } }
      : {}
  );
  if (options.numCtx !== null) {
    console.log(`[opcje] num_ctx nadpisane na ${options.numCtx} (flagą --num-ctx).`);
  }

  if (!(await ollama.isAvailable())) {
    throw new Error(
      `Ollama nie odpowiada pod ${ollama.baseUrl} — uruchom aplikację Ollama (lub 'ollama serve') i scripts/setup/windows/install_ollama_models.ps1.`
    );
  }

  const ownDir = await loadScenariosFromDir(SCENARIOS_DIR);
  const thirdPartyDir = await loadScenariosFromDir(THIRD_PARTY_SCENARIOS_DIR);
  const allScenarios = [...ownDir.scenarios, ...thirdPartyDir.scenarios];
  for (const warning of [...ownDir.warnings, ...thirdPartyDir.warnings]) {
    console.warn(`[loader] ${warning}`);
  }

  let scenarios = allScenarios.filter(
    (scenario) => scenario.variant === "mcp_llm" || scenario.variant === "third_party_mcp_llm"
  );
  if (options.scenario) {
    scenarios = scenarios.filter((scenario) => scenario.id === options.scenario);
  }
  if (options.server !== "all") {
    scenarios = scenarios.filter((scenario) => scenario.server === options.server);
  }
  scenarios = scenarios.filter((scenario) => {
    if (scenario.category === "cross") {
      return true;
    }
    if (scenario.server !== null && !resolveServer(scenario.server)) {
      console.warn(`[skip] ${scenario.id}: serwer "${scenario.server}" nie jest zarejestrowany (serverRegistry.ts).`);
      return false;
    }
    return scenario.server !== null;
  });
  if (scenarios.length === 0) {
    throw new Error("Brak pasujących scenariuszy mcp_llm (sprawdź --server/--scenario).");
  }

  const allRegistered = Object.keys(OWN_SERVERS).sort();
  const runId = newRunId();
  const records: ResultRecord[] = [];
  const connectedServers = new Set<string>();

  const crossScenarios = scenarios.filter((scenario) => scenario.category === "cross");
  const regularScenarios = scenarios.filter((scenario) => scenario.category !== "cross");

  console.log(
    `Starting generic MCP+LLM evaluation: model=${ollama.model}, catalog=${options.catalog}, scenarios=${scenarios.length} (w tym cross: ${crossScenarios.length}).`
  );

  if (regularScenarios.length > 0) {
    const ownRegular = regularScenarios.filter(
      (scenario) => resolveServer(scenario.server as string)?.serverKind === "own"
    );
    const thirdPartyRegular = regularScenarios.filter(
      (scenario) => resolveServer(scenario.server as string)?.serverKind === "third_party"
    );

    const perServerGroups = (list: Scenario[]): Map<string, Scenario[]> => {
      const byServer = new Map<string, Scenario[]>();
      for (const scenario of list) {
        const key = scenario.server as string;
        const bucket = byServer.get(key) ?? [];
        bucket.push(scenario);
        byServer.set(key, bucket);
      }
      return byServer;
    };

    if (options.catalog === "full" && ownRegular.length > 0) {
      allRegistered.forEach((name) => connectedServers.add(name));
      await runGroup("full-catalog", allRegistered, ownRegular, options, ollama, runId, records);
    } else {
      for (const [serverName, group] of [...perServerGroups(ownRegular).entries()].sort(([a], [b]) => a.localeCompare(b))) {
        connectedServers.add(serverName);
        await runGroup(serverName, [serverName], group, options, ollama, runId, records);
      }
    }

    for (const [serverName, group] of [...perServerGroups(thirdPartyRegular).entries()].sort(([a], [b]) => a.localeCompare(b))) {
      connectedServers.add(serverName);
      await runGroup(serverName, [serverName], group, options, ollama, runId, records);
    }
  }

  if (crossScenarios.length > 0) {
    allRegistered.forEach((name) => connectedServers.add(name));
    await runGroup("cross", allRegistered, crossScenarios, options, ollama, runId, records);
  }

  const runDir = await writeRunResults({
    runId,
    records,
    manifest: buildRunManifest({
      runId,
      model: ollama.model,
      serverVersions: Object.fromEntries(
        [...connectedServers].sort().map((name) => [name, resolveServer(name)?.serverVersion ?? "own"])
      ),
      notes: `Wspolny runner MCP+LLM: catalog=${options.catalog}, maxTurns=${options.maxTurns}, warmup=${options.warmup}; scenariusze scenarios/mcp-llm/**; runner: runMcpLlmGeneric.ts`
    })
  });

  const succeeded = records.filter((record) => record.success).length;
  console.log(JSON.stringify({
    variant: "mcp_llm",
    catalog: options.catalog,
    model: ollama.model,
    totalMeasurements: records.length,
    succeeded,
    resultsDir: runDir
  }, null, 2));
}

main().catch((error) => {
  console.error("Generic MCP+LLM runner failed:", error);
  process.exit(1);
});
