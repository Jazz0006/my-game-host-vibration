import { requireCommandId } from "../../core/command/CommandEnvelope.js";
import {
  CLIENT_PROTOCOL_VERSION,
  type ClientCommandEnvelope,
} from "./ClientProtocol.js";

export type BotcClientCommandEnvelope =
  ClientCommandEnvelope<"botc.startGame", Record<string, never>>;

export const BOTC_CLIENT_COMMAND_TYPES = [
  "botc.startGame",
] as const;

const TYPE_SET = new Set<string>(BOTC_CLIENT_COMMAND_TYPES);

export function isBotcClientCommand(value: unknown): boolean {
  return Boolean(
    value &&
      typeof value === "object" &&
      TYPE_SET.has(String((value as Record<string, unknown>).type ?? "")),
  );
}

export function parseBotcClientCommandEnvelope(
  value: unknown,
): BotcClientCommandEnvelope {
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
  if (record.type !== "botc.startGame") {
    throw new Error("unsupported BotC client command type");
  }
  if (
    !record.payload ||
    typeof record.payload !== "object" ||
    Array.isArray(record.payload)
  ) {
    throw new Error("command payload must be an object");
  }

  return {
    protocolVersion: CLIENT_PROTOCOL_VERSION,
    kind: "command",
    commandId: requireCommandId(record.commandId),
    type: "botc.startGame",
    payload: {},
  };
}
