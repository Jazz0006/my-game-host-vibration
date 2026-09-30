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

    expect(isBotcClientCommand({
      type: "werewolf.startGame",
    })).toBe(false);
  });
});
