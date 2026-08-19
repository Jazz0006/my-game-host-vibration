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

describe("E2.3d3a session lifecycle Web consumer boundary", () => {
  it("delivers session replacement through the stable client:event envelope", () => {
    const delivery = source("src/runtime/node/SocketIoClientSessionEventDelivery.ts");
    const server = source("src/server.ts");

    expect(delivery).toContain('socket.emit("client:event", createClientSessionReplacedEvent(payload))');
    expect(server).toContain("emitClientSessionReplaced(previousSocket, replacement)");
  });

  it("routes the production Web consumer through ClientSession realtime events", () => {
    const web = source("public/app.js");
    const composition = source("src/client/browser/WebClientSession.ts");

    expect(composition).toContain('export { CLIENT_SESSION_REPLACED }');
    expect(web).toContain("session.subscribeRealtimeEvents");
    expect(web).toContain("handleSessionReplaced(session, event, CLIENT_SESSION_REPLACED)");
    expect(web).not.toContain('socket.on("session:replaced"');
  });

  it("keeps the server legacy emit only until the dedicated removal step", () => {
    const server = source("src/server.ts");
    expect(server).toContain('previousSocket.emit("session:replaced", replacement)');
  });
});
