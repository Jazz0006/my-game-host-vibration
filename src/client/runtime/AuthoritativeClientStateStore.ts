import type { ClientStateEnvelope } from "../../protocol/client/ClientProtocol.js";

export type ClientSessionBinding = {
  roomId: string;
  playerId: string;
};

export type AuthoritativeClientStateSnapshot<TPayload = unknown> = {
  session: ClientSessionBinding | null;
  generation: number;
  revision: number | null;
  envelope: ClientStateEnvelope<TPayload> | null;
};

export type AuthoritativeStateUpdate<TPayload = unknown> = {
  generation: number;
  revision: number;
  envelope: ClientStateEnvelope<TPayload>;
};

export type AuthoritativeStateApplyStatus =
  | "applied"
  | "duplicate"
  | "stale-revision"
  | "stale-generation"
  | "session-mismatch";

export type AuthoritativeStateApplyResult<TPayload = unknown> = {
  status: AuthoritativeStateApplyStatus;
  snapshot: AuthoritativeClientStateSnapshot<TPayload>;
};

function requireNonEmptyString(value: string, fieldName: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${fieldName} is required`);
  return normalized;
}

function assertGeneration(generation: number): void {
  if (!Number.isSafeInteger(generation) || generation < 0) {
    throw new Error("client state generation must be a non-negative safe integer");
  }
}

function assertRevision(revision: number): void {
  if (!Number.isSafeInteger(revision) || revision < 0) {
    throw new Error("client state revision must be a non-negative safe integer");
  }
}

function assertAdvancingGeneration(currentGeneration: number, generation: number): void {
  assertGeneration(generation);
  if (generation <= currentGeneration) {
    throw new Error("client state generation must advance");
  }
}

/**
 * E2.2a authoritative PlayerView store. Revision is intentionally runtime
 * metadata for now because the E1 ClientStateEnvelope does not yet carry it on
 * the wire. The store never derives game state; it only accepts/rejects
 * authoritative protocol state by session, generation, and revision.
 */
export class AuthoritativeClientStateStore<TPayload = unknown> {
  private state: AuthoritativeClientStateSnapshot<TPayload> = {
    session: null,
    generation: 0,
    revision: null,
    envelope: null,
  };

  getSnapshot(): AuthoritativeClientStateSnapshot<TPayload> {
    return {
      ...this.state,
      session: this.state.session ? { ...this.state.session } : null,
    };
  }

  /**
   * Binds a completely new room/player session. Existing authoritative state is
   * cleared so a previous identity can never leak into the new session.
   */
  bindSession(binding: ClientSessionBinding, generation: number): void {
    assertAdvancingGeneration(this.state.generation, generation);
    this.state = {
      session: {
        roomId: requireNonEmptyString(binding.roomId, "roomId"),
        playerId: requireNonEmptyString(binding.playerId, "playerId"),
      },
      generation,
      revision: null,
      envelope: null,
    };
  }

  /**
   * Starts a new network/reconnect generation for the same bound session while
   * preserving the last trusted PlayerView for UI continuity during Syncing.
   */
  advanceGeneration(generation: number): void {
    if (!this.state.session) throw new Error("cannot advance an unbound client session");
    assertAdvancingGeneration(this.state.generation, generation);
    this.state = { ...this.state, generation };
  }

  /**
   * Explicit leave/dispose boundary. Advancing generation before clearing means
   * late results from the previous bound session remain stale even while no
   * session is active.
   */
  clearSession(generation: number): void {
    assertAdvancingGeneration(this.state.generation, generation);
    this.state = {
      session: null,
      generation,
      revision: null,
      envelope: null,
    };
  }

  apply(update: AuthoritativeStateUpdate<TPayload>): AuthoritativeStateApplyResult<TPayload> {
    assertGeneration(update.generation);
    assertRevision(update.revision);

    if (update.generation !== this.state.generation) {
      return this.result("stale-generation");
    }

    const session = this.state.session;
    const envelope = update.envelope;
    if (
      !session ||
      envelope.kind !== "state" ||
      envelope.scope !== "player" ||
      envelope.roomId !== session.roomId ||
      envelope.playerId !== session.playerId
    ) {
      return this.result("session-mismatch");
    }

    if (this.state.revision !== null) {
      if (update.revision === this.state.revision) {
        return this.result("duplicate");
      }
      if (update.revision < this.state.revision) {
        return this.result("stale-revision");
      }
    }

    this.state = {
      session: { ...session },
      generation: this.state.generation,
      revision: update.revision,
      envelope,
    };
    return this.result("applied");
  }

  private result(status: AuthoritativeStateApplyStatus): AuthoritativeStateApplyResult<TPayload> {
    return { status, snapshot: this.getSnapshot() };
  }
}
