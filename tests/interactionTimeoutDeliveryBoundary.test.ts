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

describe("E2.3f4 interaction-timeout delivery contraction", () => {
  it("keeps stable Node delivery and removes raw timeout emits", () => {
    const timedServer = source("src/timedServer.ts");

    expect(timedServer).toContain("emitClientInteractionTimeoutState");
    expect(timedServer).toContain("emitClientInteractionTimeoutError");
    expect(timedServer).not.toContain('emit("player:interaction-timeout-state"');
    expect(timedServer).not.toContain('emit("player:interaction-timeout-error"');
  });

  it("routes production Web timeout UI through ClientSession and retires raw listeners", () => {
    const app = source("public/app.js");
    const recovery = source("public/recoveryStatus.js");
    const webRuntime = source("src/client/browser/WebClientSession.ts");

    expect(webRuntime).toContain("attachBrowserInteractionTimeoutEvents");
    expect(app).toContain("attachBrowserInteractionTimeoutEvents");
    expect(app).toContain("handleInteractionTimeoutState(payload)");
    expect(app).toContain("handleInteractionTimeoutError(payload)");
    expect(recovery).toContain("function handleInteractionTimeoutState(state)");
    expect(recovery).toContain("function handleInteractionTimeoutError(payload)");
    expect(recovery).not.toContain('socket.on("player:interaction-timeout-state"');
    expect(recovery).not.toContain('socket.on("player:interaction-timeout-error"');
  });

  it("removes retired timeout events from the legacy inventory", () => {
    const inventory = source("src/protocol/client/LegacySocketIoSurface.ts");

    expect(inventory).not.toContain('event: "player:interaction-timeout-state"');
    expect(inventory).not.toContain('event: "player:interaction-timeout-error"');
    expect(inventory).toContain('event: "host:get-interaction-timeout"');
    expect(inventory).toContain('event: "host:set-interaction-timeout"');
    expect(inventory).toContain('event: "player:extend-interaction-timeout"');
  });
});