import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const config = JSON.parse(readFileSync("wrangler.jsonc", "utf8")) as {
  main?: string;
  durable_objects?: {
    bindings?: Array<{ name?: string; class_name?: string }>;
  };
  exports?: Record<
    string,
    { type?: string; state?: string; storage?: string }
  >;
};

describe("D2.1 Wrangler configuration", () => {
  it("binds the Worker to the GameRoom Durable Object using SQLite storage", () => {
    expect(config.main).toBe("src/runtime/cloudflare/worker.ts");
    expect(config.durable_objects?.bindings).toContainEqual({
      name: "GAME_ROOMS",
      class_name: "GameRoomDurableObject",
    });
    expect(config.exports?.GameRoomDurableObject).toEqual({
      type: "durable-object",
      state: "created",
      storage: "sqlite",
    });
  });
});
