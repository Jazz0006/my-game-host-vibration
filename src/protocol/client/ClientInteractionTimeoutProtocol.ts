import { requireCommandId } from "../../core/command/CommandEnvelope.js";
import {
  CLIENT_PROTOCOL_VERSION,
  type ClientCommandEnvelope,
} from "./ClientProtocol.js";

export type InteractionTimeoutCommand =
  | { type: "interactionTimeout.getConfig" }
  | { type: "interactionTimeout.setConfig"; timeoutSeconds: number }
  | { type: "interactionTimeout.extend"; actionId: string };

export type InteractionTimeoutClientCommandEnvelope =
  | ClientCommandEnvelope<
      "interactionTimeout.getConfig",
      Record<string, never>
    >
  | ClientCommandEnvelope<
      "interactionTimeout.setConfig",
      { timeoutSeconds: number }
    >
  | ClientCommandEnvelope<
      "interactionTimeout.extend",
      { actionId: string }
    >;

export const INTERACTION_TIMEOUT_CLIENT_COMMAND_TYPES = [
  "interactionTimeout.getConfig",
  "interactionTimeout.setConfig",
  "interactionTimeout.extend",
] as const;

const TYPE_SET = new Set<string>(INTERACTION_TIMEOUT_CLIENT_COMMAND_TYPES);

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("command payload must be an object");
  }
  return value as Record<string, unknown>;
}

export function isInteractionTimeoutClientCommand(value: unknown): boolean {
  return Boolean(
    value &&
      typeof value === "object" &&
      TYPE_SET.has(String((value as Record<string, unknown>).type ?? "")),
  );
}

export function parseInteractionTimeoutClientCommandEnvelope(
  value: unknown,
): InteractionTimeoutClientCommandEnvelope {
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
    throw new Error("unsupported interaction timeout command type");
  }

  const commandId = requireCommandId(record.commandId);
  const payload = asRecord(record.payload);

  if (record.type === "interactionTimeout.getConfig") {
    return {
      protocolVersion: CLIENT_PROTOCOL_VERSION,
      kind: "command",
      commandId,
      type: record.type,
      payload: {},
    };
  }

  if (record.type === "interactionTimeout.setConfig") {
    const timeoutSeconds = payload.timeoutSeconds;
    if (typeof timeoutSeconds !== "number" || !Number.isFinite(timeoutSeconds)) {
      throw new Error("timeoutSeconds must be a finite number");
    }
    return {
      protocolVersion: CLIENT_PROTOCOL_VERSION,
      kind: "command",
      commandId,
      type: record.type,
      payload: { timeoutSeconds },
    };
  }

  const actionId = payload.actionId;
  if (typeof actionId !== "string" || !actionId.trim()) {
    throw new Error("actionId is required");
  }
  return {
    protocolVersion: CLIENT_PROTOCOL_VERSION,
    kind: "command",
    commandId,
    type: "interactionTimeout.extend",
    payload: { actionId: actionId.trim() },
  };
}

export function mapInteractionTimeoutClientCommand(
  envelope: InteractionTimeoutClientCommandEnvelope,
): { commandId: string; command: InteractionTimeoutCommand } {
  switch (envelope.type) {
    case "interactionTimeout.getConfig":
      return {
        commandId: envelope.commandId,
        command: { type: envelope.type },
      };
    case "interactionTimeout.setConfig":
      return {
        commandId: envelope.commandId,
        command: {
          type: envelope.type,
          timeoutSeconds: envelope.payload.timeoutSeconds,
        },
      };
    case "interactionTimeout.extend":
      return {
        commandId: envelope.commandId,
        command: {
          type: envelope.type,
          actionId: envelope.payload.actionId,
        },
      };
  }
}
