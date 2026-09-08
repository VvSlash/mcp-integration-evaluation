import { readFileSync } from "node:fs";
import type { Server } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRestApiApp } from "../../src/rest-api/app.js";
import { buildOpenApiSpec } from "../../src/servers/rest-api/resources.js";
import { createRestApiToolClient, RestToolError, type RestApiToolClient } from "../../src/servers/rest-api/tools.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const seedPath = path.join(repoRoot, "datasets", "rest-api", "seed.json");

type SeedExpected = {
  productsCount: number;
  ordersCount: number;
  productId3: { id: number; name: string; price: number } | null;
};
const expected = (
  JSON.parse(readFileSync(seedPath, "utf8")) as { expected: SeedExpected }
).expected;

let server: Server;
let api: RestApiToolClient;

beforeAll(async () => {
  const app = createRestApiApp({ seedPath, accessLogPath: null });
  server = await new Promise<Server>((resolve) => {
    const instance = app.listen(0, () => resolve(instance));
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Unexpected server address");
  }
  api = createRestApiToolClient(`http://127.0.0.1:${address.port}`);
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve()))
  );
});

describe("narzędzia rest_* (mapowanie 1:1 na endpointy)", () => {
  it("rest_health_check → GET /health", async () => {
    const body = (await api.healthCheck()) as { status: string };
    expect(body.status).toBe("ok");
  });

  it("rest_get_products → GET /products (total z seedu, filtr + limit)", async () => {
    const all = (await api.getProducts({})) as { items: unknown[]; total: number };
    expect(all.total).toBe(expected.productsCount);

    const limited = (await api.getProducts({ category: "electronics", limit: 2 })) as {
      items: Array<{ category: string }>;
      total: number;
    };
    expect(limited.items.length).toBeLessThanOrEqual(2);
    expect(limited.items.every((item) => item.category === "electronics")).toBe(true);
  });

  it("rest_get_product → GET /products/:id (dane z seedu; 404 → REST_HTTP_404)", async () => {
    const product = (await api.getProduct({ id: 3 })) as { id: number; name: string; price: number };
    expect(product.id).toBe(3);
    expect(product.name).toBe(expected.productId3?.name);
    expect(product.price).toBe(expected.productId3?.price);

    await expect(api.getProduct({ id: 999999 })).rejects.toMatchObject({ code: "REST_HTTP_404" });
  });

  it("rest_create_order → POST /orders (201; widoczne w rest_get_orders)", async () => {
    const order = (await api.createOrder({
      productId: 3,
      quantity: 2,
      customerName: "Jan Testowy"
    })) as { id: number; status: string };
    expect(order.id).toBeGreaterThan(expected.ordersCount);
    expect(order.status).toBe("pending");

    const orders = (await api.getOrders({ status: "pending" })) as {
      items: Array<{ id: number }>;
    };
    expect(orders.items.some((item) => item.id === order.id)).toBe(true);
  });

  it("rest_create_order: zły productId → REST_HTTP_404 (walidacja po stronie API)", async () => {
    await expect(
      api.createOrder({ productId: 999999, quantity: 1, customerName: "X" })
    ).rejects.toMatchObject({ code: "REST_HTTP_404" });
  });

  it("niedostępne API → REST_API_UNAVAILABLE (jawny kod, nie wyjątek fetch)", async () => {
    const dead = createRestApiToolClient("http://127.0.0.1:9");
    await expect(dead.healthCheck()).rejects.toBeInstanceOf(RestToolError);
    await expect(dead.healthCheck()).rejects.toMatchObject({ code: "REST_API_UNAVAILABLE" });
  });
});

describe("zasób rest://openapi (spójność ze stanem faktycznym API)", () => {
  it("specyfikacja OpenAPI opisuje wszystkie endpointy API", () => {
    const spec = buildOpenApiSpec("http://localhost:4100") as {
      openapi: string;
      paths: Record<string, Record<string, unknown>>;
    };
    expect(spec.openapi).toMatch(/^3\./);
    for (const endpointPath of ["/health", "/products", "/products/{id}", "/orders", "/metrics"]) {
      expect(spec.paths[endpointPath], `brak ${endpointPath} w OpenAPI`).toBeDefined();
    }
    expect(spec.paths["/orders"]?.["post"], "brak POST /orders w OpenAPI").toBeDefined();
  });
});
