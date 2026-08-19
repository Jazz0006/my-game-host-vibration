import { describe, expect, it } from "vitest";
import { ClientSession } from "../src/client/runtime/ClientSession.js";
import type {
  ClientAuthoritativeStateDelivery,
  ClientRealtimeTransport,
  ClientRealtimeTransportListener,
} from "../src/client/runtime/ClientRealtimeTransport.js";
import {
  createClientRealtimeEventEnvelope,
  createPlayerStateEnvelope,
  type ClientProtocolMessage,
  type ClientReconnectCredentials,
} from "../src/protocol/client/ClientProtocol.js";

type View = { phase: string };

class FakeRealtimeTransport implements ClientRealtimeTransport<View> {
  listener: ClientRealtimeTransportListener<View> | null = null;
  private syncGeneration = 0;

  setListener(listener: ClientRealtimeTransportListener<View>): void {
    this.listener = listener;
  }

  connect(_generation: number): void {}
  disconnect(_generation: number): void {}

  synchronize(
    credentials: ClientReconnectCredentials,
    generation: number,
  ): Promise<ClientAuthoritativeStateDelivery<View>> {
    this.syncGeneration = generation;
    return Promise.resolve({
      generation,
      revision: generation,
      envelope: createPlayerStateEnvelope(
        credentials.roomId,
        credentials.playerId,
        { phase: "night" },
      ),
    });
  }

  send(_message: ClientProtocolMessage): Promise<unknown> {
    return Promise.resolve({ ok: true });
  }

  open(generation: number): void {
    this.listener?.onOpen(generation);
  }

  event(generation: number, type: string, payload: unknown): void {
    this.listener?.onEvent({
      generation,
      envelope: createClientRealtimeEventEnvelope(type, payload),
    });
  }

  get lastSyncGeneration(): number {
    return this.syncGeneration;
  }
}

const credentials = {
  roomId: "room-1",
  playerId: "p1",
  resumeToken: "resume-1",
} as const;

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("E2.2c1 ClientSession realtime events", () => {
  it("delivers current-generation events only after authoritative synchronization", async () => {
    const transport = new FakeRealtimeTransport();
    const session = new ClientSession<View>(transport);
    const received: unknown[] = [];
    session.subscribeRealtimeEvents(event => received.push(event));

    session.start(credentials);
    transport.event(1, "action-alert", { actionId: "a1" });
    expect(received).toEqual([]);

    transport.open(1);
    transport.event(1, "action-alert", { actionId: "a2" });
    expect(received).toEqual([]);

    await flushPromises();
    expect(session.getConnectionState()).toEqual({ status: "Connected", generation: 1 });
    expect(transport.lastSyncGeneration).toBe(1);

    transport.event(1, "action-alert", { actionId: "a3" });
    expect(received).toEqual([
      createClientRealtimeEventEnvelope("action-alert", { actionId: "a3" }),
    ]);
  });

  it("does not replay or deduplicate transient effects", async () => {
    const transport = new FakeRealtimeTransport();
    const session = new ClientSession<View>(transport);
    const received: string[] = [];
    session.subscribeRealtimeEvents(event => received.push(String(event.type)));

    session.start(credentials);
    transport.open(1);
    await flushPromises();

    transport.event(1, "action-alert", {});
    transport.event(1, "action-alert", {});
    expect(received).toEqual(["action-alert", "action-alert"]);

    transport.listener?.onClose(1, "network-lost");
    session.reconnect();
    transport.event(1, "stale-generation", {});
    transport.open(2);
    transport.event(2, "during-sync", {});
    await flushPromises();

    expect(session.getConnectionState()).toEqual({ status: "Connected", generation: 2 });
    expect(received).toEqual(["action-alert", "action-alert"]);

    transport.event(2, "current", {});
    expect(received).toEqual(["action-alert", "action-alert", "current"]);
  });

  it("stops delivering events after unsubscribe or dispose", async () => {
    const transport = new FakeRealtimeTransport();
    const session = new ClientSession<View>(transport);
    const received: string[] = [];
    const unsubscribe = session.subscribeRealtimeEvents(event => received.push(String(event.type)));

    session.start(credentials);
    transport.open(1);
    await flushPromises();

    transport.event(1, "first", {});
    unsubscribe();
    transport.event(1, "second", {});
    session.dispose();
    transport.event(1, "third", {});

    expect(received).toEqual(["first"]);
  });
});
