import { describe, expect, it } from "vitest";
import {
  BrowserRoomBootstrapClient,
  type BrowserRoomBootstrapFetchLike,
} from "../src/client/browser/BrowserRoomBootstrapClient.js";

describe("W3A BrowserRoomBootstrapClient", () => {
  it("creates and joins the same Cloudflare room authority through fetch", async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    let sequence = 0;
    const fetchImpl: BrowserRoomBootstrapFetchLike = async (url, init) => {
      calls.push({ url, body: JSON.parse(init.body) });
      sequence += 1;
      return {
        status: sequence === 1 ? 201 : 200,
        async json() {
          return {
            ok: true,
            roomId: "4321",
            gameType: "werewolf",
            playerId: sequence === 1 ? "p1" : "p2",
            resumeToken: sequence === 1 ? "resume-host" : "resume-guest",
            name: sequence === 1 ? "Host" : "Guest",
            seat: sequence,
            isHost: sequence === 1,
            revision: sequence - 1,
          };
        },
      };
    };

    const bootstrap = new BrowserRoomBootstrapClient({
      baseUrl: "https://game.example/",
      fetch: fetchImpl,
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
        body: { gameType: "werewolf", name: "Host" },
      },
      {
        url: "https://game.example/rooms/4321/join",
        body: { gameType: "werewolf", name: "Guest" },
      },
    ]);
    expect(calls.some(call =>
      call.url.includes("resume-host") || call.url.includes("resume-guest")
    )).toBe(false);
  });

  it("rejects invalid room codes before fetch and preserves server/network failures", async () => {
    let requests = 0;
    const bootstrap = new BrowserRoomBootstrapClient({
      baseUrl: "https://game.example",
      fetch: async () => {
        requests += 1;
        return {
          status: 404,
          async json() {
            return {
              ok: false,
              code: "room_not_found",
              message: "房间不存在",
            };
          },
        };
      },
    });

    await expect(bootstrap.joinRoom("12x4")).rejects.toThrow(
      "room code must be exactly 4 digits",
    );
    expect(requests).toBe(0);

    await expect(bootstrap.joinRoom("4321")).rejects.toThrow("房间不存在");
    expect(requests).toBe(1);

    const offline = new BrowserRoomBootstrapClient({
      baseUrl: "https://game.example",
      fetch: async () => {
        throw new Error("offline");
      },
    });
    await expect(offline.createRoom()).rejects.toThrow("offline");
  });

  it("rejects a bootstrap response from a different game product", async () => {
    const bootstrap = new BrowserRoomBootstrapClient({
      baseUrl: "https://game.example",
      gameType: "botc",
      fetch: async () => ({
        status: 201,
        async json() {
          return {
            ok: true,
            roomId: "4321",
            gameType: "werewolf",
            playerId: "p1",
            resumeToken: "resume-host",
            name: "Host",
            seat: 1,
            isHost: true,
            revision: 0,
          };
        },
      }),
    });

    await expect(bootstrap.createRoom()).rejects.toThrow(
      "room gameType does not match this client product",
    );
  });
});
