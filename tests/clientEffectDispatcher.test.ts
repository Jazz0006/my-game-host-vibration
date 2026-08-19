import { describe, expect, it } from "vitest";
import { attachBrowserClientEffects } from "../src/client/browser/BrowserClientEffects.js";
import {
  dispatchClientRealtimeEffect,
  type ClientEffectDispatchStatus,
} from "../src/client/effects/ClientEffectDispatcher.js";
import {
  CLIENT_AUDIO_CUE_NIGHT_COMPLETE,
  CLIENT_EFFECT_AUDIO_CUE,
  CLIENT_EFFECT_VIBRATE,
  createClientAudioCueEffectEvent,
  createClientVibrateEffectEvent,
} from "../src/protocol/client/ClientEffects.js";
import {
  createClientRealtimeEventEnvelope,
  type ClientRealtimeEventEnvelope,
} from "../src/protocol/client/ClientProtocol.js";

function vibrationStatus(payload: unknown): ClientEffectDispatchStatus {
  return dispatchClientRealtimeEffect(
    createClientRealtimeEventEnvelope(CLIENT_EFFECT_VIBRATE, payload),
    { vibrate: () => undefined },
  );
}

describe("E2.2c client effect dispatcher", () => {
  it("creates transport-neutral vibration and semantic audio effects", () => {
    const pattern = [300, 150, 300];
    const vibration = createClientVibrateEffectEvent(pattern, { reason: "action-alert" });
    pattern[0] = 999;
    expect(vibration.payload.pattern).toEqual([300, 150, 300]);

    expect(createClientAudioCueEffectEvent(CLIENT_AUDIO_CUE_NIGHT_COMPLETE, {
      reason: "night-complete",
    })).toEqual({
      protocolVersion: 1,
      kind: "event",
      type: CLIENT_EFFECT_AUDIO_CUE,
      payload: { cue: "night-complete", reason: "night-complete" },
    });
  });

  it("dispatches valid effects and ignores unknown or malformed effects", () => {
    const patterns: number[][] = [];
    const cues: string[] = [];
    expect(dispatchClientRealtimeEffect(createClientVibrateEffectEvent([100, 50, 100]), {
      vibrate: pattern => patterns.push([...pattern]),
    })).toBe("handled");
    expect(dispatchClientRealtimeEffect(createClientAudioCueEffectEvent(CLIENT_AUDIO_CUE_NIGHT_COMPLETE), {
      playAudioCue: cue => cues.push(cue),
    })).toBe("handled");
    expect(patterns).toEqual([[100, 50, 100]]);
    expect(cues).toEqual(["night-complete"]);

    expect(dispatchClientRealtimeEffect(
      createClientRealtimeEventEnvelope("client.effect.future", {}),
      {},
    )).toBe("ignored-unknown");
    expect(vibrationStatus({ pattern: [] })).toBe("ignored-invalid");
    expect(vibrationStatus({ pattern: [100, -1] })).toBe("ignored-invalid");
    expect(dispatchClientRealtimeEffect(
      createClientRealtimeEventEnvelope(CLIENT_EFFECT_AUDIO_CUE, { cue: "unknown" }),
      {},
    )).toBe("ignored-invalid");
  });

  it("contains platform effect failures instead of throwing into ClientSession", () => {
    expect(dispatchClientRealtimeEffect(createClientVibrateEffectEvent([100]), {
      vibrate: () => { throw new Error("platform failure"); },
    })).toBe("target-failed");
    expect(dispatchClientRealtimeEffect(createClientAudioCueEffectEvent(CLIENT_AUDIO_CUE_NIGHT_COMPLETE), {
      playAudioCue: () => { throw new Error("audio failure"); },
    })).toBe("target-failed");
  });

  it("adapts realtime events to browser vibration and semantic audio", () => {
    const realtimeListeners: Array<(event: ClientRealtimeEventEnvelope) => void> = [];
    let unsubscribed = false;
    const source = {
      subscribeRealtimeEvents(value: (event: ClientRealtimeEventEnvelope) => void) {
        realtimeListeners.push(value);
        return () => { unsubscribed = true; };
      },
    };
    const patterns: Array<number | number[]> = [];
    const cues: string[] = [];
    const detach = attachBrowserClientEffects(
      source,
      { vibrate: pattern => { patterns.push(pattern); return true; } },
      cue => { cues.push(cue); },
    );

    realtimeListeners[0]!(createClientVibrateEffectEvent([300, 150, 300]));
    realtimeListeners[0]!(createClientAudioCueEffectEvent(CLIENT_AUDIO_CUE_NIGHT_COMPLETE));
    expect(patterns).toEqual([[300, 150, 300]]);
    expect(cues).toEqual(["night-complete"]);

    detach();
    expect(unsubscribed).toBe(true);
  });
});
