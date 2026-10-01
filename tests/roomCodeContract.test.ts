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

  it("keeps web recovery codes stable while Simulator Lab V2 uses its own production-seam coordinator", () => {
    const indexHtml = source("public/index.html");
    const recoveryUi = source("public/recoveryIdentity.js");
    const labHtml = source("dev/lab.html");
    const labClient = source("dev/labV2.js");
    const coordinator = source("dev/SimulatorLabCoordinator.ts");

    expect(indexHtml).toContain('id="room-input" inputmode="numeric" maxlength="4"');
    expect(indexHtml).toContain('id="recovery-room-input" inputmode="numeric" maxlength="4"');
    expect(indexHtml).not.toContain('placeholder="6位房间号"');
    expect(recoveryUi).toContain('input.maxLength = 4');
    expect(recoveryUi).toContain('/^\\d{4}$/u');
    expect(recoveryUi).toContain('recoveryCodeInput.maxLength = 6');
    expect(recoveryUi).toContain('/^\\d{6}$/u');

    expect(labHtml).toContain("Simulator Lab V2");
    expect(labHtml).toContain('id="player-count" type="number" min="1" max="15" value="8"');
    expect(labHtml).toContain('id="reset-devices"');
    expect(labHtml).toContain('src="/dev/assets/labV2.js"');
    expect(labClient).toContain('"/dev/simulator/api/devices/reset"');
    expect(labClient).toContain('"/dev/simulator/api/reset"');
    expect(labClient).toContain("快速 BotC 模拟桌需要 5–15 名玩家");
    expect(coordinator).toContain('gameType: "botc"');
    expect(coordinator).toContain('"room.setGameModerator"');
    expect(coordinator).not.toContain("/snapshot");
  });
});
