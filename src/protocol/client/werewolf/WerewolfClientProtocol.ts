import { requireCommandId } from "../../../core/command/CommandEnvelope.js";
import type { WerewolfCommand } from "../../../games/werewolf/WerewolfGameModule.js";
import {
  CLIENT_PROTOCOL_VERSION,
  type ClientCommandEnvelope,
} from "../ClientProtocol.js";

export type WerewolfClientCommandEnvelope =
  | ClientCommandEnvelope<"werewolf.confirmRole", { actionId?: string }>
  | ClientCommandEnvelope<"werewolf.submitWolfTarget", { actionId?: string; targetPlayerId?: string | null }>
  | ClientCommandEnvelope<"werewolf.submitWitchAction", { actionId?: string; useAntidote?: boolean; poisonTargetId?: string | null }>
  | ClientCommandEnvelope<"werewolf.submitSeerTarget", { actionId?: string; targetPlayerId?: string }>
  | ClientCommandEnvelope<"werewolf.confirmSeerResult", { actionId?: string }>
  | ClientCommandEnvelope<"werewolf.submitGuardTarget", { actionId?: string; targetPlayerId?: string | null }>
  | ClientCommandEnvelope<"werewolf.submitHunterExecution", { actionId?: string; targetPlayerId?: string | null }>
  | ClientCommandEnvelope<"werewolf.submitVote", { actionId: string; targetId: string }>
  | ClientCommandEnvelope<"werewolf.startNight", Record<string, never>>
  | ClientCommandEnvelope<"werewolf.closeVoting", Record<string, never>>
  | ClientCommandEnvelope<"werewolf.beginNightStart", Record<string, never>>;

export type WerewolfProtocolAuthority = "player" | "host";

export type MappedWerewolfProtocolCommand = {
  authority: WerewolfProtocolAuthority;
  commandId: string;
  command: WerewolfCommand;
};

export const WEREWOLF_CLIENT_COMMAND_TYPES = [
  "werewolf.confirmRole",
  "werewolf.submitWolfTarget",
  "werewolf.submitWitchAction",
  "werewolf.submitSeerTarget",
  "werewolf.confirmSeerResult",
  "werewolf.submitGuardTarget",
  "werewolf.submitHunterExecution",
  "werewolf.submitVote",
  "werewolf.startNight",
  "werewolf.closeVoting",
  "werewolf.beginNightStart",
] as const;

export type WerewolfClientCommandType = typeof WEREWOLF_CLIENT_COMMAND_TYPES[number];

const WEREWOLF_CLIENT_COMMAND_TYPE_SET = new Set<string>(WEREWOLF_CLIENT_COMMAND_TYPES);

function payloadRecord(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("command payload must be an object");
  }
  return payload as Record<string, unknown>;
}

function optionalString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new Error(`${key} must be a string`);
  return value;
}

function requiredString(record: Record<string, unknown>, key: string): string {
  const value = optionalString(record, key)?.trim();
  if (!value) throw new Error(`${key} is required`);
  return value;
}

function optionalNullableString(
  record: Record<string, unknown>,
  key: string,
): string | null | undefined {
  const value = record[key];
  if (value === undefined || value === null) return value;
  if (typeof value !== "string") throw new Error(`${key} must be a string or null`);
  return value;
}

function optionalBoolean(record: Record<string, unknown>, key: string): boolean | undefined {
  const value = record[key];
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") throw new Error(`${key} must be a boolean`);
  return value;
}

function withActionId<T extends object>(
  command: T,
  actionId: string | undefined,
): T & { actionId?: string } {
  return actionId === undefined ? command : { ...command, actionId };
}

function requireEnvelopeBase(value: unknown): {
  commandId: string;
  type: WerewolfClientCommandType;
  payload: Record<string, unknown>;
} {
  if (!value || typeof value !== "object") throw new Error("client command envelope is required");
  const record = value as Record<string, unknown>;
  if (record.protocolVersion !== CLIENT_PROTOCOL_VERSION) {
    throw new Error("unsupported client protocol version");
  }
  if (record.kind !== "command") throw new Error("client protocol message is not a command");
  if (typeof record.type !== "string" || !WEREWOLF_CLIENT_COMMAND_TYPE_SET.has(record.type)) {
    throw new Error("unsupported Werewolf client command type");
  }
  return {
    commandId: requireCommandId(record.commandId),
    type: record.type as WerewolfClientCommandType,
    payload: payloadRecord(record.payload),
  };
}

export function parseWerewolfClientCommandEnvelope(value: unknown): WerewolfClientCommandEnvelope {
  const base = requireEnvelopeBase(value);
  const { payload } = base;

  switch (base.type) {
    case "werewolf.confirmRole":
    case "werewolf.confirmSeerResult": {
      const actionId = optionalString(payload, "actionId");
      return {
        protocolVersion: CLIENT_PROTOCOL_VERSION,
        kind: "command",
        commandId: base.commandId,
        type: base.type,
        payload: actionId === undefined ? {} : { actionId },
      } as WerewolfClientCommandEnvelope;
    }

    case "werewolf.submitWolfTarget":
    case "werewolf.submitGuardTarget":
    case "werewolf.submitHunterExecution": {
      const actionId = optionalString(payload, "actionId");
      const targetPlayerId = optionalNullableString(payload, "targetPlayerId");
      return {
        protocolVersion: CLIENT_PROTOCOL_VERSION,
        kind: "command",
        commandId: base.commandId,
        type: base.type,
        payload: {
          ...(actionId === undefined ? {} : { actionId }),
          ...(targetPlayerId === undefined ? {} : { targetPlayerId }),
        },
      } as WerewolfClientCommandEnvelope;
    }

    case "werewolf.submitWitchAction": {
      const actionId = optionalString(payload, "actionId");
      const useAntidote = optionalBoolean(payload, "useAntidote");
      const poisonTargetId = optionalNullableString(payload, "poisonTargetId");
      return {
        protocolVersion: CLIENT_PROTOCOL_VERSION,
        kind: "command",
        commandId: base.commandId,
        type: base.type,
        payload: {
          ...(actionId === undefined ? {} : { actionId }),
          ...(useAntidote === undefined ? {} : { useAntidote }),
          ...(poisonTargetId === undefined ? {} : { poisonTargetId }),
        },
      };
    }

    case "werewolf.submitSeerTarget": {
      const actionId = optionalString(payload, "actionId");
      const targetPlayerId = optionalString(payload, "targetPlayerId");
      return {
        protocolVersion: CLIENT_PROTOCOL_VERSION,
        kind: "command",
        commandId: base.commandId,
        type: base.type,
        payload: {
          ...(actionId === undefined ? {} : { actionId }),
          ...(targetPlayerId === undefined ? {} : { targetPlayerId }),
        },
      };
    }

    case "werewolf.submitVote":
      return {
        protocolVersion: CLIENT_PROTOCOL_VERSION,
        kind: "command",
        commandId: base.commandId,
        type: base.type,
        payload: {
          actionId: requiredString(payload, "actionId"),
          targetId: requiredString(payload, "targetId"),
        },
      };

    case "werewolf.startNight":
    case "werewolf.closeVoting":
    case "werewolf.beginNightStart":
      return {
        protocolVersion: CLIENT_PROTOCOL_VERSION,
        kind: "command",
        commandId: base.commandId,
        type: base.type,
        payload: {},
      } as WerewolfClientCommandEnvelope;
  }
}

export function mapWerewolfClientCommand(
  envelope: WerewolfClientCommandEnvelope,
): MappedWerewolfProtocolCommand {
  const commandId = requireCommandId(envelope.commandId);

  switch (envelope.type) {
    case "werewolf.confirmRole":
      return {
        authority: "player",
        commandId,
        command: withActionId({ type: "confirmRole" as const }, envelope.payload.actionId),
      };

    case "werewolf.submitWolfTarget":
      return {
        authority: "player",
        commandId,
        command: withActionId(
          {
            type: "submitWolfTarget" as const,
            ...(envelope.payload.targetPlayerId === undefined
              ? {}
              : { targetPlayerId: envelope.payload.targetPlayerId }),
          },
          envelope.payload.actionId,
        ),
      };

    case "werewolf.submitWitchAction":
      return {
        authority: "player",
        commandId,
        command: withActionId(
          {
            type: "submitWitchAction" as const,
            ...(envelope.payload.useAntidote === undefined
              ? {}
              : { useAntidote: envelope.payload.useAntidote }),
            ...(envelope.payload.poisonTargetId === undefined
              ? {}
              : { poisonTargetId: envelope.payload.poisonTargetId }),
          },
          envelope.payload.actionId,
        ),
      };

    case "werewolf.submitSeerTarget":
      return {
        authority: "player",
        commandId,
        command: withActionId(
          {
            type: "submitSeerTarget" as const,
            ...(envelope.payload.targetPlayerId === undefined
              ? {}
              : { targetPlayerId: envelope.payload.targetPlayerId }),
          },
          envelope.payload.actionId,
        ),
      };

    case "werewolf.confirmSeerResult":
      return {
        authority: "player",
        commandId,
        command: withActionId({ type: "confirmSeerResult" as const }, envelope.payload.actionId),
      };

    case "werewolf.submitGuardTarget":
      return {
        authority: "player",
        commandId,
        command: withActionId(
          {
            type: "submitGuardTarget" as const,
            ...(envelope.payload.targetPlayerId === undefined
              ? {}
              : { targetPlayerId: envelope.payload.targetPlayerId }),
          },
          envelope.payload.actionId,
        ),
      };

    case "werewolf.submitHunterExecution":
      return {
        authority: "player",
        commandId,
        command: withActionId(
          {
            type: "submitHunterExecution" as const,
            ...(envelope.payload.targetPlayerId === undefined
              ? {}
              : { targetPlayerId: envelope.payload.targetPlayerId }),
          },
          envelope.payload.actionId,
        ),
      };

    case "werewolf.submitVote":
      return {
        authority: "player",
        commandId,
        command: {
          type: "submitVote",
          actionId: envelope.payload.actionId,
          targetId: envelope.payload.targetId,
        },
      };

    case "werewolf.startNight":
      return { authority: "host", commandId, command: { type: "startNight" } };

    case "werewolf.closeVoting":
      return { authority: "host", commandId, command: { type: "closeDayVote" } };

    case "werewolf.beginNightStart":
      return { authority: "host", commandId, command: { type: "beginNightStart" } };
  }
}
