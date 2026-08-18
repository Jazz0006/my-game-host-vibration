import type { AddressInfo } from "node:net";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { io as createClient } from "socket.io-client";
import { afterEach, describe, expect, it } from "vitest";
import { createGameServer } from "../src/server.js";

const __filename = fileURLToPath(import.meta.url);
const repoRoot = path.join(path.dirname(__filename), "..");
const source = (relativePath: string) => fs.readFileSync(path.join(repoRoot, relativePath), "utf8");

describe("four-digit room code contract", () => {
  let game: ReturnType<typeof createGameServer> | null = null;

  afterEach(async () => {
    if (!game) return;
    await new Promise<void>(resolve => game!.io.close(() => resolve()));
    game = null;
  });

  it("creates a four-digit room id", async () => {
    game = createGameServer();
    await new Promise<void>(resolve => game!.httpServer.listen(0, "127.0.0.1", resolve));
    const port = (game.httpServer.address() as AddressInfo).port;
    const socket = createClient(`http://127.0.0.1:${port}`, {
      forceNew: true,
      transports: ["websocket"],
    });

    const result = await new Promise<{ ok: boolean; roomId?: string }>(resolve => {
      socket.emit("host:create-room", { name: "房主" }, resolve);
    });
    socket.disconnect();

    expect(result.ok).toBe(true);
    expect(result.roomId).toMatch(/^\d{4}$/u);
  });

  it("keeps web recovery and the lab on the same four-digit contract", () => {
    const recoveryUi = source("public/recoveryIdentity.js");
    const labHtml = source("dev/lab.html");
    const labBootstrap = source("dev/labBootstrap.js");
    const recoveryLab = source("dev/recoveryLab.js");

    expect(recoveryUi).toContain('input.maxLength = 4');
    expect(recoveryUi).toContain('/^\\d{4}$/u');
    expect(labHtml).toContain('maxlength="4"');
    expect(labBootstrap).toContain('/^\\\\d{4}$/u');
    expect(recoveryLab).toContain('/^\\d{4}$/u');
  });
});
