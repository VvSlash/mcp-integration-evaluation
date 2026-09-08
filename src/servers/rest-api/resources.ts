import type { McpServer } from "@modelcontextprotocol/server";
import { env } from "../../config/env.js";

const productSchema = {
  type: "object",
  properties: {
    id: { type: "integer" },
    name: { type: "string" },
    category: { type: "string" },
    price: { type: "number" },
    stock: { type: "integer" }
  },
  required: ["id", "name", "category", "price", "stock"]
} as const;

const orderSchema = {
  type: "object",
  properties: {
    id: { type: "integer" },
    productId: { type: "integer" },
    quantity: { type: "integer" },
    customerName: { type: "string" },
    status: { type: "string" }
  },
  required: ["id", "productId", "quantity", "customerName", "status"]
} as const;

export function buildOpenApiSpec(baseUrl: string): Record<string, unknown> {
  return {
    openapi: "3.0.3",
    info: {
      title: "mcp-integration-evaluation local REST API",
      version: "0.1.0",
      description:
        "Local in-memory test API. State resets to the seed on restart."
    },
    servers: [{ url: baseUrl }],
    paths: {
      "/health": {
        get: {
          summary: "Health check",
          responses: {
            "200": {
              description: "API is up",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: { status: { type: "string" }, uptimeMs: { type: "number" } }
                  }
                }
              }
            }
          }
        }
      },
      "/products": {
        get: {
          summary: "List products",
          parameters: [
            { name: "category", in: "query", required: false, schema: { type: "string" } },
            { name: "limit", in: "query", required: false, schema: { type: "integer", minimum: 1 } }
          ],
          responses: {
            "200": {
              description: "Products matching the filter (total = count before limit)",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      items: { type: "array", items: productSchema },
                      total: { type: "integer" }
                    }
                  }
                }
              }
            }
          }
        }
      },
      "/products/{id}": {
        get: {
          summary: "Get product by id",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
          responses: {
            "200": { description: "Product", content: { "application/json": { schema: productSchema } } },
            "404": { description: "Product not found" }
          }
        }
      },
      "/orders": {
        get: {
          summary: "List orders",
          parameters: [
            { name: "status", in: "query", required: false, schema: { type: "string" } },
            { name: "limit", in: "query", required: false, schema: { type: "integer", minimum: 1 } }
          ],
          responses: {
            "200": {
              description: "Orders matching the filter",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      items: { type: "array", items: orderSchema },
                      total: { type: "integer" }
                    }
                  }
                }
              }
            }
          }
        },
        post: {
          summary: "Create an order",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    productId: { type: "integer" },
                    quantity: { type: "integer", minimum: 1 },
                    customerName: { type: "string", minLength: 1 }
                  },
                  required: ["productId", "quantity", "customerName"]
                }
              }
            }
          },
          responses: {
            "201": { description: "Order created", content: { "application/json": { schema: orderSchema } } },
            "400": { description: "Invalid body" },
            "404": { description: "Unknown productId" }
          }
        }
      },
      "/metrics": {
        get: {
          summary: "Internal request counters (per endpoint) — measurement readout",
          responses: {
            "200": {
              description: "Request counters",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      requestCount: { type: "integer" },
                      avgLatencyMs: { type: "number" },
                      perEndpoint: { type: "object" }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  };
}

export function registerRestResources(server: McpServer, baseUrl: string = env.restApi.baseUrl): void {
  server.registerResource(
    "rest-openapi",
    "rest://openapi",
    {
      description:
        "OpenAPI 3 specification of the local REST API wrapped by the rest_* tools. Read it to understand available endpoints, parameters and response shapes.",
      mimeType: "application/json"
    },
    async (uri) => {
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(buildOpenApiSpec(baseUrl), null, 2)
          }
        ]
      };
    }
  );
}
