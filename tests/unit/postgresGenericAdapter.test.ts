import { describe, expect, it } from "vitest";
import { buildGenericQuery } from "../../src/adapters/postgresGenericAdapter.js";
const catalog = { orders: ["id", "status", "total_amount"] };
describe("generic SQL allow-list and parameter binding", () => {
  it("binds hostile values instead of interpolating", () => {
    const q = buildGenericQuery("filter", { table: "orders", column: "status", operator: "eq", value: "paid'; DELETE FROM orders; --" }, catalog);
    expect(q.text).not.toContain("DELETE"); expect(q.values[0]).toContain("DELETE");
    expect(q.text).toContain('"status" = $1');
  });
  it("rejects table and column injection, including inherited keys", () => {
    for (const table of ["orders; DROP TABLE orders", "toString", "__proto__"]) expect(() => buildGenericQuery("read", { table }, catalog)).toThrow();
    expect(() => buildGenericQuery("filter", { table: "orders", column: "status OR TRUE", operator: "eq", value: "paid" }, catalog)).toThrow();
  });
  it("checks pagination and complete count predicates", () => {
    expect(() => buildGenericQuery("read", { table: "orders", limit: 51 }, catalog)).toThrow();
    expect(() => buildGenericQuery("count", { table: "orders", column: "status" }, catalog)).toThrow();
    expect(buildGenericQuery("count", { table: "orders", column: "status", value: "paid" }, catalog).values).toEqual(["paid"]);
    expect(buildGenericQuery("read", { table: "orders", offset: 50 }, catalog).values).toEqual([50, 50]);
  });
});
