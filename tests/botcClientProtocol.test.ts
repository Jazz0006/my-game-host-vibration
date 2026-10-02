import { describe, expect, it } from "vitest";
import { createClientCommandEnvelope } from "../src/protocol/client/ClientProtocol.js";
import {
  isBotcClientCommand,
  parseBotcClientCommandEnvelope,
} from "../src/protocol/client/BotcClientProtocol.js";

describe("PV-1/PV-2/PV-3 BotC client protocol", () => {
  it("accepts one stable start-game semantic command", () => {
    const envelope = createClientCommandEnvelope(
      "botc.startGame",
      {},
      "botc-start-1",
    );

    expect(isBotcClientCommand(envelope)).toBe(true);
    expect(parseBotcClientCommandEnvelope(envelope)).toEqual({
      protocolVersion: 1,
      kind: "command",
      commandId: "botc-start-1",
      type: "botc.startGame",
      payload: {},
    });
  });

  it("accepts the stable per-player role-confirmation command", () => {
    const envelope = createClientCommandEnvelope(
      "botc.confirmRole",
      {},
      "botc-confirm-1",
    );

    expect(isBotcClientCommand(envelope)).toBe(true);
    expect(parseBotcClientCommandEnvelope(envelope)).toEqual({
      protocolVersion: 1,
      kind: "command",
      commandId: "botc-confirm-1",
      type: "botc.confirmRole",
      payload: {},
    });
  });

  it.each([
    "botc.beginFirstNight",
    "botc.beginOtherNight",
    "botc.commitNightInformation",
    "botc.completeNightStep",
  ] as const)("accepts moderator night-orchestration command %s", type => {
    const envelope = createClientCommandEnvelope(
      type,
      {},
      `night-${type}`,
    );

    expect(isBotcClientCommand(envelope)).toBe(true);
    expect(parseBotcClientCommandEnvelope(envelope)).toEqual({
      protocolVersion: 1,
      kind: "command",
      commandId: `night-${type}`,
      type,
      payload: {},
    });
  });

  it("accepts a stable player information-acknowledgement command", () => {
    const envelope = createClientCommandEnvelope(
      "botc.acknowledgeNightInformation",
      {},
      "night-info-ack-1",
    );

    expect(isBotcClientCommand(envelope)).toBe(true);
    expect(parseBotcClientCommandEnvelope(envelope)).toEqual({
      protocolVersion: 1,
      kind: "command",
      commandId: "night-info-ack-1",
      type: "botc.acknowledgeNightInformation",
      payload: {},
    });
  });

  it("accepts stable day nomination and voting commands", () => {
    expect(parseBotcClientCommandEnvelope(
      createClientCommandEnvelope(
        "botc.nominate",
        { nomineePlayerId: " p3 " },
        "nominate-1",
      ),
    )).toEqual({
      protocolVersion: 1,
      kind: "command",
      commandId: "nominate-1",
      type: "botc.nominate",
      payload: { nomineePlayerId: "p3" },
    });

    expect(parseBotcClientCommandEnvelope(
      createClientCommandEnvelope(
        "botc.submitDayVote",
        { vote: true },
        "day-vote-1",
      ),
    )).toEqual({
      protocolVersion: 1,
      kind: "command",
      commandId: "day-vote-1",
      type: "botc.submitDayVote",
      payload: { vote: true },
    });

    expect(parseBotcClientCommandEnvelope(
      createClientCommandEnvelope(
        "botc.closeNomination",
        {},
        "close-nomination-1",
      ),
    )).toEqual({
      protocolVersion: 1,
      kind: "command",
      commandId: "close-nomination-1",
      type: "botc.closeNomination",
      payload: {},
    });
  });

  it("accepts the moderator Red Herring setup command", () => {
    const envelope = createClientCommandEnvelope(
      "botc.setRedHerring",
      { playerId: " p3 " },
      "red-herring-1",
    );

    expect(isBotcClientCommand(envelope)).toBe(true);
    expect(parseBotcClientCommandEnvelope(envelope)).toEqual({
      protocolVersion: 1,
      kind: "command",
      commandId: "red-herring-1",
      type: "botc.setRedHerring",
      payload: { playerId: "p3" },
    });
  });

  it("accepts a stable player night-choice command", () => {
    const envelope = createClientCommandEnvelope(
      "botc.submitNightChoice",
      { playerIds: [" p2 ", "p3"] },
      "night-choice-1",
    );

    expect(isBotcClientCommand(envelope)).toBe(true);
    expect(parseBotcClientCommandEnvelope(envelope)).toEqual({
      protocolVersion: 1,
      kind: "command",
      commandId: "night-choice-1",
      type: "botc.submitNightChoice",
      payload: { playerIds: ["p2", "p3"] },
    });
  });

  it("rejects malformed or non-BotC command envelopes", () => {
    expect(() => parseBotcClientCommandEnvelope({
      protocolVersion: 1,
      kind: "command",
      commandId: "bad-payload",
      type: "botc.startGame",
      payload: [],
    })).toThrow("command payload must be an object");

    expect(() => parseBotcClientCommandEnvelope(
      createClientCommandEnvelope(
        "botc.submitNightChoice",
        { playerIds: "p2" },
        "bad-choice",
      ),
    )).toThrow("playerIds must be an array of non-empty strings");

    expect(() => parseBotcClientCommandEnvelope(
      createClientCommandEnvelope(
        "botc.setRedHerring",
        { playerId: "   " },
        "bad-red-herring",
      ),
    )).toThrow("playerId must be a non-empty string");

    expect(() => parseBotcClientCommandEnvelope(
      createClientCommandEnvelope(
        "botc.nominate",
        { nomineePlayerId: " " },
        "bad-nominee",
      ),
    )).toThrow("nomineePlayerId must be a non-empty string");

    expect(() => parseBotcClientCommandEnvelope(
      createClientCommandEnvelope(
        "botc.submitDayVote",
        { vote: "yes" },
        "bad-day-vote",
      ),
    )).toThrow("vote must be a boolean");

    expect(isBotcClientCommand({
      type: "werewolf.startGame",
    })).toBe(false);
  });
});
