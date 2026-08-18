import { describe, expect, it } from "vitest";
import {
  parseCommandEnvelope,
  requireCommandId,
} from "../src/core/command/CommandEnvelope.js";

describe("C3 command envelope", () => {
  it("normalizes a transport commandId without leaking it into the game command", () => {
    const envelope = parseCommandEnvelope(
      {
        commandId: "  cmd-123  ",
        command: { type: "confirmRole", actionId: "action-1" },
      },
      value => value as { type: string; actionId: string },
    );

    expect(envelope).toEqual({
      commandId: "cmd-123",
      command: { type: "confirmRole", actionId: "action-1" },
    });
    expect(envelope.command).not.toHaveProperty("commandId");
  });

  it("rejects missing or blank command ids at the transport boundary", () => {
    expect(() => requireCommandId(undefined)).toThrow(/commandId/);
    expect(() => requireCommandId("   ")).toThrow(/commandId/);
    expect(() => parseCommandEnvelope({ command: {} }, value => value)).toThrow(/commandId/);
  });

  it("rejects a missing command envelope before game parsing", () => {
    expect(() => parseCommandEnvelope(undefined, value => value)).toThrow(/envelope/);
  });
});
