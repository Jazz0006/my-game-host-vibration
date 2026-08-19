import { describe, expect, it } from "vitest";
import {
  createWeChatMiniProgramBindings,
  type WeChatMiniProgramApi,
  type WeChatMiniProgramNetworkStatus,
} from "../src/client/wechat/WeChatMiniProgramBindings.js";
import type { WeChatSocketTaskLike } from "../src/client/wechat/WeChatRealtimeTransport.js";

class SocketFake implements WeChatSocketTaskLike {
  onOpen(): void {}
  onClose(): void {}
  onError(): void {}
  onMessage(): void {}
  send(): void {}
  close(): void {}
}

class ApiFake implements WeChatMiniProgramApi {
  readonly socket = new SocketFake();
  requestCalls: unknown[] = [];
  socketUrls: string[] = [];
  shortCalls: unknown[] = [];
  longCalls = 0;
  appShowListeners = new Set<(options?: unknown) => void>();
  networkListeners = new Set<(status: WeChatMiniProgramNetworkStatus) => void>();

  request(options: any): unknown {
    this.requestCalls.push(options);
    return {};
  }
  connectSocket(options: { url: string }): WeChatSocketTaskLike {
    this.socketUrls.push(options.url);
    return this.socket;
  }
  vibrateShort(options?: { type?: "heavy" | "medium" | "light" }): unknown {
    this.shortCalls.push(options);
  }
  vibrateLong(): unknown { this.longCalls += 1; }
  onAppShow(listener: (options?: unknown) => void): void { this.appShowListeners.add(listener); }
  offAppShow(listener: (options?: unknown) => void): void { this.appShowListeners.delete(listener); }
  onNetworkStatusChange(listener: (status: WeChatMiniProgramNetworkStatus) => void): void {
    this.networkListeners.add(listener);
  }
  offNetworkStatusChange(listener: (status: WeChatMiniProgramNetworkStatus) => void): void {
    this.networkListeners.delete(listener);
  }
}

describe("E3.7 WeChat Mini Program bindings", () => {
  it("projects one wx-like API into realtime and transient-effect ports", () => {
    const api = new ApiFake();
    const bindings = createWeChatMiniProgramBindings(api);

    const requestOptions = {
      url: "https://game.example/rooms/1234/websocket-ticket",
      method: "POST" as const,
      data: {},
      success() {},
      fail() {},
    };
    bindings.realtime.request(requestOptions);
    expect(api.requestCalls).toEqual([requestOptions]);
    expect(bindings.realtime.connectSocket({ url: "wss://game.example/rooms/1234/websocket" }))
      .toBe(api.socket);
    expect(api.socketUrls).toEqual(["wss://game.example/rooms/1234/websocket"]);

    bindings.effects.vibrateShort?.({ type: "light" });
    bindings.effects.vibrateLong?.();
    expect(api.shortCalls).toEqual([{ type: "light" }]);
    expect(api.longCalls).toBe(1);
  });

  it("adapts wx app-show callbacks to the E3.1 lifecycle port and detaches the same wrapper", () => {
    const api = new ApiFake();
    const bindings = createWeChatMiniProgramBindings(api);
    let foregroundCalls = 0;
    const listener = () => { foregroundCalls += 1; };

    bindings.lifecycle.onAppShow(listener);
    expect(api.appShowListeners.size).toBe(1);
    for (const callback of api.appShowListeners) callback({ scene: 1001 });
    expect(foregroundCalls).toBe(1);

    bindings.lifecycle.offAppShow?.(listener);
    expect(api.appShowListeners.size).toBe(0);
  });

  it("passes network recovery signals through without inventing reconnect semantics", () => {
    const api = new ApiFake();
    const bindings = createWeChatMiniProgramBindings(api);
    const statuses: boolean[] = [];
    const listener = (status: WeChatMiniProgramNetworkStatus) => statuses.push(status.isConnected);

    bindings.lifecycle.onNetworkStatusChange(listener);
    for (const callback of api.networkListeners) {
      callback({ isConnected: false, networkType: "none" });
      callback({ isConnected: true, networkType: "wifi" });
    }

    expect(statuses).toEqual([false, true]);
    bindings.lifecycle.offNetworkStatusChange?.(listener);
    expect(api.networkListeners.size).toBe(0);
  });

  it("keeps optional unsupported effects absent instead of emulating them in shared runtime", () => {
    const api = new ApiFake();
    api.vibrateShort = undefined;
    api.vibrateLong = undefined;
    const bindings = createWeChatMiniProgramBindings(api);
    expect(bindings.effects.vibrateShort).toBeUndefined();
    expect(bindings.effects.vibrateLong).toBeUndefined();
  });
});
