import { describe, expect, it } from "vitest";
import {
  buildSchemaResourceText,
  type SchemaColumnRow
} from "../../src/servers/sql-minimal/resources.js";

function column(overrides: Partial<SchemaColumnRow>): SchemaColumnRow {
  return {
    table_name: "orders",
    column_name: "id",
    data_type: "integer",
    character_maximum_length: null,
    numeric_precision: null,
    numeric_scale: null,
    is_nullable: "NO",
    column_default: null,
    is_primary_key: false,
    ...overrides
  };
}

const sampleRows: SchemaColumnRow[] = [
  column({ column_name: "id", is_primary_key: true, column_default: "nextval('orders_id_seq')" }),
  column({ column_name: "customer_name", data_type: "character varying", character_maximum_length: 120 }),
  column({ column_name: "total_amount", data_type: "numeric", numeric_precision: 10, numeric_scale: 2 }),
  column({ table_name: "products", column_name: "sku", data_type: "text", is_nullable: "YES" })
];

describe("buildSchemaResourceText (postgres://schema)", () => {
  it("zawiera nagłówek schematu i listę wszystkich tabel", () => {
    const text = buildSchemaResourceText(sampleRows);
    expect(text).toContain("Schema: public");
    expect(text).toContain("Tables (2): orders, products");
  });

  it("renderuje sekcję per tabela w formacie zgodnym z zasobami per-tabelowymi", () => {
    const text = buildSchemaResourceText(sampleRows);
    expect(text).toContain("Table: orders");
    expect(text).toContain("Table: products");
    expect(text).toContain("- id integer NOT NULL PRIMARY KEY DEFAULT nextval('orders_id_seq')");
    expect(text).toContain("- customer_name character varying(120) NOT NULL");
    expect(text).toContain("- total_amount numeric(10,2) NOT NULL");
    expect(text).toContain("- sku text NULL");
  });

  it("dokleja przykładowe zapytania SELECT dla każdej tabeli", () => {
    const text = buildSchemaResourceText(sampleRows);
    expect(text).toContain("SELECT * FROM orders LIMIT 10;");
    expect(text).toContain("SELECT * FROM products LIMIT 10;");
  });
});
