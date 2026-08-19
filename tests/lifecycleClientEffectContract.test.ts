import fs from "node:fs";
import { describe, expect, it } from "vitest";

const server = fs.readFileSync(new URL("../src/server.ts", import.meta.url), "utf8");
const app = fs.readFileSync(new URL("../public/app.js", import.meta.url), "utf8");

function count(source: string, value: string): number {
  return source.split(value).length - 1;
}

describe("E2.2c3 lifecycle client effects", () => {
  it("routes night-complete and game-over effects through client:event while retaining legacy server compatibility", () => {
    expect(server).toContain("createClientAudioCueEffectEvent");
    expect(server).toContain("CLIENT_AUDIO_CUE_NIGHT_COMPLETE");
    expect(server).toContain("function emitNightCompleteEffects");
    expect(server).toContain("function emitGameOverEffects");
    expect(server).toContain('reason: "night-complete"');
    expect(server).toContain('reason: "game-over"');
    expect(server).toContain('emit("game:night-complete", context)');
    expect(server).toContain('emit("game:over", context)');
    expect(count(server, "emitNightCompleteEffects(io, room);")).toBe(2);
    expect(count(server, "emitGameOverEffects(io, room);")).toBe(2);
    expect(count(server, "emitGameOverEffects(io, membership.room);")).toBe(1);
  });

  it("removes lifecycle effect ownership from the legacy Web app", () => {
    expect(app).not.toContain('socket.on("game:night-complete"');
    expect(app).not.toContain('socket.on("game:over"');
    expect(app).not.toContain("function playNightEndAudio");
    expect(app).toContain('socket.on("room:removed"');
    expect(app).toContain('socket.on("room:closed"');
  });
});
