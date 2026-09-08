import { describe, expect, it } from "vitest";
import {
  createClientRawWebSocketErrorResponse,
  createClientRawWebSocketStatePush,
  createClientRawWebSocketSuccessResponse,
  parseClientRawWebSocketRequest,
} from "../src/protocol/client/ClientRawWebSocketProtocol.js";
import {
  CLIENT_PROTOCOL_VERSION,
  createPlayerStateEnvelope,
} from "../src/protocol/client/ClientProtocol.js";

describe("E3.2 raw WebSocket protocol helpers", () => {
  it("normalizes sync requests and preserves request correlation", () => {
    expect(parseClientRawWebSocketRequest({
      protocolVersion: CLIENT_PROTOCOL_VERSION,
      kind: "request",
      requestId: " sync-1 ",
      type: "client:sync-state",
      payload: { ignored: true },
    })).toEqual({
      protocolVersion: CLIENT_PROTOCOL_VERSION,
      kind: "request",
      requestId: "sync-1",
      type: "client:sync-state",
      payload: {},
    });
  });

  it("rejects unsupported frame versions", () => {
    expect(() => parseClientRawWebSocketRequest({
      protocolVersion: 999,
      kind: "request",
      requestId: "x",
      type: "client:sync-state",
      payload: {},
    })).toThrow(/envelope is invalid/u);
  });

  it("creates correlated response and authoritative state push envelopes", () => {
    expect(createClientRawWebSocketSuccessResponse("r1", { value: 1 })).toEqual({
      protocolVersion: CLIENT_PROTOCOL_VERSION,
      kind: "response",
      requestId: "r1",
      ok: true,
      payload: { value: 1 },
    });
    expect(createClientRawWebSocketErrorResponse("r2", "bad", "broken")).toEqual({
      protocolVersion: CLIENT_PROTOCOL_VERSION,
      kind: "response",
      requestId: "r2",
      ok: false,
      error: { code: "bad", message: "broken" },
    });

    const envelope = createPlayerStateEnvelope("1234", "p1", { phase: "night" });
    expect(createClientRawWebSocketStatePush(4, envelope)).toEqual({
      protocolVersion: CLIENT_PROTOCOL_VERSION,
      kind: "push",
      type: "client:state",
      payload: { revision: 4, envelope },
    });
  });
});
