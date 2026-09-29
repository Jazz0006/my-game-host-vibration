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

function typescriptFiles(relativeDirectory: string): string[] {
  const directory = path.join(repoRoot, relativeDirectory);
  const results: string[] = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const relativePath = path.join(relativeDirectory, entry.name);
    if (entry.isDirectory()) results.push(...typescriptFiles(relativePath));
    else if (entry.isFile() && entry.name.endsWith(".ts")) results.push(relativePath);
  }
  return results;
}

function importsOf(relativePath: string): string[] {
  const contents = source(relativePath);
  const imports: string[] = [];
  const pattern = /(?:import|export)\s+(?:type\s+)?(?:[^"']*?\s+from\s+)?["']([^"']+)["']/gu;
  for (const match of contents.matchAll(pattern)) imports.push(match[1]!);
  return imports;
}

type StaticImport = {
  specifier: string;
  typeOnly: boolean;
};

function staticImportsOf(relativePath: string): StaticImport[] {
  const contents = source(relativePath);
  const imports: StaticImport[] = [];
  const pattern = /import\s+(type\s+)?[^;]*?\s+from\s+["']([^"']+)["'];/gu;
  for (const match of contents.matchAll(pattern)) {
    imports.push({
      specifier: match[2]!,
      typeOnly: Boolean(match[1]),
    });
  }
  return imports;
}

function expectNoImportsMatching(relativePaths: string[], forbidden: RegExp[]): void {
  for (const relativePath of relativePaths) {
    for (const imported of importsOf(relativePath)) {
      for (const pattern of forbidden) {
        expect(
          pattern.test(imported),
          `${relativePath} must not import ${imported}`,
        ).toBe(false);
        pattern.lastIndex = 0;
      }
    }
  }
}

describe("architecture boundaries", () => {
  it("keeps core independent from runtimes, transports, domains, and concrete games", () => {
    expectNoImportsMatching(typescriptFiles("src/core"), [
      /^node:/u,
      /^socket\.io/u,
      /^express$/u,
      /(?:^|\/)domain(?:\/|$)/u,
      /(?:^|\/)games(?:\/|$)/u,
      /(?:^|\/)runtime(?:\/|$)/u,
    ]);
  });

  it("keeps domain code independent from Node, transports, runtimes, and concrete game adapters", () => {
    expectNoImportsMatching(typescriptFiles("src/domain"), [
      /^node:/u,
      /^socket\.io/u,
      /^express$/u,
      /(?:^|\/)runtime(?:\/|$)/u,
      /(?:^|\/)games(?:\/|$)/u,
    ]);
  });

  it("keeps game modules independent from Node and transport/runtime orchestration", () => {
    expectNoImportsMatching(typescriptFiles("src/games"), [
      /^node:/u,
      /^socket\.io/u,
      /^express$/u,
      /(?:^|\/)runtime(?:\/|$)/u,
    ]);
  });

  it("keeps RoomCore unaware of game rules and runtime presence", () => {
    const roomCore = source("src/core/room/RoomCore.ts");

    expect(roomCore).not.toMatch(/\b(werewolf|botc|phase|actionId|activePrompt|socketId|connected)\b/u);
  });

  it("keeps GameModule view context free of transport presence and authority fields", () => {
    const gameModule = source("src/core/game/GameModule.ts");

    expect(gameModule).not.toMatch(/\b(socketId|connected|resumeTokenHash)\b/u);
    const playerRef = gameModule.match(/export type GamePlayerRef = \{([\s\S]*?)\};/u)?.[1] ?? "";
    expect(playerRef).toContain("id: string");
    expect(playerRef).toContain("name: string");
    expect(playerRef).toContain("seat: number");
    expect(playerRef).not.toContain("isHost");
  });

  it("keeps legacy Werewolf domain runtime values behind games/werewolf ownership", () => {
    const nonGameProductionFiles = typescriptFiles("src").filter(
      relativePath =>
        !relativePath.startsWith(path.join("src", "domain")) &&
        !relativePath.startsWith(path.join("src", "games", "werewolf")),
    );

    for (const relativePath of nonGameProductionFiles) {
      for (const imported of staticImportsOf(relativePath)) {
        if (!/(?:^|\/)domain\/game\.js$/u.test(imported.specifier)) continue;
        expect(
          imported.typeOnly,
          `${relativePath} may only type-import legacy domain/game; runtime values belong behind games/werewolf`,
        ).toBe(true);
      }
    }
  });

  it("keeps runtime adapters from directly mutating concrete Werewolf state fields", () => {
    const directAssignment =
      /\b(?:room\.)?game\.[A-Za-z_$][\w$]*\s*(?:\+\+|--|\+=|-=|\*=|\/=|\?\?=|\|\|=|&&=|=(?!=))/u;
    const directDelete = /\bdelete\s+(?:room\.)?game\.[A-Za-z_$][\w$]*/u;

    for (const relativePath of typescriptFiles("src/runtime")) {
      const contents = source(relativePath);
      expect(
        contents,
        `${relativePath} must delegate Werewolf state mutation to the game owner`,
      ).not.toMatch(directAssignment);
      expect(
        contents,
        `${relativePath} must not delete concrete Werewolf state fields`,
      ).not.toMatch(directDelete);
    }
  });

  it("keeps Werewolf display metadata owned by the role registry", () => {
    const server = source("src/server.ts");
    const gameModule = source("src/games/werewolf/WerewolfGameModule.ts");

    expect(server).toContain("werewolfRoleCatalog");
    expect(gameModule).toContain("getWerewolfRoleDefinition");

    for (const relativePath of typescriptFiles("src")) {
      if (relativePath === path.join("src", "games", "werewolf", "roles", "registry.ts")) continue;
      expect(
        source(relativePath),
        `${relativePath} must not recreate a parallel ROLE_INFO metadata owner`,
      ).not.toMatch(/\bROLE_INFO\b/u);
    }
  });

  it("keeps the shared Cloudflare Raw WebSocket bridge free of concrete game runtimes", () => {
    const sharedProtocol = "src/runtime/cloudflare/CloudflareRawWebSocketClientProtocol.ts";
    const imports = importsOf(sharedProtocol);

    expect(imports).toContain("./CloudflareGameCommandRuntimeRegistry.js");
    for (const forbidden of [
      /(?:^|\/)games\/werewolf(?:\/|$)/u,
      /(?:^|\/)protocol\/client\/werewolf(?:\/|$)/u,
      /CloudflareWerewolf/u,
      /CloudflareInteractionTimeoutRuntime/u,
      /CloudflareRoomRecoveryRuntime/u,
    ]) {
      for (const imported of imports) {
        expect(
          forbidden.test(imported),
          `${sharedProtocol} must dispatch concrete game behavior through the game runtime registry, not ${imported}`,
        ).toBe(false);
        forbidden.lastIndex = 0;
      }
    }

    const werewolfHandler = source(
      "src/runtime/cloudflare/CloudflareWerewolfGameCommandHandler.ts",
    );
    expect(werewolfHandler).toContain("CloudflareWerewolfCommandRuntime");
    expect(werewolfHandler).toContain("CloudflareWerewolfLifecycleRuntime");
    expect(werewolfHandler).toContain("CloudflareInteractionTimeoutRuntime");
    expect(werewolfHandler).toContain("CloudflareRoomRecoveryRuntime");
  });

  it("keeps concrete Werewolf mutations behind the GameModule/runtime bridge boundary", () => {
    const server = source("src/server.ts");
    const domainGameImport = server.match(/import\s*\{([\s\S]*?)\}\s*from\s*["']\.\/domain\/game\.js["']/u)?.[1] ?? "";

    for (const mutation of [
      "startGame",
      "confirmRole",
      "startNight",
      "submitWolfTarget",
      "submitGuardTarget",
      "submitWitchAction",
      "submitSeerTarget",
      "confirmSeerResult",
      "submitHunterExecution",
      "startDayVote",
      "submitVote",
      "closeDayVote",
      "beginNightStart",
      "allAliveVoted",
    ]) {
      expect(domainGameImport, `server.ts must not import ${mutation} directly`).not.toMatch(
        new RegExp(`\\b${mutation}\\b`, "u"),
      );
    }

    expect(server).toContain('from "./runtime/node/werewolfCommandFacade.js"');
    expect(server).toContain('from "./runtime/node/roomBridge.js"');
  });
});
