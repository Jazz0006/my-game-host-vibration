import { describe, expect, it } from "vitest";
import {
  createClientCommandEnvelope,
  createClientRealtimeEventEnvelope,
  createPlayerStateEnvelope,
  createRoomStateEnvelope,
  type ClientReconnectCredentials,
} from "../src/protocol/client/ClientProtocol.js";
import {
  createClientRawWebSocketEventFrame,
  createClientRawWebSocketStateFrame,
  createClientRawWebSocketSuccessResponse,
} from "../src/protocol/client/ClientRawWebSocketProtocol.js";
import {
  WeChatRealtimeTransport,
  type WeChatPlatformLike,
  type WeChatSocketTaskLike,
} from "../src/client/WeChatRealtimeTransport.js";

type View = { phase: string };

const credentials: ClientReconnectCredentials = {
  roomId: "1234",
  playerId: "p1",
  resumeToken: "resume-secret",
};

function roomEnvelope(gameStarted = true) {
  return createRoomStateEnvelope("1234", {
    roomId: "1234",
    gameType: "werewolf",
    viewer: { playerId: "p1", isHost: true, isGameModerator: false },
    gameModerator: { mode: "automatic" },
    players: [{ id: "p1", name: "Host", seat: 1, isHost: true }],
    gameStarted,
  });
}

class FakeSocketTask implements WeChatSocketTaskLike {
  readonly sent: string[] = [];
  closeCalls = 0;
  private openListener: (() => void) | null = null;
  private closeListener: ((event: { code?: number; reason?: string }) => void) | null = null;
  private errorListener: ((error: unknown) => void) | null = null;
  private messageListener: ((event: { data: string | ArrayBuffer }) => void) | null = null;

  onOpen(listener: () => void): void {
    this.openListener = listener;
  }

  onClose(listener: (event: { code?: number; reason?: string }) => void): void {
    this.closeListener = listener;
  }

  onError(listener: (error: unknown) => void): void {
    this.errorListener = listener;
  }

  onMessage(listener: (event: { data: string | ArrayBuffer }) => void): void {
    this.messageListener = listener;
  }

  send(options: {
    data: string | ArrayBuffer;
    success?: () => void;
    fail?: (error: unknown) => void;
  }): void {
    if (typeof options.data !== "string") {
      options.fail?.(new Error("binary send unsupported in test"));
      return;
    }
    this.sent.push(options.data);
    options.success?.();
  }

  close(): void {
    this.closeCalls += 1;
  }

  open(): void {
    this.openListener?.();
  }

  serverClose(reason = "network lost"): void {
    this.closeListener?.({ code: 1006, reason });
  }

  serverError(error: unknown): void {
    this.errorListener?.(error);
  }

  serverMessage(value: unknown): void {
    this.messageListener?.({ data: JSON.stringify(value) });
  }
}

class FakeWeChatPlatform implements WeChatPlatformLike {
  readonly socket = new FakeSocketTask();
  readonly requests: Array<{
    url: string;
    method: "POST";
    data: unknown;
    success: (response: { statusCode: number; data: unknown }) => void;
    fail: (error: unknown) => void;
  }> = [];
  readonly connectUrls: string[] = [];

  request(options: {
    url: string;
    method: "POST";
    data: unknown;
    success(response: { statusCode: number; data: unknown }): void;
    fail(error: unknown): void;
  }): void {
    this.requests.push(options);
  }

  connectSocket(options: { url: string }): WeChatSocketTaskLike {
    this.connectUrls.push(options.url);
    return this.socket;
  }

  issueTicket(ticket = "ticket-1"): void {
    const request = this.requests.at(-1);
    if (!request) throw new Error("no pending ticket request");
    request.success({
      statusCode: 200,
      data: { ok: true, ticket, expiresAt: Date.now() + 10_000 },
    });
  }
}

function captureListener() {
  const opens: number[] = [];
  const closes: Array<{ generation: number; reason?: string }> = [];
  const errors: Array<{ generation: number; failure: { code: string; message?: string } }> = [];
  const states: unknown[] = [];
  const roomStates: unknown[] = [];
  const events: unknown[] = [];
  return {
    opens,
    closes,
    errors,
    states,
    roomStates,
    events,
    listener: {
      onOpen(generation: number) {
        opens.push(generation);
      },
      onClose(generation: number, reason?: string) {
        closes.push({ generation, ...(reason ? { reason } : {}) });
      },
      onError(generation: number, failure: { code: string; message?: string }) {
        errors.push({ generation, failure });
      },
      onState(delivery: unknown) {
        states.push(delivery);
      },
      onRoomState(delivery: unknown) {
        roomStates.push(delivery);
      },
      onEvent(delivery: unknown) {
        events.push(delivery);
      },
    },
  };
}

function parseLastRequest(socket: FakeSocketTask) {
  const raw = socket.sent.at(-1);
  if (!raw) throw new Error("no client frame sent");
  return JSON.parse(raw) as {
    requestId: string;
    operation: string;
    envelope?: unknown;
  };
}

describe("E3.2c WeChatRealtimeTransport", () => {
  it("exchanges resume credentials for a one-time ticket before opening SocketTask", () => {
    const platform = new FakeWeChatPlatform();
    const transport = new WeChatRealtimeTransport<View>(platform, {
      baseUrl: "https://game.example",
      requestIdFactory: () => "request-1",
    });
    const captured = captureListener();
    transport.setListener(captured.listener);

    transport.connect(credentials, 4);

    expect(platform.connectUrls).toEqual([]);
    expect(platform.requests).toHaveLength(1);
    expect(platform.requests[0]).toMatchObject({
      url: "https://game.example/rooms/1234/websocket-ticket",
      method: "POST",
      data: {
        playerId: "p1",
        resumeToken: "resume-secret",
      },
    });

    platform.issueTicket("ticket-abc");
    expect(platform.connectUrls).toEqual([
      "wss://game.example/rooms/1234/websocket?ticket=ticket-abc",
    ]);
    expect(platform.connectUrls[0]).not.toContain(credentials.resumeToken);

    platform.socket.open();
    expect(captured.opens).toEqual([4]);
  });

  it("synchronizes private and public authoritative state through one correlated Raw WebSocket request", async () => {
    let requestSequence = 0;
    const platform = new FakeWeChatPlatform();
    const transport = new WeChatRealtimeTransport<View>(platform, {
      baseUrl: "https://game.example/",
      requestIdFactory: () => `request-${++requestSequence}`,
    });
    const captured = captureListener();
    transport.setListener(captured.listener);
    transport.connect(credentials, 2);
    platform.issueTicket();
    platform.socket.open();

    const pending = transport.synchronize(credentials, 2);
    const request = parseLastRequest(platform.socket);
    expect(request).toMatchObject({
      requestId: "request-1",
      operation: "sync",
    });

    const envelope = createPlayerStateEnvelope("1234", "p1", { phase: "night" });
    platform.socket.serverMessage(createClientRawWebSocketSuccessResponse(
      request.requestId,
      { revision: 7, envelope, roomEnvelope: roomEnvelope() },
    ));

    await expect(pending).resolves.toEqual({
      generation: 2,
      revision: 7,
      envelope,
    });
    expect(captured.roomStates).toEqual([{
      generation: 2,
      revision: 7,
      envelope: roomEnvelope(),
    }]);
  });

  it("rejects a sync response for the wrong bound room/player identity", async () => {
    const platform = new FakeWeChatPlatform();
    const transport = new WeChatRealtimeTransport<View>(platform, {
      baseUrl: "https://game.example",
      requestIdFactory: () => "sync-mismatch",
    });
    transport.setListener(captureListener().listener);
    transport.connect(credentials, 2);
    platform.issueTicket();
    platform.socket.open();

    const pending = transport.synchronize(credentials, 2);
    const request = parseLastRequest(platform.socket);
    const wrongEnvelope = createPlayerStateEnvelope("1234", "p2", { phase: "night" });
    platform.socket.serverMessage(createClientRawWebSocketSuccessResponse(
      request.requestId,
      { revision: 7, envelope: wrongEnvelope, roomEnvelope: roomEnvelope() },
    ));

    await expect(pending).rejects.toThrow("authoritative client state envelope is invalid");
  });

  it("correlates command ACKs without changing commandId and forwards state/event pushes", async () => {
    let requestSequence = 0;
    const platform = new FakeWeChatPlatform();
    const transport = new WeChatRealtimeTransport<View>(platform, {
      baseUrl: "https://game.example",
      requestIdFactory: () => `request-${++requestSequence}`,
    });
    const captured = captureListener();
    transport.setListener(captured.listener);
    transport.connect(credentials, 3);
    platform.issueTicket();
    platform.socket.open();

    const command = createClientCommandEnvelope(
      "werewolf.confirmRole",
      { actionId: "action-1" },
      "command-1",
    );
    const pending = transport.send(command);
    const request = parseLastRequest(platform.socket);

    expect(request).toMatchObject({
      requestId: "request-1",
      operation: "command",
      envelope: command,
    });

    platform.socket.serverMessage(createClientRawWebSocketSuccessResponse(
      request.requestId,
      { revision: 8, replayed: false },
    ));
    await expect(pending).resolves.toEqual({ revision: 8, replayed: false });

    const stateEnvelope = createPlayerStateEnvelope("1234", "p1", { phase: "day" });
    platform.socket.serverMessage(createClientRawWebSocketStateFrame(8, stateEnvelope));

    const eventEnvelope = createClientRealtimeEventEnvelope(
      "client.effect.vibrate",
      { pattern: [100] },
    );
    platform.socket.serverMessage(createClientRawWebSocketEventFrame(eventEnvelope));

    expect(captured.states).toEqual([{
      generation: 3,
      revision: 8,
      envelope: stateEnvelope,
    }]);
    expect(captured.events).toEqual([{
      generation: 3,
      envelope: eventEnvelope,
    }]);
  });

  it("ignores stale ticket/socket callbacks from an older generation", () => {
    const platform = new FakeWeChatPlatform();
    const transport = new WeChatRealtimeTransport<View>(platform, {
      baseUrl: "https://game.example",
    });
    const captured = captureListener();
    transport.setListener(captured.listener);

    transport.connect(credentials, 1);
    transport.connect(credentials, 2);

    const first = platform.requests[0];
    const second = platform.requests[1];
    if (!first || !second) throw new Error("missing ticket requests");

    first.success({
      statusCode: 200,
      data: { ok: true, ticket: "stale-ticket", expiresAt: Date.now() + 10_000 },
    });
    expect(platform.connectUrls).toEqual([]);

    second.success({
      statusCode: 200,
      data: { ok: true, ticket: "fresh-ticket", expiresAt: Date.now() + 10_000 },
    });
    expect(platform.connectUrls).toEqual([
      "wss://game.example/rooms/1234/websocket?ticket=fresh-ticket",
    ]);

    platform.socket.open();
    expect(captured.opens).toEqual([2]);
  });

  it("keeps invalid ticket responses fatal but reports transport/network failures as reconnectable close", () => {
    const platform = new FakeWeChatPlatform();
    const transport = new WeChatRealtimeTransport<View>(platform, {
      baseUrl: "https://game.example",
    });
    const captured = captureListener();
    transport.setListener(captured.listener);

    transport.connect(credentials, 5);
    platform.requests[0]?.success({
      statusCode: 401,
      data: { ok: false, message: "invalid session credentials" },
    });

    expect(captured.errors).toEqual([{
      generation: 5,
      failure: {
        code: "websocket-ticket-failed",
        message: "invalid session credentials",
      },
    }]);

    transport.connect(credentials, 6);
    platform.issueTicket();
    platform.socket.open();
    platform.socket.serverError({ errMsg: "socket failed" });

    expect(captured.errors).toHaveLength(1);
    expect(captured.closes).toContainEqual({
      generation: 6,
      reason: "socket failed",
    });
    expect(platform.socket.closeCalls).toBe(1);

    transport.connect(credentials, 7);
    platform.requests.at(-1)?.fail({ errMsg: "ticket network failed" });
    expect(captured.closes).toContainEqual({
      generation: 7,
      reason: "ticket network failed",
    });
  });
});
