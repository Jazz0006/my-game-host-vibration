import { describe, expect, it } from "vitest";
import type { ClientRoomProjection } from "../src/protocol/client/ClientRoomProjection.js";
import {
  createPlayerStateEnvelope,
  createRoomStateEnvelope,
  type ClientProtocolMessage,
  type ClientReconnectCredentials,
} from "../src/protocol/client/ClientProtocol.js";
import { ClientSession } from "../src/client/runtime/ClientSession.js";
import type {
  ClientAuthoritativeRoomStateDelivery,
  ClientAuthoritativeStateDelivery,
  ClientRealtimeTransport,
  ClientRealtimeTransportListener,
} from "../src/client/runtime/ClientRealtimeTransport.js";

type View = { phase: string };

class FakeTransport implements ClientRealtimeTransport<View> {
  listener: ClientRealtimeTransportListener<View> | null = null;

  setListener(listener: ClientRealtimeTransportListener<View>): void {
    this.listener = listener;
  }

  connect(): void {}
  disconnect(): void {}

  synchronize(
    credentials: ClientReconnectCredentials,
    generation: number,
  ): Promise<ClientAuthoritativeStateDelivery<View>> {
    return Promise.resolve({
      generation,
      revision: 1,
      envelope: createPlayerStateEnvelope(
        credentials.roomId,
        credentials.playerId,
        { phase: "lobby" },
      ),
    });
  }

  send(_message: ClientProtocolMessage): Promise<unknown> {
    return Promise.resolve({ ok: true });
  }

  open(generation: number): void {
    this.listener?.onOpen(generation);
  }

  room(delivery: ClientAuthoritativeRoomStateDelivery<ClientRoomProjection>): void {
    this.listener?.onRoomState?.(delivery);
  }
}

const credentials = {
  roomId: "1234",
  playerId: "p1",
  resumeToken: "resume-1",
} as const;

function roomProjection(gameStarted: boolean): ClientRoomProjection {
  return {
    roomId: "1234",
    gameType: "werewolf",
    viewer: { playerId: "p1", isHost: true, isGameModerator: false },
    gameModerator: { mode: "automatic" },
    players: [
      { id: "p1", name: "Host", seat: 1, isHost: true },
      { id: "p2", name: "Player 2", seat: 2, isHost: false },
    ],
    gameStarted,
  };
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("E3.6 ClientSession room projection channel", () => {
  it("stores current-generation room projection separately from private PlayerView", async () => {
    const transport = new FakeTransport();
    const session = new ClientSession<View>(transport);
    const seen: Array<{ revision: number | null; gameStarted?: boolean }> = [];

    session.subscribeRoomState(snapshot => {
      seen.push({
        revision: snapshot.revision,
        ...(snapshot.envelope
          ? { gameStarted: snapshot.envelope.payload.gameStarted }
          : {}),
      });
    });

    session.start(credentials);
    transport.open(1);
    transport.room({
      generation: 1,
      revision: 1,
      envelope: createRoomStateEnvelope("1234", roomProjection(false)),
    });
    await flushPromises();

    expect(session.getConnectionState()).toEqual({ status: "Connected", generation: 1 });
    expect(session.getRoomState()).toMatchObject({
      generation: 1,
      revision: 1,
      envelope: {
        scope: "room",
        roomId: "1234",
        payload: { gameStarted: false },
      },
    });
    expect(session.getAuthoritativeState().envelope?.scope).toBe("player");
    expect(seen.at(-1)).toEqual({ revision: 1, gameStarted: false });
  });

  it("preserves the last room projection across reconnect while rejecting stale generation/revision", async () => {
    const transport = new FakeTransport();
    const session = new ClientSession<View>(transport);

    session.start(credentials);
    transport.open(1);
    transport.room({
      generation: 1,
      revision: 4,
      envelope: createRoomStateEnvelope("1234", roomProjection(false)),
    });
    await flushPromises();

    transport.listener?.onClose(1, "network");
    session.reconnect();
    expect(session.getRoomState()).toMatchObject({
      generation: 2,
      revision: 4,
    });

    transport.room({
      generation: 1,
      revision: 99,
      envelope: createRoomStateEnvelope("1234", roomProjection(true)),
    });
    transport.open(2);
    await flushPromises();

    transport.room({
      generation: 2,
      revision: 3,
      envelope: createRoomStateEnvelope("1234", roomProjection(true)),
    });
    expect(session.getRoomState().revision).toBe(4);

    transport.room({
      generation: 2,
      revision: 5,
      envelope: createRoomStateEnvelope("1234", roomProjection(true)),
    });
    expect(session.getRoomState()).toMatchObject({
      generation: 2,
      revision: 5,
      envelope: { payload: { gameStarted: true } },
    });
  });

  it("fails closed when a current-generation room projection belongs to another room", async () => {
    const transport = new FakeTransport();
    const session = new ClientSession<View>(transport);

    session.start(credentials);
    transport.open(1);
    transport.room({
      generation: 1,
      revision: 2,
      envelope: createRoomStateEnvelope("9999", {
        ...roomProjection(false),
        roomId: "9999",
      }),
    });

    expect(session.getConnectionState()).toMatchObject({
      status: "Failed",
      generation: 1,
      failure: { code: "authoritative-room-session-mismatch" },
    });
  });
});
