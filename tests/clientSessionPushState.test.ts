import { describe, expect, it } from "vitest";
import { ClientSession } from "../src/client/runtime/ClientSession.js";
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

class PushTransport implements ClientRealtimeTransport<View> {
  listener: ClientRealtimeTransportListener<View> | null = null;
  readonly disconnects: number[] = [];
  readonly synchronizations: Array<Deferred<ClientAuthoritativeStateDelivery<View>>> = [];

  setListener(listener: ClientRealtimeTransportListener<View>): void {
    this.listener = listener;
  }

  connect(): void {}

  disconnect(generation: number): void {
    this.disconnects.push(generation);
  }

  synchronize(): Promise<ClientAuthoritativeStateDelivery<View>> {
    const pending = deferred<ClientAuthoritativeStateDelivery<View>>();
    this.synchronizations.push(pending);
    return pending.promise;
  }

  send(): Promise<unknown> {
    return Promise.resolve({ ok: true });
  }

  open(generation: number): void {
    this.listener?.onOpen(generation);
  }

  close(generation: number): void {
    this.listener?.onClose(generation);
  }

  push(delivery: ClientAuthoritativeStateDelivery<View>): void {
    this.listener?.onState(delivery);
  }
}

const credentials = {
  roomId: "room-1",
  playerId: "p1",
  resumeToken: "resume-1",
};

function state(
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

describe("E2.2b2b ClientSession pushed authoritative state", () => {
  it("allows a realtime authoritative push to complete Syncing before the sync response", async () => {
    const transport = new PushTransport();
    const session = new ClientSession<View>(transport);
    const statuses: string[] = [];
    session.subscribe(snapshot => statuses.push(snapshot.connection.status));

    session.start(credentials);
    transport.open(1);
    expect(session.getConnectionState().status).toBe("Syncing");
    expect(transport.synchronizations).toHaveLength(1);

    transport.push(state(1, 4, "night"));
    expect(session.getConnectionState()).toEqual({ status: "Connected", generation: 1 });
    expect(session.getAuthoritativeState().revision).toBe(4);

    transport.synchronizations[0]!.resolve(state(1, 4, "night"));
    await flushPromises();

    expect(session.getConnectionState()).toEqual({ status: "Connected", generation: 1 });
    expect(statuses).toEqual(["Idle", "Connecting", "Syncing", "Connected"]);
  });

  it("applies newer pushed revisions while Connected and notifies subscribers", async () => {
    const transport = new PushTransport();
    const session = new ClientSession<View>(transport);
    const revisions: Array<number | null> = [];
    session.subscribe(snapshot => revisions.push(snapshot.authoritativeState.revision));

    session.start(credentials);
    transport.open(1);
    transport.push(state(1, 10, "day"));
    transport.push(state(1, 11, "night"));

    expect(session.getAuthoritativeState().revision).toBe(11);
    expect(session.getAuthoritativeState().envelope?.payload).toEqual({ phase: "night" });
    expect(revisions.at(-1)).toBe(11);

    transport.synchronizations[0]!.resolve(state(1, 11, "night"));
    await flushPromises();
  });

  it("ignores duplicate, stale-revision, and stale-generation realtime pushes", () => {
    const transport = new PushTransport();
    const session = new ClientSession<View>(transport);

    session.start(credentials);
    transport.open(1);
    transport.push(state(1, 20, "fresh"));
    transport.push(state(1, 20, "duplicate"));
    transport.push(state(1, 19, "stale-revision"));
    transport.push(state(0, 21, "stale-generation"));

    expect(session.getConnectionState()).toEqual({ status: "Connected", generation: 1 });
    expect(session.getAuthoritativeState().revision).toBe(20);
    expect(session.getAuthoritativeState().envelope?.payload).toEqual({ phase: "fresh" });
  });

  it("fails closed when a current-generation push belongs to another session", () => {
    const transport = new PushTransport();
    const session = new ClientSession<View>(transport);

    session.start(credentials);
    transport.open(1);
    transport.push(state(1, 3, "wrong", "room-2", "p9"));

    expect(session.getConnectionState()).toEqual({
      status: "Failed",
      generation: 1,
      failure: {
        code: "authoritative-session-mismatch",
        message: "authoritative state push belongs to another session",
      },
    });
    expect(transport.disconnects).toEqual([1]);
    expect(session.getAuthoritativeState().envelope).toBeNull();
  });
});
