import { describe, expect, it } from "vitest";
import { WeChatRealtimeTransport } from "../src/client/wechat/WeChatRealtimeTransport.js";

describe("E3.2 WeChat base URL", () => {
  it("requires an HTTP(S) origin for ticket and WebSocket derivation", () => {
    expect(() => new WeChatRealtimeTransport(
      { request() {}, connectSocket() { throw new Error("unused"); } },
      { roomId: "1234", playerId: "p1", resumeToken: "secret" },
      { baseUrl: "game.example.test" },
    )).toThrow(/http or https/u);
  });
});
