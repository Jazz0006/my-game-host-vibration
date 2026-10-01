import { describe, expect, it } from "vitest";
import { createClientLobbyPresentation } from "../src/client/ClientLobbyPresentation.js";

describe("PV-UI1 shared lobby presentation", () => {
  it("projects owner, readiness, moderator, and room controls from authoritative room state", () => {
    const model = createClientLobbyPresentation({
      roomId: "1234",
      gameType: "botc",
      viewer: {
        playerId: "p1",
        isHost: true,
        isGameModerator: false,
      },
      gameModerator: { mode: "human", playerId: "p2" },
      gameStarted: false,
      players: [
        { id: "p2", name: "Bob", seat: 2, isHost: false, ready: true },
        { id: "p1", name: "Alice", seat: 1, isHost: true, ready: false },
        { id: "p3", name: "Carol", seat: 3, isHost: false, ready: false },
      ],
    });

    expect(model).toMatchObject({
      roomCode: "1234",
      gameType: "botc",
      currentPlayerId: "p1",
      ownerId: "p1",
      moderatorAssignment: { mode: "human", playerId: "p2" },
      moderatorName: "Bob",
      isOwner: true,
      isGameModerator: false,
      canControlGame: false,
      currentPlayerReady: false,
      canInvite: true,
      canStartGame: false,
      canToggleReady: true,
      canManageRoom: true,
    });
    expect(model.participants.map(player => player.id)).toEqual(["p1", "p2", "p3"]);
    expect(model.playerOrder).toEqual(["p1", "p3"]);
  });

  it("gives the human Storyteller game-control authority without Room Owner authority", () => {
    const model = createClientLobbyPresentation({
      roomId: "5678",
      gameType: "botc",
      viewer: {
        playerId: "p2",
        isHost: false,
        isGameModerator: true,
      },
      gameModerator: { mode: "human", playerId: "p2" },
      gameStarted: false,
      players: [
        { id: "p1", name: "Alice", seat: 1, isHost: true, ready: true },
        { id: "p2", name: "Bob", seat: 2, isHost: false, ready: false },
      ],
    });

    expect(model).toMatchObject({
      isOwner: false,
      isGameModerator: true,
      canControlGame: true,
      canInvite: false,
      canStartGame: true,
      canToggleReady: false,
      canManageRoom: false,
    });
  });
});
