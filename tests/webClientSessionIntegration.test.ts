import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();

function source(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

describe("E2.2 Web ClientSession direct integration", () => {
  it("makes app.js the explicit owner of the production ClientSession lifecycle", () => {
    const app = source("public/app.js");

    expect(app).toContain("const socket = io({ autoConnect: false })");
    expect(app).toContain('const CLIENT_RUNTIME_URL = "/client-runtime/client/browser/WebClientSession.js"');
    expect(app).toContain("import(CLIENT_RUNTIME_URL)");
    expect(app).toContain("createWebClientSession(socket)");
    expect(app).toContain("attachBrowserSessionLifecycle(session)");
    expect(app).toContain("session.subscribe(snapshot =>");
    expect(app).toContain("activateClientSession(result)");
    expect(app).toContain("session.reconnect()");

    // Legacy socket lifecycle and private PlayerView delivery must not compete
    // with the ClientSession state machine after the migration shim is removed.
    expect(app).not.toContain('socket.on("connect"');
    expect(app).not.toContain('socket.on("disconnect"');
    expect(app).not.toContain('socket.on("connect_error"');
    expect(app).not.toContain('socket.on("player:game-state", renderGameState)');
  });

  it("keeps room:state as room/UI compatibility data rather than connection authority", () => {
    const app = source("public/app.js");
    const start = app.indexOf('socket.on("room:state"');
    const end = app.indexOf("// ── Audio", start);
    const roomStateHandler = app.slice(start, end);

    expect(start).toBeGreaterThan(-1);
    expect(roomStateHandler).not.toContain("membershipActive = true");
    expect(roomStateHandler).not.toContain('setConnectionStatus("已连接")');
    expect(roomStateHandler).not.toContain('setError("")');
  });

  it("removes the temporary integration loader and leaves only the E2.1 command bridge", () => {
    const protocol = source("public/webClientProtocol.js");
    const packageJson = JSON.parse(source("package.json")) as { scripts: Record<string, string> };

    expect(fs.existsSync(path.join(repoRoot, "public/webClientSessionIntegration.js"))).toBe(false);
    expect(protocol).not.toContain("installClientSessionIntegrationLoader");
    expect(protocol).not.toContain("autoConnect: false");
    expect(protocol).toContain("installSocketIoLegacyCommandBridge()");

    expect(packageJson.scripts["build:client"]).toBe("tsc -p tsconfig.client.json");
    expect(packageJson.scripts.prestart).toBe("npm run build:client");
    expect(packageJson.scripts.pretest).toBe("npm run build:client");
  });

  it("routes host/join/recovery entry through authoritative ClientSession synchronization", () => {
    const app = source("public/app.js");
    const recovery = source("public/recoveryIdentity.js");

    expect(app).toContain("saveSession(result);\n    activateClientSession(result);");
    expect(recovery).toContain("saveSession(result);\n      activateClientSession(result);");
    expect(recovery).not.toContain("saveSession(result);\n      enterRoom(result);");
  });
});
