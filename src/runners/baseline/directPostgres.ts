import { PostgresAdapter } from "../../adapters/postgresAdapter.js";

async function main() {
  const postgres = new PostgresAdapter();

  try {
    const health = await postgres.healthCheck();

    const orders = await postgres.searchOrders({
      status: "paid",
      limit: 5
    });

    console.log(JSON.stringify({
      variant: "baseline",
      health,
      query: {
        status: "paid",
        limit: 5
      },
      count: orders.length,
      orders
    }, null, 2));
  } finally {
    await postgres.close();
  }
}

main().catch((error) => {
  console.error("Baseline PostgreSQL check failed:", error);
  process.exit(1);
});
