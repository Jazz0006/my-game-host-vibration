import {
  createClientRealtimeEventEnvelope,
  type ClientRealtimeEventEnvelope,
} from "./ClientProtocol.js";

export const CLIENT_EFFECT_VIBRATE = "client.effect.vibrate" as const;

export type ClientVibrateEffectPayload = {
  pattern: number[];
  reason?: string;
  context?: Record<string, unknown>;
};

function normalizeVibrationPattern(pattern: readonly number[]): number[] {
  if (pattern.length === 0) throw new Error("vibration pattern is required");
  return pattern.map(value => {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error("vibration pattern values must be non-negative safe integers");
    }
    return value;
  });
}

/**
 * Protocol-level client effect factory shared by server runtimes and clients.
 * Effects are transient hints only; they never replace authoritative state.
 */
export function createClientVibrateEffectEvent(
  pattern: readonly number[],
  options: Omit<ClientVibrateEffectPayload, "pattern"> = {},
): ClientRealtimeEventEnvelope<typeof CLIENT_EFFECT_VIBRATE, ClientVibrateEffectPayload> {
  return createClientRealtimeEventEnvelope(CLIENT_EFFECT_VIBRATE, {
    pattern: normalizeVibrationPattern(pattern),
    ...options,
  });
}
