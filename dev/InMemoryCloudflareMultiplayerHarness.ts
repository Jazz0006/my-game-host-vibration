import type {
  BrowserFetchLike,
  BrowserWebSocketFactory,
  BrowserWebSocketLike,
} from "../src/client/browser/CloudflareRealtimeTransport.js";
import {
  CloudflareRoomRealtime,
  type HibernationWebSocketLike,
} from "../src/runtime/cloudflare/CloudflareRoomRealtime.js";
import { GameRoomDurableObject } from "../src/runtime/cloudflare/GameRoomDurableObject.js";
import {
  cloudflareWorker,
  type CloudflareEnv,
} from "../src/runtime/cloudflare/worker.js";
import type {
  DurableObjectNamespaceLike,
  DurableObjectStubLike,
} from "../src/runtime/cloudflare/roomRouting.js";

class MemoryStorage {
  private readonly values = new Map<string, unknown>();
  private alarmAt: number | null = null;

  async get<T>(key: string): Promise<T | undefined> {
    const value = this.values.get(key);
    return value === undefined ? undefined : structuredClone(value) as T;
  }

  async put<T>(key: string, value: T): Promise<void> {
    this.values.set(key, structuredClone(value));
  }

  async delete(key: string): Promise<boolean> {
    return this.values.delete(key);
  }

  async getAlarm(): Promise<number | null> {
    return this.alarmAt;
  }

  async setAlarm(scheduledTimeMs: number): Promise<void> {
    this.alarmAt = scheduledTimeMs;
  }

  async deleteAlarm(): Promise<void> {
    this.alarmAt = null;
  }
}

class HibernationState {
  private readonly connections: Array<{
    socket: HibernationWebSocketLike;
    tags: string[];
  }> = [];

  acceptWebSocket(socket: HibernationWebSocketLike, tags: string[] = []): void {
    this.connections.push({ socket, tags: [...tags] });
  }

  getWebSockets(tag?: string): HibernationWebSocketLike[] {
    return this.connections
      .filter(item => item.socket.readyState !== 3)
      .filter(item => tag === undefined || item.tags.includes(tag))
      .map(item => item.socket);
  }
}

class RoomRuntime {
  readonly storage = new MemoryStorage();
  readonly hibernation = new HibernationState();
  readonly object: GameRoomDurableObject;
  private httpTail: Promise<void> = Promise.resolve();

  constructor(roomCode: string) {
    this.object = new GameRoomDurableObject({
      id: { toString: () => `test-room-${roomCode}` },
      storage: this.storage,
      acceptWebSocket: this.hibernation.acceptWebSocket.bind(this.hibernation),
      getWebSockets: this.hibernation.getWebSockets.bind(this.hibernation),
    });
  }

  /**
   * Directly invoking one Durable Object instance from Vitest does not provide
   * the platform's request scheduling/storage gates. Queue HTTP events here so
   * rapid Promise.all joins exercise production bootstrap semantics without
   * introducing an in-memory-only lost-update race.
   */
  fetch(request: Request): Promise<Response> {
    const response = this.httpTail.then(() => this.object.fetch(request));
    this.httpTail = response.then(
      () => undefined,
      () => undefined,
    );
    return response;
  }
}

function serverFrameKind(data: string | ArrayBuffer): string | undefined {
  if (typeof data !== "string") return undefined;
  try {
    const parsed = JSON.parse(data) as { kind?: unknown };
    return typeof parsed.kind === "string" ? parsed.kind : undefined;
  } catch {
    return undefined;
  }
}

class BrowserSocket implements BrowserWebSocketLike {
  readonly sent: string[] = [];
  readonly received: Array<string | ArrayBuffer> = [];
  private readonly openListeners: Array<() => void> = [];
  private readonly closeListeners: Array<(event: { reason?: string }) => void> = [];
  private readonly errorListeners: Array<(event: unknown) => void> = [];
  private readonly messageListeners: Array<
    (event: { data: string | ArrayBuffer }) => void
  > = [];
  private server: ServerSocket | null = null;
  private closed = false;
  private responsesToDrop = 0;

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

  attach(server: ServerSocket): void {
    this.server = server;
  }

  open(): void {
    if (this.closed) return;
    for (const listener of this.openListeners) listener();
  }

  send(data: string): void {
    if (this.closed) throw new Error("test browser socket is closed");
    this.sent.push(data);
    this.server?.receiveFromClient(data);
  }

  close(code?: number, reason?: string): void {
    if (this.closed) return;
    this.closed = true;
    this.server?.closeFromClient(code, reason);
    this.emitClose(reason);
  }

  dropNextResponse(): void {
    this.responsesToDrop += 1;
  }

  receiveFromServer(data: string | ArrayBuffer): void {
    if (this.closed) return;
    this.received.push(data);
    if (this.responsesToDrop > 0 && serverFrameKind(data) === "response") {
      this.responsesToDrop -= 1;
      return;
    }
    this.emitMessage(data);
  }

  injectServerFrame(data: string | ArrayBuffer): void {
    if (this.closed) throw new Error("test browser socket is closed");
    this.received.push(data);
    this.emitMessage(data);
  }

  injectLateServerFrame(data: string | ArrayBuffer): void {
    this.received.push(data);
    this.emitMessage(data);
  }

  closeFromServer(reason?: string): void {
    if (this.closed) return;
    this.closed = true;
    this.emitClose(reason);
  }

  fail(error: unknown): void {
    if (this.closed) return;
    for (const listener of this.errorListeners) listener(error);
  }

  private emitMessage(data: string | ArrayBuffer): void {
    for (const listener of this.messageListeners) listener({ data });
  }

  private emitClose(reason?: string): void {
    for (const listener of this.closeListeners) {
      listener(reason === undefined ? {} : { reason });
    }
  }
}

class ServerSocket implements HibernationWebSocketLike {
  readyState = 1;
  private attachment: unknown;

  constructor(
    private readonly browser: BrowserSocket,
    private readonly onMessage: (message: string | ArrayBuffer) => Promise<void>,
  ) {}

  receiveFromClient(message: string | ArrayBuffer): void {
    if (this.readyState === 3) return;
    void this.onMessage(message);
  }

  send(message: string | ArrayBuffer): void {
    if (this.readyState === 3) return;
    this.browser.receiveFromServer(message);
  }

  close(_code?: number, reason?: string): void {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.browser.closeFromServer(reason);
  }

  closeFromClient(_code?: number, _reason?: string): void {
    this.readyState = 3;
  }

  serializeAttachment(value: unknown): void {
    this.attachment = structuredClone(value);
  }

  deserializeAttachment(): unknown {
    return structuredClone(this.attachment);
  }
}

type IssuedTicket = {
  roomCode: string;
  playerId: string;
};

type SocketConnection = {
  browser: BrowserSocket;
  server: ServerSocket;
};

/**
 * Test-only capability adapter around the real Cloudflare Worker / Durable
 * Object implementation. It intentionally does not implement game rules or
 * projection logic. HTTP bootstrap/ticket requests and Raw WS messages still
 * flow through production owners; only the network/socket primitives are fake.
 *
 * The actual 101 WebSocket upgrade is already covered by focused Cloudflare
 * tests. This adapter binds the authenticated ticket to the same production
 * hibernation realtime seam so multiplayer scenarios can stay deterministic in
 * Vitest without opening real ports or adding a WebSocket dependency.
 */
export class InMemoryCloudflareMultiplayerHarness {
  readonly baseUrl = "https://multiplayer.test";
  private readonly rooms = new Map<string, RoomRuntime>();
  private readonly tickets = new Map<string, IssuedTicket>();
  private readonly connections = new Map<string, SocketConnection[]>();

  private readonly namespace: DurableObjectNamespaceLike = {
    getByName: (roomCode: string): DurableObjectStubLike => ({
      fetch: request => this.room(roomCode).fetch(request),
    }),
  };

  private readonly env: CloudflareEnv = {
    GAME_ROOMS: this.namespace,
  };

  readonly fetch: BrowserFetchLike = async (url, init) => {
    const request = new Request(url, {
      method: init.method,
      headers: init.headers,
      body: init.body,
    });
    const response = await cloudflareWorker.fetch(request, this.env);

    const parsedUrl = new URL(url);
    const ticketMatch = /^\/rooms\/(\d{4})\/websocket-ticket$/u.exec(
      parsedUrl.pathname,
    );
    if (ticketMatch?.[1] && response.status >= 200 && response.status < 300) {
      const requestBody = JSON.parse(init.body) as { playerId?: unknown };
      const responseBody = await response.clone().json() as { ticket?: unknown };
      if (
        typeof requestBody.playerId === "string" &&
        typeof responseBody.ticket === "string"
      ) {
        this.tickets.set(responseBody.ticket, {
          roomCode: ticketMatch[1],
          playerId: requestBody.playerId,
        });
      }
    }

    return {
      status: response.status,
      json: () => response.json(),
    };
  };

  readonly webSocketFactory: BrowserWebSocketFactory = url => {
    const parsedUrl = new URL(url);
    const match = /^\/rooms\/(\d{4})\/websocket$/u.exec(parsedUrl.pathname);
    const ticket = parsedUrl.searchParams.get("ticket");
    const issued = ticket ? this.tickets.get(ticket) : undefined;

    if (!match?.[1] || !ticket || !issued || issued.roomCode !== match[1]) {
      throw new Error("invalid test WebSocket ticket");
    }
    this.tickets.delete(ticket);

    const runtime = this.room(issued.roomCode);
    const browser = new BrowserSocket();
    let server!: ServerSocket;
    server = new ServerSocket(
      browser,
      message => runtime.object.webSocketMessage(server, message),
    );
    browser.attach(server);

    new CloudflareRoomRealtime(runtime.hibernation).acceptPlayerSocket(
      server,
      issued.playerId,
    );

    const history = this.connections.get(issued.playerId) ?? [];
    history.push({ browser, server });
    this.connections.set(issued.playerId, history);

    queueMicrotask(() => browser.open());
    return browser;
  };

  dropNextResponse(playerId: string): void {
    this.activeConnection(playerId).browser.dropNextResponse();
  }

  disconnectPlayer(
    playerId: string,
    reason = "test network disconnect",
  ): void {
    this.activeConnection(playerId).server.close(4000, reason);
  }

  captureClientFrames(playerId: string): string[] {
    return this.connectionHistory(playerId).flatMap(({ browser }) =>
      browser.sent.slice()
    );
  }

  captureServerFrames(playerId: string): Array<string | ArrayBuffer> {
    return this.connectionHistory(playerId).flatMap(({ browser }) =>
      browser.received.slice()
    );
  }

  injectActiveServerFrame(
    playerId: string,
    frame: string | ArrayBuffer,
  ): void {
    this.activeConnection(playerId).browser.injectServerFrame(frame);
  }

  injectRetiredServerFrame(
    playerId: string,
    frame: string | ArrayBuffer,
  ): void {
    const history = this.connectionHistory(playerId);
    for (let index = history.length - 2; index >= 0; index -= 1) {
      const connection = history[index]!;
      if (connection.server.readyState === 3) {
        connection.browser.injectLateServerFrame(frame);
        return;
      }
    }
    throw new Error(`no retired test WebSocket for player ${playerId}`);
  }

  private connectionHistory(playerId: string): SocketConnection[] {
    const history = this.connections.get(playerId);
    if (!history?.length) {
      throw new Error(`no test WebSocket for player ${playerId}`);
    }
    return history;
  }

  private activeConnection(playerId: string): SocketConnection {
    const history = this.connectionHistory(playerId);
    for (let index = history.length - 1; index >= 0; index -= 1) {
      const connection = history[index]!;
      if (connection.server.readyState !== 3) return connection;
    }
    throw new Error(`no active test WebSocket for player ${playerId}`);
  }

  private room(roomCode: string): RoomRuntime {
    let room = this.rooms.get(roomCode);
    if (!room) {
      room = new RoomRuntime(roomCode);
      this.rooms.set(roomCode, room);
    }
    return room;
  }
}