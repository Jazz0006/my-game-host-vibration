import { describe, expect, it } from "vitest";
import {
  attachWeChatSessionLifecycle,
  type WeChatAppLifecycleLike,
  type WeChatLifecycleSession,
} from "../src/client/WeChatSessionLifecycle.js";
import type { ClientConnectionStatus } from "../src/client/runtime/ClientConnectionFSM.js";

class AppLifecycleFake implements WeChatAppLifecycleLike {
  private readonly showListeners = new Set<() => void>();
  private readonly hideListeners = new Set<() => void>();

  onAppShow(listener: () => void): void {
    this.showListeners.add(listener);
  }

  offAppShow(listener: () => void): void {
    this.showListeners.delete(listener);
  }

  onAppHide(listener: () => void): void {
    this.hideListeners.add(listener);
  }

  offAppHide(listener: () => void): void {
    this.hideListeners.delete(listener);
  }

  show(): void {
    for (const listener of this.showListeners) listener();
  }

  hide(): void {
    for (const listener of this.hideListeners) listener();
  }

  counts(): { show: number; hide: number } {
    return { show: this.showListeners.size, hide: this.hideListeners.size };
  }
}

class SessionFake implements WeChatLifecycleSession {
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

describe("E3.6 WeChat session lifecycle", () => {
  it("resyncs a connected session only after a real app hide/show cycle", () => {
    const lifecycle = new AppLifecycleFake();
    const session = new SessionFake();
    attachWeChatSessionLifecycle(session, lifecycle);

    lifecycle.show();
    expect(session.resyncCalls).toBe(0);

    lifecycle.hide();
    lifecycle.show();
    expect(session.resyncCalls).toBe(1);
    expect(session.reconnectCalls).toBe(0);
  });

  it("reconnects a disconnected session after returning from background", () => {
    const lifecycle = new AppLifecycleFake();
    const session = new SessionFake();
    session.status = "Disconnected";
    attachWeChatSessionLifecycle(session, lifecycle);

    lifecycle.hide();
    lifecycle.show();

    expect(session.reconnectCalls).toBe(1);
    expect(session.resyncCalls).toBe(0);
  });

  it("does not duplicate recovery while connection transition is already in progress", () => {
    const lifecycle = new AppLifecycleFake();
    const session = new SessionFake();
    attachWeChatSessionLifecycle(session, lifecycle);

    for (const status of ["Connecting", "Syncing", "Reconnecting"] as const) {
      session.status = status;
      lifecycle.hide();
      lifecycle.show();
    }

    expect(session.reconnectCalls).toBe(0);
    expect(session.resyncCalls).toBe(0);
  });

  it("detaches app lifecycle listeners cleanly", () => {
    const lifecycle = new AppLifecycleFake();
    const session = new SessionFake();
    const detach = attachWeChatSessionLifecycle(session, lifecycle);

    expect(lifecycle.counts()).toEqual({ show: 1, hide: 1 });
    detach();
    expect(lifecycle.counts()).toEqual({ show: 0, hide: 0 });

    lifecycle.hide();
    lifecycle.show();
    expect(session.resyncCalls).toBe(0);
    expect(session.reconnectCalls).toBe(0);
  });
});
