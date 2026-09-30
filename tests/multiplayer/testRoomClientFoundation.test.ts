import { describe, expect, it } from "vitest";
import type { GameType } from "../../src/games/GameCatalog.js";
import { InMemoryCloudflareMultiplayerHarness } from "../../dev/InMemoryCloudflareMultiplayerHarness.js";
import { TestRoomClient } from "../../dev/TestRoomClient.js";

type LobbyView = {
  phase: string;
  mode?: string;
};

function client(
  runtime: InMemoryCloudflareMultiplayerHarness,
  label: string,
  gameType: GameType,
): TestRoomClient<LobbyView> {
  return new TestRoomClient<LobbyView>({
    label,
    gameType,
    baseUrl: runtime.baseUrl,
    fetch: runtime.fetch,
    webSocketFactory: runtime.webSocketFactory,
  });
}

describe("T1 TestRoomClient foundation", () => {
  it("creates host + two players, converges through real client/runtime seams, sends a command, and resumes identity", async () => {
    const runtime = new InMemoryCloudflareMultiplayerHarness();
    const host = client(runtime, "host", "werewolf");
    const playerOne = client(runtime, "player-1", "werewolf");
    const playerTwo = client(runtime, "player-2", "werewolf");

    const hostBootstrap = await host.createRoom("Host");
    await host.connect();

    const playerOneBootstrap = await playerOne.joinRoom(hostBootstrap.roomId, "Player 1");
    await playerOne.connect();

    const playerTwoBootstrap = await playerTwo.joinRoom(hostBootstrap.roomId, "Player 2");
    await playerTwo.connect();

    await Promise.all([
      host.waitForRevision(2),
      playerOne.waitForRevision(2),
      playerTwo.waitForRevision(2),
    ]);

    for (const [roomClient, playerId] of [
      [host, hostBootstrap.playerId],
      [playerOne, playerOneBootstrap.playerId],
      [playerTwo, playerTwoBootstrap.playerId],
    ] as const) {
      expect(roomClient.getConnectionState().status).toBe("Connected");
      expect(roomClient.getPlayerView()).toMatchObject({ phase: "lobby" });
      expect(roomClient.getRoomProjection()).toMatchObject({
        roomId: hostBootstrap.roomId,
        gameType: "werewolf",
        viewer: { playerId },
        players: [
          { name: "Host", seat: 1 },
          { name: "Player 1", seat: 2 },
          { name: "Player 2", seat: 3 },
        ],
      });
    }

    await host.sendCommand(
      "room.updateName",
      { name: "Host Renamed" },
      "t1-rename-host",
    );

    await Promise.all([
      host.waitForRevision(3),
      playerOne.waitForRevision(3),
      playerTwo.waitForRevision(3),
    ]);
    expect(playerTwo.getRoomProjection()?.players[0]?.name).toBe("Host Renamed");

    const persisted = playerOne.getReconnectCredentials();
    playerOne.disconnect();

    const resumed = client(runtime, "player-1-resumed", "werewolf");
    resumed.resume(persisted);
    await resumed.connect();
    await resumed.waitForRevision(3);

    expect(resumed.getReconnectCredentials().playerId).toBe(playerOneBootstrap.playerId);
    expect(resumed.getRoomProjection()).toMatchObject({
      viewer: { playerId: playerOneBootstrap.playerId },
      players: [
        { name: "Host Renamed" },
        { name: "Player 1" },
        { name: "Player 2" },
      ],
    });
    expect(resumed.getRoomProjection()?.players).toHaveLength(3);

    expect(host.captureTrace()).toContainEqual(expect.objectContaining({
      client: "host",
      event: "command",
      detail: "room.updateName:t1-rename-host",
    }));
    expect(resumed.captureTrace()).toEqual(expect.arrayContaining([
      expect.objectContaining({ event: "bootstrap", detail: "resume" }),
      expect.objectContaining({ event: "connection", detail: "Connected" }),
      expect.objectContaining({ event: "room-state", revision: 3 }),
    ]));

    host.disconnect();
    playerTwo.disconnect();
    resumed.disconnect();
  });

  it("uses the same multiplayer harness for a BotC lobby without game-rule helpers", async () => {
    const runtime = new InMemoryCloudflareMultiplayerHarness();
    const host = client(runtime, "botc-host", "botc");
    const player = client(runtime, "botc-player", "botc");

    const created = await host.createRoom("Storyteller");
    await host.connect();

    const joined = await player.joinRoom(created.roomId, "Player");
    await player.connect();

    await Promise.all([
      host.waitForRevision(1),
      player.waitForRevision(1),
    ]);

    expect(host.getPlayerView()).toMatchObject({ phase: "lobby" });
    expect(player.getPlayerView()).toMatchObject({ phase: "lobby" });
    expect(host.getRoomProjection()).toMatchObject({
      gameType: "botc",
      viewer: { playerId: created.playerId },
      players: [
        { id: created.playerId, name: "Storyteller", seat: 1 },
        { id: joined.playerId, name: "Player", seat: 2 },
      ],
    });
    expect(player.getRoomProjection()).toMatchObject({
      gameType: "botc",
      viewer: { playerId: joined.playerId },
    });

    host.disconnect();
    player.disconnect();
  });
});
