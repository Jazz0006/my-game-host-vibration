import { describe, expect, it } from "vitest";
import {
  configFromPlayerCount,
  configFromRoleDeck,
  type GameState,
} from "../src/games/werewolf/WerewolfDomainFacade.js";
import {
  createWerewolfClientRoomProjection,
} from "../src/runtime/shared/werewolfClientRoomProjection.js";

function lobbyRoom() {
  const playerIds = ["p1", "p2", "p3", "p4", "p5"];
  return {
    id: "1234",
    gameType: "werewolf",
    players: playerIds.map((id, index) => ({
      id,
      name: `Player ${index + 1}`,
      seat: index + 1,
      isHost: index === 0,
      resumeTokenHash: String(index + 1).repeat(64),
    })),
    createdAt: 1,
    updatedAt: 2,
    gameModerator: { mode: "automatic" as const },
    gameConfig: configFromPlayerCount(5),
  };
}

describe("W3B Werewolf client room projection", () => {
  it("projects connection state and lobby setup without exposing session secrets", () => {
    const connected = new Set(["p1", "p2", "p3", "p4", "p5"]);
    const projection = createWerewolfClientRoomProjection(
      lobbyRoom(),
      "p1",
      {
        isPlayerConnected: playerId => connected.has(playerId),
      },
    );

    expect(projection).toMatchObject({
      roomId: "1234",
      gameType: "werewolf",
      viewer: { playerId: "p1", isHost: true, isGameModerator: false },
      gameModerator: { mode: "automatic" },
      gameStarted: false,
      players: [
        { id: "p1", seat: 1, isHost: true, connected: true },
        { id: "p2", seat: 2, isHost: false, connected: true },
        { id: "p3", seat: 3, isHost: false, connected: true },
        { id: "p4", seat: 4, isHost: false, connected: true },
        { id: "p5", seat: 5, isHost: false, connected: true },
      ],
      lobbySetup: {
        canStart: true,
        minPlayers: 5,
        maxPlayers: 12,
      },
    });
    expect(projection.lobbySetup?.roleCatalog.length).toBeGreaterThan(0);
    expect(projection.lobbySetup?.defaultRoleDeck).toHaveLength(5);
    expect(JSON.stringify(projection)).not.toContain("resumeToken");
  });

  it("separates room owner recovery from human moderator secret view", () => {
    const participantIds = ["p1", "p3", "p4", "p5", "p6"];
    const config = configFromRoleDeck(
      5,
      ["werewolf", "seer", "witch", "villager", "villager"],
    );
    const game: GameState = {
      config,
      phase: "day_vote",
      nightNumber: 1,
      dayNumber: 1,
      roles: {
        p1: "werewolf",
        p3: "seer",
        p4: "witch",
        p5: "villager",
        p6: "villager",
      },
      confirmedRolePlayerIds: [...participantIds],
      actionId: "vote-action",
      witchUsedAntidote: false,
      witchAntidoteSpent: false,
      witchPoisonSpent: false,
      seerResultConfirmed: false,
      deaths: [],
      votes: { p1: "p4", p3: "p4" },
      pkCandidateIds: [],
      deadPlayerIds: [],
    };
    const room = {
      id: "1234",
      gameType: "werewolf",
      players: ["p1", "p2", "p3", "p4", "p5", "p6"].map((id, index) => ({
        id,
        name: `Player ${index + 1}`,
        seat: index + 1,
        isHost: id === "p1",
        resumeTokenHash: String(index + 1).repeat(64),
      })),
      createdAt: 1,
      updatedAt: 2,
      gameModerator: { mode: "human" as const, playerId: "p2" },
      gameConfig: config,
      game,
    };
    const options = { isPlayerConnected: () => true };

    const owner = createWerewolfClientRoomProjection(room, "p1", options);
    const moderator = createWerewolfClientRoomProjection(room, "p2", options);

    expect(owner.viewer).toMatchObject({
      playerId: "p1",
      isHost: true,
      isGameModerator: false,
    });
    expect(owner.recovery).toBeDefined();
    expect(owner.game).not.toHaveProperty("voteTally");

    expect(moderator.viewer).toMatchObject({
      playerId: "p2",
      isHost: false,
      isGameModerator: true,
    });
    expect(moderator).not.toHaveProperty("recovery");
    expect(moderator.game).toHaveProperty("voteTally", { p4: 2 });
    expect(Object.keys(game.roles)).not.toContain("p2");
  });

  it("marks lobby start unavailable while any member is disconnected", () => {
    const projection = createWerewolfClientRoomProjection(
      lobbyRoom(),
      "p1",
      {
        isPlayerConnected: playerId => playerId !== "p5",
      },
    );

    expect(projection.lobbySetup?.canStart).toBe(false);
    expect(projection.players.find(player => player.id === "p5")?.connected).toBe(false);
  });
});
