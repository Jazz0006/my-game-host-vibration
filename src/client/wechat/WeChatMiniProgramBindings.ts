import type { WeChatEffectsPlatform } from "./WeChatClientEffects.js";
import type {
  WeChatRealtimePlatform,
  WeChatRequestOptions,
  WeChatSocketTaskLike,
} from "./WeChatRealtimeTransport.js";

export type WeChatMiniProgramNetworkStatus = {
  isConnected: boolean;
  networkType?: string;
};

/**
 * Structural copy of the E3.1 lifecycle port. E3.7 deliberately does not
 * import the E3.1 implementation because the current development stack keeps
 * E3.1 as an independent PR. Once E3.1 is merged, this object can be passed
 * directly to attachWeChatSessionLifecycle().
 */
export type WeChatMiniProgramLifecycleApi = {
  onAppShow(listener: () => void): void;
  offAppShow?(listener: () => void): void;
  onNetworkStatusChange(listener: (status: WeChatMiniProgramNetworkStatus) => void): void;
  offNetworkStatusChange?(listener: (status: WeChatMiniProgramNetworkStatus) => void): void;
};

export type WeChatMiniProgramApi = {
  request(options: WeChatRequestOptions): unknown;
  connectSocket(options: { url: string }): WeChatSocketTaskLike;
  vibrateShort?(options?: { type?: "heavy" | "medium" | "light" }): unknown;
  vibrateLong?(): unknown;
  createInnerAudioContext?(): ReturnType<NonNullable<WeChatEffectsPlatform["createInnerAudioContext"]>>;
  onAppShow(listener: (options?: unknown) => void): void;
  offAppShow?(listener: (options?: unknown) => void): void;
  onNetworkStatusChange(listener: (status: WeChatMiniProgramNetworkStatus) => void): void;
  offNetworkStatusChange?(listener: (status: WeChatMiniProgramNetworkStatus) => void): void;
};

export type WeChatMiniProgramBindings = {
  realtime: WeChatRealtimePlatform;
  effects: WeChatEffectsPlatform;
  lifecycle: WeChatMiniProgramLifecycleApi;
};

/**
 * E3.7 concrete WeChat Mini Program capability binding.
 *
 * This is intentionally a composition adapter only. It does not own session
 * state, reconnect policy, game rules, command retry, authoritative revisions,
 * or effect durability. The returned ports plug into the E3.1-E3.6 layers.
 */
export function createWeChatMiniProgramBindings(
  api: WeChatMiniProgramApi,
): WeChatMiniProgramBindings {
  const appShowWrappers = new Map<() => void, (options?: unknown) => void>();

  return {
    realtime: {
      request: options => api.request(options),
      connectSocket: options => api.connectSocket(options),
    },
    effects: {
      ...(api.vibrateShort ? { vibrateShort: options => api.vibrateShort!(options) } : {}),
      ...(api.vibrateLong ? { vibrateLong: () => api.vibrateLong!() } : {}),
      ...(api.createInnerAudioContext
        ? { createInnerAudioContext: () => api.createInnerAudioContext!() }
        : {}),
    },
    lifecycle: {
      onAppShow(listener) {
        const wrapper = () => listener();
        appShowWrappers.set(listener, wrapper);
        api.onAppShow(wrapper);
      },
      ...(api.offAppShow
        ? {
            offAppShow(listener: () => void) {
              const wrapper = appShowWrappers.get(listener);
              if (!wrapper) return;
              appShowWrappers.delete(listener);
              api.offAppShow!(wrapper);
            },
          }
        : {}),
      onNetworkStatusChange(listener) {
        api.onNetworkStatusChange(listener);
      },
      ...(api.offNetworkStatusChange
        ? {
            offNetworkStatusChange(listener: (status: WeChatMiniProgramNetworkStatus) => void) {
              api.offNetworkStatusChange!(listener);
            },
          }
        : {}),
    },
  };
}
