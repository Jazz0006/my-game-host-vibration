import { afterEach, describe, expect, it, vi } from "vitest";
import { InMemoryCloudflareMultiplayerHarness } from "../../dev/InMemoryCloudflareMultiplayerHarness.js";
import { TestRoomClient } from "../../dev/TestRoomClient.js";
import type { BotcPlayerView } from "../../src/games/botc/BotcGameModule.js";
import type { BotcClientRoomProjection } from "../../src/protocol/client/BotcRoomClientProjection.js";
import { CloudflareRandomProvider } from "../../src/runtime/cloudflare/CloudflareRandomProvider.js";

describe("PV4-S4 production-protocol playable acceptance", () => {
  const clients: TestRoomClient<BotcPlayerView>[] = [];
  afterEach(() => { vi.restoreAllMocks(); for (const client of clients) client.disconnect(); clients.length = 0; });

  it("converges through a whole playable trace with reconnect, same-command retry, stale interaction, private information, concurrent votes and victory", async () => {
    const runtime = new InMemoryCloudflareMultiplayerHarness();
    const device = (label: string) => new TestRoomClient<BotcPlayerView>({ label, gameType: "botc",
      baseUrl: runtime.baseUrl, fetch: runtime.fetch, webSocketFactory: runtime.webSocketFactory });
    const owner = device("owner");
    clients.push(owner);
    const created = await owner.createRoom("Owner");
    await owner.connect();
    for (let index = 2; index <= 5; index += 1) {
      const client = device(`player-${index}`);
      clients.push(client);
      await client.joinRoom(created.roomId, `Player ${index}`);
      await client.connect();
    }
    const room = (client = owner) => client.getRoomProjection() as BotcClientRoomProjection;
    const id = (client: TestRoomClient<BotcPlayerView>) => room(client).viewer.playerId;
    const converge = async () => {
      const revision = Math.max(...clients.map(client => client.getRoomRevision() ?? 0));
      await Promise.all(clients.map(client => client.waitForRevision(revision)));
      for (const client of clients) {
        expect(room(client).game).toEqual(room().game);
        expect(JSON.stringify(room(client))).not.toMatch(/"(assignments|history|poisonedPlayerId|selectedResolution)"/);
      }
    };
    let sequence = 0;
    const send = async (client: TestRoomClient<BotcPlayerView>, type: string, payload = {}) => {
      const result = await client.sendCommand(type, payload, `s4-${++sequence}`);
      await converge();
      return result;
    };
    // Select a reproducible legal roster through the real setup owner. IDs and credentials stay real.
    const draw = vi.spyOn(CloudflareRandomProvider.prototype, "randomInt").mockReturnValue(0);
    await send(owner, "botc.startGame");
    draw.mockRestore();
    expect(clients.map(client => client.getPlayerView()!.roleId).sort())
      .toEqual(["imp", "investigator", "librarian", "poisoner", "washerwoman"]);
    await Promise.all(clients.map(client => client.sendCommand("botc.confirmRole", {}, `confirm-${id(client)}`)));
    await converge();
    const started = await send(owner, "botc.beginFirstNight");
    expect(started).not.toHaveProperty("outcome.firstStepId");
    const poisoner = clients.find(client => client.getPlayerView()!.roleId === "poisoner")!;
    const imp = clients.find(client => client.getPlayerView()!.roleId === "imp")!;
    const choiceResult = await send(poisoner, "botc.submitNightChoice", { playerIds: [id(poisoner)] });
    expect(choiceResult).not.toHaveProperty("outcome.nextStepId");
    const reader = clients.find(client => client.getPlayerView()!.privateInformation)!;
    const content = structuredClone(reader.getPlayerView()!.privateInformation);
    const oldActionId = reader.getPlayerView()!.actionId!;
    for (const client of clients.filter(client => client !== reader)) {
      expect(client.getPlayerView()!.privateInformation).toBeUndefined();
    }
    const credentials = reader.getReconnectCredentials();
    const index = clients.indexOf(reader);
    reader.disconnect();
    const resumed = device("resumed-reader");
    resumed.resume(credentials);
    await resumed.connect();
    clients[index] = resumed;
    await converge();
    expect(resumed.getPlayerView()!.privateInformation).toEqual(content);
    expect(resumed.getPlayerView()!.actionId).toBe(oldActionId);
    const ackPayload = { actionId: oldActionId };
    const acknowledged = await resumed.sendCommand("botc.acknowledgeNightInformation", ackPayload, "s4-ack-retry");
    const replay = await resumed.sendCommand("botc.acknowledgeNightInformation", ackPayload, "s4-ack-retry");
    expect(acknowledged).toMatchObject({ replayed: false });
    expect(replay).toMatchObject({ replayed: true });
    await converge();
    await expect(resumed.sendCommand("botc.acknowledgeNightInformation", ackPayload, "s4-stale-ack"))
      .rejects.toThrow("Stale BotC interaction");
    for (let step = 0; room().game!.phase === "first_night"; step += 1) {
      expect(step).toBeLessThan(10);
      const recipient = clients.find(client => client.getPlayerView()!.privateInformation)!;
      expect(recipient).toBeDefined();
      await send(recipient, "botc.acknowledgeNightInformation");
    }
    expect(room().game).toMatchObject({ phase: "day", dayNumber: 1 });
    await send(owner, "botc.closeDay");
    await send(owner, "botc.beginOtherNight");
    await send(poisoner, "botc.submitNightChoice", { playerIds: [id(poisoner)] });
    const victim = clients.find(client => client.getPlayerView()!.roleId === "washerwoman")!;
    await send(imp, "botc.submitNightChoice", { playerIds: [id(victim)] });
    expect(room().game).toMatchObject({ phase: "day", dayNumber: 2, deadPlayerIds: [id(victim)] });
    expect(victim.getPlayerView()!.canNominate).toBe(false);
    const nominator = clients.find(client => client !== victim && client !== imp)!;
    await send(nominator, "botc.nominate", { playerId: id(imp) });
    await Promise.all(clients.map(client => client.sendCommand("botc.vote", { approve: true }, `vote-${id(client)}`)));
    await converge();
    expect(room().game!.day!.ballot!.submittedCount).toBe(5);
    await send(owner, "botc.finishVote");
    expect(room().game!.ghostVoteSpentPlayerIds).toEqual([id(victim)]);
    await send(owner, "botc.closeDay");
    for (const client of clients) {
      expect(room(client).game).toMatchObject({ phase: "finished", winner: { team: "good", reason: "demon_dead" },
        day: { executionPlayerId: id(imp), executionDied: true } });
    }
  });
});
