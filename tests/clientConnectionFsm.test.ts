import { describe, expect, it } from "vitest";
import {
  createInitialClientConnectionContext,
  transitionClientConnection,
  type ClientConnectionContext,
  type ClientConnectionEvent,
} from "../src/client/runtime/ClientConnectionFSM.js";

function step(
  context: ClientConnectionContext,
  event: ClientConnectionEvent,
): ClientConnectionContext {
  return transitionClientConnection(context, event).context;
}

describe("E2.2a ClientConnectionFSM", () => {
  it("requires authoritative synchronization before Connected", () => {
    const initial = createInitialClientConnectionContext();
    const connecting = transitionClientConnection(initial, { type: "connectRequested" });

    expect(connecting.context).toEqual({ status: "Connecting", generation: 1 });
    expect(connecting.effects).toEqual([
      { type: "openTransport", generation: 1, reconnect: false },
    ]);

    const syncing = transitionClientConnection(connecting.context, {
      type: "transportOpened",
      generation: 1,
    });
    expect(syncing.context.status).toBe("Syncing");
    expect(syncing.context.status).not.toBe("Connected");
    expect(syncing.effects).toEqual([
      { type: "synchronizeAuthoritativeState", generation: 1 },
    ]);

    const connected = transitionClientConnection(syncing.context, {
      type: "authoritativeStateSynchronized",
      generation: 1,
    });
    expect(connected.context).toEqual({ status: "Connected", generation: 1 });
  });

  it("runs Connected -> Disconnected -> Reconnecting -> Syncing -> Connected", () => {
    let context = createInitialClientConnectionContext();
    context = step(context, { type: "connectRequested" });
    context = step(context, { type: "transportOpened", generation: 1 });
    context = step(context, { type: "authoritativeStateSynchronized", generation: 1 });

    context = step(context, { type: "transportClosed", generation: 1 });
    expect(context).toEqual({ status: "Disconnected", generation: 1 });

    const reconnecting = transitionClientConnection(context, { type: "reconnectRequested" });
    expect(reconnecting.context).toEqual({ status: "Reconnecting", generation: 2 });
    expect(reconnecting.effects).toEqual([
      { type: "openTransport", generation: 2, reconnect: true },
    ]);

    context = step(reconnecting.context, { type: "transportOpened", generation: 2 });
    expect(context.status).toBe("Syncing");
    context = step(context, { type: "authoritativeStateSynchronized", generation: 2 });
    expect(context).toEqual({ status: "Connected", generation: 2 });
  });

  it("ignores stale network results from an earlier generation", () => {
    let context = createInitialClientConnectionContext();
    context = step(context, { type: "connectRequested" });
    context = step(context, { type: "transportOpened", generation: 1 });
    context = step(context, { type: "transportClosed", generation: 1 });
    context = step(context, { type: "reconnectRequested" });
    context = step(context, { type: "transportOpened", generation: 2 });

    const staleSync = transitionClientConnection(context, {
      type: "authoritativeStateSynchronized",
      generation: 1,
    });
    expect(staleSync.context).toBe(context);
    expect(staleSync.effects).toEqual([]);

    const freshSync = transitionClientConnection(context, {
      type: "authoritativeStateSynchronized",
      generation: 2,
    });
    expect(freshSync.context.status).toBe("Connected");
  });

  it("moves a current-generation protocol failure to Failed", () => {
    let context = createInitialClientConnectionContext();
    context = step(context, { type: "connectRequested" });
    context = step(context, { type: "transportOpened", generation: 1 });

    const failed = transitionClientConnection(context, {
      type: "protocolFailed",
      generation: 1,
      failure: { code: "bad-state", message: "invalid protocol state" },
    });

    expect(failed.context).toEqual({
      status: "Failed",
      generation: 1,
      failure: { code: "bad-state", message: "invalid protocol state" },
    });
    expect(failed.effects).toEqual([{ type: "closeTransport", generation: 1 }]);
  });

  it("ignores all later network events after dispose", () => {
    let context = createInitialClientConnectionContext();
    context = step(context, { type: "connectRequested" });
    context = step(context, { type: "transportOpened", generation: 1 });

    const disposed = transitionClientConnection(context, { type: "dispose" });
    expect(disposed.context).toEqual({ status: "Disposed", generation: 1 });
    expect(disposed.effects).toEqual([{ type: "closeTransport", generation: 1 }]);

    const afterOpen = transitionClientConnection(disposed.context, {
      type: "transportOpened",
      generation: 1,
    });
    const afterSync = transitionClientConnection(disposed.context, {
      type: "authoritativeStateSynchronized",
      generation: 1,
    });
    const afterFailure = transitionClientConnection(disposed.context, {
      type: "protocolFailed",
      generation: 1,
      failure: { code: "late" },
    });

    expect(afterOpen.context).toBe(disposed.context);
    expect(afterSync.context).toBe(disposed.context);
    expect(afterFailure.context).toBe(disposed.context);
  });
});
