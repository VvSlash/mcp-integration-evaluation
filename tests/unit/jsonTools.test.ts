import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inferJsonSchema } from "../../src/servers/json/resources.js";
import {
  JsonToolError,
  listJsonFiles,
  queryJsonFile,
  readJsonFile,
  updateJsonValue,
  type JsonToolsConfig
} from "../../src/servers/json/tools.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const dataDir = path.join(repoRoot, "datasets", "json");

type ExpectedValues = {
  productsCount: number;
  productId17: { id: number; price: number; name: string } | null;
  electronicsPriceOver100Count: number;
};
const expected = JSON.parse(
  readFileSync(path.join(dataDir, "products.expected.json"), "utf8")
) as ExpectedValues;

let workDir: string;
let config: JsonToolsConfig;

beforeAll(async () => {
  workDir = await mkdtemp(path.join(os.tmpdir(), "json-tools-work-"));
  config = { dataDir, workDir };
});

afterAll(async () => {
  await rm(workDir, { recursive: true, force: true });
});

describe("listJsonFiles / readJsonFile", () => {
  it("listuje pliki fixture z rozmiarami", async () => {
    const files = await listJsonFiles(config);
    const names = files.map((info) => info.file);
    expect(names).toContain("products.json");
    expect(names).toContain("orders.json");
    expect(names).toContain("config.json");
    expect(files.every((info) => info.sizeBytes > 0)).toBe(true);
  });

  it("czyta products.json — liczność zgodna z products.expected.json", async () => {
    const result = await readJsonFile(config, "products.json");
    expect(result.source).toBe("fixture");
    expect(Array.isArray(result.json)).toBe(true);
    expect((result.json as unknown[]).length).toBe(expected.productsCount);
  });

  it("odrzuca path traversal i nazwy z separatorami (JSON_INVALID_FILE_NAME)", async () => {
    for (const bad of ["../secret.json", "..\\x.json", "sub/dir.json", "a\\b.json", "no-extension"]) {
      await expect(readJsonFile(config, bad)).rejects.toMatchObject({
        code: "JSON_INVALID_FILE_NAME"
      });
    }
  });

  it("zgłasza JSON_FILE_NOT_FOUND dla nieistniejącego pliku", async () => {
    await expect(readJsonFile(config, "nie-ma-takiego.json")).rejects.toMatchObject({
      code: "JSON_FILE_NOT_FOUND"
    });
  });
});

describe("queryJsonFile (JSONPath)", () => {
  it("JSON-002: znajduje dokładnie produkt o id 17", async () => {
    const result = await queryJsonFile(config, "products.json", "$[?(@.id==17)]");
    expect(result.matches).toBe(1);
    const product = result.results[0] as { id: number; price: number };
    expect(product.id).toBe(17);
    expect(product.price).toBe(expected.productId17?.price);
  });

  it("JSON-003: liczy electronics z ceną > 100 zgodnie z wartością referencyjną", async () => {
    const result = await queryJsonFile(
      config,
      "products.json",
      '$[?(@.category=="electronics" && @.price>100)]'
    );
    expect(result.matches).toBe(expected.electronicsPriceOver100Count);
  });

  it("zgłasza JSON_PATH_ERROR dla niepoprawnej składni", async () => {
    await expect(queryJsonFile(config, "products.json", "$[?(")).rejects.toMatchObject({
      code: "JSON_PATH_ERROR"
    });
  });
});

describe("updateJsonValue (JSON-004: kopia robocza)", () => {
  it("aktualizuje cenę produktu 17 w kopii roboczej, nie dotykając fixture", async () => {
    const result = await updateJsonValue(config, "products.json", "$[?(@.id==17)].price", 249.99);
    expect(result.updated).toBe(true);
    expect(result.previousValue).toBe(expected.productId17?.price);
    expect(result.newValue).toBe(249.99);

    const workCopy = JSON.parse(await readFile(path.join(workDir, "products.json"), "utf8")) as Array<{
      id: number;
      price: number;
    }>;
    expect(workCopy.find((product) => product.id === 17)?.price).toBe(249.99);

    const readBack = await readJsonFile(config, "products.json");
    expect(readBack.source).toBe("work");

    const fixture = JSON.parse(await readFile(path.join(dataDir, "products.json"), "utf8")) as Array<{
      id: number;
      price: number;
    }>;
    expect(fixture.find((product) => product.id === 17)?.price).toBe(expected.productId17?.price);
  });

  it("wymaga dokładnie jednego dopasowania (JSON_PATH_AMBIGUOUS / JSON_PATH_NOT_FOUND)", async () => {
    await expect(
      updateJsonValue(config, "products.json", "$[*].price", 1)
    ).rejects.toMatchObject({ code: "JSON_PATH_AMBIGUOUS" });
    await expect(
      updateJsonValue(config, "products.json", "$[?(@.id==999999)].price", 1)
    ).rejects.toMatchObject({ code: "JSON_PATH_NOT_FOUND" });
  });

  it("błędy domenowe są typu JsonToolError", async () => {
    await expect(readJsonFile(config, "../x.json")).rejects.toBeInstanceOf(JsonToolError);
  });
});

describe("inferJsonSchema (zasób json://files/{name}/schema)", () => {
  it("infereuje klucze i typy, tablice z typem elementu i długością", () => {
    const schema = inferJsonSchema([{ id: 1, name: "a", active: true, tag: null }]) as {
      array: Record<string, unknown>;
      length: number;
    };
    expect(schema.length).toBe(1);
    expect(schema.array).toEqual({ id: "number", name: "string", active: "boolean", tag: "null" });
  });

  it("działa na realnym config.json (zagnieżdżenia ≥ 3 poziomy)", () => {
    expect(existsSync(path.join(dataDir, "config.json"))).toBe(true);
    const json = JSON.parse(readFileSync(path.join(dataDir, "config.json"), "utf8")) as unknown;
    const schema = inferJsonSchema(json) as { app: { features: Record<string, unknown> } };
    expect(schema.app.features).toBeDefined();
  });
});
