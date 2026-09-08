import { describe, expect, it, vi } from "vitest";
import { CLIENT_PROTOCOL_VERSION } from "../src/protocol/client/ClientProtocol.js";
import {
  WeChatRealtimeTransport,
  type WeChatRealtimePlatform,
  type WeChatRequestOptions,
  type WeChatSocketTaskLike,
} from "../src/client/wechat/WeChatRealtimeTransport.js";

class Socket implements WeChatSocketTaskLike {
  private messageListener: ((result: { data: unknown }) => void) | null = null;
  onOpen() {} onClose() {} onError() {}
  onMessage(listener: (result: { data: unknown }) => void): void { this.messageListener = listener; }
  send() {} close() {}
  message(frame: unknown): void { this.messageListener?.({ data: JSON.stringify(frame) }); }
}

describe("E3.2 WeChat transient event push", () => {
  it("forwards a valid client:event without making it authoritative", async () => {
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
    const onEvent = vi.fn();
    const onState = vi.fn();
    transport.setListener({ onOpen() {}, onClose() {}, onError() {}, onState, onEvent });
    transport.connect(1);
    await Promise.resolve();
    await Promise.resolve();

    socket.message({
      protocolVersion: CLIENT_PROTOCOL_VERSION,
      kind: "push",
      type: "client:event",
      payload: {
        protocolVersion: CLIENT_PROTOCOL_VERSION,
        kind: "event",
        type: "effect.vibration",
        payload: { pattern: "short" },
      },
    });

    expect(onEvent).toHaveBeenCalledWith({
      generation: 1,
      envelope: {
        protocolVersion: CLIENT_PROTOCOL_VERSION,
        kind: "event",
        type: "effect.vibration",
        payload: { pattern: "short" },
      },
    });
    expect(onState).not.toHaveBeenCalled();
  });
});
