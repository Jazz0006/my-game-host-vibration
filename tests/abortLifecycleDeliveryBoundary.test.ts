import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.join(__dirname, "..");

function source(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

describe("E2.3f1 abort recovery delivery boundary", () => {
  it("uses authoritative state as the abort-to-lobby recovery result", () => {
    const timedServer = source("src/timedServer.ts");
    const webRecovery = source("public/recoveryStatus.js");

    expect(timedServer).toContain("clearRoomInteractionTimeout(room)");
    expect(timedServer).toContain("delivery.broadcastRoom(room)");
    expect(timedServer).not.toContain('emit("game:aborted-to-lobby"');
    expect(webRecovery).not.toContain('socket.on("game:aborted-to-lobby"');
  });

  it("keeps recovery commands while retired server events stay out of the inventory", () => {
    const inventory = source("src/protocol/client/LegacySocketIoSurface.ts");

    expect(inventory).not.toContain('event: "game:aborted-to-lobby"');
    expect(inventory).toContain('event: "host:abort-to-lobby"');
    expect(inventory).not.toContain('event: "player:interaction-timeout-state"');
    expect(inventory).not.toContain('event: "player:interaction-timeout-error"');
  });
});