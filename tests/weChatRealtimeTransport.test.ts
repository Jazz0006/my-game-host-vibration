import { describe, expect, it, vi } from "vitest";
import {
  CLIENT_PROTOCOL_VERSION,
  createClientCommandEnvelope,
  type ClientReconnectCredentials,
} from "../src/protocol/client/ClientProtocol.js";
import {
  WeChatRealtimeTransport,
  type WeChatRealtimePlatform,
  type WeChatRequestOptions,
  type WeChatSocketTaskLike,
} from "../src/client/wechat/WeChatRealtimeTransport.js";

class FakeSocket implements WeChatSocketTaskLike {
  readonly sent: string[] = [];
  closed = false;
  private openListener: (() => void) | null = null;
  private closeListener: ((result?: { code?: number; reason?: string }) => void) | null = null;
  private errorListener: ((error: unknown) => void) | null = null;
  private messageListener: ((result: { data: unknown }) => void) | null = null;

  onOpen(listener: () => void): void {
    this.openListener = listener;
  }

  onClose(listener: (result?: { code?: number; reason?: string }) => void): void {
    this.closeListener = listener;
  }

  onError(listener: (error: unknown) => void): void {
    this.errorListener = listener;
  }

  onMessage(listener: (result: { data: unknown }) => void): void {
    this.messageListener = listener;
  }

  send(options: { data: string; success?(): void; fail?(error: unknown): void }): void {
    this.sent.push(options.data);
    options.success?.();
  }

  close(): void {
    this.closed = true;
  }

  emitOpen(): void {
    this.openListener?.();
  }

  emitClose(reason = "closed"): void {
    this.closeListener?.({ code: 1006, reason });
  }

  emitError(error: unknown): void {
    this.errorListener?.(error);
  }

  emitMessage(frame: unknown): void {
    this.messageListener?.({ data: JSON.stringify(frame) });
  }
}

class FakePlatform implements WeChatRealtimePlatform {
  readonly socket = new FakeSocket();
  requestOptions: WeChatRequestOptions | null = null;
  socketUrl = "";

  request(options: WeChatRequestOptions): unknown {
    this.requestOptions = options;
    options.success({
      statusCode: 200,
      data: { ok: true, ticket: "ticket-123", expiresAt: Date.now() + 30_000 },
    });
    return {};
  }

  connectSocket(options: { url: string }): WeChatSocketTaskLike {
    this.socketUrl = options.url;
    return this.socket;
  }
}

const credentials: ClientReconnectCredentials = {
  roomId: "1234",
  playerId: "p2",
  resumeToken: "resume-secret",
};

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function stateEnvelope(revision: number) {
  return {
    revision,
    envelope: {
      protocolVersion: CLIENT_PROTOCOL_VERSION,
      kind: "state" as const,
      scope: "player" as const,
      roomId: "1234",
      playerId: "p2",
      payload: { phase: "night" },
    },
  };
}

describe("E3.2 WeChat realtime transport", () => {
  it("exchanges resume credentials for a short-lived ticket before opening wx.connectSocket", async () => {
    const platform = new FakePlatform();
    const transport = new WeChatRealtimeTransport(platform, credentials, {
      baseUrl: "https://game.example.test/",
    });
    const onOpen = vi.fn();
    transport.setListener({
      onOpen,
      onClose: vi.fn(),
      onError: vi.fn(),
      onState: vi.fn(),
      onEvent: vi.fn(),
    });

    transport.connect(3);
    await flushPromises();

    expect(platform.requestOptions?.url).toBe(
      "https://game.example.test/rooms/1234/websocket-ticket",
    );
    expect(platform.requestOptions?.data).toEqual({
      playerId: "p2",
      resumeToken: "resume-secret",
    });
    expect(platform.socketUrl).toBe(
      "wss://game.example.test/rooms/1234/websocket?ticket=ticket-123",
    );

    platform.socket.emitOpen();
    expect(onOpen).toHaveBeenCalledWith(3);
  });

  it("correlates client:sync-state responses into ClientSession authoritative deliveries", async () => {
    const platform = new FakePlatform();
    const transport = new WeChatRealtimeTransport<{ phase: string }>(platform, credentials, {
      baseUrl: "https://game.example.test",
    });
    transport.setListener({
      onOpen: vi.fn(),
      onClose: vi.fn(),
      onError: vi.fn(),
      onState: vi.fn(),
      onEvent: vi.fn(),
    });
    transport.connect(4);
    await flushPromises();
    platform.socket.emitOpen();

    const synchronization = transport.synchronize(credentials, 4);
    const request = JSON.parse(platform.socket.sent[0]!) as Record<string, any>;
    expect(request).toMatchObject({
      protocolVersion: CLIENT_PROTOCOL_VERSION,
      kind: "request",
      type: "client:sync-state",
      payload: {},
    });

    platform.socket.emitMessage({
      protocolVersion: CLIENT_PROTOCOL_VERSION,
      kind: "response",
      requestId: request.requestId,
      ok: true,
      payload: stateEnvelope(12),
    });

    await expect(synchronization).resolves.toEqual({
      generation: 4,
      ...stateEnvelope(12),
    });
  });

  it("keeps command ACKs separate from authoritative state pushes", async () => {
    const platform = new FakePlatform();
    const onState = vi.fn();
    const transport = new WeChatRealtimeTransport(platform, credentials, {
      baseUrl: "https://game.example.test",
    });
    transport.setListener({
      onOpen: vi.fn(),
      onClose: vi.fn(),
      onError: vi.fn(),
      onState,
      onEvent: vi.fn(),
    });
    transport.connect(5);
    await flushPromises();
    platform.socket.emitOpen();

    const command = createClientCommandEnvelope(
      "werewolf.confirmRole",
      { actionId: "action-1" },
      "command-1",
    );
    const pending = transport.send(command);
    const request = JSON.parse(platform.socket.sent[0]!) as Record<string, any>;
    expect(request.type).toBe("client:command");
    expect(request.payload).toEqual(command);

    platform.socket.emitMessage({
      protocolVersion: CLIENT_PROTOCOL_VERSION,
      kind: "response",
      requestId: request.requestId,
      ok: true,
      payload: { outcome: { kind: "broadcast" }, replayed: false, revision: 13 },
    });
    await expect(pending).resolves.toMatchObject({ replayed: false, revision: 13 });
    expect(onState).not.toHaveBeenCalled();

    platform.socket.emitMessage({
      protocolVersion: CLIENT_PROTOCOL_VERSION,
      kind: "push",
      type: "client:state",
      payload: stateEnvelope(13),
    });
    expect(onState).toHaveBeenCalledWith({
      generation: 5,
      ...stateEnvelope(13),
    });
  });

  it("drops malformed transient frames but reports malformed authoritative state", async () => {
    const platform = new FakePlatform();
    const onError = vi.fn();
    const onEvent = vi.fn();
    const transport = new WeChatRealtimeTransport(platform, credentials, {
      baseUrl: "https://game.example.test",
    });
    transport.setListener({
      onOpen: vi.fn(),
      onClose: vi.fn(),
      onError,
      onState: vi.fn(),
      onEvent,
    });
    transport.connect(6);
    await flushPromises();

    platform.socket.emitMessage({
      protocolVersion: CLIENT_PROTOCOL_VERSION,
      kind: "push",
      type: "client:event",
      payload: { broken: true },
    });
    expect(onEvent).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();

    platform.socket.emitMessage({
      protocolVersion: CLIENT_PROTOCOL_VERSION,
      kind: "push",
      type: "client:state",
      payload: { revision: -1, envelope: {} },
    });
    expect(onError).toHaveBeenCalledWith(6, expect.objectContaining({
      code: "invalid-authoritative-state",
    }));
  });
});
