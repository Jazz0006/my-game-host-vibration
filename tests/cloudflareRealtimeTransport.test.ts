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
import {
  CloudflareRealtimeTransport,
  type BrowserFetchLike,
  type BrowserWebSocketLike,
} from "../src/client/browser/CloudflareRealtimeTransport.js";
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

class FakeBrowserWebSocket {
  readonly sent: string[] = [];
  readonly closeCalls: Array<{ code?: number; reason?: string }> = [];
  private openListeners: Array<() => void> = [];
  private closeListeners: Array<(event: { reason?: string }) => void> = [];
  private errorListeners: Array<(event: unknown) => void> = [];
  private messageListeners: Array<(event: { data: string | ArrayBuffer }) => void> = [];

  addEventListener(type: "open", listener: () => void): void;
  addEventListener(
    type: "close",
    listener: (event: { reason?: string }) => void,
  ): void;
  addEventListener(type: "error", listener: (event: unknown) => void): void;
  addEventListener(
    type: "message",
    listener: (event: { data: string | ArrayBuffer }) => void,
  ): void;
  addEventListener(
    type: "open" | "close" | "error" | "message",
    listener:
      | (() => void)
      | ((event: { reason?: string }) => void)
      | ((event: unknown) => void)
      | ((event: { data: string | ArrayBuffer }) => void),
  ): void {
    if (type === "open") this.openListeners.push(listener as () => void);
    else if (type === "close") {
      this.closeListeners.push(listener as (event: { reason?: string }) => void);
    } else if (type === "error") {
      this.errorListeners.push(listener as (event: unknown) => void);
    } else {
      this.messageListeners.push(
        listener as (event: { data: string | ArrayBuffer }) => void,
      );
    }
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(code?: number, reason?: string): void {
    this.closeCalls.push({
      ...(code === undefined ? {} : { code }),
      ...(reason === undefined ? {} : { reason }),
    });
  }

  open(): void {
    for (const listener of this.openListeners) listener();
  }

  serverClose(reason?: string): void {
    for (const listener of this.closeListeners) {
      listener(reason === undefined ? {} : { reason });
    }
  }

  serverError(error: unknown = new Error("socket failed")): void {
    for (const listener of this.errorListeners) listener(error);
  }

  serverMessage(data: string | ArrayBuffer): void {
    for (const listener of this.messageListeners) listener({ data });
  }
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

function parseLastRequest(socket: FakeBrowserWebSocket) {
  const raw = socket.sent.at(-1);
  if (!raw) throw new Error("no client frame sent");
  return JSON.parse(raw) as {
    requestId: string;
    operation: string;
    envelope?: { commandId?: string };
  };
}

async function flushAsync(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe("W2 CloudflareRealtimeTransport", () => {
  it("exchanges resume credentials for a ticket before opening browser WebSocket", async () => {
    const fetchCalls: Array<{ url: string; body: unknown }> = [];
    const socket = new FakeBrowserWebSocket();
    const urls: string[] = [];
    const fetchImpl: BrowserFetchLike = async (url, init) => {
      fetchCalls.push({ url, body: JSON.parse(init.body) });
      return {
        status: 200,
        async json() {
          return { ok: true, ticket: "ticket-abc" };
        },
      };
    };

    const transport = new CloudflareRealtimeTransport<View>({
      baseUrl: "https://game.example/",
      fetch: fetchImpl,
      webSocketFactory: url => {
        urls.push(url);
        return socket as BrowserWebSocketLike;
      },
    });
    const captured = captureListener();
    transport.setListener(captured.listener);

    transport.connect(credentials, 4);
    await flushAsync();

    expect(fetchCalls).toEqual([{
      url: "https://game.example/rooms/1234/websocket-ticket",
      body: {
        playerId: "p1",
        resumeToken: "resume-secret",
      },
    }]);
    expect(urls).toEqual([
      "wss://game.example/rooms/1234/websocket?ticket=ticket-abc",
    ]);
    expect(urls[0]).not.toContain(credentials.resumeToken);

    socket.open();
    expect(captured.opens).toEqual([4]);
  });

  it("shares sync, command, state, room projection and event semantics with native transport", async () => {
    const socket = new FakeBrowserWebSocket();
    let sequence = 0;
    const transport = new CloudflareRealtimeTransport<View>({
      baseUrl: "https://game.example",
      fetch: async () => ({
        status: 200,
        async json() {
          return { ok: true, ticket: "ticket-1" };
        },
      }),
      webSocketFactory: () => socket as BrowserWebSocketLike,
      requestIdFactory: () => `request-${++sequence}`,
    });
    const captured = captureListener();
    transport.setListener(captured.listener);

    transport.connect(credentials, 2);
    await flushAsync();
    socket.open();

    const syncPending = transport.synchronize(credentials, 2);
    const syncRequest = parseLastRequest(socket);
    const playerEnvelope = createPlayerStateEnvelope(
      "1234",
      "p1",
      { phase: "night" },
    );
    const roomEnvelope = createRoomStateEnvelope("1234", roomProjection(false));
    socket.serverMessage(encodeClientRawWebSocketFrame(
      createClientRawWebSocketSuccessResponse(syncRequest.requestId, {
        revision: 7,
        envelope: playerEnvelope,
        roomEnvelope,
      }),
    ));

    await expect(syncPending).resolves.toEqual({
      generation: 2,
      revision: 7,
      envelope: playerEnvelope,
    });
    expect(captured.roomStates).toEqual([{
      generation: 2,
      revision: 7,
      envelope: roomEnvelope,
    }]);

    const command = createClientCommandEnvelope(
      "werewolf.confirmRole",
      { actionId: "action-1" },
      "command-1",
    );
    const commandPending = transport.send(command);
    const commandRequest = parseLastRequest(socket);
    expect(commandRequest).toMatchObject({
      operation: "command",
      envelope: { commandId: "command-1" },
    });
    socket.serverMessage(encodeClientRawWebSocketFrame(
      createClientRawWebSocketSuccessResponse(commandRequest.requestId, {
        revision: 8,
        replayed: false,
      }),
    ));
    await expect(commandPending).resolves.toEqual({
      revision: 8,
      replayed: false,
    });

    const pushedState = createPlayerStateEnvelope(
      "1234",
      "p1",
      { phase: "day" },
    );
    socket.serverMessage(encodeClientRawWebSocketFrame(
      createClientRawWebSocketStateFrame(8, pushedState),
    ));
    const eventEnvelope = createClientRealtimeEventEnvelope(
      "client.effect.vibrate",
      { pattern: [100] },
    );
    socket.serverMessage(encodeClientRawWebSocketFrame(
      createClientRawWebSocketEventFrame(eventEnvelope),
    ));

    expect(captured.states).toEqual([{
      generation: 2,
      revision: 8,
      envelope: pushedState,
    }]);
    expect(captured.events).toEqual([{
      generation: 2,
      envelope: eventEnvelope,
    }]);
  });

  it("ignores stale ticket completion after a newer connection generation starts", async () => {
    const resolvers: Array<(value: {
      status: number;
      json(): Promise<unknown>;
    }) => void> = [];
    const fetchImpl: BrowserFetchLike = () => new Promise(resolve => {
      resolvers.push(resolve);
    });
    const urls: string[] = [];
    const sockets: FakeBrowserWebSocket[] = [];

    const transport = new CloudflareRealtimeTransport<View>({
      baseUrl: "https://game.example",
      fetch: fetchImpl,
      webSocketFactory: url => {
        urls.push(url);
        const socket = new FakeBrowserWebSocket();
        sockets.push(socket);
        return socket as BrowserWebSocketLike;
      },
    });
    const captured = captureListener();
    transport.setListener(captured.listener);

    transport.connect(credentials, 1);
    transport.connect(credentials, 2);
    expect(resolvers).toHaveLength(2);

    resolvers[0]!({
      status: 200,
      async json() {
        return { ok: true, ticket: "stale-ticket" };
      },
    });
    await flushAsync();
    expect(urls).toEqual([]);

    resolvers[1]!({
      status: 200,
      async json() {
        return { ok: true, ticket: "fresh-ticket" };
      },
    });
    await flushAsync();

    expect(urls).toEqual([
      "wss://game.example/rooms/1234/websocket?ticket=fresh-ticket",
    ]);
    sockets[0]!.open();
    expect(captured.opens).toEqual([2]);
  });

  it("treats invalid ticket responses as protocol failure and fetch errors as reconnectable close", async () => {
    const captured = captureListener();
    const invalidTicketTransport = new CloudflareRealtimeTransport<View>({
      baseUrl: "https://game.example",
      fetch: async () => ({
        status: 401,
        async json() {
          return { ok: false, message: "invalid session credentials" };
        },
      }),
      webSocketFactory: () => new FakeBrowserWebSocket() as BrowserWebSocketLike,
    });
    invalidTicketTransport.setListener(captured.listener);
    invalidTicketTransport.connect(credentials, 5);
    await flushAsync();

    expect(captured.errors).toEqual([{
      generation: 5,
      code: "websocket-ticket-failed",
      message: "invalid session credentials",
    }]);

    const networkCaptured = captureListener();
    const networkTransport = new CloudflareRealtimeTransport<View>({
      baseUrl: "https://game.example",
      fetch: async () => {
        throw new Error("offline");
      },
      webSocketFactory: () => new FakeBrowserWebSocket() as BrowserWebSocketLike,
    });
    networkTransport.setListener(networkCaptured.listener);
    networkTransport.connect(credentials, 6);
    await flushAsync();

    expect(networkCaptured.closes).toEqual([{
      generation: 6,
      reason: "offline",
    }]);
  });
});
