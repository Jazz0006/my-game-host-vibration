import { describe, expect, it } from "vitest";
import {
  attachWeChatSessionLifecycle,
  type WeChatLifecycleApi,
  type WeChatLifecycleSession,
  type WeChatNetworkStatus,
} from "../src/client/wechat/WeChatSessionLifecycle.js";
import type { ClientConnectionStatus } from "../src/client/runtime/ClientConnectionFSM.js";

class WeChatLifecycleApiFake implements WeChatLifecycleApi {
  private readonly appShowListeners = new Set<() => void>();
  private readonly networkListeners = new Set<(status: WeChatNetworkStatus) => void>();

  onAppShow(listener: () => void): void {
    this.appShowListeners.add(listener);
  }

  offAppShow(listener: () => void): void {
    this.appShowListeners.delete(listener);
  }

  onNetworkStatusChange(listener: (status: WeChatNetworkStatus) => void): void {
    this.networkListeners.add(listener);
  }

  offNetworkStatusChange(listener: (status: WeChatNetworkStatus) => void): void {
    this.networkListeners.delete(listener);
  }

  emitAppShow(): void {
    for (const listener of this.appShowListeners) listener();
  }

  emitNetworkStatus(isConnected: boolean): void {
    for (const listener of this.networkListeners) listener({ isConnected });
  }

  appShowCount(): number {
    return this.appShowListeners.size;
  }

  networkCount(): number {
    return this.networkListeners.size;
  }
}

class SessionFake implements WeChatLifecycleSession {
  status: ClientConnectionStatus = "Connected";
  reconnectCalls = 0;
  resyncCalls = 0;

  getConnectionState() {
    return { status: this.status, generation: 4 };
  }

  reconnect(): void {
    this.reconnectCalls += 1;
  }

  resync(): void {
    this.resyncCalls += 1;
  }
}

describe("E3.1 WeChat session lifecycle boundary", () => {
  it("resyncs a Connected session when the Mini Program returns to foreground", () => {
    const api = new WeChatLifecycleApiFake();
    const session = new SessionFake();
    attachWeChatSessionLifecycle(session, api);

    api.emitAppShow();

    expect(session.resyncCalls).toBe(1);
    expect(session.reconnectCalls).toBe(0);
  });

  it("reconnects a Disconnected session when network connectivity returns", () => {
    const api = new WeChatLifecycleApiFake();
    const session = new SessionFake();
    session.status = "Disconnected";
    attachWeChatSessionLifecycle(session, api);

    api.emitNetworkStatus(false);
    expect(session.reconnectCalls).toBe(0);

    api.emitNetworkStatus(true);
    expect(session.reconnectCalls).toBe(1);
    expect(session.resyncCalls).toBe(0);
  });

  it("does not duplicate recovery while ClientSession is already transitioning", () => {
    const api = new WeChatLifecycleApiFake();
    const session = new SessionFake();
    attachWeChatSessionLifecycle(session, api);

    for (const status of ["Connecting", "Syncing", "Reconnecting"] as const) {
      session.status = status;
      api.emitAppShow();
      api.emitNetworkStatus(true);
    }

    expect(session.reconnectCalls).toBe(0);
    expect(session.resyncCalls).toBe(0);
  });

  it("detaches lifecycle listeners when the client composition is torn down", () => {
    const api = new WeChatLifecycleApiFake();
    const session = new SessionFake();
    const detach = attachWeChatSessionLifecycle(session, api);

    expect(api.appShowCount()).toBe(1);
    expect(api.networkCount()).toBe(1);

    detach();

    expect(api.appShowCount()).toBe(0);
    expect(api.networkCount()).toBe(0);
    api.emitAppShow();
    api.emitNetworkStatus(true);
    expect(session.resyncCalls).toBe(0);
    expect(session.reconnectCalls).toBe(0);
  });
});
