import { describe, expect, it } from "vitest";
import { createWeChatClientSession } from "../src/client/wechat/WeChatClientSession.js";
import type {
  WeChatRealtimePlatform,
  WeChatRequestOptions,
  WeChatSocketTaskLike,
} from "../src/client/wechat/WeChatRealtimeTransport.js";
import {
  CLIENT_PROTOCOL_VERSION,
  type ClientReconnectCredentials,
} from "../src/protocol/client/ClientProtocol.js";

class FakeSocket implements WeChatSocketTaskLike {
  readonly sent: string[] = [];
  private openListener: (() => void) | null = null;
  private closeListener: ((result?: { code?: number; reason?: string }) => void) | null = null;
  private errorListener: ((error: unknown) => void) | null = null;
  private messageListener: ((result: { data: unknown }) => void) | null = null;

  onOpen(listener: () => void): void { this.openListener = listener; }
  onClose(listener: (result?: { code?: number; reason?: string }) => void): void {
    this.closeListener = listener;
  }
  onError(listener: (error: unknown) => void): void { this.errorListener = listener; }
  onMessage(listener: (result: { data: unknown }) => void): void { this.messageListener = listener; }
  send(options: { data: string; success?(): void; fail?(error: unknown): void }): void {
    this.sent.push(options.data);
    options.success?.();
  }
  close(): void {}

  emitOpen(): void { this.openListener?.(); }
  emitClose(reason = "network lost"): void { this.closeListener?.({ code: 1006, reason }); }
  emitError(error: unknown): void { this.errorListener?.(error); }
  emitMessage(frame: unknown): void { this.messageListener?.({ data: JSON.stringify(frame) }); }
}

class FakePlatform implements WeChatRealtimePlatform {
  readonly sockets: FakeSocket[] = [];
  readonly ticketRequests: WeChatRequestOptions[] = [];
  private ticketSequence = 0;

  request(options: WeChatRequestOptions): unknown {
    this.ticketRequests.push(options);
    this.ticketSequence += 1;
    options.success({
      statusCode: 200,
      data: {
        ok: true,
        ticket: `ticket-${this.ticketSequence}`,
        expiresAt: 999_999,
      },
    });
    return {};
  }

  connectSocket(): WeChatSocketTaskLike {
    const socket = new FakeSocket();
    this.sockets.push(socket);
    return socket;
  }
}

const credentials: ClientReconnectCredentials = {
  roomId: "1234",
  playerId: "p2",
  resumeToken: "resume-secret",
};

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function respondWithState(
  socket: FakeSocket,
  requestIndex: number,
  revision: number,
  phase: string,
): void {
  const request = JSON.parse(socket.sent[requestIndex]!) as { requestId: string };
  socket.emitMessage({
    protocolVersion: CLIENT_PROTOCOL_VERSION,
    kind: "response",
    requestId: request.requestId,
    ok: true,
    payload: {
      revision,
      envelope: {
        protocolVersion: CLIENT_PROTOCOL_VERSION,
        kind: "state",
        scope: "player",
        roomId: "1234",
        playerId: "p2",
        payload: { phase },
      },
    },
  });
}

function statePush(revision: number, phase: string) {
  return {
    protocolVersion: CLIENT_PROTOCOL_VERSION,
    kind: "push",
    type: "client:state",
    payload: {
      revision,
      envelope: {
        protocolVersion: CLIENT_PROTOCOL_VERSION,
        kind: "state",
        scope: "player",
        roomId: "1234",
        playerId: "p2",
        payload: { phase },
      },
    },
  };
}

describe("E3.3 WeChat authoritative reconnect PoC", () => {
  it("preserves the last trusted view while disconnected, then replaces it with the latest server revision", async () => {
    const platform = new FakePlatform();
    const session = createWeChatClientSession<{ phase: string }>(
      platform,
      credentials,
      { baseUrl: "https://game.example.test" },
    );

    session.start(credentials);
    await flush();
    const firstSocket = platform.sockets[0]!;
    firstSocket.emitOpen();
    respondWithState(firstSocket, 0, 2, "night-1");
    await flush();

    expect(session.getConnectionState()).toMatchObject({ status: "Connected", generation: 1 });
    expect(session.getAuthoritativeState()).toMatchObject({
      generation: 1,
      revision: 2,
      envelope: { payload: { phase: "night-1" } },
    });

    firstSocket.emitClose();
    expect(session.getConnectionState()).toMatchObject({ status: "Disconnected", generation: 1 });
    expect(session.getAuthoritativeState()).toMatchObject({
      generation: 1,
      revision: 2,
      envelope: { payload: { phase: "night-1" } },
    });

    session.reconnect();
    expect(session.getConnectionState()).toMatchObject({ status: "Reconnecting", generation: 2 });
    expect(session.getAuthoritativeState()).toMatchObject({
      generation: 2,
      revision: 2,
      envelope: { payload: { phase: "night-1" } },
    });

    await flush();
    expect(platform.ticketRequests).toHaveLength(2);
    expect(platform.sockets).toHaveLength(2);
    const secondSocket = platform.sockets[1]!;
    secondSocket.emitOpen();
    expect(session.getConnectionState()).toMatchObject({ status: "Syncing", generation: 2 });

    // A late frame from the previous physical socket must not contaminate the
    // new generation, even if it advertises a numerically newer revision.
    firstSocket.emitMessage(statePush(99, "stale-old-socket"));
    expect(session.getAuthoritativeState()).toMatchObject({
      generation: 2,
      revision: 2,
      envelope: { payload: { phase: "night-1" } },
    });

    respondWithState(secondSocket, 0, 5, "day-2");
    await flush();

    expect(session.getConnectionState()).toMatchObject({ status: "Connected", generation: 2 });
    expect(session.getAuthoritativeState()).toMatchObject({
      generation: 2,
      revision: 5,
      envelope: { payload: { phase: "day-2" } },
    });
  });

  it("resyncs a healthy foreground session on the same socket without advancing generation", async () => {
    const platform = new FakePlatform();
    const session = createWeChatClientSession<{ phase: string }>(
      platform,
      credentials,
      { baseUrl: "https://game.example.test" },
    );

    session.start(credentials);
    await flush();
    const socket = platform.sockets[0]!;
    socket.emitOpen();
    respondWithState(socket, 0, 3, "night");
    await flush();

    session.resync();
    expect(session.getConnectionState()).toMatchObject({ status: "Syncing", generation: 1 });
    expect(platform.ticketRequests).toHaveLength(1);
    expect(platform.sockets).toHaveLength(1);
    expect(session.getAuthoritativeState()).toMatchObject({ revision: 3 });

    respondWithState(socket, 1, 4, "day");
    await flush();

    expect(session.getConnectionState()).toMatchObject({ status: "Connected", generation: 1 });
    expect(session.getAuthoritativeState()).toMatchObject({
      generation: 1,
      revision: 4,
      envelope: { payload: { phase: "day" } },
    });
  });
});
