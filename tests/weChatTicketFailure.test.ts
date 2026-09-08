import { describe, expect, it, vi } from "vitest";
import {
  WeChatRealtimeTransport,
  type WeChatRealtimePlatform,
  type WeChatRequestOptions,
  type WeChatSocketTaskLike,
} from "../src/client/wechat/WeChatRealtimeTransport.js";

const unusedSocket: WeChatSocketTaskLike = {
  onOpen() {}, onClose() {}, onError() {}, onMessage() {}, send() {}, close() {},
};

describe("E3.2 WeChat ticket failure", () => {
  it("reports ticket exchange failure without opening a socket", async () => {
    const connectSocket = vi.fn(() => unusedSocket);
    const platform: WeChatRealtimePlatform = {
      request(options: WeChatRequestOptions) {
        options.fail({ errMsg: "network down" });
        return {};
      },
      connectSocket,
    };
    const transport = new WeChatRealtimeTransport(
      platform,
      { roomId: "1234", playerId: "p1", resumeToken: "secret" },
      { baseUrl: "https://game.example.test" },
    );
    const onError = vi.fn();
    transport.setListener({
      onOpen: vi.fn(), onClose: vi.fn(), onError, onState: vi.fn(), onEvent: vi.fn(),
    });

    transport.connect(2);
    await Promise.resolve();
    await Promise.resolve();

    expect(connectSocket).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(2, {
      code: "websocket-connect-failed",
      message: "network down",
    });
  });
});
