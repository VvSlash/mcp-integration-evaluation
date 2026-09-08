import { connect, type Socket } from "node:net";
import { env } from "../../config/env.js";

export const BRIDGE_START_HINT =
  "powershell -ExecutionPolicy Bypass -File scripts/run/start_blender_bridge.ps1";

export class BlenderBridgeError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "BlenderBridgeError";
  }
}

export function feedFrames(buffer: string, chunk: string): { buffer: string; frames: string[] } {
  const parts = (buffer + chunk).split("\n");
  const rest = parts.pop() ?? "";
  return {
    buffer: rest,
    frames: parts.map((part) => part.trim()).filter((part) => part !== "")
  };
}

export function parseBridgeResponse(frame: string): unknown {
  let parsed: unknown;
  try {
    parsed = JSON.parse(frame);
  } catch {
    throw new BlenderBridgeError(
      "BLENDER_BRIDGE_PROTOCOL_ERROR",
      `Addon odpowiedział niepoprawnym JSON-em: ${frame.slice(0, 200)}`
    );
  }
  const response = parsed as { status?: unknown; result?: unknown; code?: unknown; message?: unknown };
  if (response.status === "ok") {
    return response.result ?? null;
  }
  if (response.status === "error") {
    throw new BlenderBridgeError(
      typeof response.code === "string" ? response.code : "BLENDER_SCRIPT_ERROR",
      typeof response.message === "string" ? response.message : "Nieznany błąd addonu."
    );
  }
  throw new BlenderBridgeError(
    "BLENDER_BRIDGE_PROTOCOL_ERROR",
    `Odpowiedź addonu bez pola status: ${frame.slice(0, 200)}`
  );
}

export type BridgeOptions = {
  host?: string;
  port?: number;
  timeoutMs?: number;
};

export class OwnBlenderBridge {
  private readonly host: string;
  private readonly port: number;
  private readonly timeoutMs: number;
  private socket: Socket | null = null;
  private buffer = "";
  private pendingFrame: { resolve: (frame: string) => void; reject: (error: Error) => void } | null = null;
  private chain: Promise<unknown> = Promise.resolve();

  constructor(options: BridgeOptions = {}) {
    this.host = options.host ?? env.blender.bridgeHost;
    this.port = options.port ?? env.blender.bridgePort;
    this.timeoutMs = options.timeoutMs ?? env.blender.commandTimeoutMs;
  }

  get address(): string {
    return `${this.host}:${this.port}`;
  }

  private failPending(error: Error): void {
    const pending = this.pendingFrame;
    this.pendingFrame = null;
    pending?.reject(error);
  }

  private dropSocket(): void {
    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }
    this.buffer = "";
  }

  private async ensureSocket(): Promise<Socket> {
    if (this.socket && !this.socket.destroyed) {
      return this.socket;
    }
    this.buffer = "";
    const socket = await new Promise<Socket>((resolve, reject) => {
      const candidate = connect({ host: this.host, port: this.port }, () => {
        candidate.setTimeout(0);
        resolve(candidate);
      });
      candidate.setTimeout(2000, () => {
        candidate.destroy();
        reject(
          new BlenderBridgeError(
            "BLENDER_BRIDGE_UNAVAILABLE",
            `Most własnego addonu Blendera (TCP ${this.address}) nie odpowiada — uruchom: ${BRIDGE_START_HINT} i powtórz.`
          )
        );
      });
      candidate.on("error", (error) => {
        reject(
          new BlenderBridgeError(
            "BLENDER_BRIDGE_UNAVAILABLE",
            `Most własnego addonu Blendera (TCP ${this.address}) niedostępny (${error.message}) — uruchom: ${BRIDGE_START_HINT} i powtórz.`
          )
        );
      });
    });

    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => {
      const fed = feedFrames(this.buffer, chunk);
      this.buffer = fed.buffer;
      for (const frame of fed.frames) {
        const pending = this.pendingFrame;
        this.pendingFrame = null;
        pending?.resolve(frame);
      }
    });
    socket.on("error", (error) => {
      this.failPending(
        new BlenderBridgeError("BLENDER_BRIDGE_UNAVAILABLE", `Połączenie z addonem przerwane: ${error.message}`)
      );
      this.dropSocket();
    });
    socket.on("close", () => {
      this.failPending(
        new BlenderBridgeError("BLENDER_BRIDGE_UNAVAILABLE", "Addon zamknął połączenie (Blender wyłączony?).")
      );
      if (this.socket === socket) {
        this.socket = null;
      }
    });
    this.socket = socket;
    return socket;
  }

  private async send(op: string, params: Record<string, unknown>, timeoutMs: number): Promise<unknown> {
    const socket = await this.ensureSocket();
    const frame = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingFrame = null;
        this.dropSocket();
        reject(
          new BlenderBridgeError(
            "TOOL_TIMEOUT",
            `Operacja "${op}" nie zakończyła się w ${timeoutMs} ms (Blender zajęty renderem/modalem?).`
          )
        );
      }, timeoutMs);
      this.pendingFrame = {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        }
      };
      socket.write(`${JSON.stringify({ op, params })}\n`);
    });
    return parseBridgeResponse(frame);
  }

  async command(op: string, params: Record<string, unknown> = {}, timeoutMs?: number): Promise<unknown> {
    const run = () => this.send(op, params, timeoutMs ?? this.timeoutMs);
    const result = this.chain.then(run, run);
    this.chain = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }

  async close(): Promise<void> {
    this.failPending(new BlenderBridgeError("BLENDER_BRIDGE_UNAVAILABLE", "Most zamknięty przez klienta."));
    this.dropSocket();
  }
}

let sharedBridge: OwnBlenderBridge | null = null;

export function getSharedBridge(): OwnBlenderBridge {
  if (!sharedBridge) {
    sharedBridge = new OwnBlenderBridge();
  }
  return sharedBridge;
}

export async function closeSharedBridge(): Promise<void> {
  if (sharedBridge) {
    await sharedBridge.close();
    sharedBridge = null;
  }
}
