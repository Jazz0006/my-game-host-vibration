import { describe, expect, it } from "vitest";
import {
  createClientCommandEnvelope,
  createClientRealtimeEventEnvelope,
  createPlayerStateEnvelope,
  createRoomStateEnvelope,
} from "../src/protocol/client/ClientProtocol.js";
import {
  createClientRawWebSocketEventFrame,
  createClientRawWebSocketStateFrame,
  createClientRawWebSocketSuccessResponse,
  encodeClientRawWebSocketFrame,
} from "../src/protocol/client/ClientRawWebSocketProtocol.js";
import { RawWebSocketClientTransportCore } from "../src/client/runtime/RawWebSocketClientTransportCore.js";
import type {
  ClientRealtimeTransportListener,
} from "../src/client/runtime/ClientRealtimeTransport.js";

type View = { phase: string };

const credentials = {
  roomId: "1234",
  playerId: "p1",
  resumeToken: "resume-secret",
} as const;

function roomProjection(gameStarted = false) {
  return {
    roomId: "1234",
    gameType: "werewolf",
    viewer: { playerId: "p1", isHost: true },
    players: [
      { id: "p1", name: "Host", seat: 1, isHost: true },
      { id: "p2", name: "Player", seat: 2, isHost: false },
    ],
    gameStarted,
  };
}

function captureListener() {
  const opens: number[] = [];
  const closes: Array<{ generation: number; reason?: string }> = [];
  const errors: Array<{ generation: number; code: string; message?: string }> = [];
  const states: unknown[] = [];
  const roomStates: unknown[] = [];
  const events: unknown[] = [];

  const listener: ClientRealtimeTransportListener<View> = {
    onOpen(generation) {
      opens.push(generation);
    },
    onClose(generation, reason) {
      closes.push({ generation, ...(reason ? { reason } : {}) });
    },
    onError(generation, failure) {
      errors.push({
        generation,
        code: failure.code,
        ...(failure.message ? { message: failure.message } : {}),
      });
    },
    onState(delivery) {
      states.push(delivery);
    },
    onRoomState(delivery) {
      roomStates.push(delivery);
    },
    onEvent(delivery) {
      events.push(delivery);
    },
  };

  return { listener, opens, closes, errors, states, roomStates, events };
}

function requestFrom(raw: string) {
  return JSON.parse(raw) as {
    requestId: string;
    operation: string;
    envelope?: { commandId?: string };
  };
}

describe("W1 RawWebSocketClientTransportCore", () => {
  it("correlates sync and dispatches private plus room authoritative state", async () => {
    const sent: string[] = [];
    const core = new RawWebSocketClientTransportCore<View>({
      transportLabel: "Test",
      requestIdFactory: () => "sync-1",
    });
    const captured = captureListener();
    core.setListener(captured.listener);

    core.beginGeneration(1);
    core.open(1, async data => {
      sent.push(data);
    });

    const pending = core.synchronize(credentials, 1);
    const request = requestFrom(sent[0]!);
    expect(request).toMatchObject({ requestId: "sync-1", operation: "sync" });

    const playerEnvelope = createPlayerStateEnvelope(
      "1234",
      "p1",
      { phase: "night" },
    );
    const roomEnvelope = createRoomStateEnvelope("1234", roomProjection(false));
    core.handleMessage(
      encodeClientRawWebSocketFrame(
        createClientRawWebSocketSuccessResponse(request.requestId, {
          revision: 7,
          envelope: playerEnvelope,
          roomEnvelope,
        }),
      ),
      1,
    );

    await expect(pending).resolves.toEqual({
      generation: 1,
      revision: 7,
      envelope: playerEnvelope,
    });
    expect(captured.roomStates).toEqual([{
      generation: 1,
      revision: 7,
      envelope: roomEnvelope,
    }]);
  });

  it("retries a retryable send with a fresh requestId while preserving commandId", async () => {
    let sequence = 0;
    let sendAttempt = 0;
    const attempted: string[] = [];
    const core = new RawWebSocketClientTransportCore<View>({
      transportLabel: "Test",
      requestIdFactory: () => `wire-${++sequence}`,
      commandRetries: 1,
    });
    core.setListener(captureListener().listener);
    core.beginGeneration(3);
    core.open(3, data => {
      attempted.push(data);
      sendAttempt += 1;
      return sendAttempt === 1
        ? Promise.reject(new Error("temporary send failure"))
        : Promise.resolve();
    });

    const command = createClientCommandEnvelope(
      "werewolf.confirmRole",
      { actionId: "action-1" },
      "command-1",
    );
    const pending = core.send(command);

    await Promise.resolve();
    await Promise.resolve();

    expect(attempted).toHaveLength(2);
    const first = requestFrom(attempted[0]!);
    const second = requestFrom(attempted[1]!);
    expect(first.requestId).toBe("wire-1");
    expect(second.requestId).toBe("wire-2");
    expect(first.envelope?.commandId).toBe("command-1");
    expect(second.envelope?.commandId).toBe("command-1");

    core.handleMessage(
      encodeClientRawWebSocketFrame(
        createClientRawWebSocketSuccessResponse(second.requestId, {
          revision: 8,
          replayed: false,
        }),
      ),
      3,
    );

    await expect(pending).resolves.toEqual({ revision: 8, replayed: false });
  });

  it("rejects old pending requests and ignores stale-generation frames", async () => {
    const sent: string[] = [];
    let sequence = 0;
    const core = new RawWebSocketClientTransportCore<View>({
      transportLabel: "Test",
      requestIdFactory: () => `request-${++sequence}`,
    });
    const captured = captureListener();
    core.setListener(captured.listener);

    core.beginGeneration(1);
    core.open(1, async data => {
      sent.push(data);
    });
    const oldPending = core.synchronize(credentials, 1);
    const oldRequest = requestFrom(sent[0]!);

    core.beginGeneration(2);
    await expect(oldPending).rejects.toThrow(
      "Test realtime transport generation was replaced",
    );

    const staleState = createPlayerStateEnvelope(
      "1234",
      "p1",
      { phase: "stale" },
    );
    core.handleMessage(
      encodeClientRawWebSocketFrame(
        createClientRawWebSocketStateFrame(99, staleState),
      ),
      1,
    );
    core.handleMessage(
      encodeClientRawWebSocketFrame(
        createClientRawWebSocketSuccessResponse(oldRequest.requestId, {
          revision: 99,
          envelope: staleState,
          roomEnvelope: createRoomStateEnvelope("1234", roomProjection(true)),
        }),
      ),
      1,
    );

    expect(captured.states).toEqual([]);
    expect(captured.roomStates).toEqual([]);
  });

  it("dispatches current-generation state/events and reports malformed frames", () => {
    const core = new RawWebSocketClientTransportCore<View>({
      transportLabel: "Test",
    });
    const captured = captureListener();
    core.setListener(captured.listener);
    core.beginGeneration(4);
    core.open(4, async () => {});

    const stateEnvelope = createPlayerStateEnvelope(
      "1234",
      "p1",
      { phase: "day" },
    );
    const eventEnvelope = createClientRealtimeEventEnvelope(
      "client.effect.vibrate",
      { pattern: [100] },
    );

    core.handleMessage(
      encodeClientRawWebSocketFrame(
        createClientRawWebSocketStateFrame(5, stateEnvelope),
      ),
      4,
    );
    core.handleMessage(
      encodeClientRawWebSocketFrame(
        createClientRawWebSocketEventFrame(eventEnvelope),
      ),
      4,
    );
    core.handleMessage("not-json", 4);
    core.handleMessage(new ArrayBuffer(1), 4);

    expect(captured.states).toEqual([{
      generation: 4,
      revision: 5,
      envelope: stateEnvelope,
    }]);
    expect(captured.events).toEqual([{
      generation: 4,
      envelope: eventEnvelope,
    }]);
    expect(captured.errors).toEqual([
      {
        generation: 4,
        code: "invalid-raw-websocket-frame",
        message: "server frame is not valid JSON",
      },
      {
        generation: 4,
        code: "invalid-raw-websocket-frame",
        message: "binary server frames are not supported",
      },
    ]);
  });
});
