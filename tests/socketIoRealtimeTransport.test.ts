import { describe, expect, it } from "vitest";
import { SocketIoRealtimeTransport } from "../src/client/browser/SocketIoRealtimeTransport.js";
import type { ClientRealtimeTransportListener } from "../src/client/runtime/ClientRealtimeTransport.js";
import {
  createClientCommandEnvelope,
  createPlayerStateEnvelope,
} from "../src/protocol/client/ClientProtocol.js";

type View = { phase: string };

type AckResponse = { error: Error | null; result?: unknown };

class FakeSocket {
  connected = false;
  connectCalls = 0;
  disconnectCalls = 0;
  readonly emitted: Array<{ event: string; payload: unknown }> = [];
  private readonly handlers = new Map<string, Array<(...args: any[]) => void>>();
  private readonly ackResponses = new Map<string, AckResponse[]>();

  connect(): void {
    this.connectCalls += 1;
  }

  disconnect(): void {
    this.disconnectCalls += 1;
    this.connected = false;
  }

  on(event: string, listener: (...args: any[]) => void): void {
    const listeners = this.handlers.get(event) ?? [];
    listeners.push(listener);
    this.handlers.set(event, listeners);
  }

  timeout(): { emit: (event: string, payload: unknown, callback: (error: Error | null, result?: unknown) => void) => void } {
    return {
      emit: (event, payload, callback) => {
        this.emitted.push({ event, payload });
        const responses = this.ackResponses.get(event) ?? [];
        const response = responses.shift();
        if (!response) throw new Error(`No fake acknowledgement queued for ${event}`);
        callback(response.error, response.result);
      },
    };
  }

  queueAck(event: string, result?: unknown, error: Error | null = null): void {
    const responses = this.ackResponses.get(event) ?? [];
    responses.push({ error, result });
    this.ackResponses.set(event, responses);
  }

  serverEmit(event: string, ...args: unknown[]): void {
    for (const listener of this.handlers.get(event) ?? []) listener(...args);
  }
}

function listener() {
  const opened: number[] = [];
  const closed: Array<{ generation: number; reason?: string }> = [];
  const states: unknown[] = [];
  const errors: unknown[] = [];
  const value: ClientRealtimeTransportListener<View> = {
    onOpen: generation => opened.push(generation),
    onClose: (generation, reason) => closed.push({ generation, ...(reason ? { reason } : {}) }),
    onError: (generation, failure) => errors.push({ generation, failure }),
    onState: state => states.push(state),
  };
  return { value, opened, closed, states, errors };
}

function statePayload(revision: number, phase: string) {
  return {
    revision,
    envelope: createPlayerStateEnvelope("room-1", "p1", { phase }),
  };
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("E2.2b2c SocketIoRealtimeTransport", () => {
  it("reports the active ClientSession generation when an already-open socket connects", async () => {
    const socket = new FakeSocket();
    socket.connected = true;
    const transport = new SocketIoRealtimeTransport<View>(socket);
    const events = listener();
    transport.setListener(events.value);

    transport.connect(7);
    await flushPromises();

    expect(socket.connectCalls).toBe(0);
    expect(events.opened).toEqual([7]);
  });

  it("synchronizes the current authenticated membership without resuming again", async () => {
    const socket = new FakeSocket();
    const transport = new SocketIoRealtimeTransport<View>(socket);
    transport.setListener(listener().value);
    transport.connect(1);

    socket.queueAck("client:sync-state", { ok: true, ...statePayload(4, "night") });
    const result = await transport.synchronize(
      { roomId: "room-1", playerId: "p1", resumeToken: "token" },
      1,
    );

    expect(result).toEqual({ generation: 1, ...statePayload(4, "night") });
    expect(socket.emitted.map(item => item.event)).toEqual(["client:sync-state"]);
  });

  it("falls back to player:resume after reconnect and then synchronizes state", async () => {
    const socket = new FakeSocket();
    const transport = new SocketIoRealtimeTransport<View>(socket);
    transport.setListener(listener().value);
    transport.connect(2);

    socket.queueAck("client:sync-state", { ok: false, message: "你当前不在房间中" });
    socket.queueAck("player:resume", { ok: true, roomId: "room-1", playerId: "p1" });
    socket.queueAck("client:sync-state", { ok: true, ...statePayload(8, "day") });

    await expect(transport.synchronize(
      { roomId: "room-1", playerId: "p1", resumeToken: "token" },
      2,
    )).resolves.toEqual({ generation: 2, ...statePayload(8, "day") });

    expect(socket.emitted.map(item => item.event)).toEqual([
      "client:sync-state",
      "player:resume",
      "client:sync-state",
    ]);
  });

  it("forwards revised state pushes with the active generation and rejects malformed state", () => {
    const socket = new FakeSocket();
    const transport = new SocketIoRealtimeTransport<View>(socket);
    const events = listener();
    transport.setListener(events.value);
    transport.connect(3);

    socket.serverEmit("client:state", statePayload(9, "night"));
    expect(events.states).toEqual([{ generation: 3, ...statePayload(9, "night") }]);

    socket.serverEmit("client:state", { revision: -1, envelope: {} });
    expect(events.errors).toEqual([
      {
        generation: 3,
        failure: {
          code: "invalid-authoritative-state",
          message: "authoritative client state revision is invalid",
        },
      },
    ]);
  });

  it("retries a lost command acknowledgement with the identical protocol envelope", async () => {
    const socket = new FakeSocket();
    const transport = new SocketIoRealtimeTransport(socket, { commandRetries: 1 });
    transport.setListener(listener().value);
    transport.connect(1);
    const command = createClientCommandEnvelope("werewolf.confirmRole", {}, "command-1");

    socket.queueAck("client:command", undefined, new Error("ack timeout"));
    socket.queueAck("client:command", { ok: true });

    await expect(transport.send(command)).resolves.toEqual({ ok: true });
    expect(socket.emitted).toEqual([
      { event: "client:command", payload: command },
      { event: "client:command", payload: command },
    ]);
  });
});
