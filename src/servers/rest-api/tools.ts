import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { env } from "../../config/env.js";

export class RestToolError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly body: unknown = null
  ) {
    super(message);
    this.name = "RestToolError";
  }
}

export type RestCallResult = { status: number; body: unknown };

async function callApi(
  baseUrl: string,
  method: "GET" | "POST",
  path: string,
  query: Record<string, string | number | undefined> = {},
  body: Record<string, unknown> | null = null
): Promise<RestCallResult> {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) {
      search.set(key, String(value));
    }
  }
  const queryString = search.size > 0 ? `?${search.toString()}` : "";

  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}${queryString}`, {
      method,
      ...(body
        ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
        : {})
    });
  } catch (error) {
    throw new RestToolError(
      "REST_API_UNAVAILABLE",
      `Local REST API not reachable at ${baseUrl} — start it with 'npm run rest-api'. (${(error as Error).message})`
    );
  }
  const parsed: unknown = await response.json().catch(() => null);
  return { status: response.status, body: parsed };
}

function expectStatus(result: RestCallResult, expected: number): unknown {
  if (result.status !== expected) {
    throw new RestToolError(
      `REST_HTTP_${result.status}`,
      `Expected HTTP ${expected}, got ${result.status}.`,
      result.body
    );
  }
  return result.body;
}

export function createRestApiToolClient(baseUrl: string) {
  return {
    healthCheck: async (): Promise<unknown> =>
      expectStatus(await callApi(baseUrl, "GET", "/health"), 200),

    getProducts: async (args: { category?: string | undefined; limit?: number | undefined }): Promise<unknown> =>
      expectStatus(
        await callApi(baseUrl, "GET", "/products", { category: args.category, limit: args.limit }),
        200
      ),

    getProduct: async (args: { id: number }): Promise<unknown> =>
      expectStatus(await callApi(baseUrl, "GET", `/products/${args.id}`), 200),

    getOrders: async (args: { status?: string | undefined; limit?: number | undefined }): Promise<unknown> =>
      expectStatus(
        await callApi(baseUrl, "GET", "/orders", { status: args.status, limit: args.limit }),
        200
      ),

    createOrder: async (args: {
      productId: number;
      quantity: number;
      customerName: string;
    }): Promise<unknown> => expectStatus(await callApi(baseUrl, "POST", "/orders", {}, args), 201)
  };
}
export type RestApiToolClient = ReturnType<typeof createRestApiToolClient>;

type ToolSuccess = { content: Array<{ type: "text"; text: string }> };
type ToolFailure = { isError: true; content: Array<{ type: "text"; text: string }> };

function ok(payload: unknown): ToolSuccess {
  return { content: [{ type: "text", text: JSON.stringify(payload) }] };
}

function fail(error: unknown): ToolFailure {
  const code = error instanceof RestToolError ? error.code : "REST_TOOL_FAILED";
  const message = error instanceof Error ? error.message : "Unknown REST tool error";
  const body = error instanceof RestToolError ? error.body : null;
  return { isError: true, content: [{ type: "text", text: JSON.stringify({ code, message, body }) }] };
}

export function registerRestTools(server: McpServer, baseUrl: string = env.restApi.baseUrl): void {
  const api = createRestApiToolClient(baseUrl);

  server.registerTool(
    "rest_health_check",
    {
      description: "Check whether the local REST API is up. Maps 1:1 to GET /health.",
      inputSchema: z.object({})
    },
    async () => {
      try {
        return ok(await api.healthCheck());
      } catch (error) {
        return fail(error);
      }
    }
  );

  server.registerTool(
    "rest_get_products",
    {
      description:
        "List products from the local REST API, optionally filtered by category and limited. Maps 1:1 to GET /products.",
      inputSchema: z.object({
        category: z.string().optional(),
        limit: z.number().int().positive().optional()
      })
    },
    async (args) => {
      try {
        return ok(await api.getProducts(args));
      } catch (error) {
        return fail(error);
      }
    }
  );

  server.registerTool(
    "rest_get_product",
    {
      description: "Get a single product by id. Maps 1:1 to GET /products/:id (404 if unknown).",
      inputSchema: z.object({ id: z.number().int() })
    },
    async (args) => {
      try {
        return ok(await api.getProduct(args));
      } catch (error) {
        return fail(error);
      }
    }
  );

  server.registerTool(
    "rest_get_orders",
    {
      description:
        "List orders from the local REST API, optionally filtered by status and limited. Maps 1:1 to GET /orders.",
      inputSchema: z.object({
        status: z.string().optional(),
        limit: z.number().int().positive().optional()
      })
    },
    async (args) => {
      try {
        return ok(await api.getOrders(args));
      } catch (error) {
        return fail(error);
      }
    }
  );

  server.registerTool(
    "rest_create_order",
    {
      description:
        "Create a new order for a product. Maps 1:1 to POST /orders (400 on invalid body, 404 on unknown productId).",
      inputSchema: z.object({
        productId: z.number().int(),
        quantity: z.number().int().positive(),
        customerName: z.string().min(1)
      })
    },
    async (args) => {
      try {
        return ok(await api.createOrder(args));
      } catch (error) {
        return fail(error);
      }
    }
  );
}
