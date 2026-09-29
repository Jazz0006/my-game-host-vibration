import { requireCommandId } from "../../core/command/CommandEnvelope.js";
import {
  CLIENT_PROTOCOL_VERSION,
  type ClientCommandEnvelope,
} from "./ClientProtocol.js";

export type RoomRecoveryCommand =
  | { type: "recovery.resendCurrentAction" }
  | { type: "recovery.abortToLobby" };

export type RoomRecoveryClientCommandEnvelope =
  | ClientCommandEnvelope<"recovery.resendCurrentAction", Record<string, never>>
  | ClientCommandEnvelope<"recovery.abortToLobby", Record<string, never>>;

export const ROOM_RECOVERY_CLIENT_COMMAND_TYPES = [
  "recovery.resendCurrentAction",
  "recovery.abortToLobby",
] as const;

const TYPE_SET = new Set<string>(ROOM_RECOVERY_CLIENT_COMMAND_TYPES);

export function isRoomRecoveryClientCommand(value: unknown): boolean {
  return Boolean(
    value &&
      typeof value === "object" &&
      TYPE_SET.has(String((value as Record<string, unknown>).type ?? "")),
  );
}

export function parseRoomRecoveryClientCommandEnvelope(
  value: unknown,
): RoomRecoveryClientCommandEnvelope {
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
    throw new Error("unsupported room recovery client command type");
  }
  if (!record.payload || typeof record.payload !== "object" || Array.isArray(record.payload)) {
    throw new Error("command payload must be an object");
  }

  return {
    protocolVersion: CLIENT_PROTOCOL_VERSION,
    kind: "command",
    commandId: requireCommandId(record.commandId),
    type: record.type,
    payload: {},
  } as RoomRecoveryClientCommandEnvelope;
}

export function mapRoomRecoveryClientCommand(
  envelope: RoomRecoveryClientCommandEnvelope,
): { commandId: string; command: RoomRecoveryCommand } {
  return {
    commandId: envelope.commandId,
    command: { type: envelope.type },
  };
}
