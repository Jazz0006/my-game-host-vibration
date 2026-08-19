import type { ClientConnectionContext } from "../runtime/ClientConnectionFSM.js";

export type WeChatLifecycleSession = {
  getConnectionState(): ClientConnectionContext;
  reconnect(): void;
  resync(): void;
};

export type WeChatNetworkStatus = {
  isConnected: boolean;
};

export type WeChatLifecycleApi = {
  onAppShow(listener: () => void): void;
  offAppShow?(listener: () => void): void;
  onNetworkStatusChange(listener: (status: WeChatNetworkStatus) => void): void;
  offNetworkStatusChange?(listener: (status: WeChatNetworkStatus) => void): void;
};

function recoverSession(session: WeChatLifecycleSession): void {
  switch (session.getConnectionState().status) {
    case "Connected":
      session.resync();
      return;

    case "Disconnected":
      session.reconnect();
      return;

    case "Idle":
    case "Connecting":
    case "Syncing":
    case "Reconnecting":
    case "Failed":
    case "Disposed":
      return;
  }
}

/**
 * E3.1 native WeChat lifecycle bridge.
 *
 * Mini Program foreground/background and network signals stay in the platform
 * adapter instead of leaking into ClientSession. Returning to the foreground
 * revalidates a healthy synchronized session because the app may have been
 * suspended while authoritative game state advanced. A confirmed network
 * recovery follows the same rule: Connected sessions resync, while sessions
 * already reported Disconnected start a new ClientSession generation.
 *
 * Network loss itself is observational. The transport remains responsible for
 * reporting the actual close/error signal to ClientSession.
 */
export function attachWeChatSessionLifecycle(
  session: WeChatLifecycleSession,
  api: WeChatLifecycleApi,
): () => void {
  const onAppShow = () => {
    recoverSession(session);
  };
  const onNetworkStatusChange = (status: WeChatNetworkStatus) => {
    if (status.isConnected) recoverSession(session);
  };

  api.onAppShow(onAppShow);
  api.onNetworkStatusChange(onNetworkStatusChange);

  return () => {
    api.offAppShow?.(onAppShow);
    api.offNetworkStatusChange?.(onNetworkStatusChange);
  };
}
