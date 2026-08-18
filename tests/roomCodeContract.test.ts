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

  it("keeps web recovery and the lab on the same room and command contracts", () => {
    const indexHtml = source("public/index.html");
    const recoveryUi = source("public/recoveryIdentity.js");
    const labHtml = source("dev/lab.html");
    const labBootstrap = source("dev/labBootstrap.js");
    const recoveryLab = source("dev/recoveryLab.js");

    expect(indexHtml).toContain('id="room-input" inputmode="numeric" maxlength="4"');
    expect(indexHtml).toContain('id="recovery-room-input" inputmode="numeric" maxlength="4"');
    expect(indexHtml).not.toContain('placeholder="6位房间号"');
    expect(recoveryUi).toContain('input.maxLength = 4');
    expect(recoveryUi).toContain('/^\\d{4}$/u');
    expect(recoveryUi).toContain('recoveryCodeInput.maxLength = 6');
    expect(recoveryUi).toContain('/^\\d{6}$/u');
    expect(labHtml).toContain('maxlength="4"');
    expect(labBootstrap).toContain('.replace("\\\\d{6}", "\\\\d{4}")');
    expect(labBootstrap).toContain('source.includes("/^\\\\d{4}$/u")');
    expect(labBootstrap).toContain('commandId: crypto.randomUUID()');
    expect(labBootstrap).toContain('Function(source)();');
    expect(labBootstrap).toContain('实验室启动失败');
    expect(labBootstrap).toContain('createButton("模拟掉线"');
    expect(recoveryLab).toContain('/^\\d{4}$/u');
    expect(recoveryLab).toContain('/^\\d{6}$/u');
    expect(recoveryLab).toContain('"player:claim-identity-recovery"');
  });
});
