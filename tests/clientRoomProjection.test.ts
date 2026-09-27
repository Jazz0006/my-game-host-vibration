import { describe, expect, it } from "vitest";
import { createClientRoomProjection } from "../src/runtime/shared/clientRoomProjection.js";

describe("E3.6 public client room projection", () => {
  it("exposes only the minimal lobby fields and omits session/runtime secrets", () => {
    const projection = createClientRoomProjection(
      {
        id: "1234",
        gameType: "werewolf",
        players: [{
          id: "p1",
          name: "Host",
          seat: 1,
          isHost: true,
          resumeTokenHash: "secret-hash",
          socketId: "socket-1",
        }],
        createdAt: 1,
        updatedAt: 2,
        gameConfig: { playerCount: 5 },
      },
      "p1",
    );

    expect(projection).toEqual({
      roomId: "1234",
      gameType: "werewolf",
      viewer: { playerId: "p1", isHost: true },
      players: [{ id: "p1", name: "Host", seat: 1, isHost: true }],
      gameStarted: false,
    });
    expect(JSON.stringify(projection)).not.toContain("resumeToken");
    expect(JSON.stringify(projection)).not.toContain("socketId");
  });

  it("requires the viewer to still be a room member", () => {
    expect(() => createClientRoomProjection(
      {
        id: "1234",
        gameType: "werewolf",
        players: [],
        createdAt: 1,
        updatedAt: 2,
        gameConfig: {},
      },
      "missing",
    )).toThrow("viewer is not a room member");
  });
});
