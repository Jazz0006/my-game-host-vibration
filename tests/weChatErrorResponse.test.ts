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
  sent = "";
  private messageListener: ((result: { data: unknown }) => void) | null = null;
  onOpen() {} onClose() {} onError() {} close() {}
  onMessage(listener: (result: { data: unknown }) => void): void { this.messageListener = listener; }
  send(options: { data: string }): void { this.sent = options.data; }
  reply(frame: unknown): void { this.messageListener?.({ data: JSON.stringify(frame) }); }
}

describe("E3.2 correlated raw WebSocket errors", () => {
  it("rejects the matching command promise without failing unrelated transport state", async () => {
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
    transport.setListener({ onOpen() {}, onClose() {}, onError() {}, onState() {}, onEvent() {} });
    transport.connect(1);
    await Promise.resolve();
    await Promise.resolve();

    const pending = transport.send(createClientCommandEnvelope(
      "werewolf.confirmRole", { actionId: "bad" }, "c1",
    ));
    const request = JSON.parse(socket.sent) as { requestId: string };
    socket.reply({
      protocolVersion: CLIENT_PROTOCOL_VERSION,
      kind: "response",
      requestId: request.requestId,
      ok: false,
      error: { code: "command_failed", message: "action is stale" },
    });

    await expect(pending).rejects.toThrow("action is stale");
  });
});
