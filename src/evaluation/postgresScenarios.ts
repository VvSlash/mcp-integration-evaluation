import type { SearchOrdersParams } from "../adapters/postgresAdapter.js";

export type PostgresSearchOrdersScenario = {
  id: string;
  name: string;
  toolName: "pg_search_orders";
  arguments: SearchOrdersParams;
};

export const postgresSearchOrdersScenarios: PostgresSearchOrdersScenario[] = [
  {
    id: "PG-001",
    name: "Search paid orders",
    toolName: "pg_search_orders",
    arguments: {
      status: "paid",
      limit: 5
    }
  },
  {
    id: "PG-002",
    name: "Search shipped orders",
    toolName: "pg_search_orders",
    arguments: {
      status: "shipped",
      limit: 5
    }
  },
  {
    id: "PG-003",
    name: "Search orders by amount range",
    toolName: "pg_search_orders",
    arguments: {
      minAmount: 300,
      maxAmount: 1000,
      limit: 10
    }
  },
  {
    id: "PG-004",
    name: "Search recent orders without status filter",
    toolName: "pg_search_orders",
    arguments: {
      limit: 10
    }
  }
];