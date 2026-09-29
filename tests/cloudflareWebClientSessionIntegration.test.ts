import { describe, expect, it } from "vitest";
import {
  createPlayerStateEnvelope,
  createRoomStateEnvelope,
} from "../src/protocol/client/ClientProtocol.js";
import {
  createClientRawWebSocketSuccessResponse,
  encodeClientRawWebSocketFrame,
} from "../src/protocol/client/ClientRawWebSocketProtocol.js";
import {
  createCloudflareWebClientSession,
} from "../src/client/browser/WebClientSession.js";
import type {
  BrowserWebSocketLike,
} from "../src/client/browser/CloudflareRealtimeTransport.js";

type View = { phase: string };

const credentials = {
  roomId: "1234",
  playerId: "p1",
  resumeToken: "resume-secret",
} as const;

function roomProjection() {
  return {
    roomId: "1234",
    gameType: "werewolf",
    viewer: { playerId: "p1", isHost: true, isGameModerator: false },
    gameModerator: { mode: "automatic" },
    players: [
      { id: "p1", name: "Host", seat: 1, isHost: true },
    ],
    gameStarted: false,
  };
}

class FakeWebSocket {
  readonly sent: string[] = [];
  private openListeners: Array<() => void> = [];
  private closeListeners: Array<(event: { reason?: string }) => void> = [];
  private errorListeners: Array<(event: unknown) => void> = [];
  private messageListeners: Array<(event: { data: string | ArrayBuffer }) => void> = [];

  addEventListener(type: "open", listener: () => void): void;
  addEventListener(
    type: "close",
    listener: (event: { reason?: string }) => void,
  ): void;
  addEventListener(type: "error", listener: (event: unknown) => void): void;
  addEventListener(
    type: "message",
    listener: (event: { data: string | ArrayBuffer }) => void,
  ): void;
  addEventListener(
    type: "open" | "close" | "error" | "message",
    listener:
      | (() => void)
      | ((event: { reason?: string }) => void)
      | ((event: unknown) => void)
      | ((event: { data: string | ArrayBuffer }) => void),
  ): void {
    if (type === "open") this.openListeners.push(listener as () => void);
    else if (type === "close") {
      this.closeListeners.push(listener as (event: { reason?: string }) => void);
    } else if (type === "error") {
      this.errorListeners.push(listener as (event: unknown) => void);
    } else {
      this.messageListeners.push(
        listener as (event: { data: string | ArrayBuffer }) => void,
      );
    }
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {}

  open(): void {
    for (const listener of this.openListeners) listener();
  }

  serverMessage(data: string): void {
    for (const listener of this.messageListeners) listener({ data });
  }
}

async function flushAsync(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe("W3A Cloudflare Web ClientSession composition", () => {
  it("uses Cloudflare ticket/Raw WebSocket transport while preserving ClientSession sync semantics", async () => {
    const socket = new FakeWebSocket();
    const session = createCloudflareWebClientSession<View>({
      baseUrl: "https://game.example",
      fetch: async () => ({
        status: 200,
        async json() {
          return { ok: true, ticket: "ticket-1" };
        },
      }),
      webSocketFactory: () => socket as BrowserWebSocketLike,
      requestIdFactory: () => "sync-1",
    });

    session.start(credentials);
    await flushAsync();
    socket.open();

    expect(session.getConnectionState()).toEqual({
      status: "Syncing",
      generation: 1,
    });
    const request = JSON.parse(socket.sent[0]!) as {
      requestId: string;
      operation: string;
    };
    expect(request).toEqual(expect.objectContaining({
      requestId: "sync-1",
      operation: "sync",
    }));

    const playerEnvelope = createPlayerStateEnvelope(
      "1234",
      "p1",
      { phase: "lobby" },
    );
    const roomEnvelope = createRoomStateEnvelope("1234", roomProjection());
    socket.serverMessage(encodeClientRawWebSocketFrame(
      createClientRawWebSocketSuccessResponse("sync-1", {
        revision: 1,
        envelope: playerEnvelope,
        roomEnvelope,
      }),
    ));
    await flushAsync();

    expect(session.getConnectionState()).toEqual({
      status: "Connected",
      generation: 1,
    });
    expect(session.getAuthoritativeState()).toMatchObject({
      revision: 1,
      envelope: {
        scope: "player",
        payload: { phase: "lobby" },
      },
    });
    expect(session.getRoomState()).toMatchObject({
      revision: 1,
      envelope: {
        scope: "room",
        payload: {
          roomId: "1234",
          viewer: { playerId: "p1", isHost: true, isGameModerator: false },
        },
      },
    });

    session.dispose();
  });
});
