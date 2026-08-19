import { describe, expect, it, vi } from "vitest";
import {
  WeChatRealtimeTransport,
  type WeChatRealtimePlatform,
  type WeChatRequestOptions,
  type WeChatSocketTaskLike,
} from "../src/client/wechat/WeChatRealtimeTransport.js";

class Socket implements WeChatSocketTaskLike {
  private listener: ((result: { data: unknown }) => void) | null = null;
  onOpen() {} onClose() {} onError() {} send() {} close() {}
  onMessage(listener: (result: { data: unknown }) => void): void { this.listener = listener; }
  malformed(): void { this.listener?.({ data: "{" }); }
}

describe("E3.2 malformed raw WebSocket frames", () => {
  it("drops malformed JSON without failing the synchronized session", async () => {
    const socket = new Socket();
    const platform: WeChatRealtimePlatform = {
      request(options: WeChatRequestOptions) {
        options.success({ statusCode: 200, data: { ok: true, ticket: "ticket", expiresAt: 1 } });
        return {};
      },
      connectSocket() { return socket; },
    };
    const transport = new WeChatRealtimeTransport(
      platform,
      { roomId: "1234", playerId: "p1", resumeToken: "secret" },
      { baseUrl: "https://game.example.test" },
    );
    const onError = vi.fn();
    transport.setListener({ onOpen() {}, onClose() {}, onError, onState() {}, onEvent() {} });
    transport.connect(1);
    await Promise.resolve();
    await Promise.resolve();
    socket.malformed();
    expect(onError).not.toHaveBeenCalled();
  });
});
