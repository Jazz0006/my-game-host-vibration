import { describe, expect, it } from "vitest";
import { createClientCommandEnvelope, createClientRealtimeEventEnvelope, createPlayerStateEnvelope } from "../src/protocol/client/ClientProtocol.js";
import {
  CLIENT_RAW_WEBSOCKET_WIRE_VERSION,
  ClientRawWebSocketWireError,
  createClientRawWebSocketCommandRequest,
  createClientRawWebSocketEventFrame,
  createClientRawWebSocketFailureResponse,
  createClientRawWebSocketStateFrame,
  createClientRawWebSocketSuccessResponse,
  createClientRawWebSocketSyncRequest,
  parseClientRawWebSocketRequest,
  parseClientRawWebSocketServerFrame,
} from "../src/protocol/client/ClientRawWebSocketProtocol.js";

describe("E3.2b Raw WebSocket client wire protocol", () => {
  it("keeps request correlation separate from command idempotency", () => {
    const command = createClientCommandEnvelope("werewolf.confirmRole", { actionId: "action-1" }, "command-1");
    const request = createClientRawWebSocketCommandRequest("request-1", command);

    expect(request).toEqual({
      wireVersion: CLIENT_RAW_WEBSOCKET_WIRE_VERSION,
      kind: "request",
      requestId: "request-1",
      operation: "command",
      envelope: command,
    });
    expect(parseClientRawWebSocketRequest(request)).toEqual(request);

    const retry = createClientRawWebSocketCommandRequest("request-2", command);
    expect(retry.requestId).not.toBe(request.requestId);
    expect(retry.envelope.commandId).toBe(request.envelope.commandId);
  });

  it("defines correlated sync/response frames and uncorrelated state/event pushes", () => {
    const sync = createClientRawWebSocketSyncRequest("sync-1");
    expect(parseClientRawWebSocketRequest(sync)).toEqual(sync);

    const stateEnvelope = createPlayerStateEnvelope("room-1", "p1", { phase: "night" });
    const delivery = { revision: 7, envelope: stateEnvelope };
    const success = createClientRawWebSocketSuccessResponse("sync-1", delivery);
    const failure = createClientRawWebSocketFailureResponse("sync-2", "sync_failed", "cannot sync");
    const state = createClientRawWebSocketStateFrame(8, stateEnvelope);
    const eventEnvelope = createClientRealtimeEventEnvelope("client.effect.vibrate", { pattern: [100] });
    const event = createClientRawWebSocketEventFrame(eventEnvelope);

    expect(parseClientRawWebSocketServerFrame(success)).toEqual(success);
    expect(parseClientRawWebSocketServerFrame(failure)).toEqual(failure);
    expect(parseClientRawWebSocketServerFrame(state)).toEqual(state);
    expect(parseClientRawWebSocketServerFrame(event)).toEqual(event);
  });

  it("rejects unsupported wire versions with a stable protocol error code", () => {
    expect(() => parseClientRawWebSocketRequest({
      wireVersion: 99,
      kind: "request",
      requestId: "bad-version",
      operation: "sync",
    })).toThrow(ClientRawWebSocketWireError);

    try {
      parseClientRawWebSocketRequest({
        wireVersion: 99,
        kind: "request",
        requestId: "bad-version",
        operation: "sync",
      });
      throw new Error("expected parse to fail");
    } catch (error) {
      expect(error).toMatchObject({
        code: "unsupported_wire_version",
        requestId: "bad-version",
      });
    }
  });
});
