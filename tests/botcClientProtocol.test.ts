import { describe, expect, it } from "vitest";
import { createClientCommandEnvelope } from "../src/protocol/client/ClientProtocol.js";
import {
  isBotcClientCommand,
  parseBotcClientCommandEnvelope,
} from "../src/protocol/client/BotcClientProtocol.js";

describe("PV-1/PV-2 BotC client protocol", () => {
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

  it("rejects malformed or non-BotC command envelopes", () => {
    expect(() => parseBotcClientCommandEnvelope({
      protocolVersion: 1,
      kind: "command",
      commandId: "bad-payload",
      type: "botc.startGame",
      payload: [],
    })).toThrow("command payload must be an object");

    expect(isBotcClientCommand({
      type: "werewolf.startGame",
    })).toBe(false);
  });
});
