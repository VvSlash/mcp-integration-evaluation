import { describe, expect, it } from "vitest";
import { buildOrderStatisticsQuery } from "../../src/adapters/postgresAdapter.js";

describe("buildOrderStatisticsQuery", () => {
  it("grupuje po kolumnie z whitelisty (status)", () => {
    const query = buildOrderStatisticsQuery({ groupBy: "status" });
    expect(query.text).toContain("GROUP BY status");
    expect(query.text).toContain("status::text AS group_value");
    expect(query.text).toContain("COUNT(*)::int AS order_count");
    expect(query.text).toContain("SUM(total_amount)");
    expect(query.text).toContain("AVG(total_amount)");
    expect(query.values).toEqual([null, null]);
  });

  it("grupuje po kolumnie currency", () => {
    const query = buildOrderStatisticsQuery({ groupBy: "currency" });
    expect(query.text).toContain("GROUP BY currency");
    expect(query.text).not.toContain("GROUP BY status");
  });

  it("filtry dat idą parametrami (nie interpolacją do tekstu SQL)", () => {
    const query = buildOrderStatisticsQuery({
      groupBy: "status",
      dateFrom: "2026-01-01T00:00:00Z",
      dateTo: "2026-06-30T23:59:59Z"
    });
    expect(query.values).toEqual(["2026-01-01T00:00:00Z", "2026-06-30T23:59:59Z"]);
    expect(query.text).not.toContain("2026-01-01");
    expect(query.text).toContain("$1::timestamp");
    expect(query.text).toContain("$2::timestamp");
  });
});
