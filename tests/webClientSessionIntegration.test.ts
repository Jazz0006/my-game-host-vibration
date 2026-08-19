import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.join(__dirname, "..");

function source(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

describe("E2.2 Web ClientSession integration", () => {
  it("defers the production no-argument io() connection until ClientSession wiring loads", () => {
    const ioCalls: unknown[][] = [];
    const rawSocket = {
      timeout() {
        return { emit() {} };
      },
      emit() {},
    };
    const appendedScripts: Array<{ src?: string; dataset: Record<string, string> }> = [];
    const domListeners = new Map<string, () => void>();
    const document = {
      readyState: "loading",
      body: {
        appendChild(node: { src?: string; dataset: Record<string, string> }) {
          appendedScripts.push(node);
        },
      },
      createElement() {
        return { src: "", dataset: {} as Record<string, string> };
      },
      querySelector() {
        return null;
      },
      addEventListener(event: string, listener: () => void) {
        domListeners.set(event, listener);
      },
    };
    const context = vm.createContext({
      crypto: { randomUUID: () => "command-1" },
      document,
      io: (...args: unknown[]) => {
        ioCalls.push(args);
        return rawSocket;
      },
    });

    vm.runInContext(source("public/webClientProtocol.js"), context);
    const bridgedIo = (context as unknown as { io: (...args: unknown[]) => unknown }).io;
    bridgedIo();

    expect(JSON.parse(JSON.stringify(ioCalls))).toEqual([[{ autoConnect: false }]]);
    expect(appendedScripts).toEqual([]);

    domListeners.get("DOMContentLoaded")?.();
    expect(appendedScripts).toHaveLength(1);
    expect(appendedScripts[0]!.src).toBe("/webClientSessionIntegration.js");
    expect(appendedScripts[0]!.dataset.webClientSessionIntegration).toBe("true");
  });

  it("keeps explicit Socket.IO options untouched for non-production callers", () => {
    const ioCalls: unknown[][] = [];
    const rawSocket = {
      timeout() {
        return { emit() {} };
      },
      emit() {},
    };
    const context = vm.createContext({
      crypto: { randomUUID: () => "command-1" },
      io: (...args: unknown[]) => {
        ioCalls.push(args);
        return rawSocket;
      },
    });

    vm.runInContext(source("public/webClientProtocol.js"), context);
    const bridgedIo = (context as unknown as { io: (...args: unknown[]) => unknown }).io;
    bridgedIo("/custom", { transports: ["websocket"] });

    expect(JSON.parse(JSON.stringify(ioCalls))).toEqual([
      ["/custom", { transports: ["websocket"] }],
    ]);
  });

  it("loads the integration after app.js and replaces only the Web session boundary", () => {
    const integration = source("public/webClientSessionIntegration.js");
    const app = source("public/app.js");
    const packageJson = JSON.parse(source("package.json")) as { scripts: Record<string, string> };

    expect(() => new Function(integration)).not.toThrow();
    expect(integration).toContain('socket.off("connect")');
    expect(integration).toContain('socket.off("disconnect")');
    expect(integration).toContain('socket.off("player:game-state", renderGameState)');
    expect(integration).toContain("session.reconnect()");
    expect(integration).toContain("createWebClientSession(socket)");
    expect(integration).toContain("attachBrowserSessionLifecycle(session)");
    expect(integration).toContain("detachClientLifecycle?.()");
    expect(integration).toContain("/client-runtime/client/browser/WebClientSession.js");

    // The legacy UI remains present as the compatibility surface; E2.2 wiring
    // is deliberately layered on top instead of rewriting this large file.
    expect(app).toContain('socket.on("connect"');
    expect(app).toContain('socket.on("player:game-state", renderGameState)');
    expect(app).toContain('socket.on("room:state"');

    expect(packageJson.scripts["build:client"]).toBe("tsc -p tsconfig.client.json");
    expect(packageJson.scripts.prestart).toBe("npm run build:client");
    expect(packageJson.scripts.pretest).toBe("npm run build:client");
  });
});
