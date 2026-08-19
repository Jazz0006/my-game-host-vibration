import fs from "node:fs";
import { describe, expect, it } from "vitest";

const delivery = fs.readFileSync(
  new URL("../src/runtime/node/SocketIoClientEffectDelivery.ts", import.meta.url),
  "utf8",
);
const server = fs.readFileSync(new URL("../src/server.ts", import.meta.url), "utf8");
const transport = fs.readFileSync(
  new URL("../src/runtime/node/SocketIoClientProtocolTransport.ts", import.meta.url),
  "utf8",
);
const app = fs.readFileSync(new URL("../public/app.js", import.meta.url), "utf8");

function count(source: string, value: string): number {
  return source.split(value).length - 1;
}

describe("E2.3b lifecycle legacy event contraction", () => {
  it("publishes lifecycle effects only through the canonical client:event boundary", () => {
    expect(delivery).toContain("createClientAudioCueEffectEvent");
    expect(delivery).toContain("CLIENT_AUDIO_CUE_NIGHT_COMPLETE");
    expect(delivery).toContain("function emitNightCompleteEffects");
    expect(delivery).toContain("function emitGameOverEffects");
    expect(delivery).toContain('reason: "night-complete"');
    expect(delivery).toContain('reason: "game-over"');
    expect(delivery).not.toContain('"game:night-complete"');
    expect(delivery).not.toContain('"game:over"');

    expect(server).not.toContain('emit("game:night-complete"');
    expect(server).not.toContain('emit("game:over"');
    expect(count(server, "emitNightCompleteEffects(io, room);")).toBe(2);
    expect(count(server, "emitGameOverEffects(io, room);")).toBe(2);
    expect(server).not.toContain("emitGameOverEffects(io, membership.room);");

    expect(transport).toContain('case "hunterResolved"');
    expect(transport).toContain('case "vote"');
    expect(transport).toContain("emitGameOverEffects(io, room);");
  });

  it("keeps lifecycle event ownership out of raw Web Socket.IO listeners", () => {
    expect(app).not.toContain('socket.on("game:night-complete"');
    expect(app).not.toContain('socket.on("game:over"');
    expect(app).not.toContain("function playNightEndAudio");
    expect(app).not.toContain('socket.on("room:removed"');
    expect(app).not.toContain('socket.on("room:closed"');
    expect(app).toContain("attachBrowserRoomLifecycle");
  });
});
