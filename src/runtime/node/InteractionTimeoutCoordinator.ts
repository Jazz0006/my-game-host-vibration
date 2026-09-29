import {
  DEFAULT_INTERACTION_TIMEOUT_SECONDS,
  createInteractionTimeoutState,
  extendInteractionTimeout,
  interactionTimeoutClientState,
  markInteractionTimeoutWarning,
  normalizeInteractionTimeoutSeconds,
  type InteractionTimeoutClientState,
  type InteractionTimeoutState,
} from "../shared/interactionTimeoutPolicy.js";

export {
  DEFAULT_INTERACTION_TIMEOUT_SECONDS,
  INTERACTION_TIMEOUT_EXTENSION_SECONDS,
  INTERACTION_TIMEOUT_WARNING_SECONDS,
  MAX_INTERACTION_TIMEOUT_EXTENSIONS,
  type InteractionTimeoutClientState,
  type InteractionTimeoutState,
} from "../shared/interactionTimeoutPolicy.js";

export class InteractionTimeoutCoordinator {
  private readonly timers = new Map<string, InteractionTimeoutState>();
  private readonly roomTimeoutSeconds = new Map<string, number>();

  getRoomTimeoutSeconds(roomId: string): number {
    return this.roomTimeoutSeconds.get(roomId) ?? DEFAULT_INTERACTION_TIMEOUT_SECONDS;
  }

  setRoomTimeoutSeconds(roomId: string, seconds: number): number {
    const normalized = normalizeInteractionTimeoutSeconds(seconds);
    this.roomTimeoutSeconds.set(roomId, normalized);
    this.timers.delete(roomId);
    return normalized;
  }

  get(roomId: string): InteractionTimeoutState | undefined {
    return this.timers.get(roomId);
  }

  clear(roomId: string): InteractionTimeoutState | undefined {
    const current = this.timers.get(roomId);
    this.timers.delete(roomId);
    return current;
  }

  ensure(
    roomId: string,
    actionId: string,
    actorPlayerIds: readonly string[],
    now: number,
  ): { state?: InteractionTimeoutState; created: boolean; replaced?: InteractionTimeoutState } {
    const timeoutSeconds = this.getRoomTimeoutSeconds(roomId);
    const existing = this.timers.get(roomId);

    if (timeoutSeconds <= 0 || actorPlayerIds.length === 0) {
      if (existing) {
        this.timers.delete(roomId);
        return { created: false, replaced: existing };
      }
      return { created: false };
    }

    if (existing?.actionId === actionId) return { state: existing, created: false };

    const state = createInteractionTimeoutState(
      roomId,
      actionId,
      actorPlayerIds,
      now,
      timeoutSeconds,
    );
    if (!state) {
      if (existing) {
        this.timers.delete(roomId);
        return { created: false, replaced: existing };
      }
      return { created: false };
    }
    this.timers.set(roomId, state);
    return existing
      ? { state, created: true, replaced: existing }
      : { state, created: true };
  }

  markWarningSent(roomId: string, actionId: string): InteractionTimeoutState | undefined {
    const state = this.timers.get(roomId);
    if (!state) return undefined;
    const warned = markInteractionTimeoutWarning(state, actionId);
    if (!warned) return undefined;
    this.timers.set(roomId, warned);
    return warned;
  }

  extend(
    roomId: string,
    actionId: string,
    playerId: string,
    now: number = Date.now(),
  ): { ok: true; state: InteractionTimeoutState } | { ok: false; message: string } {
    const result = extendInteractionTimeout(
      this.timers.get(roomId),
      actionId,
      playerId,
      now,
    );
    if (!result.ok) return result;
    this.timers.set(roomId, result.state);
    return result;
  }

  clientState(state: InteractionTimeoutState, warning = false): InteractionTimeoutClientState {
    return interactionTimeoutClientState(state, warning);
  }
}
