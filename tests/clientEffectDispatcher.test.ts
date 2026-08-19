import { describe, expect, it } from "vitest";
import { attachBrowserClientEffects } from "../src/client/browser/BrowserClientEffects.js";
import {
  dispatchClientRealtimeEffect,
  type ClientEffectDispatchStatus,
} from "../src/client/effects/ClientEffectDispatcher.js";
import {
  CLIENT_EFFECT_VIBRATE,
  createClientVibrateEffectEvent,
} from "../src/protocol/client/ClientEffects.js";
import { createClientRealtimeEventEnvelope } from "../src/protocol/client/ClientProtocol.js";

function statusFor(payload: unknown): ClientEffectDispatchStatus {
  return dispatchClientRealtimeEffect(
    createClientRealtimeEventEnvelope(CLIENT_EFFECT_VIBRATE, payload),
    { vibrate: () => undefined },
  );
}

describe("E2.2c2 ClientEffectDispatcher", () => {
  it("creates a transport-neutral vibration effect without sharing the source array", () => {
    const pattern = [300, 150, 300];
    const event = createClientVibrateEffectEvent(pattern, {
      reason: "action-alert",
      context: { actionId: "action-1", phase: "night_seer" },
    });
    pattern[0] = 999;

    expect(event).toEqual({
      protocolVersion: 1,
      kind: "event",
      type: CLIENT_EFFECT_VIBRATE,
      payload: {
        pattern: [300, 150, 300],
        reason: "action-alert",
        context: { actionId: "action-1", phase: "night_seer" },
      },
    });
  });

  it("dispatches valid vibration effects and ignores unknown or malformed effects", () => {
    const patterns: number[][] = [];
    const valid = createClientVibrateEffectEvent([100, 50, 100]);

    expect(dispatchClientRealtimeEffect(valid, {
      vibrate: pattern => patterns.push([...pattern]),
    })).toBe("handled");
    expect(patterns).toEqual([[100, 50, 100]]);

    expect(dispatchClientRealtimeEffect(
      createClientRealtimeEventEnvelope("client.effect.future", {}),
      { vibrate: () => { throw new Error("must not run"); } },
    )).toBe("ignored-unknown");

    expect(statusFor({ pattern: [] })).toBe("ignored-invalid");
    expect(statusFor({ pattern: [100, -1] })).toBe("ignored-invalid");
    expect(statusFor({ pattern: [100, 1.5] })).toBe("ignored-invalid");
  });

  it("contains platform effect failures instead of throwing into ClientSession", () => {
    const event = createClientVibrateEffectEvent([100]);
    expect(dispatchClientRealtimeEffect(event, {
      vibrate: () => { throw new Error("platform failure"); },
    })).toBe("target-failed");
  });

  it("adapts realtime events to browser vibration and safely no-ops when unsupported", () => {
    let listener: ((event: ReturnType<typeof createClientVibrateEffectEvent>) => void) | null = null;
    let unsubscribed = false;
    const source = {
      subscribeRealtimeEvents(value: (event: any) => void) {
        listener = value;
        return () => { unsubscribed = true; };
      },
    };
    const patterns: Array<number | number[]> = [];
    const detach = attachBrowserClientEffects(source, {
      vibrate: pattern => {
        patterns.push(pattern);
        return true;
      },
    });

    listener?.(createClientVibrateEffectEvent([300, 150, 300]));
    expect(patterns).toEqual([[300, 150, 300]]);

    expect(() => attachBrowserClientEffects(source, undefined)).not.toThrow();
    detach();
    expect(unsubscribed).toBe(true);
  });
});
