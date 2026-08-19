import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { WEREWOLF_CLIENT_COMMAND_TYPES } from "../src/protocol/client/werewolf/WerewolfClientProtocol.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.join(__dirname, "..");

function source(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

type WebClientProtocolApi = {
  CLIENT_PROTOCOL_VERSION: number;
  SOCKET_COMMAND_EVENT: string;
  createSocketIoAdapter(
    socket: {
      timeout(ms: number): {
        emit(
          event: string,
          payload: unknown,
          callback: (error: Error | null, result?: unknown) => void,
        ): void;
      };
      emit: (...args: unknown[]) => void;
    },
    options?: {
      timeoutMs?: number;
      maxRetries?: number;
      randomUUID?: () => string;
    },
  ): {
    sendCommand(
      type: string,
      payload: unknown,
      callback?: (error: Error | null, result?: unknown) => void,
    ): string;
  };
};

function loadWebClientProtocol(): WebClientProtocolApi {
  const context = vm.createContext({
    crypto: { randomUUID: () => "context-uuid" },
  });
  vm.runInContext(source("public/webClientProtocol.js"), context);
  return (context as unknown as { WebClientProtocol: WebClientProtocolApi }).WebClientProtocol;
}

describe("E2 Web client protocol adapter", () => {
  it("sends one versioned command envelope through the stable Socket.IO transport event", () => {
    const api = loadWebClientProtocol();
    const deliveries: Array<{ event: string; payload: unknown }> = [];
    const socket = {
      emit() {},
      timeout(ms: number) {
        expect(ms).toBe(5000);
        return {
          emit(event: string, payload: unknown, callback: (error: Error | null, result?: unknown) => void) {
            deliveries.push({ event, payload });
            callback(null, { ok: true });
          },
        };
      },
    };

    const adapter = api.createSocketIoAdapter(socket, {
      randomUUID: () => "command-1",
    });
    let result: unknown;
    const commandId = adapter.sendCommand(
      "werewolf.confirmRole",
      { actionId: "action-1" },
      (_error, value) => { result = value; },
    );

    expect(commandId).toBe("command-1");
    expect(result).toEqual({ ok: true });
    expect(deliveries).toEqual([
      {
        event: "client:command",
        payload: {
          protocolVersion: 1,
          kind: "command",
          commandId: "command-1",
          type: "werewolf.confirmRole",
          payload: { actionId: "action-1" },
        },
      },
    ]);
  });

  it("retries a lost acknowledgement with the same envelope and commandId", () => {
    const api = loadWebClientProtocol();
    const deliveries: Array<{
      event: string;
      payload: unknown;
      callback: (error: Error | null, result?: unknown) => void;
    }> = [];
    let generatedIds = 0;
    const socket = {
      emit() {},
      timeout() {
        return {
          emit(event: string, payload: unknown, callback: (error: Error | null, result?: unknown) => void) {
            deliveries.push({ event, payload, callback });
          },
        };
      },
    };

    const adapter = api.createSocketIoAdapter(socket, {
      randomUUID: () => `command-${++generatedIds}`,
      maxRetries: 1,
    });
    let finalResult: unknown;
    adapter.sendCommand(
      "werewolf.submitWolfTarget",
      { actionId: "action-2", targetPlayerId: "p3" },
      (_error, result) => { finalResult = result; },
    );

    expect(deliveries).toHaveLength(1);
    deliveries[0]!.callback(new Error("ack timeout"));
    expect(deliveries).toHaveLength(2);
    expect(deliveries[1]!.event).toBe("client:command");
    expect(deliveries[1]!.payload).toBe(deliveries[0]!.payload);
    expect((deliveries[1]!.payload as { commandId: string }).commandId).toBe("command-1");
    expect(generatedIds).toBe(1);

    deliveries[1]!.callback(null, { ok: true });
    expect(finalResult).toEqual({ ok: true });
  });

  it("does not retry an authoritative application rejection", () => {
    const api = loadWebClientProtocol();
    let deliveries = 0;
    const socket = {
      emit() {},
      timeout() {
        return {
          emit(_event: string, _payload: unknown, callback: (error: Error | null, result?: unknown) => void) {
            deliveries += 1;
            callback(null, { ok: false, message: "invalid action" });
          },
        };
      },
    };

    const adapter = api.createSocketIoAdapter(socket, {
      randomUUID: () => "command-1",
    });
    let response: unknown;
    adapter.sendCommand("werewolf.confirmRole", {}, (_error, result) => { response = result; });

    expect(deliveries).toBe(1);
    expect(response).toEqual({ ok: false, message: "invalid action" });
  });

  it("loads the Web adapter before app.js and keeps migrated Web game calls protocol-only", () => {
    const html = source("public/index.html");
    const app = source("public/app.js");

    expect(html.indexOf('/webClientProtocol.js')).toBeGreaterThan(-1);
    expect(html.indexOf('/webClientProtocol.js')).toBeLessThan(html.indexOf('/app.js'));
    expect(() => new Function(app)).not.toThrow();

    for (const protocolType of WEREWOLF_CLIENT_COMMAND_TYPES) {
      expect(app, `missing Web protocol command: ${protocolType}`).toContain(protocolType);
    }

    const migratedLegacyEvents = [
      "player:confirm-role",
      "player:submit-wolf-target",
      "player:submit-witch-action",
      "player:submit-seer-target",
      "player:confirm-seer-result",
      "player:submit-guard-target",
      "player:submit-hunter-execution",
      "player:submit-vote",
      "host:start-night",
      "host:close-voting",
      "host:begin-night-start",
    ];
    for (const event of migratedLegacyEvents) {
      expect(app, `legacy Web game event still referenced: ${event}`).not.toContain(event);
    }

    // Deliberately outside the first E2 slice.
    expect(app).toContain("host:start-game");
    expect(app).toContain("host:restart-game");
  });
});
