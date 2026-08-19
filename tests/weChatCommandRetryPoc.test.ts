import { describe, expect, it } from "vitest";
import { createWeChatClientSession } from "../src/client/wechat/WeChatClientSession.js";
import { sendWeChatCommandWithReconnectRetry } from "../src/client/wechat/WeChatCommandRetry.js";
import {
  CLIENT_PROTOCOL_VERSION,
  createClientCommandEnvelope,
  type ClientReconnectCredentials,
} from "../src/protocol/client/ClientProtocol.js";
import type {
  WeChatRealtimePlatform,
  WeChatRequestOptions,
  WeChatSocketTaskLike,
} from "../src/client/wechat/WeChatRealtimeTransport.js";

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
  emitMessage(frame: unknown): void {
    this.messageListener?.({ data: JSON.stringify(frame) });
  }
}

class FakePlatform implements WeChatRealtimePlatform {
  readonly sockets: FakeSocket[] = [];
  ticketRequests = 0;

  request(options: WeChatRequestOptions): unknown {
    this.ticketRequests += 1;
    options.success({
      statusCode: 200,
      data: {
        ok: true,
        ticket: `ticket-${this.ticketRequests}`,
        expiresAt: 999999,
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
  await Promise.resolve();
}

function sentFrames(socket: FakeSocket): Array<Record<string, any>> {
  return socket.sent.map(frame => JSON.parse(frame) as Record<string, any>);
}

function respondToSync(socket: FakeSocket, revision: number, phase: string): void {
  const request = sentFrames(socket).find(frame => frame.type === "client:sync-state");
  if (!request) throw new Error("sync request not found");
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

describe("E3.4 WeChat command ACK / retry PoC", () => {
  it("retries the same commandId after reconnect when execution succeeded but ACK was lost", async () => {
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
    respondToSync(firstSocket, 1, "role_confirm");
    await flush();
    expect(session.getConnectionState()).toEqual({ status: "Connected", generation: 1 });

    const command = createClientCommandEnvelope(
      "werewolf.confirmRole",
      { actionId: "action-1" },
      "stable-command-id",
    );
    const resultPromise = sendWeChatCommandWithReconnectRetry(session, command);
    await flush();

    const firstCommandRequest = sentFrames(firstSocket).find(frame => frame.type === "client:command");
    expect(firstCommandRequest?.payload).toEqual(command);

    // Model the real failure window: the server committed commandId and pushed
    // authoritative state, but the correlated command ACK never reached client.
    firstSocket.emitMessage({
      protocolVersion: CLIENT_PROTOCOL_VERSION,
      kind: "push",
      type: "client:state",
      payload: {
        revision: 2,
        envelope: {
          protocolVersion: CLIENT_PROTOCOL_VERSION,
          kind: "state",
          scope: "player",
          roomId: "1234",
          playerId: "p2",
          payload: { phase: "night_start" },
        },
      },
    });
    firstSocket.emitClose();
    await flush();

    expect(session.getConnectionState()).toEqual({ status: "Disconnected", generation: 1 });
    expect(session.getAuthoritativeState()).toMatchObject({
      generation: 1,
      revision: 2,
      envelope: { payload: { phase: "night_start" } },
    });

    session.reconnect();
    await flush();
    const secondSocket = platform.sockets[1]!;
    expect(platform.ticketRequests).toBe(2);
    expect(session.getConnectionState()).toEqual({ status: "Reconnecting", generation: 2 });

    secondSocket.emitOpen();
    respondToSync(secondSocket, 2, "night_start");
    await flush();
    expect(session.getConnectionState()).toEqual({ status: "Connected", generation: 2 });

    const secondCommandRequest = sentFrames(secondSocket).find(frame => frame.type === "client:command");
    expect(secondCommandRequest?.payload).toEqual(command);
    expect(secondCommandRequest?.payload.commandId).toBe(firstCommandRequest?.payload.commandId);
    expect(secondCommandRequest?.requestId).not.toBe(firstCommandRequest?.requestId);

    secondSocket.emitMessage({
      protocolVersion: CLIENT_PROTOCOL_VERSION,
      kind: "response",
      requestId: secondCommandRequest?.requestId,
      ok: true,
      payload: {
        outcome: { kind: "broadcast" },
        replayed: true,
        revision: 2,
      },
    });

    await expect(resultPromise).resolves.toEqual({
      outcome: { kind: "broadcast" },
      replayed: true,
      revision: 2,
    });
  });

  it("does not retry a definitive command error while the session remains Connected", async () => {
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
    respondToSync(socket, 3, "night");
    await flush();

    const command = createClientCommandEnvelope(
      "werewolf.confirmRole",
      { actionId: "stale-action" },
      "command-error-id",
    );
    const resultPromise = sendWeChatCommandWithReconnectRetry(session, command);
    await flush();
    const commandRequest = sentFrames(socket).find(frame => frame.type === "client:command");

    socket.emitMessage({
      protocolVersion: CLIENT_PROTOCOL_VERSION,
      kind: "response",
      requestId: commandRequest?.requestId,
      ok: false,
      error: {
        code: "command_failed",
        message: "stale action",
      },
    });

    await expect(resultPromise).rejects.toThrow("stale action");
    expect(sentFrames(socket).filter(frame => frame.type === "client:command")).toHaveLength(1);
    expect(session.getConnectionState().status).toBe("Connected");
  });
});
