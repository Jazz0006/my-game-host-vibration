import { describe, expect, it } from "vitest";
import {
  WeChatRealtimeTransport,
  type WeChatRealtimePlatform,
  type WeChatRequestOptions,
  type WeChatSocketTaskLike,
} from "../src/client/wechat/WeChatRealtimeTransport.js";

class Socket implements WeChatSocketTaskLike {
  onOpen() {} onClose() {} onError() {} onMessage() {} send() {} close() {}
}

describe("E3.2 WeChat credential binding", () => {
  it("rejects synchronization credentials that differ from the ticket-bound identity", async () => {
    const platform: WeChatRealtimePlatform = {
      request(options: WeChatRequestOptions) {
        options.success({ statusCode: 200, data: { ok: true, ticket: "ticket", expiresAt: 1 } });
        return {};
      },
      connectSocket() { return new Socket(); },
    };
    const transport = new WeChatRealtimeTransport(
      platform,
      { roomId: "1234", playerId: "p1", resumeToken: "secret" },
      { baseUrl: "https://game.example.test" },
    );
    transport.setListener({ onOpen() {}, onClose() {}, onError() {}, onState() {}, onEvent() {} });
    transport.connect(1);
    await Promise.resolve();
    await Promise.resolve();

    await expect(transport.synchronize(
      { roomId: "1234", playerId: "p2", resumeToken: "other" },
      1,
    )).rejects.toThrow(/credentials do not match/u);
  });
});
