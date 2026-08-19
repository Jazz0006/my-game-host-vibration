import {
  createReconnectEnvelope,
  type ClientProtocolMessage,
  type ClientReconnectCredentials,
} from "../../protocol/client/ClientProtocol.js";
import {
  AuthoritativeClientStateStore,
  type AuthoritativeClientStateSnapshot,
  type AuthoritativeStateApplyStatus,
} from "./AuthoritativeClientStateStore.js";
import {
  createInitialClientConnectionContext,
  transitionClientConnection,
  type ClientConnectionContext,
  type ClientConnectionEffect,
  type ClientConnectionEvent,
  type ClientConnectionFailure,
} from "./ClientConnectionFSM.js";
import type {
  ClientAuthoritativeStateDelivery,
  ClientRealtimeTransport,
} from "./ClientRealtimeTransport.js";

export type ClientSessionSnapshot<TStatePayload = unknown> = {
  connection: ClientConnectionContext;
  authoritativeState: AuthoritativeClientStateSnapshot<TStatePayload>;
};

export type ClientSessionListener<TStatePayload = unknown> = (
  snapshot: ClientSessionSnapshot<TStatePayload>,
) => void;

function clonedConnection(context: ClientConnectionContext): ClientConnectionContext {
  return context.failure
    ? { ...context, failure: { ...context.failure } }
    : { ...context };
}

function synchronizationFailure(
  status: Exclude<AuthoritativeStateApplyStatus, "applied" | "duplicate" | "stale-generation">,
): ClientConnectionFailure {
  if (status === "stale-revision") {
    return {
      code: "stale-authoritative-revision",
      message: "authoritative synchronization returned an older revision",
    };
  }
  return {
    code: "authoritative-session-mismatch",
    message: "authoritative synchronization returned state for another session",
  };
}

function sessionMismatchFailure(): ClientConnectionFailure {
  return {
    code: "authoritative-session-mismatch",
    message: "authoritative state push belongs to another session",
  };
}

/**
 * E2.2b transport-neutral client session manager.
 *
 * The session is intentionally imperative while ClientConnectionFSM remains a
 * pure reducer. ClientSession interprets FSM effects, keeps the state store and
 * FSM on the same active generation, reconciles both explicit sync responses
 * and realtime authoritative state pushes, and only reports Connected after a
 * current PlayerView has been accepted (or confirmed duplicate).
 */
export class ClientSession<TStatePayload = unknown> {
  private connection: ClientConnectionContext = createInitialClientConnectionContext();
  private readonly stateStore = new AuthoritativeClientStateStore<TStatePayload>();
  private readonly listeners = new Set<ClientSessionListener<TStatePayload>>();
  private credentials: ClientReconnectCredentials | null = null;

  constructor(private readonly transport: ClientRealtimeTransport<TStatePayload>) {
    transport.setListener({
      onOpen: generation => {
        this.dispatch({ type: "transportOpened", generation });
      },
      onClose: generation => {
        this.dispatch({ type: "transportClosed", generation });
      },
      onError: (generation, failure) => {
        this.dispatch({ type: "protocolFailed", generation, failure });
      },
      onState: delivery => {
        this.receiveAuthoritativeState(delivery);
      },
    });
  }

  getConnectionState(): ClientConnectionContext {
    return clonedConnection(this.connection);
  }

  getAuthoritativeState(): AuthoritativeClientStateSnapshot<TStatePayload> {
    return this.stateStore.getSnapshot();
  }

  getSnapshot(): ClientSessionSnapshot<TStatePayload> {
    return {
      connection: this.getConnectionState(),
      authoritativeState: this.getAuthoritativeState(),
    };
  }

  subscribe(listener: ClientSessionListener<TStatePayload>): () => void {
    this.listeners.add(listener);
    listener(this.getSnapshot());
    return () => {
      this.listeners.delete(listener);
    };
  }

  start(credentials: ClientReconnectCredentials): void {
    if (this.connection.status !== "Idle") {
      throw new Error("client session has already started");
    }

    const normalized = createReconnectEnvelope(credentials).credentials;
    const transition = transitionClientConnection(this.connection, { type: "connectRequested" });
    this.connection = transition.context;
    this.credentials = normalized;
    this.stateStore.bindSession(
      { roomId: normalized.roomId, playerId: normalized.playerId },
      this.connection.generation,
    );
    this.notify();
    this.runEffects(transition.effects);
  }

  reconnect(): void {
    const previousGeneration = this.connection.generation;
    const transition = transitionClientConnection(this.connection, { type: "reconnectRequested" });
    this.connection = transition.context;

    if (this.connection.generation !== previousGeneration) {
      this.stateStore.advanceGeneration(this.connection.generation);
      this.notify();
    }
    this.runEffects(transition.effects);
  }

  send(message: ClientProtocolMessage): Promise<unknown> {
    if (this.connection.status !== "Connected") {
      return Promise.reject(new Error("client session is not synchronized"));
    }
    return this.transport.send(message);
  }

  dispose(): void {
    if (this.connection.status === "Disposed") return;

    const transition = transitionClientConnection(this.connection, { type: "dispose" });
    this.connection = transition.context;
    this.credentials = null;

    const state = this.stateStore.getSnapshot();
    if (state.session) {
      if (state.generation === Number.MAX_SAFE_INTEGER) {
        throw new Error("client session generation cannot advance beyond the safe integer range");
      }
      this.stateStore.clearSession(state.generation + 1);
    }

    this.notify();
    this.runEffects(transition.effects);
    this.listeners.clear();
  }

  private dispatch(event: ClientConnectionEvent): void {
    const previous = this.connection;
    const transition = transitionClientConnection(this.connection, event);
    this.connection = transition.context;
    if (this.connection !== previous) this.notify();
    this.runEffects(transition.effects);
  }

  private runEffects(effects: readonly ClientConnectionEffect[]): void {
    for (const effect of effects) {
      switch (effect.type) {
        case "openTransport":
          this.transport.connect(effect.generation);
          break;

        case "closeTransport":
          this.transport.disconnect(effect.generation);
          break;

        case "synchronizeAuthoritativeState":
          this.synchronize(effect.generation);
          break;
      }
    }
  }

  private synchronize(generation: number): void {
    const credentials = this.credentials;
    if (!credentials) {
      this.dispatch({
        type: "protocolFailed",
        generation,
        failure: { code: "missing-session-credentials" },
      });
      return;
    }

    void this.transport.synchronize(credentials, generation).then(
      delivery => this.acceptSynchronization(generation, delivery),
      error => {
        if (!this.isCurrentSync(generation)) return;
        const message = error instanceof Error ? error.message.trim() : "";
        const failure: ClientConnectionFailure = message
          ? { code: "authoritative-sync-failed", message }
          : { code: "authoritative-sync-failed" };
        this.dispatch({ type: "protocolFailed", generation, failure });
      },
    );
  }

  private acceptSynchronization(
    generation: number,
    delivery: ClientAuthoritativeStateDelivery<TStatePayload>,
  ): void {
    // A realtime state push may have completed Syncing before the explicit
    // sync request resolves. In that case the late response is redundant.
    if (!this.isCurrentSync(generation)) return;

    const result = this.stateStore.apply(delivery);
    switch (result.status) {
      case "applied":
      case "duplicate":
        this.dispatch({ type: "authoritativeStateSynchronized", generation });
        return;

      case "stale-generation":
        return;

      case "stale-revision":
      case "session-mismatch":
        this.dispatch({
          type: "protocolFailed",
          generation,
          failure: synchronizationFailure(result.status),
        });
        return;
    }
  }

  private receiveAuthoritativeState(
    delivery: ClientAuthoritativeStateDelivery<TStatePayload>,
  ): void {
    if (this.connection.status !== "Syncing" && this.connection.status !== "Connected") {
      return;
    }

    const result = this.stateStore.apply(delivery);
    switch (result.status) {
      case "applied":
        if (this.connection.status === "Syncing") {
          this.dispatch({
            type: "authoritativeStateSynchronized",
            generation: this.connection.generation,
          });
        } else {
          this.notify();
        }
        return;

      case "duplicate":
        if (this.connection.status === "Syncing") {
          this.dispatch({
            type: "authoritativeStateSynchronized",
            generation: this.connection.generation,
          });
        }
        return;

      case "stale-generation":
      case "stale-revision":
        // Realtime delivery may be reordered. Older pushes are harmless because
        // the state store has already retained the newer authoritative view.
        return;

      case "session-mismatch":
        this.dispatch({
          type: "protocolFailed",
          generation: this.connection.generation,
          failure: sessionMismatchFailure(),
        });
        return;
    }
  }

  private isCurrentSync(generation: number): boolean {
    return this.connection.status === "Syncing" && this.connection.generation === generation;
  }

  private notify(): void {
    if (this.listeners.size === 0) return;
    const snapshot = this.getSnapshot();
    for (const listener of this.listeners) listener(snapshot);
  }
}
