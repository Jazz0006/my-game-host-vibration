import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LEGACY_SOCKET_IO_SURFACE } from "../src/protocol/client/LegacySocketIoSurface.js";

function source(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

describe("E2.3 legacy confirm-role handler contraction", () => {
  it("removes the raw Node handler and inventory entry", () => {
    const server = source("src/server.ts");

    expect(server).not.toContain('socket.on("player:confirm-role"');
    expect(
      LEGACY_SOCKET_IO_SURFACE.some(entry => entry.event === "player:confirm-role"),
    ).toBe(false);
  });

  it("keeps the Web compatibility bridge pointed at the stable command", () => {
    const bridge = source("public/webClientProtocol.js");
    const transport = source("src/runtime/node/SocketIoClientProtocolTransport.ts");

    expect(bridge).toContain('"player:confirm-role": "werewolf.confirmRole"');
    expect(transport).toContain('socket.on("client:command"');
  });
});
