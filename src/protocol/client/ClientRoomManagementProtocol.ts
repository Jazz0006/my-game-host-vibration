import { requireCommandId } from "../../core/command/CommandEnvelope.js";
import type { GameModeratorAssignment } from "../../core/room/types.js";
import {
  CLIENT_PROTOCOL_VERSION,
  type ClientCommandEnvelope,
} from "./ClientProtocol.js";

export type RoomManagementCommand =
  | { type: "room.updateName"; name: string }
  | { type: "room.setReady"; ready: boolean }
  | { type: "room.movePlayerSeat"; targetPlayerId: string; insertIndex: number }
  | { type: "room.removePlayer"; targetPlayerId: string }
  | { type: "room.setGameModerator"; assignment: GameModeratorAssignment }
  | { type: "room.transferHost"; targetPlayerId: string }
  | { type: "room.leaveAndTransfer"; targetPlayerId: string }
  | { type: "room.close" }
  | { type: "room.leave" };

export type RoomManagementClientCommandEnvelope =
  | ClientCommandEnvelope<"room.updateName", { name: string }>
  | ClientCommandEnvelope<"room.setReady", { ready: boolean }>
  | ClientCommandEnvelope<
      "room.movePlayerSeat",
      { targetPlayerId: string; insertIndex: number }
    >
  | ClientCommandEnvelope<"room.removePlayer", { targetPlayerId: string }>
  | ClientCommandEnvelope<
      "room.setGameModerator",
      { assignment: GameModeratorAssignment }
    >
  | ClientCommandEnvelope<"room.transferHost", { targetPlayerId: string }>
  | ClientCommandEnvelope<"room.leaveAndTransfer", { targetPlayerId: string }>
  | ClientCommandEnvelope<"room.close", Record<string, never>>
  | ClientCommandEnvelope<"room.leave", Record<string, never>>;

export const ROOM_MANAGEMENT_CLIENT_COMMAND_TYPES = [
  "room.updateName",
  "room.setReady",
  "room.movePlayerSeat",
  "room.removePlayer",
  "room.setGameModerator",
  "room.transferHost",
  "room.leaveAndTransfer",
  "room.close",
  "room.leave",
] as const;

const TYPE_SET = new Set<string>(ROOM_MANAGEMENT_CLIENT_COMMAND_TYPES);

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("command payload must be an object");
  }
  return value as Record<string, unknown>;
}

function requiredGameModeratorAssignment(
  record: Record<string, unknown>,
): GameModeratorAssignment {
  const value = record.assignment;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("assignment is required");
  }
  const assignment = value as Record<string, unknown>;
  if (assignment.mode === "automatic") return { mode: "automatic" };
  if (assignment.mode === "human") {
    const playerId = assignment.playerId;
    if (typeof playerId !== "string" || !playerId.trim()) {
      throw new Error("assignment.playerId is required");
    }
    return { mode: "human", playerId: playerId.trim() };
  }
  throw new Error("assignment.mode must be automatic or human");
}

function requiredString(
  record: Record<string, unknown>,
  key: string,
): string {
  const value = record[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${key} is required`);
  }
  return value.trim();
}

export function isRoomManagementClientCommand(value: unknown): boolean {
  return Boolean(
    value &&
      typeof value === "object" &&
      TYPE_SET.has(String((value as Record<string, unknown>).type ?? "")),
  );
}

export function parseRoomManagementClientCommandEnvelope(
  value: unknown,
): RoomManagementClientCommandEnvelope {
  if (!value || typeof value !== "object") {
    throw new Error("client command envelope is required");
  }
  const record = value as Record<string, unknown>;
  if (record.protocolVersion !== CLIENT_PROTOCOL_VERSION) {
    throw new Error("unsupported client protocol version");
  }
  if (record.kind !== "command") {
    throw new Error("client protocol message is not a command");
  }
  if (typeof record.type !== "string" || !TYPE_SET.has(record.type)) {
    throw new Error("unsupported room management client command type");
  }

  const commandId = requireCommandId(record.commandId);
  const payload = asRecord(record.payload);

  switch (record.type) {
    case "room.updateName":
      return {
        protocolVersion: CLIENT_PROTOCOL_VERSION,
        kind: "command",
        commandId,
        type: "room.updateName",
        payload: { name: requiredString(payload, "name") },
      };

    case "room.setReady": {
      if (typeof payload.ready !== "boolean") {
        throw new Error("ready must be a boolean");
      }
      return {
        protocolVersion: CLIENT_PROTOCOL_VERSION,
        kind: "command",
        commandId,
        type: "room.setReady",
        payload: { ready: payload.ready },
      };
    }

    case "room.movePlayerSeat": {
      const insertIndex = payload.insertIndex;
      if (!Number.isInteger(insertIndex) || Number(insertIndex) < 0) {
        throw new Error("insertIndex must be a non-negative integer");
      }
      return {
        protocolVersion: CLIENT_PROTOCOL_VERSION,
        kind: "command",
        commandId,
        type: "room.movePlayerSeat",
        payload: {
          targetPlayerId: requiredString(payload, "targetPlayerId"),
          insertIndex: Number(insertIndex),
        },
      };
    }

    case "room.setGameModerator":
      return {
        protocolVersion: CLIENT_PROTOCOL_VERSION,
        kind: "command",
        commandId,
        type: "room.setGameModerator",
        payload: { assignment: requiredGameModeratorAssignment(payload) },
      };

    case "room.removePlayer":
    case "room.transferHost":
    case "room.leaveAndTransfer":
      return {
        protocolVersion: CLIENT_PROTOCOL_VERSION,
        kind: "command",
        commandId,
        type: record.type,
        payload: {
          targetPlayerId: requiredString(payload, "targetPlayerId"),
        },
      } as RoomManagementClientCommandEnvelope;

    case "room.close":
    case "room.leave":
      return {
        protocolVersion: CLIENT_PROTOCOL_VERSION,
        kind: "command",
        commandId,
        type: record.type,
        payload: {},
      };

    default:
      throw new Error("unsupported room management client command type");
  }
}

export function mapRoomManagementClientCommand(
  envelope: RoomManagementClientCommandEnvelope,
): { commandId: string; command: RoomManagementCommand } {
  switch (envelope.type) {
    case "room.updateName":
      return {
        commandId: envelope.commandId,
        command: { type: envelope.type, name: envelope.payload.name },
      };
    case "room.setReady":
      return {
        commandId: envelope.commandId,
        command: { type: envelope.type, ready: envelope.payload.ready },
      };
    case "room.movePlayerSeat":
      return {
        commandId: envelope.commandId,
        command: {
          type: envelope.type,
          targetPlayerId: envelope.payload.targetPlayerId,
          insertIndex: envelope.payload.insertIndex,
        },
      };
    case "room.setGameModerator":
      return {
        commandId: envelope.commandId,
        command: {
          type: envelope.type,
          assignment: { ...envelope.payload.assignment },
        },
      };
    case "room.removePlayer":
    case "room.transferHost":
    case "room.leaveAndTransfer":
      return {
        commandId: envelope.commandId,
        command: {
          type: envelope.type,
          targetPlayerId: envelope.payload.targetPlayerId,
        },
      };
    case "room.close":
    case "room.leave":
      return {
        commandId: envelope.commandId,
        command: { type: envelope.type },
      };
  }
}
