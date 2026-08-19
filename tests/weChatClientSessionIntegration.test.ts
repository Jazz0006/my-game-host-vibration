import { describe, expect, it } from "vitest";
import { ClientSession } from "../src/client/runtime/ClientSession.js";
import {
  WeChatRealtimeTransport,
  type WeChatRealtimePlatform,
  type WeChatRequestOptions,
  type WeChatSocketTaskLike,
} from "../src/client/wechat/WeChatRealtimeTransport.js";
import {
  CLIENT_PROTOCOL_VERSION,
  type ClientReconnectCredentials,
} from "../src/protocol/client/ClientProtocol.js";

class FakeSocket implements WeChatSocketTaskLike {
  readonly sent: string[] = [];
  private openListener: (() => void) | null = null;
  private messageListener: ((result: { data: unknown }) => void) | null = null;

  onOpen(listener: () => void): void { this.openListener = listener; }
  onClose(_listener: (result?: { code?: number; reason?: string }) => void): void {}
  onError(_listener: (error: unknown) => void): void {}
  onMessage(listener: (result: { data: unknown }) => void): void { this.messageListener = listener; }
  send(options: { data: string; success?(): void; fail?(error: unknown): void }): void {
    this.sent.push(options.data);
    options.success?.();
  }
  close(): void {}
  emitOpen(): void { this.openListener?.(); }
  emitMessage(frame: unknown): void { this.messageListener?.({ data: JSON.stringify(frame) }); }
}

class FakePlatform implements WeChatRealtimePlatform {
  readonly socket = new FakeSocket();
  request(options: WeChatRequestOptions): unknown {
    options.success({ statusCode: 200, data: { ok: true, ticket: "ticket", expiresAt: 999999 } });
    return {};
  }
  connectSocket(): WeChatSocketTaskLike { return this.socket; }
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

describe("E3.2 WeChat ClientSession integration", () => {
  it("reaches Connected only after a WeChat raw WebSocket authoritative sync", async () => {
    const platform = new FakePlatform();
    const session = new ClientSession<{ phase: string }>(
      new WeChatRealtimeTransport(platform, credentials, { baseUrl: "https://game.example.test" }),
    );

    session.start(credentials);
    expect(session.getConnectionState().status).toBe("Connecting");
    await flush();
    platform.socket.emitOpen();
    expect(session.getConnectionState().status).toBe("Syncing");

    const request = JSON.parse(platform.socket.sent[0]!) as { requestId: string };
    platform.socket.emitMessage({
      protocolVersion: CLIENT_PROTOCOL_VERSION,
      kind: "response",
      requestId: request.requestId,
      ok: true,
      payload: {
        revision: 3,
        envelope: {
          protocolVersion: CLIENT_PROTOCOL_VERSION,
          kind: "state",
          scope: "player",
          roomId: "1234",
          playerId: "p2",
          payload: { phase: "night" },
        },
      },
    });
    await flush();

    expect(session.getConnectionState().status).toBe("Connected");
    expect(session.getAuthoritativeState()).toMatchObject({
      revision: 3,
      payload: { phase: "night" },
    });
  });
});
