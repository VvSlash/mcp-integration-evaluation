import { appendFile, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import express, { type Express, type NextFunction, type Request, type Response } from "express";
import * as z from "zod/v4";
import { env } from "../config/env.js";

export const productSchema = z.looseObject({
  id: z.number().int(),
  name: z.string(),
  category: z.string(),
  price: z.number(),
  stock: z.number()
});
export type Product = z.output<typeof productSchema>;

export const orderSchema = z.looseObject({
  id: z.number().int(),
  productId: z.number().int(),
  quantity: z.number().int(),
  customerName: z.string(),
  status: z.string()
});
export type Order = z.output<typeof orderSchema>;

const seedSchema = z.looseObject({
  products: z.array(productSchema),
  orders: z.array(orderSchema)
});

export type RestApiOptions = {
  seedPath?: string;
  accessLogPath?: string | null;
};

type EndpointStats = { count: number; totalLatencyMs: number };

function parseLimit(raw: unknown): number | null {
  if (typeof raw !== "string" || raw.trim() === "") {
    return null;
  }
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : null;
}

export function createRestApiApp(options: RestApiOptions = {}): Express {
  const seedPath = options.seedPath ?? env.restApi.seedPath;
  const seedRaw: unknown = JSON.parse(readFileSync(seedPath, "utf8"));
  const seed = seedSchema.parse(seedRaw);

  const products: Product[] = structuredClone(seed.products);
  const orders: Order[] = structuredClone(seed.orders);
  let nextOrderId = orders.reduce((max, order) => Math.max(max, order.id), 0) + 1;

  const startedAt = Date.now();
  const stats = new Map<string, EndpointStats>();
  let requestCount = 0;
  let totalLatencyMs = 0;

  let accessLogPath: string | null;
  if (options.accessLogPath === null) {
    accessLogPath = null;
  } else if (options.accessLogPath) {
    accessLogPath = options.accessLogPath;
  } else {
    const stamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
    accessLogPath = path.join("results", "raw", `rest-api-access-${stamp}.jsonl`);
  }
  if (accessLogPath) {
    mkdirSync(path.dirname(accessLogPath), { recursive: true });
  }

  const app = express();
  app.use(express.json());

  app.use((req: Request, res: Response, next: NextFunction) => {
    const requestStartedAt = performance.now();
    res.on("finish", () => {
      const latencyMs = Number((performance.now() - requestStartedAt).toFixed(3));
      const routePath = req.route?.path ? `${req.baseUrl}${req.route.path as string}` : req.path;
      const endpointKey = `${req.method} ${routePath}`;

      if (req.path !== "/metrics") {
        requestCount += 1;
        totalLatencyMs += latencyMs;
        const entry = stats.get(endpointKey) ?? { count: 0, totalLatencyMs: 0 };
        entry.count += 1;
        entry.totalLatencyMs += latencyMs;
        stats.set(endpointKey, entry);
      }

      if (accessLogPath) {
        const line = JSON.stringify({
          timestamp: new Date().toISOString(),
          method: req.method,
          path: req.originalUrl,
          endpoint: endpointKey,
          status: res.statusCode,
          latencyMs
        });
        appendFile(accessLogPath, line + "\n", (error) => {
          if (error) {
            console.error("REST API access log write failed:", error.message);
          }
        });
      }
    });
    next();
  });

  app.get("/health", (_req: Request, res: Response) => {
    res.json({ status: "ok", uptimeMs: Date.now() - startedAt });
  });

  app.get("/products", (req: Request, res: Response) => {
    const category = typeof req.query["category"] === "string" ? req.query["category"] : null;
    const limit = parseLimit(req.query["limit"]);
    const filtered = category
      ? products.filter((product) => product.category === category)
      : products;
    const items = limit !== null ? filtered.slice(0, limit) : filtered;
    res.json({ items, total: filtered.length });
  });

  app.get("/products/:id", (req: Request, res: Response) => {
    const id = Number(req.params["id"]);
    const product = Number.isInteger(id)
      ? products.find((candidate) => candidate.id === id)
      : undefined;
    if (!product) {
      res.status(404).json({ error: `Product not found: ${req.params["id"]}` });
      return;
    }
    res.json(product);
  });

  app.get("/orders", (req: Request, res: Response) => {
    const status = typeof req.query["status"] === "string" ? req.query["status"] : null;
    const limit = parseLimit(req.query["limit"]);
    const filtered = status ? orders.filter((order) => order.status === status) : orders;
    const items = limit !== null ? filtered.slice(0, limit) : filtered;
    res.json({ items, total: filtered.length });
  });

  app.post("/orders", (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const productId = body["productId"];
    const quantity = body["quantity"];
    const customerName = body["customerName"];

    if (
      typeof productId !== "number" || !Number.isInteger(productId) ||
      typeof quantity !== "number" || !Number.isInteger(quantity) || quantity <= 0 ||
      typeof customerName !== "string" || customerName.trim() === ""
    ) {
      res.status(400).json({
        error: "Invalid body — required: productId (int), quantity (int > 0), customerName (non-empty string)."
      });
      return;
    }

    const product = products.find((candidate) => candidate.id === productId);
    if (!product) {
      res.status(404).json({ error: `Product not found: ${productId}` });
      return;
    }

    const order: Order = {
      id: nextOrderId,
      productId,
      quantity,
      customerName,
      status: "pending"
    };
    nextOrderId += 1;
    orders.push(order);
    res.status(201).json(order);
  });

  app.get("/metrics", (_req: Request, res: Response) => {
    const perEndpoint: Record<string, { count: number; avgLatencyMs: number }> = {};
    for (const [endpoint, entry] of stats) {
      perEndpoint[endpoint] = {
        count: entry.count,
        avgLatencyMs: entry.count > 0 ? Number((entry.totalLatencyMs / entry.count).toFixed(3)) : 0
      };
    }
    res.json({
      requestCount,
      avgLatencyMs: requestCount > 0 ? Number((totalLatencyMs / requestCount).toFixed(3)) : 0,
      perEndpoint
    });
  });

  app.use((error: Error & { status?: number }, _req: Request, res: Response, _next: NextFunction) => {
    res.status(error.status ?? 500).json({ error: error.message });
  });

  return app;
}
