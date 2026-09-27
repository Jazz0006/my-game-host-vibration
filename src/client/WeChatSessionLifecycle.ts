import type { ClientConnectionContext } from "./runtime/ClientConnectionFSM.js";

export type WeChatLifecycleSession = {
  getConnectionState(): ClientConnectionContext;
  reconnect(): void;
  resync(): void;
};

export type WeChatAppLifecycleLike = {
  onAppShow(listener: () => void): void;
  onAppHide(listener: () => void): void;
  offAppShow?(listener: () => void): void;
  offAppHide?(listener: () => void): void;
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

export function attachWeChatSessionLifecycle(
  session: WeChatLifecycleSession,
  lifecycle: WeChatAppLifecycleLike,
): () => void {
  let sawBackground = false;

  const onHide = () => {
    sawBackground = true;
  };

  const onShow = () => {
    if (!sawBackground) return;
    sawBackground = false;
    recoverSession(session);
  };

  lifecycle.onAppHide(onHide);
  lifecycle.onAppShow(onShow);

  return () => {
    lifecycle.offAppHide?.(onHide);
    lifecycle.offAppShow?.(onShow);
    sawBackground = false;
  };
}
