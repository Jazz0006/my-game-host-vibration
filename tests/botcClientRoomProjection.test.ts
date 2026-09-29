import { describe, expect, it } from "vitest";
import type { GameModuleDependencies } from "../src/core/game/GameModule.js";
import { createRoomSnapshot } from "../src/core/room/RoomSnapshot.js";
import {
  BotcGameModule,
  type BotcGameConfig,
  type BotcGameState,
} from "../src/games/botc/BotcGameModule.js";
import {
  createBotcClientRoomProjection,
} from "../src/runtime/shared/botcClientRoomProjection.js";
import {
  createGamePlayerStateEnvelope,
  createGameRoomStateEnvelope,
} from "../src/runtime/shared/gameClientStateProjection.js";

const dependencies: GameModuleDependencies = {
  random: {
    randomInt: () => 0,
    randomId: () => "unused",
  },
};

function players(ids: readonly string[]) {
  return ids.map((id, index) => ({
    id,
    name: `Player ${index + 1}`,
    seat: index + 1,
    isHost: id === "p1",
    resumeTokenHash: String(index + 1).repeat(64),
  }));
}

function activeBotcRoom() {
  const module = new BotcGameModule();
  const game = module.createGame(
    {
      playerIds: ["p1", "p2", "p3", "p4", "p5"],
      config: { scriptId: "trouble-brewing" },
      assignments: [
        { playerId: "p1", actualRoleId: "washerwoman" },
        {
          playerId: "p2",
          actualRoleId: "drunk",
          shownRoleId: "empath",
        },
        { playerId: "p3", actualRoleId: "saint" },
        { playerId: "p4", actualRoleId: "baron" },
        { playerId: "p5", actualRoleId: "imp" },
      ],
    },
    dependencies,
  );

  return {
    id: "5678",
    gameType: "botc",
    players: players(["p1", "p2", "p3", "p4", "p5", "p6"]),
    createdAt: 10,
    updatedAt: 20,
    gameModerator: { mode: "human" as const, playerId: "p6" },
    gameConfig: { scriptId: "trouble-brewing" as const },
    game,
  };
}

describe("B0A BotC room/client projections", () => {
  it("projects Trouble Brewing lobby setup without session secrets", () => {
    const room = {
      id: "5678",
      gameType: "botc",
      players: players(["p1", "p2", "p3", "p4", "p5"]),
      createdAt: 10,
      updatedAt: 20,
      gameModerator: { mode: "automatic" as const },
      gameConfig: { scriptId: "trouble-brewing" as const },
    };

    const projection = createBotcClientRoomProjection(room, "p1", {
      isPlayerConnected: () => true,
    });

    expect(projection).toMatchObject({
      roomId: "5678",
      gameType: "botc",
      viewer: {
        playerId: "p1",
        isHost: true,
        isGameModerator: false,
      },
      gameModerator: { mode: "automatic" },
      gameStarted: false,
      lobbySetup: {
        canStart: true,
        minPlayers: 5,
        maxPlayers: 15,
        scriptId: "trouble-brewing",
      },
    });
    expect(projection.lobbySetup?.roleCatalog).toHaveLength(22);
    expect(JSON.stringify(projection)).not.toContain("resumeToken");
  });

  it("keeps room owner on PublicView while a human moderator receives ModeratorView", () => {
    const room = activeBotcRoom();

    const owner = createBotcClientRoomProjection(room, "p1", {
      isPlayerConnected: () => true,
    });
    const moderator = createBotcClientRoomProjection(room, "p6", {
      isPlayerConnected: () => true,
    });

    expect(owner.viewer).toEqual({
      playerId: "p1",
      isHost: true,
      isGameModerator: false,
    });
    expect(owner.gameStarted).toBe(true);
    expect(JSON.stringify(owner)).not.toContain("actualRoleId");
    expect(JSON.stringify(owner)).not.toContain("shownRoleId");

    expect(moderator.viewer).toEqual({
      playerId: "p6",
      isHost: false,
      isGameModerator: true,
    });
    expect(moderator).toMatchObject({
      game: {
        assignments: expect.arrayContaining([
          {
            playerId: "p2",
            actualRoleId: "drunk",
            shownRoleId: "empath",
          },
        ]),
      },
    });
  });

  it("dispatches active BotC PlayerView and room projection through the shared seam", () => {
    const room = activeBotcRoom();
    const snapshot = createRoomSnapshot<
      BotcGameState,
      BotcGameConfig,
      (typeof room.players)[number]
    >(room, { revision: 7 });

    const drunkPlayer = createGamePlayerStateEnvelope(snapshot, "p2");
    expect(drunkPlayer).toMatchObject({
      scope: "player",
      roomId: "5678",
      playerId: "p2",
      payload: {
        phase: "role_reveal",
        mode: "role_reveal",
        roleId: "empath",
        roleCategory: "townsfolk",
      },
    });
    expect(JSON.stringify(drunkPlayer)).not.toContain('"actualRoleId":"drunk"');

    const ownerRoom = createGameRoomStateEnvelope(
      snapshot,
      "p1",
      () => true,
    );
    expect(ownerRoom).toMatchObject({
      scope: "room",
      roomId: "5678",
      payload: {
        gameType: "botc",
        gameStarted: true,
        game: {
          scriptId: "trouble-brewing",
          playerCount: 5,
        },
      },
    });
    expect(JSON.stringify(ownerRoom)).not.toContain("actualRoleId");

    const moderatorRoom = createGameRoomStateEnvelope(
      snapshot,
      "p6",
      () => true,
    );
    expect(moderatorRoom).toMatchObject({
      payload: {
        viewer: { isGameModerator: true },
        game: {
          assignments: expect.arrayContaining([
            {
              playerId: "p2",
              actualRoleId: "drunk",
              shownRoleId: "empath",
            },
          ]),
        },
      },
    });
  });
});
