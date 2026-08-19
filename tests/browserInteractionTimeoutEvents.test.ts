import { describe, expect, it, vi } from "vitest";
import {
  attachBrowserInteractionTimeoutEvents,
  type BrowserInteractionTimeoutEventSource,
} from "../src/client/browser/BrowserInteractionTimeoutEvents.js";
import type { ClientSessionRealtimeEventListener } from "../src/client/runtime/ClientSession.js";
import {
  createClientInteractionTimeoutErrorEvent,
  createClientInteractionTimeoutStateEvent,
  type ClientInteractionTimeoutErrorPayload,
  type ClientInteractionTimeoutStatePayload,
} from "../src/protocol/client/ClientInteractionTimeoutEvents.js";
import { createClientRealtimeEventEnvelope } from "../src/protocol/client/ClientProtocol.js";

describe("browser interaction timeout events", () => {
  it("maps stable timeout state and error envelopes to semantic callbacks", () => {
    let listener: ClientSessionRealtimeEventListener = () => undefined;
    const detach = vi.fn();
    const source: BrowserInteractionTimeoutEventSource = {
      subscribeRealtimeEvents(next) {
        listener = next;
        return detach;
      },
    };
    const onState = vi.fn<(payload: ClientInteractionTimeoutStatePayload) => void>();
    const onError = vi.fn<(payload: ClientInteractionTimeoutErrorPayload) => void>();

    const unsubscribe = attachBrowserInteractionTimeoutEvents(source, { onState, onError });
    const active = {
      roomId: "room-1",
      active: true as const,
      actionId: "action-1",
      deadlineAt: 2_000,
      warningAt: 1_500,
      warning: false,
      canExtend: true,
      extensionCount: 0,
    };
    listener(createClientInteractionTimeoutStateEvent(active));
    listener(createClientInteractionTimeoutStateEvent({
      roomId: "room-1",
      active: false,
      actionId: "action-1",
    }));
    const error = { roomId: "room-1", actionId: "action-1", message: "操作失败" };
    listener(createClientInteractionTimeoutErrorEvent(error));

    expect(onState).toHaveBeenNthCalledWith(1, active);
    expect(onState).toHaveBeenNthCalledWith(2, {
      roomId: "room-1",
      active: false,
      actionId: "action-1",
    });
    expect(onError).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalledWith(error);
    unsubscribe();
    expect(detach).toHaveBeenCalledOnce();
  });

  it("ignores unrelated realtime events", () => {
    let listener: ClientSessionRealtimeEventListener = () => undefined;
    const source: BrowserInteractionTimeoutEventSource = {
      subscribeRealtimeEvents(next) {
        listener = next;
        return () => undefined;
      },
    };
    const onState = vi.fn<(payload: ClientInteractionTimeoutStatePayload) => void>();
    const onError = vi.fn<(payload: ClientInteractionTimeoutErrorPayload) => void>();

    attachBrowserInteractionTimeoutEvents(source, { onState, onError });
    listener(createClientRealtimeEventEnvelope("test.other", { value: true }));

    expect(onState).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });
});