import { describe, expect, it, vi } from "vitest";
import {
  attachBrowserSessionReplaced,
  type BrowserSessionEventSource,
} from "../src/client/browser/BrowserSessionEvents.js";
import {
  createClientSessionReplacedEvent,
  type ClientSessionReplacedPayload,
} from "../src/protocol/client/ClientSessionEvents.js";
import { createClientRealtimeEventEnvelope } from "../src/protocol/client/ClientProtocol.js";
import type { ClientSessionRealtimeEventListener } from "../src/client/runtime/ClientSession.js";

describe("E2.3d3 browser session lifecycle events", () => {
  it("maps the stable session.replaced envelope to a semantic callback", () => {
    let listener: ClientSessionRealtimeEventListener | null = null;
    const detach = vi.fn();
    const source: BrowserSessionEventSource = {
      subscribeRealtimeEvents(next) {
        listener = next;
        return detach;
      },
    };
    const onReplaced = vi.fn<(payload: ClientSessionReplacedPayload) => void>();

    const unsubscribe = attachBrowserSessionReplaced(source, onReplaced);
    const payload = { roomId: "room-1", playerId: "player-1" };
    listener?.(createClientSessionReplacedEvent(payload));

    expect(onReplaced).toHaveBeenCalledOnce();
    expect(onReplaced).toHaveBeenCalledWith(payload);
    unsubscribe();
    expect(detach).toHaveBeenCalledOnce();
  });

  it("ignores unrelated realtime events", () => {
    let listener: ClientSessionRealtimeEventListener | null = null;
    const source: BrowserSessionEventSource = {
      subscribeRealtimeEvents(next) {
        listener = next;
        return () => undefined;
      },
    };
    const onReplaced = vi.fn<(payload: ClientSessionReplacedPayload) => void>();

    attachBrowserSessionReplaced(source, onReplaced);
    listener?.(createClientRealtimeEventEnvelope("test.other", { value: true }));

    expect(onReplaced).not.toHaveBeenCalled();
  });
});
