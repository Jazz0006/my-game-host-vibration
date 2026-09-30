import { requireCommandId } from "../../core/command/CommandEnvelope.js";
import {
  CLIENT_PROTOCOL_VERSION,
  type ClientCommandEnvelope,
} from "./ClientProtocol.js";

export type BotcClientCommandEnvelope =
  | ClientCommandEnvelope<"botc.startGame", Record<string, never>>
  | ClientCommandEnvelope<"botc.confirmRole", Record<string, never>>
  | ClientCommandEnvelope<"botc.beginFirstNight", Record<string, never>>
  | ClientCommandEnvelope<"botc.submitNightChoice", { playerIds: string[] }>
  | ClientCommandEnvelope<"botc.commitNightInformation", Record<string, never>>
  | ClientCommandEnvelope<"botc.acknowledgeNightInformation", Record<string, never>>
  | ClientCommandEnvelope<"botc.completeNightStep", Record<string, never>>;

export const BOTC_CLIENT_COMMAND_TYPES = [
  "botc.startGame",
  "botc.confirmRole",
  "botc.beginFirstNight",
  "botc.submitNightChoice",
  "botc.commitNightInformation",
  "botc.acknowledgeNightInformation",
  "botc.completeNightStep",
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
  if (!TYPE_SET.has(String(record.type ?? ""))) {
    throw new Error("unsupported BotC client command type");
  }
  if (
    !record.payload ||
    typeof record.payload !== "object" ||
    Array.isArray(record.payload)
  ) {
    throw new Error("command payload must be an object");
  }

  const commandId = requireCommandId(record.commandId);
  switch (record.type) {
    case "botc.startGame":
    case "botc.confirmRole":
    case "botc.beginFirstNight":
    case "botc.commitNightInformation":
    case "botc.acknowledgeNightInformation":
    case "botc.completeNightStep":
      return {
        protocolVersion: CLIENT_PROTOCOL_VERSION,
        kind: "command",
        commandId,
        type: record.type,
        payload: {},
      };
    case "botc.submitNightChoice": {
      const payload = record.payload as Record<string, unknown>;
      if (
        !Array.isArray(payload.playerIds) ||
        payload.playerIds.some(
          playerId => typeof playerId !== "string" || !playerId.trim(),
        )
      ) {
        throw new Error("playerIds must be an array of non-empty strings");
      }
      return {
        protocolVersion: CLIENT_PROTOCOL_VERSION,
        kind: "command",
        commandId,
        type: "botc.submitNightChoice",
        payload: {
          playerIds: payload.playerIds.map(playerId => playerId.trim()),
        },
      };
    }
    default:
      throw new Error("unsupported BotC client command type");
  }
}
