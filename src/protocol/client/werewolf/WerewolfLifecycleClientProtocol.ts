import { requireCommandId } from "../../../core/command/CommandEnvelope.js";
import type { Role } from "../../../domain/game.js";
import {
  CLIENT_PROTOCOL_VERSION,
  type ClientCommandEnvelope,
} from "../ClientProtocol.js";

export type WerewolfLifecycleClientCommandEnvelope =
  | ClientCommandEnvelope<"werewolf.startGame", { roleDeck?: Role[] }>
  | ClientCommandEnvelope<"werewolf.restartGame", Record<string, never>>;

export const WEREWOLF_LIFECYCLE_CLIENT_COMMAND_TYPES = [
  "werewolf.startGame",
  "werewolf.restartGame",
] as const;

const TYPE_SET = new Set<string>(WEREWOLF_LIFECYCLE_CLIENT_COMMAND_TYPES);

export function isWerewolfLifecycleClientCommand(value: unknown): boolean {
  return Boolean(
    value &&
      typeof value === "object" &&
      TYPE_SET.has(String((value as Record<string, unknown>).type ?? "")),
  );
}

export function parseWerewolfLifecycleClientCommandEnvelope(
  value: unknown,
): WerewolfLifecycleClientCommandEnvelope {
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
    throw new Error("unsupported Werewolf lifecycle client command type");
  }
  if (!record.payload || typeof record.payload !== "object" || Array.isArray(record.payload)) {
    throw new Error("command payload must be an object");
  }

  const commandId = requireCommandId(record.commandId);
  const payload = record.payload as Record<string, unknown>;

  if (record.type === "werewolf.startGame") {
    const roleDeck = payload.roleDeck;
    if (
      roleDeck !== undefined &&
      (!Array.isArray(roleDeck) || roleDeck.some(role => typeof role !== "string"))
    ) {
      throw new Error("roleDeck must be a string array");
    }
    return {
      protocolVersion: CLIENT_PROTOCOL_VERSION,
      kind: "command",
      commandId,
      type: "werewolf.startGame",
      payload: roleDeck === undefined ? {} : { roleDeck: roleDeck as Role[] },
    };
  }

  return {
    protocolVersion: CLIENT_PROTOCOL_VERSION,
    kind: "command",
    commandId,
    type: "werewolf.restartGame",
    payload: {},
  };
}
