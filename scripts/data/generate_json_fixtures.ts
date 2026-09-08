import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const SEED = 20260706;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Product = {
  id: number;
  name: string;
  category: string;
  price: number;
  stock: number;
};

type JsonOrder = {
  id: number;
  productId: number;
  quantity: number;
  customerName: string;
  status: string;
  totalAmount: number;
};

const categories = ["electronics", "books", "toys", "home", "sports"];
const adjectives = ["Compact", "Pro", "Eco", "Smart", "Classic", "Ultra", "Mini", "Max"];
const nouns = ["Speaker", "Lamp", "Notebook", "Ball", "Kettle", "Router", "Chair", "Camera"];
const customers = [
  "Anna Kowalska", "Jan Nowak", "Marta Zielinska", "Piotr Wisniewski",
  "Ewa Wojcik", "Tomasz Kaminski", "Katarzyna Lewandowska", "Michal Dabrowski"
];
const orderStatuses = ["pending", "paid", "shipped", "cancelled", "refunded"];

async function main() {
  const rand = mulberry32(SEED);
  const pick = <T>(items: T[]): T => {
    const index = Math.floor(rand() * items.length);
    return items[index] as T;
  };

  const products: Product[] = [];
  for (let id = 1; id <= 60; id += 1) {
    products.push({
      id,
      name: `${pick(adjectives)} ${pick(nouns)} ${id}`,
      category: pick(categories),
      price: Number((5 + rand() * 495).toFixed(2)),
      stock: Math.floor(rand() * 200)
    });
  }

  const orders: JsonOrder[] = [];
  for (let id = 1; id <= 40; id += 1) {
    const product = pick(products);
    const quantity = 1 + Math.floor(rand() * 5);
    orders.push({
      id,
      productId: product.id,
      quantity,
      customerName: pick(customers),
      status: pick(orderStatuses),
      totalAmount: Number((product.price * quantity).toFixed(2))
    });
  }

  const config = {
    app: {
      name: "mcp-json-fixture",
      features: {
        search: { enabled: true, maxResults: 25, fuzzy: { enabled: false, distance: 2 } },
        cache: { enabled: true, ttlSeconds: 300, layers: { memory: true, disk: false } }
      }
    },
    integrations: {
      database: { host: "localhost", port: 5432, options: { ssl: false, poolSize: 4 } },
      llm: { provider: "ollama", model: "qwen3.5", params: { temperature: 0, numCtx: 8192 } }
    },
    metadata: { generatedBy: "scripts/data/generate_json_fixtures.ts", seed: SEED }
  };

  const product17 = products.find((product) => product.id === 17) ?? null;
  const expected = {
    productsCount: products.length,
    ordersCount: orders.length,
    productId17: product17,
    electronicsPriceOver100Count: products.filter(
      (product) => product.category === "electronics" && product.price > 100
    ).length,
    seed: SEED
  };

  const summary = {
    description: "Cross-server summary target (XSRV-001): fill via json_update_value.",
    count: null,
    averagePrice: null
  };

  const outDir = path.join("datasets", "json");
  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, "products.json"), JSON.stringify(products, null, 2), "utf8");
  await writeFile(path.join(outDir, "orders.json"), JSON.stringify(orders, null, 2), "utf8");
  await writeFile(path.join(outDir, "config.json"), JSON.stringify(config, null, 2), "utf8");
  await writeFile(path.join(outDir, "summary.json"), JSON.stringify(summary, null, 2), "utf8");
  await writeFile(path.join(outDir, "products.expected.json"), JSON.stringify(expected, null, 2), "utf8");

  console.log(JSON.stringify({ written: ["products.json", "orders.json", "config.json", "summary.json", "products.expected.json"], expected }, null, 2));
}

main().catch((error) => {
  console.error("JSON fixtures generation failed:", error);
  process.exit(1);
});
