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

describe("E2.3d2 session lifecycle delivery boundary", () => {
  it("delivers session replacement through the stable client:event envelope", () => {
    const delivery = source("src/runtime/node/SocketIoClientSessionEventDelivery.ts");
    const server = source("src/server.ts");

    expect(delivery).toContain('socket.emit("client:event", createClientSessionReplacedEvent(payload))');
    expect(server).toContain("emitClientSessionReplaced(previousSocket, replacement)");
  });

  it("keeps the legacy replacement event only during the consumer migration window", () => {
    const server = source("src/server.ts");
    const web = source("public/app.js");

    expect(server).toContain('previousSocket.emit("session:replaced", replacement)');
    expect(web).toContain('socket.on("session:replaced"');
  });
});
