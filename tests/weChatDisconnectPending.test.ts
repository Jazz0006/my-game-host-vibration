import { describe, expect, it } from "vitest";
import {
  CLIENT_PROTOCOL_VERSION,
  createClientCommandEnvelope,
} from "../src/protocol/client/ClientProtocol.js";
import {
  WeChatRealtimeTransport,
  type WeChatRealtimePlatform,
  type WeChatRequestOptions,
  type WeChatSocketTaskLike,
} from "../src/client/wechat/WeChatRealtimeTransport.js";

class Socket implements WeChatSocketTaskLike {
  private openListener: (() => void) | null = null;
  onOpen(listener: () => void): void { this.openListener = listener; }
  onClose() {} onError() {} onMessage() {} send() {} close() {}
  open(): void { this.openListener?.(); }
}

describe("E3.2 WeChat pending request teardown", () => {
  it("rejects pending requests when the active generation disconnects", async () => {
    const socket = new Socket();
    const platform: WeChatRealtimePlatform = {
      request(options: WeChatRequestOptions) {
        options.success({ statusCode: 200, data: { ok: true, ticket: "ticket", expiresAt: 1 } });
        return {};
      },
      connectSocket() { return socket; },
    };
    const credentials = { roomId: "1234", playerId: "p1", resumeToken: "secret" };
    const transport = new WeChatRealtimeTransport(platform, credentials, {
      baseUrl: "https://game.example.test",
    });
    transport.setListener({ onOpen() {}, onClose() {}, onError() {}, onState() {}, onEvent() {} });
    transport.connect(1);
    await Promise.resolve();
    await Promise.resolve();
    socket.open();

    const pending = transport.send(createClientCommandEnvelope(
      "werewolf.confirmRole",
      { actionId: "a1" },
      "c1",
    ));
    transport.disconnect(1);

    await expect(pending).rejects.toThrow(/disconnected/u);
    expect(CLIENT_PROTOCOL_VERSION).toBe(1);
  });
});
