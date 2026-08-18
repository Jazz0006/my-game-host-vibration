export const DEFAULT_INTERACTION_TIMEOUT_SECONDS = 30;
export const INTERACTION_TIMEOUT_WARNING_SECONDS = 8;
export const INTERACTION_TIMEOUT_EXTENSION_SECONDS = 30;
export const MAX_INTERACTION_TIMEOUT_EXTENSIONS = 1;

export type InteractionTimeoutState = {
  roomId: string;
  actionId: string;
  actorPlayerIds: string[];
  startedAt: number;
  deadlineAt: number;
  warningAt: number;
  warningSent: boolean;
  extensionCount: number;
};

export type InteractionTimeoutClientState = {
  active: boolean;
  actionId?: string;
  deadlineAt?: number;
  warningAt?: number;
  warning?: boolean;
  canExtend?: boolean;
  extensionCount?: number;
};

function normalizedTimeoutSeconds(value: number | undefined): number {
  if (value === undefined) return DEFAULT_INTERACTION_TIMEOUT_SECONDS;
  if (!Number.isFinite(value)) return DEFAULT_INTERACTION_TIMEOUT_SECONDS;
  if (value <= 0) return 0;
  return Math.max(10, Math.min(120, Math.round(value)));
}

export class InteractionTimeoutCoordinator {
  private readonly timers = new Map<string, InteractionTimeoutState>();
  private readonly roomTimeoutSeconds = new Map<string, number>();

  getRoomTimeoutSeconds(roomId: string): number {
    return this.roomTimeoutSeconds.get(roomId) ?? DEFAULT_INTERACTION_TIMEOUT_SECONDS;
  }

  setRoomTimeoutSeconds(roomId: string, seconds: number): number {
    const normalized = normalizedTimeoutSeconds(seconds);
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

    const timeoutMs = timeoutSeconds * 1000;
    const warningLeadMs = Math.min(
      INTERACTION_TIMEOUT_WARNING_SECONDS * 1000,
      Math.max(1000, Math.floor(timeoutMs / 3)),
    );
    const state: InteractionTimeoutState = {
      roomId,
      actionId,
      actorPlayerIds: [...actorPlayerIds],
      startedAt: now,
      deadlineAt: now + timeoutMs,
      warningAt: now + timeoutMs - warningLeadMs,
      warningSent: false,
      extensionCount: 0,
    };
    this.timers.set(roomId, state);
    return existing
      ? { state, created: true, replaced: existing }
      : { state, created: true };
  }

  markWarningSent(roomId: string, actionId: string): InteractionTimeoutState | undefined {
    const state = this.timers.get(roomId);
    if (!state || state.actionId !== actionId || state.warningSent) return undefined;
    state.warningSent = true;
    return state;
  }

  extend(
    roomId: string,
    actionId: string,
    playerId: string,
    now: number = Date.now(),
  ): { ok: true; state: InteractionTimeoutState } | { ok: false; message: string } {
    const state = this.timers.get(roomId);
    if (!state || state.actionId !== actionId || now >= state.deadlineAt) {
      return { ok: false, message: "当前行动已经结束" };
    }
    if (!state.actorPlayerIds.includes(playerId)) {
      return { ok: false, message: "当前不是你的行动阶段" };
    }
    if (state.extensionCount >= MAX_INTERACTION_TIMEOUT_EXTENSIONS) {
      return { ok: false, message: "本次行动已经延长过一次" };
    }

    state.extensionCount += 1;
    state.deadlineAt += INTERACTION_TIMEOUT_EXTENSION_SECONDS * 1000;
    state.warningAt = state.deadlineAt - INTERACTION_TIMEOUT_WARNING_SECONDS * 1000;
    state.warningSent = false;
    return { ok: true, state };
  }

  clientState(state: InteractionTimeoutState, warning = false): InteractionTimeoutClientState {
    return {
      active: true,
      actionId: state.actionId,
      deadlineAt: state.deadlineAt,
      warningAt: state.warningAt,
      warning,
      canExtend: state.extensionCount < MAX_INTERACTION_TIMEOUT_EXTENSIONS,
      extensionCount: state.extensionCount,
    };
  }
}
