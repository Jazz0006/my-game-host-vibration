export type CommandEnvelope<TCommand> = {
  commandId: string;
  command: TCommand;
};

export function requireCommandId(value: unknown): string {
  if (typeof value !== "string") {
    throw new Error("commandId is required");
  }
  const commandId = value.trim();
  if (!commandId) {
    throw new Error("commandId is required");
  }
  return commandId;
}

export function parseCommandEnvelope<TCommand>(
  value: unknown,
  parseCommand: (value: unknown) => TCommand,
): CommandEnvelope<TCommand> {
  if (!value || typeof value !== "object") {
    throw new Error("command envelope is required");
  }

  const record = value as Record<string, unknown>;
  return {
    commandId: requireCommandId(record.commandId),
    command: parseCommand(record.command),
  };
}
