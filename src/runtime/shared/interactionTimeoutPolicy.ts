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

export function normalizeInteractionTimeoutSeconds(
  value: number | undefined,
): number {
  if (value === undefined) return DEFAULT_INTERACTION_TIMEOUT_SECONDS;
  if (!Number.isFinite(value)) return DEFAULT_INTERACTION_TIMEOUT_SECONDS;
  if (value <= 0) return 0;
  return Math.max(10, Math.min(120, Math.round(value)));
}

export function createInteractionTimeoutState(
  roomId: string,
  actionId: string,
  actorPlayerIds: readonly string[],
  now: number,
  timeoutSeconds: number,
): InteractionTimeoutState | undefined {
  if (timeoutSeconds <= 0 || actorPlayerIds.length === 0) return undefined;

  const timeoutMs = timeoutSeconds * 1000;
  const warningLeadMs = Math.min(
    INTERACTION_TIMEOUT_WARNING_SECONDS * 1000,
    Math.max(1000, Math.floor(timeoutMs / 3)),
  );

  return {
    roomId,
    actionId,
    actorPlayerIds: [...actorPlayerIds],
    startedAt: now,
    deadlineAt: now + timeoutMs,
    warningAt: now + timeoutMs - warningLeadMs,
    warningSent: false,
    extensionCount: 0,
  };
}

export function markInteractionTimeoutWarning(
  state: InteractionTimeoutState,
  actionId: string,
): InteractionTimeoutState | undefined {
  if (state.actionId !== actionId || state.warningSent) return undefined;
  return { ...state, warningSent: true };
}

export function extendInteractionTimeout(
  state: InteractionTimeoutState | undefined,
  actionId: string,
  playerId: string,
  now: number,
):
  | { ok: true; state: InteractionTimeoutState }
  | { ok: false; message: string } {
  if (!state || state.actionId !== actionId || now >= state.deadlineAt) {
    return { ok: false, message: "当前行动已经结束" };
  }
  if (!state.actorPlayerIds.includes(playerId)) {
    return { ok: false, message: "当前不是你的行动阶段" };
  }
  if (state.extensionCount >= MAX_INTERACTION_TIMEOUT_EXTENSIONS) {
    return { ok: false, message: "本次行动已经延长过一次" };
  }

  const next = {
    ...state,
    extensionCount: state.extensionCount + 1,
    deadlineAt:
      state.deadlineAt + INTERACTION_TIMEOUT_EXTENSION_SECONDS * 1000,
    warningAt:
      state.deadlineAt +
      INTERACTION_TIMEOUT_EXTENSION_SECONDS * 1000 -
      INTERACTION_TIMEOUT_WARNING_SECONDS * 1000,
    warningSent: false,
  };
  return { ok: true, state: next };
}

export function interactionTimeoutClientState(
  state: InteractionTimeoutState,
  warning = false,
): InteractionTimeoutClientState {
  return {
    active: true,
    actionId: state.actionId,
    deadlineAt: state.deadlineAt,
    warningAt: state.warningAt,
    warning,
    canExtend:
      state.extensionCount < MAX_INTERACTION_TIMEOUT_EXTENSIONS,
    extensionCount: state.extensionCount,
  };
}
