import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __filename = fileURLToPath(import.meta.url);
const repoRoot = path.join(path.dirname(__filename), "..");

function source(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

describe("Hunter runtime hook architecture", () => {
  it("keeps domain independent while production Werewolf commands inject registry hooks", () => {
    const domain = source("src/domain/game.ts");
    const module = source("src/games/werewolf/WerewolfGameModule.ts");
    const facade = source("src/games/werewolf/WerewolfDomainFacade.ts");
    const adapter = source("src/games/werewolf/WerewolfRuleRuntimeHooks.ts");

    expect(domain).not.toMatch(/(?:^|\/)games(?:\/|$)/u);
    expect(module).toContain('from "./WerewolfDomainFacade.js"');
    expect(facade).toContain("WEREWOLF_RULE_RUNTIME_HOOKS");
    expect(adapter).toContain("collectWerewolfAfterDeathActions");
    expect(adapter).toContain("WEREWOLF_ROLE_REGISTRY");
  });
});
