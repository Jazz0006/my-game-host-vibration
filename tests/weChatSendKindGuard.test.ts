import { describe, expect, it } from "vitest";
import { createPlayerStateEnvelope } from "../src/protocol/client/ClientProtocol.js";
import { WeChatRealtimeTransport } from "../src/client/wechat/WeChatRealtimeTransport.js";

describe("E3.2 WeChat send boundary", () => {
  it("rejects non-command protocol messages", async () => {
    const transport = new WeChatRealtimeTransport(
      { request() {}, connectSocket() { throw new Error("unused"); } },
      { roomId: "1234", playerId: "p1", resumeToken: "secret" },
      { baseUrl: "https://game.example.test" },
    );
    await expect(transport.send(createPlayerStateEnvelope("1234", "p1", {})))
      .rejects.toThrow(/cannot send state/u);
  });
});
