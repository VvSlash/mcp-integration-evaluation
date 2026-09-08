import { describe, expect, it } from "vitest";
import {
  extractFinalJson,
  sampleToolValues,
  scoreArgumentCorrectness,
  scoreResultIntegration
} from "../../src/runners/mcp-llm/llmMetrics.js";

describe("extractFinalJson (finalAnswerValidJson)", () => {
  it("parsuje czysty JSON, blok ```json``` i JSON otoczony tekstem", () => {
    expect(extractFinalJson('{"count": 5}')).toEqual({ count: 5 });
    expect(extractFinalJson('Oto wynik:\n```json\n{"count": 5}\n```')).toEqual({ count: 5 });
    expect(extractFinalJson('Odpowiedź: {"a": {"b": 1}} — koniec.')).toEqual({ a: { b: 1 } });
  });

  it("zwraca null dla tekstu bez poprawnego JSON-a", () => {
    expect(extractFinalJson("brak jsona")).toBeNull();
    expect(extractFinalJson("{niepoprawny}")).toBeNull();
    expect(extractFinalJson("")).toBeNull();
  });
});

describe("scoreArgumentCorrectness (1 / 0.5 / 0)", () => {
  const expected = { status: "paid", limit: 5 };

  it("pełna zgodność = 1 (w tym liczby jako stringi)", () => {
    expect(scoreArgumentCorrectness(expected, { status: "paid", limit: 5 })).toBe(1);
    expect(scoreArgumentCorrectness(expected, { status: "paid", limit: "5" })).toBe(1);
  });

  it("częściowa = 0.5: złe wartości przy poprawnych kluczach LUB klucze nadmiarowe", () => {
    expect(scoreArgumentCorrectness(expected, { status: "shipped", limit: 5 })).toBe(0.5);
    expect(scoreArgumentCorrectness(expected, { status: "paid", limit: 5, extra: 1 })).toBe(0.5);
    expect(scoreArgumentCorrectness(expected, { status: "paid" })).toBe(0.5);
  });

  it("błędna = 0: żaden oczekiwany klucz / brak wywołania", () => {
    expect(scoreArgumentCorrectness(expected, { foo: 1 })).toBe(0);
    expect(scoreArgumentCorrectness(expected, null)).toBe(0);
  });

  it("puste oczekiwania: {} → 1, argumenty nadmiarowe → 0.5", () => {
    expect(scoreArgumentCorrectness({}, {})).toBe(1);
    expect(scoreArgumentCorrectness({}, { x: 1 })).toBe(0.5);
  });

  it("surowe zapytania (sql/path) → null (ocena po skutku, poza heurystyką)", () => {
    expect(scoreArgumentCorrectness({ sql: "SELECT 1" }, { sql: "SELECT 1" })).toBeNull();
    expect(scoreArgumentCorrectness({ file: "x.json", path: "$[0]" }, { file: "x.json", path: "$[0]" })).toBeNull();
  });
});

describe("scoreResultIntegration (heurystyka użycia danych narzędzia)", () => {
  const payload = {
    count: 3,
    orders: [
      { id: 17, customer_name: "Anna Kowalska", total_amount: "249.99" },
      { id: 21, customer_name: "Jan Nowak", total_amount: "89.50" }
    ]
  };

  it("wysoki wynik, gdy odpowiedź cytuje wartości z narzędzia", () => {
    const answer = JSON.stringify({
      count: 3,
      top: [{ id: 17, name: "Anna Kowalska", amount: "249.99" }, { id: 21, name: "Jan Nowak", amount: "89.50" }]
    });
    const score = scoreResultIntegration(payload, answer);
    expect(score).not.toBeNull();
    expect(score as number).toBeGreaterThanOrEqual(0.8);
  });

  it("niski wynik dla odpowiedzi z pamięci (bez wartości z narzędzia)", () => {
    const score = scoreResultIntegration(payload, '{"info": "zamówienia zostały pobrane pomyślnie"}');
    expect(score).not.toBeNull();
    expect(score as number).toBeLessThanOrEqual(0.2);
  });

  it("null, gdy payload nie zawiera charakterystycznych wartości", () => {
    expect(scoreResultIntegration({ ok: true }, "cokolwiek")).toBeNull();
  });

  it("sampleToolValues pomija wartości generyczne i limituje próbkę", () => {
    const samples = sampleToolValues({ status: "ok", flag: true, values: [1, 2, 3], name: "Widget" });
    expect(samples).not.toContain("ok");
    expect(samples).toContain("Widget");
    expect(sampleToolValues(payload).length).toBeLessThanOrEqual(12);
  });
});
