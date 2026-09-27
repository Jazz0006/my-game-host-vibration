import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createPlayerStateEnvelope,
  type ClientReconnectCredentials,
} from "../src/protocol/client/ClientProtocol.js";
import {
  createClientRawWebSocketStateFrame,
  createClientRawWebSocketSuccessResponse,
} from "../src/protocol/client/ClientRawWebSocketProtocol.js";
import { ClientSession } from "../src/client/runtime/ClientSession.js";
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

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
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

  serverMessage(value: unknown): void {
    this.messageListener?.({ data: JSON.stringify(value) });
  }
}

class FakeWeChatPlatform implements WeChatPlatformLike {
  readonly sockets: FakeSocketTask[] = [];
  readonly requests: Array<{
    url: string;
    method: "POST";
    data: unknown;
    success: (response: { statusCode: number; data: unknown }) => void;
    fail: (error: unknown) => void;
  }> = [];

  request(options: {
    url: string;
    method: "POST";
    data: unknown;
    success(response: { statusCode: number; data: unknown }): void;
    fail(error: unknown): void;
  }): void {
    this.requests.push(options);
  }

  connectSocket(): WeChatSocketTaskLike {
    const socket = new FakeSocketTask();
    this.sockets.push(socket);
    return socket;
  }

  issueTicket(requestIndex: number, ticket = `ticket-${requestIndex + 1}`): FakeSocketTask {
    const request = this.requests[requestIndex];
    if (!request) throw new Error(`missing ticket request ${requestIndex}`);
    request.success({
      statusCode: 200,
      data: { ok: true, ticket, expiresAt: Date.now() + 10_000 },
    });
    const socket = this.sockets.at(-1);
    if (!socket) throw new Error("ticket did not create a socket");
    return socket;
  }
}

function lastWireRequest(socket: FakeSocketTask): {
  requestId: string;
  operation: string;
} {
  const raw = socket.sent.at(-1);
  if (!raw) throw new Error("no wire request");
  return JSON.parse(raw) as { requestId: string; operation: string };
}

function completeSync(
  socket: FakeSocketTask,
  revision: number,
  phase: string,
  playerId = "p1",
): void {
  const request = lastWireRequest(socket);
  if (request.operation !== "sync") throw new Error("last request is not sync");
  socket.serverMessage(createClientRawWebSocketSuccessResponse(
    request.requestId,
    {
      revision,
      envelope: createPlayerStateEnvelope("1234", playerId, { phase }),
    },
  ));
}

afterEach(() => {
  vi.useRealTimers();
});

describe("E3.3 WeChat ClientSession integration", () => {
  it("reconnects with a new generation and reconciles authoritative revisions", async () => {
    const platform = new FakeWeChatPlatform();
    const transport = new WeChatRealtimeTransport<View>(platform, {
      baseUrl: "https://game.example",
    });
    const session = new ClientSession<View>(transport);

    session.start(credentials);
    expect(session.getConnectionState()).toEqual({ status: "Connecting", generation: 1 });

    const first = platform.issueTicket(0);
    first.open();
    expect(session.getConnectionState()).toEqual({ status: "Syncing", generation: 1 });
    completeSync(first, 5, "night");
    await flushPromises();

    expect(session.getConnectionState()).toEqual({ status: "Connected", generation: 1 });
    expect(session.getAuthoritativeState()).toMatchObject({
      generation: 1,
      revision: 5,
      envelope: { playerId: "p1", payload: { phase: "night" } },
    });

    first.serverMessage(createClientRawWebSocketStateFrame(
      6,
      createPlayerStateEnvelope("1234", "p1", { phase: "day" }),
    ));
    expect(session.getAuthoritativeState().revision).toBe(6);

    first.serverClose("background socket expired");
    expect(session.getConnectionState()).toEqual({ status: "Disconnected", generation: 1 });
    expect(session.getAuthoritativeState().revision).toBe(6);

    session.reconnect();
    expect(session.getConnectionState()).toEqual({ status: "Reconnecting", generation: 2 });
    expect(session.getAuthoritativeState().revision).toBe(6);

    const second = platform.issueTicket(1);
    second.open();
    expect(session.getConnectionState()).toEqual({ status: "Syncing", generation: 2 });
    completeSync(second, 8, "night_start");
    await flushPromises();

    expect(session.getConnectionState()).toEqual({ status: "Connected", generation: 2 });
    expect(session.getAuthoritativeState()).toMatchObject({
      generation: 2,
      revision: 8,
      envelope: { payload: { phase: "night_start" } },
    });

    first.serverMessage(createClientRawWebSocketStateFrame(
      99,
      createPlayerStateEnvelope("1234", "p1", { phase: "stale-old-socket" }),
    ));
    second.serverMessage(createClientRawWebSocketStateFrame(
      7,
      createPlayerStateEnvelope("1234", "p1", { phase: "stale-revision" }),
    ));
    expect(session.getAuthoritativeState().revision).toBe(8);
    expect(session.getAuthoritativeState().envelope?.payload).toEqual({ phase: "night_start" });

    second.serverMessage(createClientRawWebSocketStateFrame(
      9,
      createPlayerStateEnvelope("1234", "p1", { phase: "day_2" }),
    ));
    expect(session.getAuthoritativeState().revision).toBe(9);
    expect(session.getAuthoritativeState().envelope?.payload).toEqual({ phase: "day_2" });
  });

  it("turns sync timeout into reconnectable Disconnected state", async () => {
    vi.useFakeTimers();

    const platform = new FakeWeChatPlatform();
    const transport = new WeChatRealtimeTransport<View>(platform, {
      baseUrl: "https://game.example",
      requestTimeoutMs: 50,
    });
    const session = new ClientSession<View>(transport);

    session.start(credentials);
    const first = platform.issueTicket(0);
    first.open();
    expect(session.getConnectionState()).toEqual({ status: "Syncing", generation: 1 });

    await vi.advanceTimersByTimeAsync(50);
    await flushPromises();

    expect(session.getConnectionState()).toEqual({ status: "Disconnected", generation: 1 });
    expect(first.closeCalls).toBe(1);

    session.reconnect();
    expect(session.getConnectionState()).toEqual({ status: "Reconnecting", generation: 2 });

    const second = platform.issueTicket(1);
    second.open();
    completeSync(second, 2, "recovered");
    await flushPromises();

    expect(session.getConnectionState()).toEqual({ status: "Connected", generation: 2 });
    expect(session.getAuthoritativeState().revision).toBe(2);
    expect(session.getAuthoritativeState().envelope?.payload).toEqual({ phase: "recovered" });
  });

  it("keeps invalid authoritative identity fail-closed instead of treating it as reconnectable", async () => {
    const platform = new FakeWeChatPlatform();
    const transport = new WeChatRealtimeTransport<View>(platform, {
      baseUrl: "https://game.example",
    });
    const session = new ClientSession<View>(transport);

    session.start(credentials);
    const socket = platform.issueTicket(0);
    socket.open();
    completeSync(socket, 3, "wrong", "p9");
    await flushPromises();

    expect(session.getConnectionState()).toEqual({
      status: "Failed",
      generation: 1,
      failure: {
        code: "authoritative-sync-failed",
        message: "authoritative client state envelope is invalid",
      },
    });
    expect(socket.closeCalls).toBe(1);
  });
});
