import type {
  ClientProtocolMessage,
  ClientRealtimeEventEnvelope,
  ClientReconnectCredentials,
  ClientStateEnvelope,
} from "../../protocol/client/ClientProtocol.js";
import type { ClientConnectionFailure } from "./ClientConnectionFSM.js";

export type ClientAuthoritativeStateDelivery<TPayload = unknown> = {
  generation: number;
  revision: number;
  envelope: ClientStateEnvelope<TPayload>;
};

export type ClientRealtimeEventDelivery<
  TType extends string = string,
  TPayload = unknown,
> = {
  generation: number;
  envelope: ClientRealtimeEventEnvelope<TType, TPayload>;
};

export type ClientRealtimeTransportListener<TStatePayload = unknown> = {
  onOpen(generation: number): void;
  onClose(generation: number, reason?: string): void;
  onError(generation: number, failure: ClientConnectionFailure): void;
  onState(delivery: ClientAuthoritativeStateDelivery<TStatePayload>): void;
  onEvent(delivery: ClientRealtimeEventDelivery): void;
};

/**
 * E2.2 transport port shared by Web and future native clients.
 *
 * A transport owns wire connectivity/framing only. It reports open/close/error
 * callbacks tagged with the connection generation, can request one current
 * authoritative state for synchronization, forwards revised authoritative
 * state pushes and transient realtime events, and can send protocol messages.
 * Reconnect policy, revision reconciliation, event replay policy, and game/UI
 * behavior stay outside the transport.
 */
export interface ClientRealtimeTransport<TStatePayload = unknown> {
  setListener(listener: ClientRealtimeTransportListener<TStatePayload>): void;

  connect(generation: number): void;

  disconnect(generation: number): void;

  synchronize(
    credentials: ClientReconnectCredentials,
    generation: number,
  ): Promise<ClientAuthoritativeStateDelivery<TStatePayload>>;

  send(message: ClientProtocolMessage): Promise<unknown>;
}
