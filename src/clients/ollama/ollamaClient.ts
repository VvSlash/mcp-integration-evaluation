import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { env } from "../../config/env.js";

export type OllamaToolSpec = {
  type: "function";
  function: { name: string; description: string; parameters: unknown };
};

export type OllamaToolCall = {
  type?: "function";
  function: { name: string; arguments: Record<string, unknown> };
};

export type OllamaChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content?: string;
  thinking?: string;
  tool_calls?: OllamaToolCall[];
  tool_name?: string;
};

export type OllamaChatResult = {
  message: { content?: string; thinking?: string; tool_calls?: OllamaToolCall[] };
  promptTokens: number | null;
  outputTokens: number | null;
  durationMs: number;
};

type OllamaChatResponse = {
  message?: { content?: string; thinking?: string; tool_calls?: OllamaToolCall[] };
  prompt_eval_count?: number;
  eval_count?: number;
};

export function loadOllamaGenerationOptions(
  configPath = "config/ollama/ollama.json"
): Record<string, unknown> {
  try {
    const parsed = JSON.parse(readFileSync(configPath, "utf8")) as { options?: unknown };
    return typeof parsed.options === "object" && parsed.options !== null
      ? (parsed.options as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export type OllamaClientOptions = {
  timeoutMs?: number;
  baseUrl?: string;
  model?: string;
  generationOptions?: Record<string, unknown>;
};

export class OllamaChatClient {
  readonly baseUrl: string;
  readonly model: string;
  readonly generationOptions: Record<string, unknown>;
  readonly timeoutMs: number;

  constructor(options: OllamaClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? env.ollama.baseUrl;
    this.model = options.model ?? env.ollama.model;
    this.timeoutMs = options.timeoutMs ?? 180000;
    this.generationOptions = options.generationOptions ?? loadOllamaGenerationOptions();
  }

  async isAvailable(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`, {
        signal: AbortSignal.timeout(3000)
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async chat(messages: OllamaChatMessage[], tools?: OllamaToolSpec[]): Promise<OllamaChatResult> {
    const startedAt = performance.now();
    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: "POST",
      signal: AbortSignal.timeout(this.timeoutMs),
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.model,
        stream: false,
        messages,
        ...(tools && tools.length > 0 ? { tools } : {}),
        options: this.generationOptions
      })
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`Ollama chat failed: HTTP ${response.status} ${text.slice(0, 300)}`);
    }

    const data = (await response.json()) as OllamaChatResponse;
    return {
      message: { ...data.message },
      promptTokens: typeof data.prompt_eval_count === "number" ? data.prompt_eval_count : null,
      outputTokens: typeof data.eval_count === "number" ? data.eval_count : null,
      durationMs: Number((performance.now() - startedAt).toFixed(3))
    };
  }
}
