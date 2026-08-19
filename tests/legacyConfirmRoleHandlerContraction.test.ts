import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LEGACY_SOCKET_IO_SURFACE } from "../src/protocol/client/LegacySocketIoSurface.js";

function source(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const retiredLegacyCommands = [
  ["player:confirm-role", "werewolf.confirmRole"],
  ["player:submit-seer-target", "werewolf.submitSeerTarget"],
  ["host:begin-night-start", "werewolf.beginNightStart"],
  ["host:close-voting", "werewolf.closeVoting"],
  ["host:start-night", "werewolf.startNight"],
] as const;

describe("E2.3 legacy game handler contraction", () => {
  it("keeps retired raw Node handlers out of the runtime inventory", () => {
    const server = source("src/server.ts");

    for (const [legacyEvent] of retiredLegacyCommands) {
      expect(server).not.toContain(`socket.on("${legacyEvent}"`);
      expect(
        LEGACY_SOCKET_IO_SURFACE.some(entry => entry.event === legacyEvent),
      ).toBe(false);
    }
  });

  it("keeps the Web compatibility bridge pointed at stable client commands", () => {
    const bridge = source("public/webClientProtocol.js");
    const transport = source("src/runtime/node/SocketIoClientProtocolTransport.ts");

    for (const [legacyEvent, stableType] of retiredLegacyCommands) {
      expect(bridge).toContain(`"${legacyEvent}": "${stableType}"`);
    }
    expect(transport).toContain('socket.on("client:command"');
  });
});
