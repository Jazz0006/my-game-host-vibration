import { describe, expect, it } from "vitest";
import { SocketIoRealtimeTransport } from "../src/client/browser/SocketIoRealtimeTransport.js";
import type { ClientRealtimeTransportListener } from "../src/client/runtime/ClientRealtimeTransport.js";
import { createClientVibrateEffectEvent } from "../src/protocol/client/ClientEffects.js";

type View = { phase: string };

class FakeSocket {
  connected = false;
  private readonly handlers = new Map<string, Set<(...args: any[]) => void>>();

  connect(): void {}
  disconnect(): void { this.connected = false; }

  on(event: string, listener: (...args: any[]) => void): void {
    const listeners = this.handlers.get(event) ?? new Set();
    listeners.add(listener);
    this.handlers.set(event, listeners);
  }

  off(event: string, listener: (...args: any[]) => void): void {
    this.handlers.get(event)?.delete(listener);
  }

  timeout(): { emit: () => void } {
    return { emit: () => undefined };
  }

  serverEmit(event: string, value: unknown): void {
    for (const listener of this.handlers.get(event) ?? []) listener(value);
  }
}

function captureListener() {
  const events: unknown[] = [];
  const errors: unknown[] = [];
  const listener: ClientRealtimeTransportListener<View> = {
    onOpen: () => undefined,
    onClose: () => undefined,
    onError: (generation, failure) => errors.push({ generation, failure }),
    onState: () => undefined,
    onEvent: event => events.push(event),
  };
  return { listener, events, errors };
}

describe("E2.2c2 Socket.IO realtime event transport", () => {
  it("forwards valid client:event envelopes with the active generation", () => {
    const socket = new FakeSocket();
    const transport = new SocketIoRealtimeTransport<View>(socket);
    const captured = captureListener();
    transport.setListener(captured.listener);
    transport.connect(4);

    const event = createClientVibrateEffectEvent([300, 150, 300], {
      reason: "action-alert",
    });
    socket.serverEmit("client:event", event);

    expect(captured.events).toEqual([{ generation: 4, envelope: event }]);
    expect(captured.errors).toEqual([]);
  });

  it("drops malformed transient events without failing authoritative synchronization", () => {
    const socket = new FakeSocket();
    const transport = new SocketIoRealtimeTransport<View>(socket);
    const captured = captureListener();
    transport.setListener(captured.listener);
    transport.connect(2);

    socket.serverEmit("client:event", { protocolVersion: 1, kind: "state" });
    socket.serverEmit("client:event", { protocolVersion: 99, kind: "event", type: "x", payload: {} });
    socket.serverEmit("client:event", { protocolVersion: 1, kind: "event", type: "", payload: {} });

    expect(captured.events).toEqual([]);
    expect(captured.errors).toEqual([]);
  });

  it("detaches client:event listeners when the transport is disposed", () => {
    const socket = new FakeSocket();
    const transport = new SocketIoRealtimeTransport<View>(socket);
    const captured = captureListener();
    transport.setListener(captured.listener);
    transport.connect(3);
    transport.disconnect(3);

    socket.serverEmit("client:event", createClientVibrateEffectEvent([100]));
    expect(captured.events).toEqual([]);
  });
});
