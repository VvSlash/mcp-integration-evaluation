import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import type { Server } from "node:http";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRestApiApp } from "../../src/rest-api/app.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const seedPath = path.join(repoRoot, "datasets", "rest-api", "seed.json");

type SeedExpected = {
  productsCount: number;
  ordersCount: number;
  productId3: { id: number; name: string; category: string; price: number } | null;
};
const expected = (
  JSON.parse(readFileSync(seedPath, "utf8")) as { expected: SeedExpected }
).expected;

let tmpDir: string;
let accessLogPath: string;
let server: Server;
let baseUrl: string;

function listen(app: ReturnType<typeof createRestApiApp>): Promise<Server> {
  return new Promise((resolve) => {
    const instance = app.listen(0, () => resolve(instance));
  });
}

beforeAll(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), "rest-api-test-"));
  accessLogPath = path.join(tmpDir, "access.jsonl");
  server = await listen(createRestApiApp({ seedPath, accessLogPath }));
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Unexpected server address");
  }
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve()))
  );
  await rm(tmpDir, { recursive: true, force: true });
});

describe("GET /health i /products", () => {
  it("health zwraca status ok i uptimeMs", async () => {
    const response = await fetch(`${baseUrl}/health`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { status: string; uptimeMs: number };
    expect(body.status).toBe("ok");
    expect(body.uptimeMs).toBeGreaterThanOrEqual(0);
  });

  it("products: total zgodny z seedem, filtr category i limit działają", async () => {
    const all = (await (await fetch(`${baseUrl}/products`)).json()) as {
      items: Array<{ category: string }>;
      total: number;
    };
    expect(all.total).toBe(expected.productsCount);
    expect(all.items).toHaveLength(expected.productsCount);

    const filtered = (await (
      await fetch(`${baseUrl}/products?category=electronics&limit=3`)
    ).json()) as { items: Array<{ category: string }>; total: number };
    expect(filtered.items.length).toBeLessThanOrEqual(3);
    expect(filtered.items.every((item) => item.category === "electronics")).toBe(true);
    expect(filtered.total).toBeGreaterThanOrEqual(filtered.items.length);
  });

  it("products/:id: 200 dla istniejącego (zgodny z seedem), 404 dla nieznanego", async () => {
    const response = await fetch(`${baseUrl}/products/3`);
    expect(response.status).toBe(200);
    const product = (await response.json()) as { id: number; name: string; price: number };
    expect(product.id).toBe(3);
    expect(product.name).toBe(expected.productId3?.name);
    expect(product.price).toBe(expected.productId3?.price);

    expect((await fetch(`${baseUrl}/products/999999`)).status).toBe(404);
    expect((await fetch(`${baseUrl}/products/abc`)).status).toBe(404);
  });
});

describe("POST /orders (walidacja + widoczność)", () => {
  it("201 dla poprawnego body; zamówienie widoczne w GET /orders", async () => {
    const response = await fetch(`${baseUrl}/orders`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ productId: 3, quantity: 2, customerName: "Jan Testowy" })
    });
    expect(response.status).toBe(201);
    const order = (await response.json()) as { id: number; status: string };
    expect(order.id).toBeGreaterThan(expected.ordersCount);
    expect(order.status).toBe("pending");

    const orders = (await (await fetch(`${baseUrl}/orders`)).json()) as {
      items: Array<{ id: number }>;
      total: number;
    };
    expect(orders.total).toBe(expected.ordersCount + 1);
    expect(orders.items.some((item) => item.id === order.id)).toBe(true);
  });

  it("400 przy braku/niepoprawnych polach, 404 przy złym productId", async () => {
    const missing = await fetch(`${baseUrl}/orders`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ productId: 3 })
    });
    expect(missing.status).toBe(400);

    const badProduct = await fetch(`${baseUrl}/orders`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ productId: 999999, quantity: 1, customerName: "X" })
    });
    expect(badProduct.status).toBe(404);
  });
});

describe("GET /metrics i log JSONL", () => {
  it("metrics liczy żądania per endpoint, nie licząc samego /metrics", async () => {
    const before = (await (await fetch(`${baseUrl}/metrics`)).json()) as {
      requestCount: number;
      perEndpoint: Record<string, { count: number; avgLatencyMs: number }>;
    };
    await fetch(`${baseUrl}/products`);
    await fetch(`${baseUrl}/products`);
    const after = (await (await fetch(`${baseUrl}/metrics`)).json()) as typeof before;

    expect(after.requestCount).toBe(before.requestCount + 2);
    const productsBefore = before.perEndpoint["GET /products"]?.count ?? 0;
    expect(after.perEndpoint["GET /products"]?.count).toBe(productsBefore + 2);
    expect(Object.keys(after.perEndpoint)).not.toContain("GET /metrics");
  });

  it("każde żądanie ląduje w logu JSONL (niezależne źródło prawdy)", async () => {
    await fetch(`${baseUrl}/health`);
    let lines: string[] = [];
    for (let attempt = 0; attempt < 20; attempt += 1) {
      if (existsSync(accessLogPath)) {
        lines = (await readFile(accessLogPath, "utf8")).trim().split("\n");
        if (lines.length > 0 && lines[0] !== "") {
          break;
        }
      }
      await delay(50);
    }
    expect(lines.length).toBeGreaterThan(0);
    const entry = JSON.parse(lines[lines.length - 1] as string) as {
      method: string;
      endpoint: string;
      status: number;
      latencyMs: number;
    };
    expect(entry.method).toBeTypeOf("string");
    expect(entry.status).toBeGreaterThanOrEqual(200);
    expect(entry.latencyMs).toBeGreaterThanOrEqual(0);
  });
});

describe("determinizm seedu (restart = reset stanu)", () => {
  it("świeża instancja aplikacji wraca do stanu z seedu", async () => {
    const freshServer = await listen(createRestApiApp({ seedPath, accessLogPath: null }));
    try {
      const address = freshServer.address();
      if (address === null || typeof address === "string") {
        throw new Error("Unexpected server address");
      }
      const orders = (await (
        await fetch(`http://127.0.0.1:${address.port}/orders`)
      ).json()) as { total: number };
      expect(orders.total).toBe(expected.ordersCount);
    } finally {
      await new Promise<void>((resolve, reject) =>
        freshServer.close((error) => (error ? reject(error) : resolve()))
      );
    }
  });
});
