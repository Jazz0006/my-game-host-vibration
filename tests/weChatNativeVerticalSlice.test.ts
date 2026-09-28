import { describe, expect, it } from "vitest";
import {
  createWeChatNativeClient,
  type WeChatNativeApi,
} from "../src/client/WeChatNativeClient.js";
import type {
  WeChatInnerAudioContextLike,
} from "../src/client/WeChatClientEffects.js";
import type { WeChatSocketTaskLike } from "../src/client/WeChatRealtimeTransport.js";
import {
  createClientActionAlertEffectEvent,
} from "../src/protocol/client/ClientEffects.js";
import type { ClientRoomProjection } from "../src/protocol/client/ClientRoomProjection.js";
import {
  createPlayerStateEnvelope,
  createRoomStateEnvelope,
} from "../src/protocol/client/ClientProtocol.js";
import {
  createClientRawWebSocketEventFrame,
  createClientRawWebSocketStateFrame,
  createClientRawWebSocketSuccessResponse,
} from "../src/protocol/client/ClientRawWebSocketProtocol.js";

type PlayerView = {
  phase: string;
  mode: string;
  actionId?: string;
};

class FakeSocket implements WeChatSocketTaskLike {
  readonly sent: string[] = [];
  private onOpenListener: (() => void) | null = null;
  private onCloseListener: ((event: { code?: number; reason?: string }) => void) | null = null;
  private onErrorListener: ((error: unknown) => void) | null = null;
  private onMessageListener: ((event: { data: string | ArrayBuffer }) => void) | null = null;

  onOpen(listener: () => void): void {
    this.onOpenListener = listener;
  }

  onClose(listener: (event: { code?: number; reason?: string }) => void): void {
    this.onCloseListener = listener;
  }

  onError(listener: (error: unknown) => void): void {
    this.onErrorListener = listener;
  }

  onMessage(listener: (event: { data: string | ArrayBuffer }) => void): void {
    this.onMessageListener = listener;
  }

  send(options: {
    data: string | ArrayBuffer;
    success?: () => void;
    fail?: (error: unknown) => void;
  }): void {
    if (typeof options.data !== "string") throw new Error("test only supports text");
    this.sent.push(options.data);
    options.success?.();
  }

  close(): void {}

  open(): void {
    this.onOpenListener?.();
  }

  serverClose(reason = "network lost"): void {
    this.onCloseListener?.({ code: 1006, reason });
  }

  serverMessage(value: unknown): void {
    this.onMessageListener?.({ data: JSON.stringify(value) });
  }
}

class SilentAudio implements WeChatInnerAudioContextLike {
  src = "";
  play(): void {}
}

class FakeWx implements WeChatNativeApi {
  readonly storage = new Map<string, unknown>();
  readonly ticketRequests: Array<{
    url: string;
    data: unknown;
    success(response: { statusCode: number; data: unknown }): void;
    fail(error: unknown): void;
  }> = [];
  readonly sockets: FakeSocket[] = [];
  readonly vibrationCalls: string[] = [];
  private readonly showListeners = new Set<() => void>();
  private readonly hideListeners = new Set<() => void>();

  request(options: {
    url: string;
    method: "POST";
    data: unknown;
    success(response: { statusCode: number; data: unknown }): void;
    fail(error: unknown): void;
  }): void {
    this.ticketRequests.push(options);
  }

  connectSocket(): WeChatSocketTaskLike {
    const socket = new FakeSocket();
    this.sockets.push(socket);
    return socket;
  }

  vibrateShort(): void {
    this.vibrationCalls.push("short");
  }

  vibrateLong(): void {
    this.vibrationCalls.push("long");
  }

  createInnerAudioContext(): WeChatInnerAudioContextLike {
    return new SilentAudio();
  }

  getStorageSync(key: string): unknown {
    return this.storage.get(key);
  }

  setStorageSync(key: string, data: unknown): void {
    this.storage.set(key, structuredClone(data));
  }

  removeStorageSync(key: string): void {
    this.storage.delete(key);
  }

  onAppShow(listener: () => void): void {
    this.showListeners.add(listener);
  }

  offAppShow(listener: () => void): void {
    this.showListeners.delete(listener);
  }

  onAppHide(listener: () => void): void {
    this.hideListeners.add(listener);
  }

  offAppHide(listener: () => void): void {
    this.hideListeners.delete(listener);
  }

  hide(): void {
    for (const listener of this.hideListeners) listener();
  }

  show(): void {
    for (const listener of this.showListeners) listener();
  }

  issueTicket(index: number): FakeSocket {
    const request = this.ticketRequests[index];
    if (!request) throw new Error(`missing ticket request ${index}`);
    request.success({
      statusCode: 200,
      data: { ok: true, ticket: `ticket-${index + 1}`, expiresAt: Date.now() + 10_000 },
    });
    const socket = this.sockets[index];
    if (!socket) throw new Error(`missing socket ${index}`);
    return socket;
  }
}

function room(gameStarted: boolean): ClientRoomProjection {
  return {
    roomId: "1234",
    gameType: "werewolf",
    viewer: { playerId: "p1", isHost: true },
    players: [
      { id: "p1", name: "Host", seat: 1, isHost: true },
      { id: "p2", name: "Player 2", seat: 2, isHost: false },
      { id: "p3", name: "Player 3", seat: 3, isHost: false },
      { id: "p4", name: "Player 4", seat: 4, isHost: false },
      { id: "p5", name: "Player 5", seat: 5, isHost: false },
    ],
    gameStarted,
  };
}

function lastRequest(socket: FakeSocket): {
  requestId: string;
  operation: string;
  envelope?: {
    commandId: string;
    type: string;
    payload: unknown;
  };
} {
  const raw = socket.sent.at(-1);
  if (!raw) throw new Error("missing client request");
  return JSON.parse(raw);
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe("E3.6 minimal native WeChat vertical slice", () => {
  it("runs stored credentials -> lobby -> command -> effect -> background reconnect", async () => {
    const wx = new FakeWx();
    wx.storage.set("gamehost.client.session.v1", {
      roomId: "1234",
      playerId: "p1",
      resumeToken: "resume-secret",
    });

    let requestSeq = 0;
    let commandSeq = 0;
    const client = createWeChatNativeClient<PlayerView>(wx, {
      baseUrl: "https://game.example",
      requestIdFactory: () => `request-${++requestSeq}`,
      commandIdFactory: () => `command-${++commandSeq}`,
    });

    expect(client.startStoredSession()).toBe(true);
    expect(wx.ticketRequests).toHaveLength(1);
    expect(client.getView().screen).toBe("connecting");

    const first = wx.issueTicket(0);
    first.open();
    const sync1 = lastRequest(first);
    expect(sync1).toMatchObject({ requestId: "request-1", operation: "sync" });
    first.serverMessage(createClientRawWebSocketSuccessResponse(sync1.requestId, {
      revision: 3,
      envelope: createPlayerStateEnvelope("1234", "p1", {
        phase: "lobby",
        mode: "lobby",
      }),
      roomEnvelope: createRoomStateEnvelope("1234", room(false)),
    }));
    await flush();

    expect(client.getView()).toMatchObject({
      screen: "lobby",
      connectionStatus: "Connected",
      room: { roomId: "1234", gameStarted: false },
      playerView: { phase: "lobby", mode: "lobby" },
    });

    const startPending = client.sendCommand("werewolf.startGame", {});
    const start = lastRequest(first);
    expect(start).toMatchObject({
      requestId: "request-2",
      operation: "command",
      envelope: {
        commandId: "command-1",
        type: "werewolf.startGame",
        payload: {},
      },
    });
    first.serverMessage(createClientRawWebSocketSuccessResponse(start.requestId, {
      revision: 4,
      replayed: false,
    }));
    first.serverMessage(createClientRawWebSocketStateFrame(
      4,
      createRoomStateEnvelope("1234", room(true)),
    ));
    first.serverMessage(createClientRawWebSocketStateFrame(
      4,
      createPlayerStateEnvelope("1234", "p1", {
        phase: "role_reveal",
        mode: "role_reveal",
        actionId: "role-action",
      }),
    ));
    await expect(startPending).resolves.toEqual({ revision: 4, replayed: false });
    expect(client.getView()).toMatchObject({
      screen: "game",
      room: { gameStarted: true },
      playerView: { mode: "role_reveal" },
    });

    // The server owns rule progression; this push represents the later point at
    // which the same player is the active wolf actor.
    first.serverMessage(createClientRawWebSocketStateFrame(
      5,
      createPlayerStateEnvelope("1234", "p1", {
        phase: "night_werewolf",
        mode: "wolf_action",
        actionId: "wolf-action",
      }),
    ));

    const actionPending = client.sendCommand("werewolf.submitWolfTarget", {
      actionId: "wolf-action",
      targetPlayerId: "p4",
    });
    const action = lastRequest(first);
    expect(action).toMatchObject({
      requestId: "request-3",
      operation: "command",
      envelope: {
        commandId: "command-2",
        type: "werewolf.submitWolfTarget",
      },
    });
    first.serverMessage(createClientRawWebSocketSuccessResponse(action.requestId, {
      revision: 6,
      replayed: false,
    }));
    first.serverMessage(createClientRawWebSocketStateFrame(
      6,
      createPlayerStateEnvelope("1234", "p1", {
        phase: "night_witch",
        mode: "waiting",
        actionId: "witch-action",
      }),
    ));
    first.serverMessage(createClientRawWebSocketEventFrame(
      createClientActionAlertEffectEvent({ actionId: "witch-action" }),
    ));
    await expect(actionPending).resolves.toEqual({ revision: 6, replayed: false });
    expect(wx.vibrationCalls).toEqual(["short"]);
    expect(client.getView().playerView).toMatchObject({ mode: "waiting" });

    wx.hide();
    first.serverClose("background socket expired");
    expect(client.getView().screen).toBe("disconnected");

    wx.show();
    expect(wx.ticketRequests).toHaveLength(2);
    expect(client.getView().connectionStatus).toBe("Reconnecting");

    const second = wx.issueTicket(1);
    second.open();
    const sync2 = lastRequest(second);
    expect(sync2).toMatchObject({ requestId: "request-4", operation: "sync" });
    second.serverMessage(createClientRawWebSocketSuccessResponse(sync2.requestId, {
      revision: 7,
      envelope: createPlayerStateEnvelope("1234", "p1", {
        phase: "night_witch",
        mode: "waiting",
        actionId: "witch-action",
      }),
      roomEnvelope: createRoomStateEnvelope("1234", room(true)),
    }));
    await flush();

    expect(client.getView()).toMatchObject({
      screen: "game",
      connectionStatus: "Connected",
      playerRevision: 7,
      roomRevision: 7,
    });

    client.dispose();
  });

  it("bootstraps a room, persists credentials, then starts the same ClientSession owner", async () => {
    const wx = new FakeWx();
    const client = createWeChatNativeClient<PlayerView>(wx, {
      baseUrl: "https://game.example",
    });

    expect(client.hasStoredSession()).toBe(false);
    const pending = client.createRoom("Host");
    const bootstrap = wx.ticketRequests[0];
    expect(bootstrap).toMatchObject({
      url: "https://game.example/rooms",
      data: { name: "Host" },
    });
    bootstrap!.success({
      statusCode: 201,
      data: {
        ok: true,
        roomId: "4321",
        playerId: "p1",
        resumeToken: "resume-secret",
        name: "Host",
        seat: 1,
        isHost: true,
        revision: 0,
      },
    });

    await expect(pending).resolves.toMatchObject({
      roomId: "4321",
      playerId: "p1",
      isHost: true,
    });
    expect(client.hasStoredSession()).toBe(true);
    expect(wx.storage.get("gamehost.client.session.v1")).toEqual({
      roomId: "4321",
      playerId: "p1",
      resumeToken: "resume-secret",
    });
    expect(wx.ticketRequests[1]).toMatchObject({
      url: "https://game.example/rooms/4321/websocket-ticket",
      data: {
        playerId: "p1",
        resumeToken: "resume-secret",
      },
    });
    expect(client.getView().connectionStatus).toBe("Connecting");

    client.dispose();
  });
});
