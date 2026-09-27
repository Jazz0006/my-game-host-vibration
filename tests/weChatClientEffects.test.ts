import { afterEach, describe, expect, it, vi } from "vitest";
import {
  attachWeChatClientEffects,
  type WeChatClientEffectPlatform,
  type WeChatInnerAudioContextLike,
} from "../src/client/WeChatClientEffects.js";
import {
  CLIENT_AUDIO_CUE_NIGHT_COMPLETE,
  createClientAudioCueEffectEvent,
  createClientVibrateEffectEvent,
} from "../src/protocol/client/ClientEffects.js";
import {
  createClientRealtimeEventEnvelope,
  type ClientRealtimeEventEnvelope,
} from "../src/protocol/client/ClientProtocol.js";

class FakeAudioContext implements WeChatInnerAudioContextLike {
  src = "";
  readonly played: string[] = [];
  destroyed = false;

  play(): void {
    this.played.push(this.src);
  }

  stop(): void {}

  destroy(): void {
    this.destroyed = true;
  }
}

function sourceHarness() {
  let listener: ((event: ClientRealtimeEventEnvelope) => void) | null = null;
  const unsubscribe = vi.fn();
  return {
    source: {
      subscribeRealtimeEvents(next: (event: ClientRealtimeEventEnvelope) => void) {
        listener = next;
        return unsubscribe;
      },
    },
    emit(event: ClientRealtimeEventEnvelope) {
      listener?.(event);
    },
    unsubscribe,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("E3.5 WeChat client effects", () => {
  it("approximates semantic vibration patterns with native short/long pulses", async () => {
    vi.useFakeTimers();

    const calls: string[] = [];
    const platform: WeChatClientEffectPlatform = {
      vibrateShort() {
        calls.push("short");
      },
      vibrateLong() {
        calls.push("long");
      },
    };
    const harness = sourceHarness();
    const detach = attachWeChatClientEffects(harness.source, platform);

    harness.emit(createClientVibrateEffectEvent([160, 100, 160, 100, 500]));

    expect(calls).toEqual(["short"]);

    await vi.advanceTimersByTimeAsync(259);
    expect(calls).toEqual(["short"]);

    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toEqual(["short", "short"]);

    await vi.advanceTimersByTimeAsync(259);
    expect(calls).toEqual(["short", "short"]);

    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toEqual(["short", "short", "long"]);

    detach();
    expect(harness.unsubscribe).toHaveBeenCalledOnce();
  });

  it("cancels future vibration pulses when the effect adapter is detached", async () => {
    vi.useFakeTimers();

    const calls: string[] = [];
    const harness = sourceHarness();
    const detach = attachWeChatClientEffects(harness.source, {
      vibrateShort() {
        calls.push("short");
      },
      vibrateLong() {
        calls.push("long");
      },
    });

    harness.emit(createClientVibrateEffectEvent([300, 150, 500]));
    expect(calls).toEqual(["short"]);

    detach();
    await vi.advanceTimersByTimeAsync(1_000);

    expect(calls).toEqual(["short"]);
  });

  it("renders the semantic night-complete cue through one reusable native audio context", () => {
    const context = new FakeAudioContext();
    let createCalls = 0;
    const harness = sourceHarness();
    const detach = attachWeChatClientEffects(
      harness.source,
      {
        createInnerAudioContext() {
          createCalls += 1;
          return context;
        },
      },
      {
        audioSources: {
          [CLIENT_AUDIO_CUE_NIGHT_COMPLETE]: "/audio/night-complete.mp3",
        },
      },
    );

    harness.emit(createClientAudioCueEffectEvent(CLIENT_AUDIO_CUE_NIGHT_COMPLETE));
    harness.emit(createClientAudioCueEffectEvent(CLIENT_AUDIO_CUE_NIGHT_COMPLETE));

    expect(createCalls).toBe(1);
    expect(context.played).toEqual([
      "/audio/night-complete.mp3",
      "/audio/night-complete.mp3",
    ]);

    detach();
    expect(context.destroyed).toBe(true);
  });

  it("treats unsupported capabilities, malformed effects, and platform failures as best-effort no-ops", async () => {
    vi.useFakeTimers();

    const harness = sourceHarness();
    const detach = attachWeChatClientEffects(harness.source, {
      vibrateShort() {
        throw new Error("native vibration failed");
      },
      createInnerAudioContext() {
        throw new Error("native audio failed");
      },
    });

    expect(() => {
      harness.emit(createClientVibrateEffectEvent([100, 50, 100]));
      harness.emit(createClientAudioCueEffectEvent(CLIENT_AUDIO_CUE_NIGHT_COMPLETE));
      harness.emit(createClientRealtimeEventEnvelope("client.effect.future", {}));
      harness.emit(createClientRealtimeEventEnvelope("client.effect.vibrate", {
        pattern: [100, -1],
      }));
    }).not.toThrow();

    await vi.advanceTimersByTimeAsync(500);
    detach();
  });
});
