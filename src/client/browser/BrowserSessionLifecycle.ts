import type { ClientConnectionContext } from "../runtime/ClientConnectionFSM.js";

export type BrowserLifecycleSession = {
  getConnectionState(): ClientConnectionContext;
  reconnect(): void;
  resync(): void;
};

export type BrowserDocumentLike = {
  visibilityState?: string;
  addEventListener(event: string, listener: () => void): void;
  removeEventListener(event: string, listener: () => void): void;
};

export type BrowserWindowLike = {
  addEventListener(event: string, listener: () => void): void;
  removeEventListener(event: string, listener: () => void): void;
};

export type BrowserSessionLifecycleOptions = {
  document?: BrowserDocumentLike;
  window?: BrowserWindowLike;
};

function recoverSession(session: BrowserLifecycleSession): void {
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
 * E2.2 browser lifecycle bridge. Background suspension may leave a Socket.IO
 * connection apparently healthy even though the local PlayerView is no longer
 * trustworthy. Returning to foreground therefore revalidates Connected state;
 * a transport that has already reported Disconnected follows the reconnect path.
 *
 * `offline` is intentionally observational. Socket.IO remains the owner of the
 * actual transport-close signal; the next `online` event immediately asks the
 * ClientSession to reconcile whatever state the transport reported.
 */
export function attachBrowserSessionLifecycle(
  session: BrowserLifecycleSession,
  options: BrowserSessionLifecycleOptions = {},
): () => void {
  const documentTarget = options.document ?? globalThis.document;
  const windowTarget = options.window ?? globalThis.window;
  let sawOffline = false;

  const onVisibilityChange = () => {
    if (documentTarget.visibilityState === "visible") recoverSession(session);
  };
  const onOffline = () => {
    sawOffline = true;
  };
  const onOnline = () => {
    sawOffline = false;
    recoverSession(session);
  };

  documentTarget.addEventListener("visibilitychange", onVisibilityChange);
  windowTarget.addEventListener("offline", onOffline);
  windowTarget.addEventListener("online", onOnline);

  return () => {
    documentTarget.removeEventListener("visibilitychange", onVisibilityChange);
    windowTarget.removeEventListener("offline", onOffline);
    windowTarget.removeEventListener("online", onOnline);
    void sawOffline;
  };
}
