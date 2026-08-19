import { describe, expect, it, vi } from "vitest";
import {
  WeChatRealtimeTransport,
  type WeChatRealtimePlatform,
  type WeChatRequestOptions,
  type WeChatSocketTaskLike,
} from "../src/client/wechat/WeChatRealtimeTransport.js";

class Socket implements WeChatSocketTaskLike {
  onOpen() {} onClose() {} onError() {} onMessage() {} send() {} close() {}
}

describe("E3.2 WeChat generation guard", () => {
  it("ignores a stale ticket result after a newer generation starts", async () => {
    const requests: WeChatRequestOptions[] = [];
    const connectSocket = vi.fn(() => new Socket());
    const platform: WeChatRealtimePlatform = {
      request(options) { requests.push(options); return {}; },
      connectSocket,
    };
    const transport = new WeChatRealtimeTransport(
      platform,
      { roomId: "1234", playerId: "p1", resumeToken: "secret" },
      { baseUrl: "https://game.example.test" },
    );
    transport.setListener({
      onOpen: vi.fn(), onClose: vi.fn(), onError: vi.fn(), onState: vi.fn(), onEvent: vi.fn(),
    });

    transport.connect(1);
    transport.connect(2);
    requests[0]!.success({ statusCode: 200, data: { ok: true, ticket: "old", expiresAt: 1 } });
    requests[1]!.success({ statusCode: 200, data: { ok: true, ticket: "new", expiresAt: 2 } });
    await Promise.resolve();
    await Promise.resolve();

    expect(connectSocket).toHaveBeenCalledTimes(1);
    expect(connectSocket).toHaveBeenCalledWith({
      url: "wss://game.example.test/rooms/1234/websocket?ticket=new",
    });
  });
});
