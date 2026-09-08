import { describe, expect, it } from "vitest";
import {
  BlenderBridgeError,
  feedFrames,
  parseBridgeResponse
} from "../../src/servers/blender/bridge.js";

describe("feedFrames (ramkowanie NDJSON)", () => {
  it("składa ramki z fragmentów TCP (niedokończona linia zostaje w buforze)", () => {
    const first = feedFrames("", '{"status":"ok","re');
    expect(first.frames).toEqual([]);
    expect(first.buffer).toBe('{"status":"ok","re');

    const second = feedFrames(first.buffer, 'sult":{"count":3}}\n{"status":"ok"');
    expect(second.frames).toEqual(['{"status":"ok","result":{"count":3}}']);
    expect(second.buffer).toBe('{"status":"ok"');
  });

  it("obsługuje wiele ramek w jednym chunku i pomija puste linie", () => {
    const fed = feedFrames("", '{"a":1}\n\n{"b":2}\n');
    expect(fed.frames).toEqual(['{"a":1}', '{"b":2}']);
    expect(fed.buffer).toBe("");
  });
});

describe("parseBridgeResponse (protokół addonu)", () => {
  it("zwraca result przy status ok", () => {
    expect(parseBridgeResponse('{"status":"ok","result":{"pong":true}}')).toEqual({ pong: true });
  });

  it("propaguje kod błędu addonu jako BlenderBridgeError (konwencja 15.1)", () => {
    try {
      parseBridgeResponse('{"status":"error","code":"OBJECT_NOT_FOUND","message":"No object"}');
      expect.unreachable("oczekiwano wyjątku");
    } catch (error) {
      expect(error).toBeInstanceOf(BlenderBridgeError);
      expect((error as BlenderBridgeError).code).toBe("OBJECT_NOT_FOUND");
    }
  });

  it("niepoprawny JSON i brak pola status → BLENDER_BRIDGE_PROTOCOL_ERROR", () => {
    for (const frame of ["not-json", '{"result":1}']) {
      try {
        parseBridgeResponse(frame);
        expect.unreachable("oczekiwano wyjątku");
      } catch (error) {
        expect((error as BlenderBridgeError).code).toBe("BLENDER_BRIDGE_PROTOCOL_ERROR");
      }
    }
  });
});
