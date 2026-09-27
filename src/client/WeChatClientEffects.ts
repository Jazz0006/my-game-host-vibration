import {
  CLIENT_AUDIO_CUE_NIGHT_COMPLETE,
  type ClientAudioCue,
} from "../protocol/client/ClientEffects.js";
import type { ClientSessionRealtimeEventListener } from "./runtime/ClientSession.js";
import { dispatchClientRealtimeEffect } from "./effects/ClientEffectDispatcher.js";

export type WeChatRealtimeEventSource = {
  subscribeRealtimeEvents(listener: ClientSessionRealtimeEventListener): () => void;
};

export type WeChatInnerAudioContextLike = {
  src: string;
  play(): void;
  stop?(): void;
  destroy?(): void;
};

export type WeChatClientEffectPlatform = {
  vibrateShort?(options?: { type?: "heavy" | "medium" | "light" }): unknown;
  vibrateLong?(options?: Record<string, never>): unknown;
  createInnerAudioContext?(): WeChatInnerAudioContextLike;
};

export type WeChatClientEffectOptions = {
  audioSources?: Partial<Record<ClientAudioCue, string>>;
};

const LONG_VIBRATION_THRESHOLD_MS = 400;

function safeNativeVibration(
  platform: WeChatClientEffectPlatform,
  durationMs: number,
): void {
  if (durationMs <= 0) return;

  try {
    if (durationMs >= LONG_VIBRATION_THRESHOLD_MS && platform.vibrateLong) {
      platform.vibrateLong({});
      return;
    }
    platform.vibrateShort?.({ type: "heavy" });
  } catch {
    // Native effects are best-effort only. Platform failures must not escape
    // into ClientSession or alter authoritative state.
  }
}

function createWeChatVibrationTarget(
  platform: WeChatClientEffectPlatform,
  timerHandles: Set<ReturnType<typeof setTimeout>>,
): (pattern: readonly number[]) => void {
  return pattern => {
    let offsetMs = 0;

    for (let index = 0; index < pattern.length; index += 1) {
      const durationMs = pattern[index] ?? 0;
      if (index % 2 === 0 && durationMs > 0) {
        if (offsetMs === 0) {
          safeNativeVibration(platform, durationMs);
        } else {
          const handle = setTimeout(() => {
            timerHandles.delete(handle);
            safeNativeVibration(platform, durationMs);
          }, offsetMs);
          timerHandles.add(handle);
        }
      }
      offsetMs += durationMs;
    }
  };
}

function createWeChatAudioTarget(
  platform: WeChatClientEffectPlatform,
  options: WeChatClientEffectOptions,
): {
  play(cue: ClientAudioCue): void;
  dispose(): void;
} {
  let context: WeChatInnerAudioContextLike | null = null;

  return {
    play(cue) {
      const src = options.audioSources?.[cue]?.trim();
      if (!src) return;

      try {
        context ??= platform.createInnerAudioContext?.() ?? null;
        if (!context) return;
        context.stop?.();
        context.src = src;
        context.play();
      } catch {
        // Audio playback is a transient hint. Playback/creation failure is a
        // platform concern and must not fail the synchronized session.
      }
    },

    dispose() {
      if (!context) return;
      try {
        context.stop?.();
        context.destroy?.();
      } catch {
        // Best-effort cleanup only.
      }
      context = null;
    },
  };
}

/**
 * Attaches WeChat-native rendering for semantic client:event effects.
 *
 * The protocol remains platform-neutral: vibration patterns are approximated
 * with native short/long pulses, while semantic audio cues resolve to
 * platform-owned audio sources. No effect is authoritative or replayed.
 */
export function attachWeChatClientEffects(
  source: WeChatRealtimeEventSource,
  platform: WeChatClientEffectPlatform,
  options: WeChatClientEffectOptions = {},
): () => void {
  const timerHandles = new Set<ReturnType<typeof setTimeout>>();
  const vibrate = createWeChatVibrationTarget(platform, timerHandles);
  const audio = createWeChatAudioTarget(platform, options);

  const unsubscribe = source.subscribeRealtimeEvents(event => {
    dispatchClientRealtimeEffect(event, {
      vibrate,
      playAudioCue: cue => {
        if (cue === CLIENT_AUDIO_CUE_NIGHT_COMPLETE) audio.play(cue);
      },
    });
  });

  return () => {
    unsubscribe();
    for (const handle of timerHandles) clearTimeout(handle);
    timerHandles.clear();
    audio.dispose();
  };
}
