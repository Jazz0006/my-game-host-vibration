import { describe, expect, it } from "vitest";
import type { GameType } from "../../src/games/GameCatalog.js";
import type { ClientRoomProjection } from "../../src/protocol/client/ClientRoomProjection.js";
import { InMemoryCloudflareMultiplayerHarness } from "../../dev/InMemoryCloudflareMultiplayerHarness.js";
import {
  TestRoomClient,
  type TestRoomClientTraceEntry,
} from "../../dev/TestRoomClient.js";

type LobbyView = {
  phase: string;
  mode?: string;
};

type JoinedClient = {
  client: TestRoomClient<LobbyView>;
  playerId: string;
};

const TOTAL_CLIENTS = 10;
const INITIAL_ONLINE_CLIENTS = 4;
const FINAL_REVISION = TOTAL_CLIENTS - 1;

function createClient(
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

function membership(projection: ClientRoomProjection | null) {
  if (!projection) throw new Error("missing room projection");
  return projection.players.map(player => ({
    id: player.id,
    name: player.name,
    seat: player.seat,
    isHost: player.isHost,
  }));
}

function roomRevisions(trace: TestRoomClientTraceEntry[]): number[] {
  return trace
    .filter(entry => entry.event === "room-state")
    .map(entry => entry.revision)
    .filter((revision): revision is number => typeof revision === "number");
}

function expectMonotonic(revisions: number[]): void {
  for (let index = 1; index < revisions.length; index += 1) {
    expect(revisions[index]).toBeGreaterThanOrEqual(revisions[index - 1]!);
  }
}

describe.each(["werewolf", "botc"] satisfies GameType[])(
  "T2 multiplayer convergence baseline — %s",
  gameType => {
    it("converges 10 clients after rapid joins without sleep-based coordination", async () => {
      const runtime = new InMemoryCloudflareMultiplayerHarness();
      const host = createClient(runtime, `${gameType}-host`, gameType);
      const created = await host.createRoom("Player 1");
      await host.connect();

      const joined: JoinedClient[] = [{
        client: host,
        playerId: created.playerId,
      }];

      // Keep four clients online before the rapid-join wave so T2 verifies
      // authoritative fan-out to already-connected viewers, not only fresh sync.
      for (let number = 2; number <= INITIAL_ONLINE_CLIENTS; number += 1) {
        const roomClient = createClient(
          runtime,
          `${gameType}-player-${number}`,
          gameType,
        );
        const credentials = await roomClient.joinRoom(
          created.roomId,
          `Player ${number}`,
        );
        await roomClient.connect();
        joined.push({ client: roomClient, playerId: credentials.playerId });
      }

      await Promise.all(
        joined.map(item => item.client.waitForRevision(INITIAL_ONLINE_CLIENTS - 1)),
      );

      const rapidClients = Array.from(
        { length: TOTAL_CLIENTS - INITIAL_ONLINE_CLIENTS },
        (_, index) => {
          const number = INITIAL_ONLINE_CLIENTS + index + 1;
          return {
            number,
            client: createClient(
              runtime,
              `${gameType}-player-${number}`,
              gameType,
            ),
          };
        },
      );

      const rapidCredentials = await Promise.all(
        rapidClients.map(({ client, number }) =>
          client.joinRoom(created.roomId, `Player ${number}`)
        ),
      );

      // The initial online clients must receive the rapid join fan-out before
      // the newly joined clients even establish their own realtime sessions.
      await Promise.all(
        joined.map(item => item.client.waitForRevision(FINAL_REVISION)),
      );

      for (const item of joined) {
        expect(item.client.getRoomRevision()).toBe(FINAL_REVISION);
        expect(item.client.getRoomProjection()?.players).toHaveLength(TOTAL_CLIENTS);
      }

      await Promise.all(rapidClients.map(({ client }) => client.connect()));
      rapidClients.forEach(({ client }, index) => {
        joined.push({
          client,
          playerId: rapidCredentials[index]!.playerId,
        });
      });

      await Promise.all(
        joined.map(item => item.client.waitForRevision(FINAL_REVISION)),
      );

      const expectedMembership = membership(host.getRoomProjection());
      expect(expectedMembership).toHaveLength(TOTAL_CLIENTS);
      expect(new Set(expectedMembership.map(player => player.id)).size)
        .toBe(TOTAL_CLIENTS);
      expect(new Set(expectedMembership.map(player => player.seat)).size)
        .toBe(TOTAL_CLIENTS);
      expect(expectedMembership.map(player => player.seat).sort((a, b) => a - b))
        .toEqual(Array.from({ length: TOTAL_CLIENTS }, (_, index) => index + 1));

      const viewerIds = new Set<string>();
      for (const item of joined) {
        const projection = item.client.getRoomProjection();
        expect(item.client.getConnectionState().status).toBe("Connected");
        expect(item.client.getRoomRevision()).toBe(FINAL_REVISION);
        expect(item.client.getPlayerView()).toMatchObject({ phase: "lobby" });
        expect(projection?.gameType).toBe(gameType);
        expect(projection?.viewer.playerId).toBe(item.playerId);
        expect(membership(projection)).toEqual(expectedMembership);
        viewerIds.add(projection!.viewer.playerId);

        const revisions = roomRevisions(item.client.captureTrace());
        expect(revisions.at(-1)).toBe(FINAL_REVISION);
        expectMonotonic(revisions);
      }

      expect(viewerIds.size).toBe(TOTAL_CLIENTS);

      for (const item of joined) item.client.disconnect();
    });
  },
);
