import { describe, expect, it } from "vitest";
import { WeChatRoomBootstrapClient } from "../src/client/WeChatRoomBootstrapClient.js";

describe("E3.7B WeChat room bootstrap client", () => {
  it("creates and joins through HTTP without exposing transport credentials in URLs", async () => {
    const calls: Array<{ url: string; method: string; data: unknown }> = [];
    let sequence = 0;
    const api = {
      request(options: {
        url: string;
        method: "POST";
        data: unknown;
        success(response: { statusCode: number; data: unknown }): void;
        fail(error: unknown): void;
      }) {
        calls.push({ url: options.url, method: options.method, data: options.data });
        sequence += 1;
        options.success({
          statusCode: sequence === 1 ? 201 : 200,
          data: {
            ok: true,
            roomId: "4321",
            playerId: sequence === 1 ? "p1" : "p2",
            resumeToken: sequence === 1 ? "resume-host" : "resume-guest",
            name: sequence === 1 ? "Host" : "Guest",
            seat: sequence,
            isHost: sequence === 1,
            revision: sequence - 1,
          },
        });
      },
    };

    const bootstrap = new WeChatRoomBootstrapClient(api, {
      baseUrl: "https://game.example/",
    });

    await expect(bootstrap.createRoom("Host")).resolves.toMatchObject({
      roomId: "4321",
      playerId: "p1",
      resumeToken: "resume-host",
      isHost: true,
    });
    await expect(bootstrap.joinRoom("4321", "Guest")).resolves.toMatchObject({
      roomId: "4321",
      playerId: "p2",
      resumeToken: "resume-guest",
      isHost: false,
    });

    expect(calls).toEqual([
      {
        url: "https://game.example/rooms",
        method: "POST",
        data: { name: "Host" },
      },
      {
        url: "https://game.example/rooms/4321/join",
        method: "POST",
        data: { name: "Guest" },
      },
    ]);
    expect(calls.some(call => call.url.includes("resume-host") || call.url.includes("resume-guest"))).toBe(false);
  });

  it("rejects invalid room codes before issuing a request and surfaces server bootstrap errors", async () => {
    let requests = 0;
    const api = {
      request(options: {
        url: string;
        method: "POST";
        data: unknown;
        success(response: { statusCode: number; data: unknown }): void;
        fail(error: unknown): void;
      }) {
        requests += 1;
        options.success({
          statusCode: 404,
          data: { ok: false, code: "room_not_found", message: "房间不存在" },
        });
      },
    };
    const bootstrap = new WeChatRoomBootstrapClient(api, {
      baseUrl: "https://game.example",
    });

    await expect(bootstrap.joinRoom("12x4")).rejects.toThrow("room code must be exactly 4 digits");
    expect(requests).toBe(0);

    await expect(bootstrap.joinRoom("4321")).rejects.toThrow("房间不存在");
    expect(requests).toBe(1);
  });

  it("preserves wx.request fail diagnostics from plain error objects", async () => {
    const api = {
      request(options: {
        url: string;
        method: "POST";
        data: unknown;
        success(response: { statusCode: number; data: unknown }): void;
        fail(error: unknown): void;
      }) {
        options.fail({
          errMsg: "request:fail url not in domain list",
          errno: 600009,
        });
      },
    };
    const bootstrap = new WeChatRoomBootstrapClient(api, {
      baseUrl: "https://game.example",
    });

    await expect(bootstrap.createRoom()).rejects.toThrow(
      "request:fail url not in domain list (errno 600009)",
    );
  });
});
