import { describe, expect, it } from "vitest";
import {
  CLIENT_AUDIO_CUE_NIGHT_COMPLETE,
  createClientAudioCueEffectEvent,
  createClientVibrateEffectEvent,
} from "../src/protocol/client/ClientEffects.js";
import {
  attachWeChatClientEffects,
  type WeChatEffectsPlatform,
  type WeChatInnerAudioContextLike,
} from "../src/client/wechat/WeChatClientEffects.js";
import type { ClientRealtimeEventEnvelope } from "../src/protocol/client/ClientProtocol.js";

class FakeSource {
  listener: ((event: ClientRealtimeEventEnvelope) => void) | null = null;
  unsubscribed = false;

  subscribeRealtimeEvents(listener: (event: ClientRealtimeEventEnvelope) => void): () => void {
    this.listener = listener;
    return () => {
      this.unsubscribed = true;
      this.listener = null;
    };
  }

  emit(event: ClientRealtimeEventEnvelope): void {
    this.listener?.(event);
  }
}

type Timer = { callback: () => void; delayMs: number; cleared: boolean };

class FakeAudioContext implements WeChatInnerAudioContextLike {
  src = "";
  plays = 0;
  stops = 0;
  destroys = 0;
  play(): void { this.plays += 1; }
  stop(): void { this.stops += 1; }
  destroy(): void { this.destroys += 1; }
}

function platformHarness() {
  const vibrationCalls: string[] = [];
  const timers: Timer[] = [];
  const audioContexts: FakeAudioContext[] = [];
  const platform: WeChatEffectsPlatform = {
    vibrateShort(options) {
      vibrationCalls.push(`short:${options?.type ?? "default"}`);
    },
    vibrateLong() {
      vibrationCalls.push("long");
    },
    createInnerAudioContext() {
      const context = new FakeAudioContext();
      audioContexts.push(context);
      return context;
    },
    setTimeout(callback, delayMs) {
      const timer = { callback, delayMs, cleared: false };
      timers.push(timer);
      return timer;
    },
    clearTimeout(handle) {
      (handle as Timer).cleared = true;
    },
  };
  return { platform, vibrationCalls, timers, audioContexts };
}

describe("E3.5 WeChat client effects", () => {
  it("approximates a transport-neutral vibration pattern with WeChat short/long primitives", () => {
    const source = new FakeSource();
    const harness = platformHarness();
    attachWeChatClientEffects(source, harness.platform);

    source.emit(createClientVibrateEffectEvent([300, 150, 300]));

    expect(harness.vibrationCalls).toEqual(["long"]);
    expect(harness.timers).toHaveLength(1);
    expect(harness.timers[0]!.delayMs).toBe(450);

    harness.timers[0]!.callback();
    expect(harness.vibrationCalls).toEqual(["long", "long"]);
  });

  it("maps shorter vibration segments to WeChat short vibration intensity", () => {
    const source = new FakeSource();
    const harness = platformHarness();
    attachWeChatClientEffects(source, harness.platform, { longVibrationThresholdMs: 200 });

    source.emit(createClientVibrateEffectEvent([50]));
    source.emit(createClientVibrateEffectEvent([120]));

    expect(harness.vibrationCalls).toEqual(["short:light", "short:medium"]);
  });

  it("maps semantic audio cues to platform-local assets and reuses the audio context", () => {
    const source = new FakeSource();
    const harness = platformHarness();
    attachWeChatClientEffects(source, harness.platform, {
      audioSources: { [CLIENT_AUDIO_CUE_NIGHT_COMPLETE]: "/audio/night-complete.mp3" },
    });

    source.emit(createClientAudioCueEffectEvent(CLIENT_AUDIO_CUE_NIGHT_COMPLETE));
    source.emit(createClientAudioCueEffectEvent(CLIENT_AUDIO_CUE_NIGHT_COMPLETE));

    expect(harness.audioContexts).toHaveLength(1);
    expect(harness.audioContexts[0]!.src).toBe("/audio/night-complete.mp3");
    expect(harness.audioContexts[0]!.plays).toBe(2);
  });

  it("treats missing WeChat capabilities and missing audio assets as safe no-ops", () => {
    const source = new FakeSource();
    const attachment = attachWeChatClientEffects(source, {});

    expect(attachment.dispatch(createClientVibrateEffectEvent([100]))).toBe("handled");
    expect(attachment.dispatch(
      createClientAudioCueEffectEvent(CLIENT_AUDIO_CUE_NIGHT_COMPLETE),
    )).toBe("handled");
  });

  it("contains delayed vibration failures outside the shared dispatcher stack", () => {
    const source = new FakeSource();
    const timers: Array<() => void> = [];
    let calls = 0;
    attachWeChatClientEffects(source, {
      vibrateLong() {
        calls += 1;
        if (calls > 1) throw new Error("device vibration failed");
      },
      setTimeout(callback) {
        timers.push(callback);
        return callback;
      },
    });

    source.emit(createClientVibrateEffectEvent([300, 100, 300]));
    expect(() => timers[0]!()).not.toThrow();
  });

  it("reports an immediate platform failure without throwing into the realtime source", () => {
    const source = new FakeSource();
    const attachment = attachWeChatClientEffects(source, {
      vibrateLong() { throw new Error("device failure"); },
    });

    expect(attachment.dispatch(createClientVibrateEffectEvent([300]))).toBe("target-failed");
  });

  it("detaches cleanly, cancels scheduled vibration, and releases audio resources", () => {
    const source = new FakeSource();
    const harness = platformHarness();
    const attachment = attachWeChatClientEffects(source, harness.platform, {
      audioSources: { [CLIENT_AUDIO_CUE_NIGHT_COMPLETE]: "/audio/night-complete.mp3" },
    });

    source.emit(createClientVibrateEffectEvent([300, 150, 300]));
    source.emit(createClientAudioCueEffectEvent(CLIENT_AUDIO_CUE_NIGHT_COMPLETE));
    attachment.detach();

    expect(source.unsubscribed).toBe(true);
    expect(harness.timers[0]!.cleared).toBe(true);
    expect(harness.audioContexts[0]!.stops).toBe(1);
    expect(harness.audioContexts[0]!.destroys).toBe(1);

    harness.timers[0]!.callback();
    expect(harness.vibrationCalls).toEqual(["long"]);
  });
});
