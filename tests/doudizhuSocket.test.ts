import type { AddressInfo } from "node:net";
import { io as createClient, type Socket as ClientSocket } from "socket.io-client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createGameEngineRegistry } from "../src/games/registry.js";
import { GAME_METADATA } from "../src/games/shared/metadata.js";
import type {
  DouDizhuGameState,
  DouDizhuPlayerView,
} from "../src/games/doudizhu/state.js";
import { createGameServer } from "../src/server.js";

const TIMEOUT_MS = 3000;

type Session = {
  ok: true;
  roomId: string;
  playerId: string;
  resumeToken: string;
  gameKind: "doudizhu";
};

type CommandAck =
  | { ok: true; changed: boolean; revision: number; actionId: string }
  | { ok: false; message: string };

function waitFor<T>(
  socket: ClientSocket,
  event: string,
  predicate: (payload: T) => boolean = () => true,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, handler);
      reject(new Error(`Timed out waiting for ${event}`));
    }, TIMEOUT_MS);
    const handler = (payload: T) => {
      if (!predicate(payload)) return;
      clearTimeout(timer);
      socket.off(event, handler);
      resolve(payload);
    };
    socket.on(event, handler);
  });
}

function emitAck<T>(socket: ClientSocket, event: string, payload: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    socket.timeout(TIMEOUT_MS).emit(event, payload, (error: Error | null, result: T) => {
      if (error) reject(error);
      else resolve(result);
    });
  });
}

describe("three-player doudizhu Socket.IO flow", () => {
  let game: ReturnType<typeof createGameServer>;
  let baseUrl: string;
  let clients: ClientSocket[];

  beforeEach(async () => {
    const testMetadata = GAME_METADATA.map(metadata =>
      metadata.kind === "doudizhu"
        ? { ...metadata, availability: "available" as const }
        : metadata
    );
    game = createGameServer({ gameRegistry: createGameEngineRegistry(testMetadata) });
    await new Promise<void>(resolve => game.httpServer.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${(game.httpServer.address() as AddressInfo).port}`;
    clients = [];
  });

  afterEach(async () => {
    for (const client of clients) client.disconnect();
    await new Promise<void>(resolve => game.io.close(() => resolve()));
  });

  async function connect(): Promise<ClientSocket> {
    const socket = createClient(baseUrl, {
      forceNew: true,
      reconnection: false,
      transports: ["websocket"],
    });
    clients.push(socket);
    if (!socket.connected) await waitFor(socket, "connect");
    return socket;
  }

  it("keeps hands private, ignores forged identities, resumes securely, and settles a game", async () => {
    const sockets = await Promise.all([connect(), connect(), connect()]);
    const hostSession = await emitAck<Session>(sockets[0]!, "host:create-room", {
      name: "房主",
      gameKind: "doudizhu",
    });
    const sessions = [hostSession];
    for (let index = 1; index < sockets.length; index += 1) {
      sessions.push(await emitAck<Session>(sockets[index]!, "player:join-room", {
        roomId: hostSession.roomId,
        name: `玩家${index + 1}`,
      }));
    }

    const biddingViews = sockets.map(socket =>
      waitFor<DouDizhuPlayerView>(socket, "player:game-state", view => view.phase === "bidding")
    );
    const publicBidding = waitFor<Record<string, unknown>>(
      sockets[0]!,
      "room:state",
      state => JSON.stringify(state).includes('"phase":"bidding"'),
    );
    expect(await emitAck<{ ok: boolean }>(sockets[0]!, "host:start-game", {})).toEqual({ ok: true });
    const dealt = await Promise.all(biddingViews);
    const publicState = await publicBidding;

    expect(dealt.map(view => view.hand.length)).toEqual([17, 17, 17]);
    expect(new Set(dealt.flatMap(view => view.hand))).toHaveLength(51);
    expect(dealt.every(view => view.bottomCards.length === 0)).toBe(true);
    for (let viewerIndex = 0; viewerIndex < dealt.length; viewerIndex += 1) {
      const serialized = JSON.stringify(dealt[viewerIndex]);
      for (let otherIndex = 0; otherIndex < dealt.length; otherIndex += 1) {
        if (viewerIndex === otherIndex) continue;
        expect(serialized).not.toContain(`"${dealt[otherIndex]!.hand[0]}"`);
      }
    }
    for (const view of dealt) {
      expect(JSON.stringify(publicState)).not.toContain(`"${view.hand[0]}"`);
    }

    const bidderId = dealt[0]!.currentPlayerId;
    const bidderIndex = sessions.findIndex(session => session.playerId === bidderId);
    const playingViews = sockets.map(socket =>
      waitFor<DouDizhuPlayerView>(socket, "player:game-state", view => view.phase === "playing")
    );
    const bidAck = await emitAck<CommandAck>(sockets[bidderIndex]!, "game:command", {
      type: "bid",
      bid: 3,
      requestId: "socket-bid-three",
      actionId: dealt[bidderIndex]!.actionId,
      stateRevision: dealt[bidderIndex]!.revision,
      actorPlayerId: sessions[(bidderIndex + 1) % 3]!.playerId,
    });
    expect(bidAck).toMatchObject({ ok: true, changed: true, revision: 1 });
    expect(Object.keys(bidAck).sort()).toEqual(["actionId", "changed", "ok", "revision"]);
    const playing = await Promise.all(playingViews);
    expect(playing[bidderIndex]!.hand).toHaveLength(20);
    expect(playing.filter((_, index) => index !== bidderIndex).map(view => view.hand.length)).toEqual([17, 17]);
    expect(playing.every(view => view.bottomCards.length === 3)).toBe(true);

    const otherIndex = (bidderIndex + 1) % 3;
    const forgedCard = playing[otherIndex]!.hand[0]!;
    const forged = await emitAck<CommandAck>(sockets[bidderIndex]!, "game:command", {
      type: "play_cards",
      cardIds: [forgedCard],
      requestId: "forged-player-id",
      actionId: playing[bidderIndex]!.actionId,
      stateRevision: playing[bidderIndex]!.revision,
      actorPlayerId: sessions[otherIndex]!.playerId,
    });
    expect(forged).toMatchObject({ ok: false });

    const resumeIndex = (bidderIndex + 1) % 3;
    const beforeResume = playing[resumeIndex]!;
    sockets[resumeIndex]!.disconnect();
    const replacement = await connect();
    const resumedViewPromise = waitFor<DouDizhuPlayerView>(
      replacement,
      "player:game-state",
      view => view.phase === "playing",
    );
    expect(await emitAck<{ ok: boolean }>(replacement, "player:resume", {
      roomId: hostSession.roomId,
      playerId: sessions[resumeIndex]!.playerId,
      resumeToken: sessions[resumeIndex]!.resumeToken,
    })).toMatchObject({ ok: true });
    const resumedView = await resumedViewPromise;
    expect(resumedView.hand).toEqual(beforeResume.hand);
    expect(resumedView).toMatchObject({
      actionId: beforeResume.actionId,
      revision: beforeResume.revision,
      currentPlayerId: beforeResume.currentPlayerId,
    });
    sockets[resumeIndex] = replacement;

    const room = game.rooms.get(hostSession.roomId)!;
    const internalState = room.game!.state as DouDizhuGameState;
    const winningCard = internalState.hands[bidderId]![0]!;
    internalState.hands[bidderId] = [winningCard];
    internalState.currentPlayerId = bidderId;
    internalState.trickLeaderPlayerId = bidderId;
    delete internalState.currentCombination;
    internalState.consecutivePasses = 0;

    const finalViews = sockets.map(socket =>
      waitFor<DouDizhuPlayerView>(socket, "player:game-state", view => view.phase === "game_over")
    );
    const gameOverEvent = waitFor<{ type: string }>(
      sockets[0]!,
      "game:event",
      event => event.type === "doudizhu:game-over",
    );
    const winningAck = await emitAck<CommandAck>(sockets[bidderIndex]!, "game:command", {
      type: "play_cards",
      cardIds: [winningCard],
      requestId: "socket-winning-play",
      actionId: internalState.actionId,
      stateRevision: internalState.revision,
    });
    expect(winningAck).toMatchObject({ ok: true, changed: true, revision: 2 });
    expect((await gameOverEvent).type).toBe("doudizhu:game-over");
    const finished = await Promise.all(finalViews);
    expect(finished.every(view => view.winner === "landlord" && view.result)).toBe(true);

    const restartedViews = sockets.map(socket =>
      waitFor<DouDizhuPlayerView>(socket, "player:game-state", view => view.phase === "bidding")
    );
    expect(await emitAck<{ ok: boolean }>(sockets[0]!, "host:restart-game", {})).toEqual({
      ok: true,
    });
    const restarted = await Promise.all(restartedViews);
    expect(restarted.map(view => view.hand.length)).toEqual([17, 17, 17]);
    expect(restarted.every(view => view.revision === 0 && view.bottomCards.length === 0)).toBe(true);
  });
});
