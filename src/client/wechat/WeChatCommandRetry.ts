import type { ClientSession } from "../runtime/ClientSession.js";
import type { ClientCommandEnvelope } from "../../protocol/client/ClientProtocol.js";

export type WeChatCommandRetryOptions = {
  maxReconnectRetries?: number;
};

function retryableStatus(status: string): boolean {
  return status === "Disconnected" || status === "Reconnecting" || status === "Syncing";
}

function waitForConnected<TStatePayload>(
  session: ClientSession<TStatePayload>,
  originalError: unknown,
): Promise<void> {
  const current = session.getConnectionState();
  if (current.status === "Connected") return Promise.resolve();
  if (!retryableStatus(current.status)) return Promise.reject(originalError);

  return new Promise((resolve, reject) => {
    let settled = false;
    let unsubscribe: (() => void) | null = null;

    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      unsubscribe?.();
      callback();
    };

    unsubscribe = session.subscribe(snapshot => {
      const status = snapshot.connection.status;
      if (status === "Connected") {
        finish(resolve);
        return;
      }
      if (status === "Failed" || status === "Disposed" || status === "Idle") {
        finish(() => reject(originalError));
      }
    });
  });
}

/**
 * E3.4 reconnect-aware command retry boundary for the native WeChat client.
 *
 * The exact same semantic command envelope is retried after ClientSession has
 * recovered to Connected, which preserves commandId for C3 server idempotency.
 * Raw WebSocket requestId values remain transport-local and may change between
 * attempts. This helper does not initiate reconnect itself; lifecycle/session
 * recovery remains owned by the E3.1/E3.3 boundaries.
 */
export async function sendWeChatCommandWithReconnectRetry<TStatePayload>(
  session: ClientSession<TStatePayload>,
  command: ClientCommandEnvelope,
  options: WeChatCommandRetryOptions = {},
): Promise<unknown> {
  const maxReconnectRetries = Number.isInteger(options.maxReconnectRetries)
    ? Math.max(0, Number(options.maxReconnectRetries))
    : 1;

  let retries = 0;
  while (true) {
    try {
      return await session.send(command);
    } catch (error) {
      if (retries >= maxReconnectRetries) throw error;
      if (!retryableStatus(session.getConnectionState().status)) throw error;
      retries += 1;
      await waitForConnected(session, error);
    }
  }
}
