import type { ClientReconnectCredentials } from "../../protocol/client/ClientProtocol.js";
import { ClientSession } from "../runtime/ClientSession.js";
import {
  WeChatRealtimeTransport,
  type WeChatRealtimePlatform,
  type WeChatRealtimeTransportOptions,
} from "./WeChatRealtimeTransport.js";

/**
 * E3.3 native WeChat composition root.
 *
 * UI code supplies only platform capabilities, stable reconnect credentials,
 * and the Cloudflare base URL. Connection FSM, generation handling,
 * authoritative revision reconciliation, and protocol framing remain behind
 * ClientSession / WeChatRealtimeTransport.
 */
export function createWeChatClientSession<TStatePayload = unknown>(
  platform: WeChatRealtimePlatform,
  credentials: ClientReconnectCredentials,
  options: WeChatRealtimeTransportOptions,
): ClientSession<TStatePayload> {
  return new ClientSession<TStatePayload>(
    new WeChatRealtimeTransport<TStatePayload>(platform, credentials, options),
  );
}
