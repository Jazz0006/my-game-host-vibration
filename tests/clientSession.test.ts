import { describe, expect, it } from "vitest";
import { ClientSession } from "../src/client/runtime/ClientSession.js";
import type {
  ClientAuthoritativeStateDelivery,
  ClientRealtimeTransport,
  ClientRealtimeTransportListener,
} from "../src/client/runtime/ClientRealtimeTransport.js";
import {
  createClientCommandEnvelope,
  createPlayerStateEnvelope,
  type ClientProtocolMessage,
  type ClientReconnectCredentials,
} from "../src/protocol/client/ClientProtocol.js";

type View = { phase: string };

type Deferred<T> = {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

class FakeRealtimeTransport implements ClientRealtimeTransport<View> {
  listener: ClientRealtimeTransportListener | null = null;
  readonly connects: number[] = [];
  readonly disconnects: number[] = [];
  readonly syncs: Array<{
    credentials: ClientReconnectCredentials;
    generation: number;
    deferred: Deferred<ClientAuthoritativeStateDelivery<View>>;
  }> = [];
  readonly sent: ClientProtocolMessage[] = [];

  setListener(listener: ClientRealtimeTransportListener): void {
    this.listener = listener;
  }

  connect(generation: number): void {
    this.connects.push(generation);
  }

  disconnect(generation: number): void {
    this.disconnects.push(generation);
  }

  synchronize(
    credentials: ClientReconnectCredentials,
    generation: number,
  ): Promise<ClientAuthoritativeStateDelivery<View>> {
    const sync = deferred<ClientAuthoritativeStateDelivery<View>>();
    this.syncs.push({ credentials: { ...credentials }, generation, deferred: sync });
    return sync.promise;
  }

  send(message: ClientProtocolMessage): Promise<unknown> {
    this.sent.push(message);
    return Promise.resolve({ ok: true });
  }

  open(generation: number): void {
    this.listener?.onOpen(generation);
  }

  close(generation: number, reason?: string): void {
    this.listener?.onClose(generation, reason);
  }
}

const credentials = {
  roomId: "room-1",
  playerId: "p1",
  resumeToken: "resume-1",
} as const;

function delivery(
  generation: number,
  revision: number,
  phase: string,
  roomId = credentials.roomId,
  playerId = credentials.playerId,
): ClientAuthoritativeStateDelivery<View> {
  return {
    generation,
    revision,
    envelope: createPlayerStateEnvelope(roomId, playerId, { phase }),
  };
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("E2.2b1 ClientSession", () => {
  it("does not become Connected until authoritative state is synchronized", async () => {
    const transport = new FakeRealtimeTransport();
    const session = new ClientSession<View>(transport);

    session.start(credentials);
    expect(session.getConnectionState()).toEqual({ status: "Connecting", generation: 1 });
    expect(transport.connects).toEqual([1]);

    transport.open(1);
    expect(session.getConnectionState()).toEqual({ status: "Syncing", generation: 1 });
    expect(transport.syncs).toHaveLength(1);
    expect(transport.syncs[0]!.credentials).toEqual(credentials);

    transport.syncs[0]!.deferred.resolve(delivery(1, 7, "night"));
    await flushPromises();

    expect(session.getConnectionState()).toEqual({ status: "Connected", generation: 1 });
    expect(session.getAuthoritativeState().revision).toBe(7);
    expect(session.getAuthoritativeState().envelope?.payload).toEqual({ phase: "night" });
  });

  it("treats an equal revision as successful reconnect synchronization", async () => {
    const transport = new FakeRealtimeTransport();
    const session = new ClientSession<View>(transport);

    session.start(credentials);
    transport.open(1);
    transport.syncs[0]!.deferred.resolve(delivery(1, 12, "day"));
    await flushPromises();

    transport.close(1, "network-lost");
    expect(session.getConnectionState().status).toBe("Disconnected");

    session.reconnect();
    expect(session.getConnectionState()).toEqual({ status: "Reconnecting", generation: 2 });
    expect(session.getAuthoritativeState().revision).toBe(12);
    expect(session.getAuthoritativeState().envelope?.payload).toEqual({ phase: "day" });

    transport.open(2);
    transport.syncs[1]!.deferred.resolve(delivery(2, 12, "day"));
    await flushPromises();

    expect(session.getConnectionState()).toEqual({ status: "Connected", generation: 2 });
    expect(session.getAuthoritativeState().revision).toBe(12);
  });

  it("ignores an older generation synchronization that resolves after a newer reconnect", async () => {
    const transport = new FakeRealtimeTransport();
    const session = new ClientSession<View>(transport);

    session.start(credentials);
    transport.open(1);
    expect(transport.syncs).toHaveLength(1);

    transport.close(1);
    session.reconnect();
    transport.open(2);
    expect(transport.syncs).toHaveLength(2);

    transport.syncs[1]!.deferred.resolve(delivery(2, 20, "fresh"));
    await flushPromises();
    expect(session.getConnectionState()).toEqual({ status: "Connected", generation: 2 });
    expect(session.getAuthoritativeState().envelope?.payload).toEqual({ phase: "fresh" });

    transport.syncs[0]!.deferred.resolve(delivery(1, 21, "late-old"));
    await flushPromises();
    expect(session.getConnectionState()).toEqual({ status: "Connected", generation: 2 });
    expect(session.getAuthoritativeState().revision).toBe(20);
    expect(session.getAuthoritativeState().envelope?.payload).toEqual({ phase: "fresh" });
  });

  it("fails synchronization when authoritative state belongs to another session", async () => {
    const transport = new FakeRealtimeTransport();
    const session = new ClientSession<View>(transport);

    session.start(credentials);
    transport.open(1);
    transport.syncs[0]!.deferred.resolve(delivery(1, 2, "wrong", "room-2", "p9"));
    await flushPromises();

    expect(session.getConnectionState()).toEqual({
      status: "Failed",
      generation: 1,
      failure: {
        code: "authoritative-session-mismatch",
        message: "authoritative synchronization returned state for another session",
      },
    });
    expect(transport.disconnects).toEqual([1]);
    expect(session.getAuthoritativeState().envelope).toBeNull();
  });

  it("blocks protocol sends before synchronization and delegates them after Connected", async () => {
    const transport = new FakeRealtimeTransport();
    const session = new ClientSession<View>(transport);
    const command = createClientCommandEnvelope("werewolf.confirmRole", {}, "command-1");

    session.start(credentials);
    await expect(session.send(command)).rejects.toThrow("client session is not synchronized");
    expect(transport.sent).toEqual([]);

    transport.open(1);
    transport.syncs[0]!.deferred.resolve(delivery(1, 1, "role_reveal"));
    await flushPromises();

    await expect(session.send(command)).resolves.toEqual({ ok: true });
    expect(transport.sent).toEqual([command]);
  });

  it("clears bound state on dispose and ignores late transport/sync callbacks", async () => {
    const transport = new FakeRealtimeTransport();
    const session = new ClientSession<View>(transport);

    session.start(credentials);
    transport.open(1);
    expect(transport.syncs).toHaveLength(1);

    session.dispose();
    expect(session.getConnectionState()).toEqual({ status: "Disposed", generation: 1 });
    expect(transport.disconnects).toEqual([1]);
    expect(session.getAuthoritativeState()).toEqual({
      session: null,
      generation: 2,
      revision: null,
      envelope: null,
    });

    transport.syncs[0]!.deferred.resolve(delivery(1, 99, "late"));
    transport.open(1);
    await flushPromises();

    expect(session.getConnectionState()).toEqual({ status: "Disposed", generation: 1 });
    expect(session.getAuthoritativeState().envelope).toBeNull();
  });
});
