import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  CLIENT_PROTOCOL_VERSION,
  CLIENT_RECONNECT_POLICY,
  createClientCommandEnvelope,
  createReconnectEnvelope,
} from "../src/protocol/client/ClientProtocol.js";
import { LEGACY_SOCKET_IO_SURFACE } from "../src/protocol/client/LegacySocketIoSurface.js";
import {
  WEREWOLF_CLIENT_COMMAND_TYPES,
  mapWerewolfClientCommand,
  parseWerewolfClientCommandEnvelope,
} from "../src/protocol/client/werewolf/WerewolfClientProtocol.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.join(__dirname, "..");
const SOCKET_SERVER_SOURCES = [
  "src/server.ts",
  "src/timedServer.ts",
  "src/runtime/node/SocketIoClientProtocolTransport.ts",
] as const;

function source(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function matches(contents: string, pattern: RegExp): string[] {
  return [...contents.matchAll(pattern)].map(match => match[1]!).filter(Boolean);
}

function applicationSocketHandlers(): string[] {
  const eventNames = SOCKET_SERVER_SOURCES.flatMap(relativePath =>
    matches(source(relativePath), /socket\.on\(\s*["']([^"']+)["']/gu),
  );
  return eventNames.filter(event => event !== "disconnect");
}

function applicationServerEmits(): string[] {
  const eventNames = SOCKET_SERVER_SOURCES.flatMap(relativePath =>
    matches(source(relativePath), /\.emit\(\s*["']([^"']+)["']/gu),
  );
  return eventNames.filter(event => !event.startsWith("dev:"));
}

describe("E1 client protocol contract", () => {
  it("uses one versioned command envelope and keeps commandId separate from actionId", () => {
    const envelope = createClientCommandEnvelope(
      "werewolf.confirmRole",
      { actionId: "action-7" },
      " command-7 ",
    );

    expect(envelope).toEqual({
      protocolVersion: CLIENT_PROTOCOL_VERSION,
      kind: "command",
      commandId: "command-7",
      type: "werewolf.confirmRole",
      payload: { actionId: "action-7" },
    });

    const parsed = parseWerewolfClientCommandEnvelope(envelope);
    expect(mapWerewolfClientCommand(parsed)).toEqual({
      authority: "player",
      commandId: "command-7",
      command: { type: "confirmRole", actionId: "action-7" },
    });
  });

  it("rejects wrong protocol versions and malformed command payloads", () => {
    expect(() => parseWerewolfClientCommandEnvelope({
      protocolVersion: 2,
      kind: "command",
      commandId: "c-1",
      type: "werewolf.startNight",
      payload: {},
    })).toThrow("unsupported client protocol version");

    expect(() => parseWerewolfClientCommandEnvelope({
      protocolVersion: 1,
      kind: "command",
      commandId: "c-2",
      type: "werewolf.submitVote",
      payload: { targetId: "p2" },
    })).toThrow("actionId is required");
  });

  it("defines reconnect as credentials plus authoritative state regeneration, not event replay", () => {
    const reconnect = createReconnectEnvelope({
      roomId: "1234",
      playerId: "p1",
      resumeToken: "secret-token",
    });

    expect(reconnect.kind).toBe("reconnect");
    expect(reconnect.credentials).toEqual({
      roomId: "1234",
      playerId: "p1",
      resumeToken: "secret-token",
    });
    expect(CLIENT_RECONNECT_POLICY).toEqual({
      sourceOfTruth: "authoritative-state",
      eventReplay: false,
    });
  });

  it("keeps the Socket.IO audit complete for current application handlers and deliveries", () => {
    const clientToServerInventory = new Set(
      LEGACY_SOCKET_IO_SURFACE
        .filter(entry => entry.direction === "client-to-server")
        .map(entry => entry.event),
    );
    const serverToClientInventory = new Set(
      LEGACY_SOCKET_IO_SURFACE
        .filter(entry => entry.direction === "server-to-client")
        .map(entry => entry.event),
    );

    for (const event of applicationSocketHandlers()) {
      expect(clientToServerInventory.has(event), `missing client→server audit entry: ${event}`).toBe(true);
    }
    for (const event of applicationServerEmits()) {
      expect(serverToClientInventory.has(event), `missing server→client audit entry: ${event}`).toBe(true);
    }

    const keys = LEGACY_SOCKET_IO_SURFACE.map(entry => `${entry.direction}:${entry.event}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(new Set(LEGACY_SOCKET_IO_SURFACE.map(entry => entry.family))).toEqual(
      new Set(["command", "state", "event", "reconnect"]),
    );
  });

  it("maps every post-start Werewolf Socket.IO game command to a stable protocol type", () => {
    const mappedTargets = LEGACY_SOCKET_IO_SURFACE
      .filter(entry =>
        entry.direction === "client-to-server" &&
        entry.category === "werewolf-game" &&
        entry.protocolTarget
      )
      .map(entry => entry.protocolTarget)
      .sort();

    expect(mappedTargets).toEqual([...WEREWOLF_CLIENT_COMMAND_TYPES].sort());
  });
});
