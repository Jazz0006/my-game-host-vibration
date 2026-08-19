import { describe, expect, it } from "vitest";
import {
  createInitialClientConnectionContext,
  transitionClientConnection,
} from "../src/client/runtime/ClientConnectionFSM.js";

describe("E3.3 reconnect generation contract", () => {
  it("advances generation only for a real disconnected reconnect", () => {
    let context = createInitialClientConnectionContext();
    context = transitionClientConnection(context, { type: "connectRequested" }).context;
    context = transitionClientConnection(context, { type: "transportOpened", generation: 1 }).context;
    context = transitionClientConnection(context, {
      type: "authoritativeStateSynchronized",
      generation: 1,
    }).context;

    const resync = transitionClientConnection(context, { type: "resyncRequested" });
    expect(resync.context).toEqual({ status: "Syncing", generation: 1 });

    const disconnected = transitionClientConnection(context, {
      type: "transportClosed",
      generation: 1,
    }).context;
    const reconnect = transitionClientConnection(disconnected, { type: "reconnectRequested" });
    expect(reconnect.context).toEqual({ status: "Reconnecting", generation: 2 });
  });
});
