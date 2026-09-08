import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const SEED = 20260707;

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

type SeedProduct = { id: number; name: string; category: string; price: number; stock: number };
type SeedOrder = { id: number; productId: number; quantity: number; customerName: string; status: string };

const categories = ["electronics", "books", "home"];
const names = ["Router", "Powerbank", "Atlas", "Thriller", "Mikser", "Lampa", "Czajnik", "Sluchawki"];
const customers = ["Anna Kowalska", "Jan Nowak", "Ewa Wojcik", "Tomasz Kaminski"];
const statuses = ["pending", "paid", "shipped"];

async function main() {
  const rand = mulberry32(SEED);
  const pick = <T>(items: T[]): T => {
    const index = Math.floor(rand() * items.length);
    return items[index] as T;
  };

  const products: SeedProduct[] = [];
  for (let id = 1; id <= 20; id += 1) {
    products.push({
      id,
      name: `${pick(names)} ${id}`,
      category: pick(categories),
      price: Number((10 + rand() * 290).toFixed(2)),
      stock: 5 + Math.floor(rand() * 95)
    });
  }

  const orders: SeedOrder[] = [];
  for (let id = 1; id <= 10; id += 1) {
    orders.push({
      id,
      productId: (products[Math.floor(rand() * products.length)] as SeedProduct).id,
      quantity: 1 + Math.floor(rand() * 3),
      customerName: pick(customers),
      status: pick(statuses)
    });
  }

  const expected = {
    productsCount: products.length,
    ordersCount: orders.length,
    productId3: products.find((product) => product.id === 3) ?? null,
    seed: SEED
  };

  const outDir = path.join("datasets", "rest-api");
  await mkdir(outDir, { recursive: true });
  await writeFile(
    path.join(outDir, "seed.json"),
    JSON.stringify({ products, orders, expected }, null, 2),
    "utf8"
  );

  console.log(JSON.stringify({ written: "datasets/rest-api/seed.json", expected }, null, 2));
}

main().catch((error) => {
  console.error("REST seed generation failed:", error);
  process.exit(1);
});
