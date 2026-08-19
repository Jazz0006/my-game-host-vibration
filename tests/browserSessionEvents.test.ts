import { describe, expect, it, vi } from "vitest";
import {
  attachBrowserRoomLifecycle,
  attachBrowserSessionReplaced,
  type BrowserSessionEventSource,
} from "../src/client/browser/BrowserSessionEvents.js";
import {
  createClientRoomClosedEvent,
  createClientRoomRemovedEvent,
  type ClientRoomClosedPayload,
  type ClientRoomRemovedPayload,
} from "../src/protocol/client/ClientRoomEvents.js";
import {
  createClientSessionReplacedEvent,
  type ClientSessionReplacedPayload,
} from "../src/protocol/client/ClientSessionEvents.js";
import { createClientRealtimeEventEnvelope } from "../src/protocol/client/ClientProtocol.js";
import type { ClientSessionRealtimeEventListener } from "../src/client/runtime/ClientSession.js";

describe("browser session lifecycle events", () => {
  it("maps the stable session.replaced envelope to a semantic callback", () => {
    let listener: ClientSessionRealtimeEventListener = () => undefined;
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
    listener(createClientSessionReplacedEvent(payload));

    expect(onReplaced).toHaveBeenCalledOnce();
    expect(onReplaced).toHaveBeenCalledWith(payload);
    unsubscribe();
    expect(detach).toHaveBeenCalledOnce();
  });

  it("maps stable room lifecycle envelopes to semantic callbacks", () => {
    let listener: ClientSessionRealtimeEventListener = () => undefined;
    const detach = vi.fn();
    const source: BrowserSessionEventSource = {
      subscribeRealtimeEvents(next) {
        listener = next;
        return detach;
      },
    };
    const onRemoved = vi.fn<(payload: ClientRoomRemovedPayload) => void>();
    const onClosed = vi.fn<(payload: ClientRoomClosedPayload) => void>();

    const unsubscribe = attachBrowserRoomLifecycle(source, { onRemoved, onClosed });
    listener(createClientRoomRemovedEvent("room-1"));
    listener(createClientRoomClosedEvent("room-1"));

    expect(onRemoved).toHaveBeenCalledOnce();
    expect(onRemoved).toHaveBeenCalledWith({ roomId: "room-1", reason: "removed" });
    expect(onClosed).toHaveBeenCalledOnce();
    expect(onClosed).toHaveBeenCalledWith({ roomId: "room-1", reason: "host_closed" });
    unsubscribe();
    expect(detach).toHaveBeenCalledOnce();
  });

  it("ignores unrelated realtime events", () => {
    let sessionListener: ClientSessionRealtimeEventListener = () => undefined;
    let roomListener: ClientSessionRealtimeEventListener = () => undefined;
    let subscriptionCount = 0;
    const source: BrowserSessionEventSource = {
      subscribeRealtimeEvents(next) {
        if (subscriptionCount === 0) sessionListener = next;
        else roomListener = next;
        subscriptionCount += 1;
        return () => undefined;
      },
    };
    const onReplaced = vi.fn<(payload: ClientSessionReplacedPayload) => void>();
    const onRemoved = vi.fn<(payload: ClientRoomRemovedPayload) => void>();
    const onClosed = vi.fn<(payload: ClientRoomClosedPayload) => void>();

    attachBrowserSessionReplaced(source, onReplaced);
    attachBrowserRoomLifecycle(source, { onRemoved, onClosed });
    const unrelated = createClientRealtimeEventEnvelope("test.other", { value: true });
    sessionListener(unrelated);
    roomListener(unrelated);

    expect(onReplaced).not.toHaveBeenCalled();
    expect(onRemoved).not.toHaveBeenCalled();
    expect(onClosed).not.toHaveBeenCalled();
  });
});
