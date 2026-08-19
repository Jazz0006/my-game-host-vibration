import { describe, expect, it } from "vitest";
import {
  attachBrowserSessionLifecycle,
  type BrowserDocumentLike,
  type BrowserLifecycleSession,
  type BrowserWindowLike,
} from "../src/client/browser/BrowserSessionLifecycle.js";
import type { ClientConnectionStatus } from "../src/client/runtime/ClientConnectionFSM.js";

class EventTargetFake {
  private readonly listeners = new Map<string, Set<() => void>>();

  addEventListener(event: string, listener: () => void): void {
    const listeners = this.listeners.get(event) ?? new Set<() => void>();
    listeners.add(listener);
    this.listeners.set(event, listeners);
  }

  removeEventListener(event: string, listener: () => void): void {
    this.listeners.get(event)?.delete(listener);
  }

  emit(event: string): void {
    for (const listener of this.listeners.get(event) ?? []) listener();
  }

  count(event: string): number {
    return this.listeners.get(event)?.size ?? 0;
  }
}

class DocumentFake extends EventTargetFake implements BrowserDocumentLike {
  visibilityState = "visible";
}

class WindowFake extends EventTargetFake implements BrowserWindowLike {}

class SessionFake implements BrowserLifecycleSession {
  status: ClientConnectionStatus = "Connected";
  reconnectCalls = 0;
  resyncCalls = 0;

  getConnectionState() {
    return { status: this.status, generation: 3 };
  }

  reconnect(): void {
    this.reconnectCalls += 1;
  }

  resync(): void {
    this.resyncCalls += 1;
  }
}

describe("E2.2b3b browser session lifecycle", () => {
  it("resyncs a Connected session when the page returns to foreground", () => {
    const document = new DocumentFake();
    const window = new WindowFake();
    const session = new SessionFake();
    attachBrowserSessionLifecycle(session, { document, window });

    document.visibilityState = "hidden";
    document.emit("visibilitychange");
    expect(session.resyncCalls).toBe(0);

    document.visibilityState = "visible";
    document.emit("visibilitychange");
    expect(session.resyncCalls).toBe(1);
    expect(session.reconnectCalls).toBe(0);
  });

  it("reconnects a Disconnected session when network connectivity returns", () => {
    const document = new DocumentFake();
    const window = new WindowFake();
    const session = new SessionFake();
    session.status = "Disconnected";
    attachBrowserSessionLifecycle(session, { document, window });

    window.emit("offline");
    expect(session.reconnectCalls).toBe(0);

    window.emit("online");
    expect(session.reconnectCalls).toBe(1);
    expect(session.resyncCalls).toBe(0);
  });

  it("does not duplicate recovery while ClientSession is already in a transition state", () => {
    const document = new DocumentFake();
    const window = new WindowFake();
    const session = new SessionFake();
    attachBrowserSessionLifecycle(session, { document, window });

    for (const status of ["Connecting", "Syncing", "Reconnecting"] as const) {
      session.status = status;
      document.emit("visibilitychange");
      window.emit("online");
    }

    expect(session.reconnectCalls).toBe(0);
    expect(session.resyncCalls).toBe(0);
  });

  it("detaches browser lifecycle listeners when the session is torn down", () => {
    const document = new DocumentFake();
    const window = new WindowFake();
    const session = new SessionFake();
    const detach = attachBrowserSessionLifecycle(session, { document, window });

    expect(document.count("visibilitychange")).toBe(1);
    expect(window.count("offline")).toBe(1);
    expect(window.count("online")).toBe(1);

    detach();
    expect(document.count("visibilitychange")).toBe(0);
    expect(window.count("offline")).toBe(0);
    expect(window.count("online")).toBe(0);

    document.emit("visibilitychange");
    window.emit("online");
    expect(session.resyncCalls).toBe(0);
    expect(session.reconnectCalls).toBe(0);
  });
});
