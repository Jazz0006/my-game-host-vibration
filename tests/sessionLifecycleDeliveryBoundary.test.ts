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

describe("E2.3d3 session lifecycle delivery boundary", () => {
  it("keeps session replacement on the stable client:event delivery path", () => {
    const delivery = source("src/runtime/node/SocketIoClientSessionEventDelivery.ts");
    const server = source("src/server.ts");

    expect(delivery).toContain('socket.emit("client:event", createClientSessionReplacedEvent(payload))');
    expect(server).toContain("emitClientSessionReplaced(previousSocket, replacement)");
  });

  it("keeps the Web UI behind the semantic browser session event adapter", () => {
    const webSession = source("src/client/browser/WebClientSession.ts");
    const adapter = source("src/client/browser/BrowserSessionEvents.ts");
    const web = source("public/app.js");

    expect(webSession).toContain('export { attachBrowserSessionReplaced } from "./BrowserSessionEvents.js"');
    expect(adapter).toContain("CLIENT_SESSION_REPLACED");
    expect(adapter).toContain("session.subscribeRealtimeEvents");
    expect(web).toContain("attachBrowserSessionReplaced");
    expect(web).not.toContain('socket.on("session:replaced"');
  });

  it("removes the retired raw session replacement event from server and inventory", () => {
    const server = source("src/server.ts");
    const inventory = source("src/protocol/client/LegacySocketIoSurface.ts");

    expect(server).not.toContain('emit("session:replaced"');
    expect(inventory).not.toContain('event: "session:replaced"');
  });
});
