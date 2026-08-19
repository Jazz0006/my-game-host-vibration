import fs from "node:fs";
import { describe, expect, it } from "vitest";

const delivery = fs.readFileSync(
  new URL("../src/runtime/node/SocketIoClientEffectDelivery.ts", import.meta.url),
  "utf8",
);
const server = fs.readFileSync(new URL("../src/server.ts", import.meta.url), "utf8");
const app = fs.readFileSync(new URL("../public/app.js", import.meta.url), "utf8");

function count(source: string, value: string): number {
  return source.split(value).length - 1;
}

describe("E2.2c3 lifecycle client effects", () => {
  it("dual-publishes lifecycle effects only from the canonical Node effect delivery boundary", () => {
    expect(delivery).toContain("createClientAudioCueEffectEvent");
    expect(delivery).toContain("CLIENT_AUDIO_CUE_NIGHT_COMPLETE");
    expect(delivery).toContain("function emitNightCompleteEffects");
    expect(delivery).toContain("function emitGameOverEffects");
    expect(delivery).toContain('reason: "night-complete"');
    expect(delivery).toContain('reason: "game-over"');
    expect(delivery).toContain('emit("game:night-complete", context)');
    expect(delivery).toContain('emit("game:over", context)');

    expect(server).not.toContain('emit("game:night-complete"');
    expect(server).not.toContain('emit("game:over"');
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
