import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createClientCommandEnvelope,
  type ClientReconnectCredentials,
} from "../src/protocol/client/ClientProtocol.js";
import {
  createClientRawWebSocketFailureResponse,
  createClientRawWebSocketSuccessResponse,
} from "../src/protocol/client/ClientRawWebSocketProtocol.js";
import {
  WeChatRealtimeTransport,
  type WeChatPlatformLike,
  type WeChatSocketTaskLike,
} from "../src/client/WeChatRealtimeTransport.js";

const credentials: ClientReconnectCredentials = {
  roomId: "1234",
  playerId: "p1",
  resumeToken: "resume-secret",
};

class FakeSocketTask implements WeChatSocketTaskLike {
  readonly sent: string[] = [];
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

  close(): void {}

  open(): void {
    this.openListener?.();
  }

  serverMessage(value: unknown): void {
    this.messageListener?.({ data: JSON.stringify(value) });
  }
}

class FakeWeChatPlatform implements WeChatPlatformLike {
  readonly socket = new FakeSocketTask();
  private ticketRequest: {
    success(response: { statusCode: number; data: unknown }): void;
  } | null = null;

  request(options: {
    url: string;
    method: "POST";
    data: unknown;
    success(response: { statusCode: number; data: unknown }): void;
    fail(error: unknown): void;
  }): void {
    this.ticketRequest = options;
  }

  connectSocket(): WeChatSocketTaskLike {
    return this.socket;
  }

  connectTransport(transport: WeChatRealtimeTransport): void {
    transport.connect(credentials, 1);
    if (!this.ticketRequest) throw new Error("missing ticket request");
    this.ticketRequest.success({
      statusCode: 200,
      data: { ok: true, ticket: "ticket-1", expiresAt: Date.now() + 10_000 },
    });
    this.socket.open();
  }
}

function sentFrames(socket: FakeSocketTask): Array<{
  requestId: string;
  operation: string;
  envelope?: {
    commandId?: string;
    type?: string;
  };
}> {
  return socket.sent.map(raw => JSON.parse(raw));
}

afterEach(() => {
  vi.useRealTimers();
});

describe("E3.4 WeChat command ACK retry", () => {
  it("retries a timed-out command with a new requestId and the same commandId", async () => {
    vi.useFakeTimers();

    let requestSequence = 0;
    const platform = new FakeWeChatPlatform();
    const transport = new WeChatRealtimeTransport(platform, {
      baseUrl: "https://game.example",
      requestTimeoutMs: 50,
      commandRetries: 1,
      requestIdFactory: () => `request-${++requestSequence}`,
    });
    transport.setListener({
      onOpen() {},
      onClose() {},
      onError() {},
      onState() {},
      onEvent() {},
    });
    platform.connectTransport(transport);

    const command = createClientCommandEnvelope(
      "werewolf.confirmRole",
      { actionId: "action-1" },
      "command-1",
    );
    const pending = transport.send(command);

    expect(sentFrames(platform.socket)).toEqual([
      expect.objectContaining({
        requestId: "request-1",
        operation: "command",
        envelope: expect.objectContaining({ commandId: "command-1" }),
      }),
    ]);

    await vi.advanceTimersByTimeAsync(50);
    await Promise.resolve();

    const frames = sentFrames(platform.socket);
    expect(frames).toHaveLength(2);
    expect(frames[1]).toMatchObject({
      requestId: "request-2",
      operation: "command",
      envelope: {
        commandId: "command-1",
        type: "werewolf.confirmRole",
      },
    });
    expect(frames[1]?.requestId).not.toBe(frames[0]?.requestId);

    platform.socket.serverMessage(createClientRawWebSocketSuccessResponse(
      "request-2",
      { revision: 8, replayed: true },
    ));

    await expect(pending).resolves.toEqual({
      revision: 8,
      replayed: true,
    });

    // A late ACK for the timed-out first attempt must be harmless.
    platform.socket.serverMessage(createClientRawWebSocketSuccessResponse(
      "request-1",
      { revision: 8, replayed: false },
    ));
  });

  it("does not retry a correlated application failure", async () => {
    let requestSequence = 0;
    const platform = new FakeWeChatPlatform();
    const transport = new WeChatRealtimeTransport(platform, {
      baseUrl: "https://game.example",
      commandRetries: 1,
      requestIdFactory: () => `request-${++requestSequence}`,
    });
    transport.setListener({
      onOpen() {},
      onClose() {},
      onError() {},
      onState() {},
      onEvent() {},
    });
    platform.connectTransport(transport);

    const pending = transport.send(createClientCommandEnvelope(
      "werewolf.confirmRole",
      { actionId: "bad-action" },
      "command-bad",
    ));
    platform.socket.serverMessage(createClientRawWebSocketFailureResponse(
      "request-1",
      "command_failed",
      "invalid action",
    ));

    await expect(pending).rejects.toThrow("invalid action");
    expect(sentFrames(platform.socket)).toHaveLength(1);
  });

  it("bounds retries and rejects after the configured retry budget is exhausted", async () => {
    vi.useFakeTimers();

    let requestSequence = 0;
    const platform = new FakeWeChatPlatform();
    const transport = new WeChatRealtimeTransport(platform, {
      baseUrl: "https://game.example",
      requestTimeoutMs: 25,
      commandRetries: 1,
      requestIdFactory: () => `request-${++requestSequence}`,
    });
    transport.setListener({
      onOpen() {},
      onClose() {},
      onError() {},
      onState() {},
      onEvent() {},
    });
    platform.connectTransport(transport);

    const pending = transport.send(createClientCommandEnvelope(
      "werewolf.confirmRole",
      { actionId: "action-1" },
      "command-timeout",
    ));
    const rejection = expect(pending).rejects.toMatchObject({
      name: "ClientTransportRequestError",
      code: "request-timeout",
      retryable: true,
    });

    await vi.advanceTimersByTimeAsync(25);
    await Promise.resolve();
    expect(sentFrames(platform.socket)).toHaveLength(2);

    await vi.advanceTimersByTimeAsync(25);
    await rejection;
    expect(sentFrames(platform.socket)).toHaveLength(2);
  });
});
