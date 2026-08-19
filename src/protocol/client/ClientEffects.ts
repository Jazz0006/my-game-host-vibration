import {
  createClientRealtimeEventEnvelope,
  type ClientRealtimeEventEnvelope,
} from "./ClientProtocol.js";

export const CLIENT_EFFECT_VIBRATE = "client.effect.vibrate" as const;
export const CLIENT_EFFECT_AUDIO_CUE = "client.effect.audio-cue" as const;
export const CLIENT_AUDIO_CUE_NIGHT_COMPLETE = "night-complete" as const;

export type ClientAudioCue = typeof CLIENT_AUDIO_CUE_NIGHT_COMPLETE;

export type ClientVibrateEffectPayload = {
  pattern: number[];
  reason?: string;
  context?: Record<string, unknown>;
};

export type ClientAudioCueEffectPayload = {
  cue: ClientAudioCue;
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
 * Protocol-level client effect factories shared by server runtimes and clients.
 * Effects are transient hints only; they never replace authoritative state.
 * Audio cues are semantic so each client platform can choose its own playback
 * implementation instead of receiving browser-specific audio instructions.
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

export function createClientAudioCueEffectEvent(
  cue: ClientAudioCue,
  options: Omit<ClientAudioCueEffectPayload, "cue"> = {},
): ClientRealtimeEventEnvelope<typeof CLIENT_EFFECT_AUDIO_CUE, ClientAudioCueEffectPayload> {
  if (cue !== CLIENT_AUDIO_CUE_NIGHT_COMPLETE) {
    throw new Error("unsupported client audio cue");
  }
  return createClientRealtimeEventEnvelope(CLIENT_EFFECT_AUDIO_CUE, {
    cue,
    ...options,
  });
}
