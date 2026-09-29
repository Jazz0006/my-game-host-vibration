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

function expectNoNodeRuntimeImports(relativePath: string): void {
  const contents = source(relativePath);
  expect(contents).not.toMatch(/from\s+["']node:/u);
  expect(contents).not.toMatch(/require\(["']node:/u);
}

describe("platform boundaries", () => {
  it("keeps the Werewolf rules engine and default randomness free of Node runtime imports", () => {
    expectNoNodeRuntimeImports("src/domain/game.ts");
    expectNoNodeRuntimeImports("src/domain/gameRandom.ts");
  });

  it("keeps session-token contracts and service platform-neutral", () => {
    expectNoNodeRuntimeImports("src/core/security/SessionTokenCryptoProvider.ts");
    expectNoNodeRuntimeImports("src/core/session/SessionTokenService.ts");
  });

  it("removes the legacy domain session-token implementation", () => {
    expect(fs.existsSync(path.join(repoRoot, "src/domain/sessionToken.ts"))).toBe(false);
  });

  it("routes Node server session tokens through the service and runtime adapter", () => {
    const serverSource = source("src/server.ts");

    expect(serverSource).toContain('from "./core/session/SessionTokenService.js"');
    expect(serverSource).toContain('from "./runtime/node/NodeSessionTokenCryptoProvider.js"');
    expect(serverSource).not.toContain("./domain/sessionToken.js");
  });

  it("keeps WeChat adapters game-agnostic and limits global wx binding to the composition root", () => {
    const effectSource = source("src/client/WeChatClientEffects.ts");
    const transportSource = source("src/client/WeChatRealtimeTransport.ts");
    const credentialSource = source("src/client/WeChatSessionCredentialStore.ts");
    const lifecycleSource = source("src/client/WeChatSessionLifecycle.ts");
    const nativeSource = source("src/client/WeChatNativeClient.ts");

    expect(effectSource).toContain("dispatchClientRealtimeEffect");
    for (const contents of [
      effectSource,
      transportSource,
      credentialSource,
      lifecycleSource,
    ]) {
      expect(contents).not.toMatch(/\bwx\b/u);
      expect(contents).not.toMatch(/from\s+["']\.\.\/domain\//u);
      expect(contents).not.toMatch(/from\s+["']\.\.\/games\//u);
    }

    expect(nativeSource).toContain("declare const wx: WeChatNativeApi");
    expect(nativeSource).toContain("createWeChatNativeClient<TPlayerView>(wx, options)");
    expect(nativeSource).not.toMatch(/from\s+["']\.\.\/domain\//u);
    expect(nativeSource).not.toMatch(/from\s+["']\.\.\/games\//u);
  });

  it("keeps shared Raw WebSocket client semantics platform-neutral and single-owned", () => {
    const coreSource = source("src/client/runtime/RawWebSocketClientTransportCore.ts");
    const endpointSource = source("src/client/runtime/RawWebSocketClientEndpoint.ts");
    const weChatTransportSource = source("src/client/WeChatRealtimeTransport.ts");
    const browserTransportSource = source(
      "src/client/browser/CloudflareRealtimeTransport.ts",
    );

    for (const relativePath of [
      "src/client/runtime/RawWebSocketClientTransportCore.ts",
      "src/client/runtime/RawWebSocketClientEndpoint.ts",
    ]) {
      expectNoNodeRuntimeImports(relativePath);
    }
    for (const contents of [coreSource, endpointSource]) {
      expect(contents).not.toMatch(/from\s+["'][^"']*domain\//u);
      expect(contents).not.toMatch(/from\s+["'][^"']*games\//u);
      expect(contents).not.toMatch(/from\s+["'][^"']*runtime\/(?:node|cloudflare)\//u);
      expect(contents).not.toMatch(/\bwx\b/u);
      expect(contents).not.toMatch(/\bfetch\b/u);
      expect(contents).not.toMatch(/\bwindow\b/u);
    }

    expect(weChatTransportSource).toContain(
      'from "./runtime/RawWebSocketClientTransportCore.js"',
    );
    expect(browserTransportSource).toContain(
      'from "../runtime/RawWebSocketClientTransportCore.js"',
    );
    expect(weChatTransportSource).toContain(
      'from "./runtime/RawWebSocketClientEndpoint.js"',
    );
    expect(browserTransportSource).toContain(
      'from "../runtime/RawWebSocketClientEndpoint.js"',
    );
    expect(weChatTransportSource).not.toContain("ClientRawWebSocketProtocol");
    expect(browserTransportSource).not.toContain("ClientRawWebSocketProtocol");
  });
});
