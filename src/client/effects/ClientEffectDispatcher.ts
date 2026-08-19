import {
  CLIENT_EFFECT_VIBRATE,
  type ClientVibrateEffectPayload,
} from "../../protocol/client/ClientEffects.js";
import type { ClientRealtimeEventEnvelope } from "../../protocol/client/ClientProtocol.js";

export type ClientEffectTarget = {
  vibrate(pattern: readonly number[]): unknown;
};

export type ClientEffectDispatchStatus =
  | "handled"
  | "ignored-unknown"
  | "ignored-invalid"
  | "target-failed";

function vibrationPattern(payload: unknown): number[] | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const pattern = (payload as Partial<ClientVibrateEffectPayload>).pattern;
  if (!Array.isArray(pattern) || pattern.length === 0) return null;
  if (!pattern.every(value => Number.isSafeInteger(value) && value >= 0)) return null;
  return [...pattern];
}

/**
 * Platform-neutral dispatcher for transient client effects.
 *
 * Unknown or malformed effects are deliberately ignored instead of failing the
 * synchronized session. Effect delivery is best-effort and never authoritative.
 */
export function dispatchClientRealtimeEffect(
  event: ClientRealtimeEventEnvelope,
  target: ClientEffectTarget,
): ClientEffectDispatchStatus {
  if (event.type !== CLIENT_EFFECT_VIBRATE) return "ignored-unknown";

  const pattern = vibrationPattern(event.payload);
  if (!pattern) return "ignored-invalid";

  try {
    target.vibrate(pattern);
    return "handled";
  } catch {
    return "target-failed";
  }
}
