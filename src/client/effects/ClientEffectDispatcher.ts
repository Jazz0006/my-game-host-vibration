import {
  CLIENT_AUDIO_CUE_NIGHT_COMPLETE,
  CLIENT_EFFECT_AUDIO_CUE,
  CLIENT_EFFECT_VIBRATE,
  type ClientAudioCue,
  type ClientAudioCueEffectPayload,
  type ClientVibrateEffectPayload,
} from "../../protocol/client/ClientEffects.js";
import type { ClientRealtimeEventEnvelope } from "../../protocol/client/ClientProtocol.js";

export type ClientEffectTarget = {
  vibrate?(pattern: readonly number[]): unknown;
  playAudioCue?(cue: ClientAudioCue): unknown;
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

function audioCue(payload: unknown): ClientAudioCue | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const cue = (payload as Partial<ClientAudioCueEffectPayload>).cue;
  return cue === CLIENT_AUDIO_CUE_NIGHT_COMPLETE ? cue : null;
}

/**
 * Platform-neutral dispatcher for transient client effects.
 *
 * Unknown or malformed effects are deliberately ignored instead of failing the
 * synchronized session. Unsupported platform capabilities are safe no-ops.
 * Effect delivery is best-effort and never authoritative.
 */
export function dispatchClientRealtimeEffect(
  event: ClientRealtimeEventEnvelope,
  target: ClientEffectTarget,
): ClientEffectDispatchStatus {
  try {
    if (event.type === CLIENT_EFFECT_VIBRATE) {
      const pattern = vibrationPattern(event.payload);
      if (!pattern) return "ignored-invalid";
      target.vibrate?.(pattern);
      return "handled";
    }

    if (event.type === CLIENT_EFFECT_AUDIO_CUE) {
      const cue = audioCue(event.payload);
      if (!cue) return "ignored-invalid";
      target.playAudioCue?.(cue);
      return "handled";
    }

    return "ignored-unknown";
  } catch {
    return "target-failed";
  }
}
