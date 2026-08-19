export const CLIENT_CONNECTION_STATUSES = [
  "Idle",
  "Connecting",
  "Syncing",
  "Connected",
  "Disconnected",
  "Reconnecting",
  "Failed",
  "Disposed",
] as const;

export type ClientConnectionStatus = typeof CLIENT_CONNECTION_STATUSES[number];

export type ClientConnectionFailure = {
  code: string;
  message?: string;
};

export type ClientConnectionContext = {
  status: ClientConnectionStatus;
  generation: number;
  failure?: ClientConnectionFailure;
};

export type ClientConnectionEvent =
  | { type: "connectRequested" }
  | { type: "reconnectRequested" }
  | { type: "transportOpened"; generation: number }
  | { type: "transportClosed"; generation: number }
  | { type: "authoritativeStateSynchronized"; generation: number }
  | { type: "protocolFailed"; generation: number; failure: ClientConnectionFailure }
  | { type: "dispose" };

export type ClientConnectionEffect =
  | { type: "openTransport"; generation: number; reconnect: boolean }
  | { type: "synchronizeAuthoritativeState"; generation: number }
  | { type: "closeTransport"; generation: number };

export type ClientConnectionTransition = {
  context: ClientConnectionContext;
  effects: ClientConnectionEffect[];
};

export function createInitialClientConnectionContext(): ClientConnectionContext {
  return { status: "Idle", generation: 0 };
}

function assertGeneration(generation: number): void {
  if (!Number.isSafeInteger(generation) || generation < 0) {
    throw new Error("client connection generation must be a non-negative safe integer");
  }
}

function nextGeneration(currentGeneration: number): number {
  assertGeneration(currentGeneration);
  if (currentGeneration === Number.MAX_SAFE_INTEGER) {
    throw new Error("client connection generation cannot advance beyond the safe integer range");
  }
  return currentGeneration + 1;
}

function unchanged(context: ClientConnectionContext): ClientConnectionTransition {
  return { context, effects: [] };
}

function eventGeneration(event: ClientConnectionEvent): number | undefined {
  switch (event.type) {
    case "transportOpened":
    case "transportClosed":
    case "authoritativeStateSynchronized":
    case "protocolFailed":
      return event.generation;
    default:
      return undefined;
  }
}

function shouldCloseTransport(status: ClientConnectionStatus): boolean {
  return status === "Connecting" ||
    status === "Syncing" ||
    status === "Connected" ||
    status === "Reconnecting";
}

/**
 * Pure E2.2a connection state machine. Transport connectivity is deliberately
 * distinct from session synchronization: transportOpened enters Syncing, and
 * only authoritativeStateSynchronized may enter Connected.
 */
export function transitionClientConnection(
  context: ClientConnectionContext,
  event: ClientConnectionEvent,
): ClientConnectionTransition {
  assertGeneration(context.generation);

  if (context.status === "Disposed") return unchanged(context);

  const incomingGeneration = eventGeneration(event);
  if (incomingGeneration !== undefined) {
    assertGeneration(incomingGeneration);
    if (incomingGeneration !== context.generation) return unchanged(context);
  }

  switch (event.type) {
    case "connectRequested": {
      if (context.status !== "Idle" && context.status !== "Failed") {
        return unchanged(context);
      }
      const generation = nextGeneration(context.generation);
      return {
        context: { status: "Connecting", generation },
        effects: [{ type: "openTransport", generation, reconnect: false }],
      };
    }

    case "reconnectRequested": {
      if (context.status !== "Disconnected") return unchanged(context);
      const generation = nextGeneration(context.generation);
      return {
        context: { status: "Reconnecting", generation },
        effects: [{ type: "openTransport", generation, reconnect: true }],
      };
    }

    case "transportOpened":
      if (context.status !== "Connecting" && context.status !== "Reconnecting") {
        return unchanged(context);
      }
      return {
        context: { status: "Syncing", generation: context.generation },
        effects: [{
          type: "synchronizeAuthoritativeState",
          generation: context.generation,
        }],
      };

    case "authoritativeStateSynchronized":
      if (context.status !== "Syncing") return unchanged(context);
      return {
        context: { status: "Connected", generation: context.generation },
        effects: [],
      };

    case "transportClosed":
      if (!shouldCloseTransport(context.status)) return unchanged(context);
      return {
        context: { status: "Disconnected", generation: context.generation },
        effects: [],
      };

    case "protocolFailed":
      return {
        context: {
          status: "Failed",
          generation: context.generation,
          failure: { ...event.failure },
        },
        effects: shouldCloseTransport(context.status)
          ? [{ type: "closeTransport", generation: context.generation }]
          : [],
      };

    case "dispose":
      return {
        context: { status: "Disposed", generation: context.generation },
        effects: shouldCloseTransport(context.status)
          ? [{ type: "closeTransport", generation: context.generation }]
          : [],
      };
  }
}
