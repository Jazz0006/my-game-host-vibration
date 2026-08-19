import type {
  ClientProtocolMessage,
  ClientReconnectCredentials,
  ClientStateEnvelope,
} from "../../protocol/client/ClientProtocol.js";
import type { ClientConnectionFailure } from "./ClientConnectionFSM.js";

export type ClientAuthoritativeStateDelivery<TPayload = unknown> = {
  generation: number;
  revision: number;
  envelope: ClientStateEnvelope<TPayload>;
};

export type ClientRealtimeTransportListener = {
  onOpen(generation: number): void;
  onClose(generation: number, reason?: string): void;
  onError(generation: number, failure: ClientConnectionFailure): void;
};

/**
 * E2.2b transport port shared by Web and future native clients.
 *
 * A transport owns wire connectivity/framing only. It reports open/close/error
 * callbacks tagged with the connection generation, can request one current
 * authoritative state for synchronization, and can send protocol messages.
 * Reconnect policy, revision reconciliation, and game/UI behavior stay outside
 * the transport implementation.
 */
export interface ClientRealtimeTransport<TStatePayload = unknown> {
  setListener(listener: ClientRealtimeTransportListener): void;

  connect(generation: number): void;

  disconnect(generation: number): void;

  synchronize(
    credentials: ClientReconnectCredentials,
    generation: number,
  ): Promise<ClientAuthoritativeStateDelivery<TStatePayload>>;

  send(message: ClientProtocolMessage): Promise<unknown>;
}
