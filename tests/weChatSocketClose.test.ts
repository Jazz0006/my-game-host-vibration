import { describe, expect, it, vi } from "vitest";
import {
  WeChatRealtimeTransport,
  type WeChatRealtimePlatform,
  type WeChatRequestOptions,
  type WeChatSocketTaskLike,
} from "../src/client/wechat/WeChatRealtimeTransport.js";

class Socket implements WeChatSocketTaskLike {
  private closeListener: ((result?: { code?: number; reason?: string }) => void) | null = null;
  onOpen() {} onError() {} onMessage() {} send() {} close() {}
  onClose(listener: (result?: { code?: number; reason?: string }) => void): void { this.closeListener = listener; }
  emitClose(): void { this.closeListener?.({ code: 1006, reason: "network lost" }); }
}

describe("E3.2 WeChat socket close", () => {
  it("reports the active transport close to ClientSession", async () => {
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
    const onClose = vi.fn();
    transport.setListener({ onOpen() {}, onClose, onError() {}, onState() {}, onEvent() {} });
    transport.connect(7);
    await Promise.resolve();
    await Promise.resolve();

    socket.emitClose();
    expect(onClose).toHaveBeenCalledWith(7, "network lost");
  });
});
