import { describe, expect, it } from "vitest";
import { ClientSession } from "../src/client/runtime/ClientSession.js";
import {
  createInitialClientConnectionContext,
  transitionClientConnection,
} from "../src/client/runtime/ClientConnectionFSM.js";
import type {
  ClientAuthoritativeStateDelivery,
  ClientRealtimeTransport,
  ClientRealtimeTransportListener,
} from "../src/client/runtime/ClientRealtimeTransport.js";
import { createPlayerStateEnvelope } from "../src/protocol/client/ClientProtocol.js";

type View = { phase: string };

type Deferred<T> = {
  promise: Promise<T>;
  resolve(value: T): void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(resolvePromise => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

class ResyncTransport implements ClientRealtimeTransport<View> {
  listener: ClientRealtimeTransportListener<View> | null = null;
  readonly connects: number[] = [];
  readonly syncs: Array<Deferred<ClientAuthoritativeStateDelivery<View>>> = [];

  setListener(listener: ClientRealtimeTransportListener<View>): void {
    this.listener = listener;
  }

  connect(generation: number): void {
    this.connects.push(generation);
  }

  disconnect(): void {}

  synchronize(): Promise<ClientAuthoritativeStateDelivery<View>> {
    const pending = deferred<ClientAuthoritativeStateDelivery<View>>();
    this.syncs.push(pending);
    return pending.promise;
  }

  send(): Promise<unknown> {
    return Promise.resolve({ ok: true });
  }

  open(generation: number): void {
    this.listener?.onOpen(generation);
  }
}

function state(generation: number, revision: number, phase: string) {
  return {
    generation,
    revision,
    envelope: createPlayerStateEnvelope("room-1", "p1", { phase }),
  };
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("E2.2b3a ClientSession resync", () => {
  it("pure FSM moves Connected to Syncing without advancing generation", () => {
    let context = createInitialClientConnectionContext();
    context = transitionClientConnection(context, { type: "connectRequested" }).context;
    context = transitionClientConnection(context, {
      type: "transportOpened",
      generation: 1,
    }).context;
    context = transitionClientConnection(context, {
      type: "authoritativeStateSynchronized",
      generation: 1,
    }).context;

    const resync = transitionClientConnection(context, { type: "resyncRequested" });
    expect(resync.context).toEqual({ status: "Syncing", generation: 1 });
    expect(resync.effects).toEqual([
      { type: "synchronizeAuthoritativeState", generation: 1 },
    ]);
  });

  it("resyncs an already Connected session with the same generation and equal revision", async () => {
    const transport = new ResyncTransport();
    const session = new ClientSession<View>(transport);

    session.start({ roomId: "room-1", playerId: "p1", resumeToken: "token" });
    transport.open(1);
    transport.syncs[0]!.resolve(state(1, 5, "night"));
    await flushPromises();

    expect(session.getConnectionState()).toEqual({ status: "Connected", generation: 1 });
    expect(transport.connects).toEqual([1]);

    session.resync();
    expect(session.getConnectionState()).toEqual({ status: "Syncing", generation: 1 });
    expect(transport.connects).toEqual([1]);
    expect(transport.syncs).toHaveLength(2);

    transport.syncs[1]!.resolve(state(1, 5, "night"));
    await flushPromises();

    expect(session.getConnectionState()).toEqual({ status: "Connected", generation: 1 });
    expect(session.getAuthoritativeState().revision).toBe(5);
  });

  it("applies a newer authoritative revision during foreground resync", async () => {
    const transport = new ResyncTransport();
    const session = new ClientSession<View>(transport);

    session.start({ roomId: "room-1", playerId: "p1", resumeToken: "token" });
    transport.open(1);
    transport.syncs[0]!.resolve(state(1, 7, "day"));
    await flushPromises();

    session.resync();
    transport.syncs[1]!.resolve(state(1, 8, "night"));
    await flushPromises();

    expect(session.getConnectionState()).toEqual({ status: "Connected", generation: 1 });
    expect(session.getAuthoritativeState().revision).toBe(8);
    expect(session.getAuthoritativeState().envelope?.payload).toEqual({ phase: "night" });
  });

  it("ignores duplicate resync requests while already Syncing", async () => {
    const transport = new ResyncTransport();
    const session = new ClientSession<View>(transport);

    session.start({ roomId: "room-1", playerId: "p1", resumeToken: "token" });
    transport.open(1);
    transport.syncs[0]!.resolve(state(1, 1, "lobby"));
    await flushPromises();

    session.resync();
    session.resync();
    expect(transport.syncs).toHaveLength(2);
    expect(session.getConnectionState()).toEqual({ status: "Syncing", generation: 1 });
  });
});
