import {
  dispatchClientRealtimeEffect,
  type ClientEffectDispatchStatus,
} from "../effects/ClientEffectDispatcher.js";
import type { ClientSessionRealtimeEventListener } from "../runtime/ClientSession.js";
import {
  CLIENT_AUDIO_CUE_NIGHT_COMPLETE,
  type ClientAudioCue,
} from "../../protocol/client/ClientEffects.js";

export type WeChatRealtimeEventSource = {
  subscribeRealtimeEvents(listener: ClientSessionRealtimeEventListener): () => void;
};

export type WeChatVibrateOptions = {
  type?: "heavy" | "medium" | "light";
};

export type WeChatInnerAudioContextLike = {
  src: string;
  play(): unknown;
  stop?(): unknown;
  destroy?(): unknown;
};

export type WeChatEffectsPlatform = {
  vibrateShort?(options?: WeChatVibrateOptions): unknown;
  vibrateLong?(): unknown;
  createInnerAudioContext?(): WeChatInnerAudioContextLike;
  setTimeout?(callback: () => void, delayMs: number): unknown;
  clearTimeout?(handle: unknown): void;
};

export type WeChatClientEffectOptions = {
  audioSources?: Partial<Record<ClientAudioCue, string>>;
  longVibrationThresholdMs?: number;
};

export type WeChatClientEffectsAttachment = {
  detach(): void;
  dispatch(event: Parameters<typeof dispatchClientRealtimeEffect>[0]): ClientEffectDispatchStatus;
};

function normalizedThreshold(value: number | undefined): number {
  return Number.isFinite(value) && Number(value) >= 0 ? Number(value) : 200;
}

function scheduler(platform: WeChatEffectsPlatform): {
  set(callback: () => void, delayMs: number): unknown;
  clear(handle: unknown): void;
} {
  return {
    set: platform.setTimeout
      ? (callback, delayMs) => platform.setTimeout!(callback, delayMs)
      : (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
    clear: platform.clearTimeout
      ? handle => platform.clearTimeout!(handle)
      : handle => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
  };
}

/**
 * E3.5 WeChat capability adapter for transient client effects.
 *
 * The shared protocol keeps an arbitrary vibration pattern because browsers and
 * future native clients may support it directly. WeChat exposes short/long
 * vibration primitives instead, so this adapter approximates each vibration
 * segment while preserving the pattern's relative timing. Audio remains
 * semantic: only this platform adapter maps a cue to a local/remote asset path.
 *
 * Effects are deliberately best-effort. Missing capabilities, failed platform
 * calls, background suspension, and duplicate delivery never affect
 * authoritative game state and are never replayed here.
 */
export function attachWeChatClientEffects(
  source: WeChatRealtimeEventSource,
  platform: WeChatEffectsPlatform,
  options: WeChatClientEffectOptions = {},
): WeChatClientEffectsAttachment {
  const timers = new Set<unknown>();
  const audioContexts = new Set<WeChatInnerAudioContextLike>();
  const clock = scheduler(platform);
  const threshold = normalizedThreshold(options.longVibrationThresholdMs);
  let detached = false;

  const invokeVibration = (durationMs: number): void => {
    if (detached) return;
    if (durationMs >= threshold && platform.vibrateLong) {
      platform.vibrateLong();
      return;
    }
    platform.vibrateShort?.({ type: durationMs >= threshold / 2 ? "medium" : "light" });
  };

  const vibrate = (pattern: readonly number[]): void => {
    let offset = 0;
    for (let index = 0; index < pattern.length; index += 1) {
      const duration = pattern[index]!;
      if (index % 2 === 0 && duration > 0) {
        if (offset === 0) {
          invokeVibration(duration);
        } else {
          const handle = clock.set(() => {
            timers.delete(handle);
            invokeVibration(duration);
          }, offset);
          timers.add(handle);
        }
      }
      offset += duration;
    }
  };

  const playAudioCue = (cue: ClientAudioCue): void => {
    const src = options.audioSources?.[cue];
    if (!src || !platform.createInnerAudioContext) return;
    const context = platform.createInnerAudioContext();
    context.src = src;
    audioContexts.add(context);
    context.play();
  };

  const dispatch = (event: Parameters<typeof dispatchClientRealtimeEffect>[0]) =>
    dispatchClientRealtimeEffect(event, { vibrate, playAudioCue });

  const unsubscribe = source.subscribeRealtimeEvents(event => {
    dispatch(event);
  });

  return {
    dispatch,
    detach() {
      if (detached) return;
      detached = true;
      unsubscribe();
      for (const handle of timers) clock.clear(handle);
      timers.clear();
      for (const context of audioContexts) {
        try {
          context.stop?.();
          context.destroy?.();
        } catch {
          // Effect cleanup remains nonfatal.
        }
      }
      audioContexts.clear();
    },
  };
}

export const DEFAULT_WECHAT_AUDIO_CUE_SOURCES: Readonly<Partial<Record<ClientAudioCue, string>>> = {
  [CLIENT_AUDIO_CUE_NIGHT_COMPLETE]: "",
};
