import {
  BrowserRoomBootstrapClient,
  type BrowserRoomBootstrapFetchLike,
} from "../../src/client/browser/BrowserRoomBootstrapClient.js";
import {
  CloudflareRealtimeTransport,
  type BrowserFetchLike,
  type BrowserWebSocketFactory,
} from "../../src/client/browser/CloudflareRealtimeTransport.js";
import { ClientSession } from "../../src/client/runtime/ClientSession.js";
import type { ClientRoomProjection } from "../../src/protocol/client/ClientRoomProjection.js";
import {
  createClientCommandEnvelope,
  type ClientReconnectCredentials,
} from "../../src/protocol/client/ClientProtocol.js";
import type { RoomBootstrapCredentials } from "../../src/client/runtime/RoomBootstrapClientCore.js";
import type { GameType } from "../../src/games/GameCatalog.js";

export type TestRoomClientTraceEntry = {
  sequence: number;
  client: string;
  event: "bootstrap" | "connection" | "player-state" | "room-state" | "command";
  generation: number;
  revision?: number | null;
  detail?: string;
};

export type TestRoomClientOptions = {
  label: string;
  gameType: GameType;
  baseUrl: string;
  fetch: BrowserFetchLike;
  webSocketFactory: BrowserWebSocketFactory;
  traceLimit?: number;
};

type RevisionScope = "player" | "room";

const DEFAULT_WAIT_TIMEOUT_MS = 1500;
const DEFAULT_TRACE_LIMIT = 64;

function reconnectCredentials(
  credentials: RoomBootstrapCredentials,
): ClientReconnectCredentials {
  return {
    roomId: credentials.roomId,
    playerId: credentials.playerId,
    resumeToken: credentials.resumeToken,
  };
}

/**
 * Test-side client façade over the same public/runtime contracts used by a real
 * Cloudflare browser client. It owns no room/game semantics and never reads a
 * Durable Object snapshot directly.
 */
export class TestRoomClient<TPlayerView = unknown> {
  private readonly bootstrap: BrowserRoomBootstrapClient;
  private readonly traceLimit: number;
  private readonly trace: TestRoomClientTraceEntry[] = [];
  private sequence = 0;
  private credentials: ClientReconnectCredentials | null = null;
  private session: ClientSession<TPlayerView> | null = null;

  constructor(private readonly options: TestRoomClientOptions) {
    this.traceLimit = Math.max(8, options.traceLimit ?? DEFAULT_TRACE_LIMIT);
    this.bootstrap = new BrowserRoomBootstrapClient({
      baseUrl: options.baseUrl,
      gameType: options.gameType,
      fetch: options.fetch as BrowserRoomBootstrapFetchLike,
    });
  }

  async createRoom(name?: string): Promise<RoomBootstrapCredentials> {
    this.assertDisconnected();
    const created = await this.bootstrap.createRoom(name);
    this.credentials = reconnectCredentials(created);
    this.pushTrace("bootstrap", 0, created.revision, "create-room");
    return { ...created };
  }

  async joinRoom(
    roomCode: string,
    name?: string,
  ): Promise<RoomBootstrapCredentials> {
    this.assertDisconnected();
    const joined = await this.bootstrap.joinRoom(roomCode, name);
    this.credentials = reconnectCredentials(joined);
    this.pushTrace("bootstrap", 0, joined.revision, "join-room");
    return { ...joined };
  }

  resume(credentials: ClientReconnectCredentials): void {
    this.assertDisconnected();
    this.credentials = { ...credentials };
    this.pushTrace("bootstrap", 0, undefined, "resume");
  }

  async connect(timeoutMs = DEFAULT_WAIT_TIMEOUT_MS): Promise<void> {
    if (!this.credentials) {
      throw new Error(`${this.options.label} has no room credentials`);
    }
    if (this.session) {
      throw new Error(`${this.options.label} is already connected`);
    }

    const transport = new CloudflareRealtimeTransport<TPlayerView>({
      baseUrl: this.options.baseUrl,
      fetch: this.options.fetch,
      webSocketFactory: this.options.webSocketFactory,
    });
    const session = new ClientSession<TPlayerView>(transport);
    this.session = session;

    session.subscribe(snapshot => {
      this.pushTrace(
        "connection",
        snapshot.connection.generation,
        snapshot.authoritativeState.revision,
        snapshot.connection.status,
      );
      if (snapshot.authoritativeState.revision !== null) {
        this.pushTrace(
          "player-state",
          snapshot.authoritativeState.generation,
          snapshot.authoritativeState.revision,
        );
      }
    });
    session.subscribeRoomState(snapshot => {
      if (snapshot.revision === null) return;
      this.pushTrace(
        "room-state",
        snapshot.generation,
        snapshot.revision,
      );
    });

    session.start(this.credentials);
    await this.waitForConnected(timeoutMs);
  }

  disconnect(): void {
    const session = this.session;
    if (!session) return;
    session.dispose();
    this.session = null;
  }

  async sendCommand<TPayload>(
    type: string,
    payload: TPayload,
    commandId: string,
  ): Promise<unknown> {
    const session = this.requireSession();
    this.pushTrace(
      "command",
      session.getConnectionState().generation,
      undefined,
      `${type}:${commandId}`,
    );
    return session.send(createClientCommandEnvelope(type, payload, commandId));
  }

  async waitForRevision(
    revision: number,
    scope: RevisionScope = "room",
    timeoutMs = DEFAULT_WAIT_TIMEOUT_MS,
  ): Promise<void> {
    if (!Number.isSafeInteger(revision) || revision < 0) {
      throw new Error("revision must be a non-negative safe integer");
    }
    const session = this.requireSession();

    const current = scope === "room"
      ? session.getRoomState().revision
      : session.getAuthoritativeState().revision;
    if (current !== null && current >= revision) return;

    await new Promise<void>((resolve, reject) => {
      let unsubscribe: (() => void) | null = null;
      let settled = false;

      const finish = (): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        unsubscribe?.();
        resolve();
      };

      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        unsubscribe?.();
        reject(new Error(
          `${this.options.label} timed out waiting for ${scope} revision ${revision}\n${this.formatTrace()}`,
        ));
      }, timeoutMs);

      unsubscribe = scope === "room"
        ? session.subscribeRoomState(snapshot => {
            if (snapshot.revision !== null && snapshot.revision >= revision) {
              finish();
            }
          })
        : session.subscribe(snapshot => {
            const next = snapshot.authoritativeState.revision;
            if (next !== null && next >= revision) finish();
          });

      if (settled) unsubscribe();
    });
  }

  getReconnectCredentials(): ClientReconnectCredentials {
    if (!this.credentials) {
      throw new Error(`${this.options.label} has no room credentials`);
    }
    return { ...this.credentials };
  }

  getPlayerView(): TPlayerView | null {
    return this.requireSession().getAuthoritativeState().envelope?.payload ?? null;
  }

  getRoomProjection(): ClientRoomProjection | null {
    return this.requireSession().getRoomState().envelope?.payload ?? null;
  }

  getRoomRevision(): number | null {
    return this.requireSession().getRoomState().revision;
  }

  getConnectionState() {
    return this.requireSession().getConnectionState();
  }

  captureTrace(): TestRoomClientTraceEntry[] {
    return this.trace.map(entry => ({ ...entry }));
  }

  private waitForConnected(timeoutMs: number): Promise<void> {
    const session = this.requireSession();
    if (session.getConnectionState().status === "Connected") {
      return Promise.resolve();
    }

    return new Promise<void>((resolve, reject) => {
      let unsubscribe: (() => void) | null = null;
      let settled = false;

      const finish = (error?: Error): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        unsubscribe?.();
        if (error) reject(error);
        else resolve();
      };

      const timeout = setTimeout(() => {
        finish(new Error(
          `${this.options.label} timed out waiting for synchronization\n${this.formatTrace()}`,
        ));
      }, timeoutMs);

      unsubscribe = session.subscribe(snapshot => {
        if (snapshot.connection.status === "Connected") {
          finish();
          return;
        }
        if (snapshot.connection.status === "Failed") {
          finish(new Error(
            `${this.options.label} failed to synchronize\n${this.formatTrace()}`,
          ));
        }
      });

      if (settled) unsubscribe();
    });
  }

  private assertDisconnected(): void {
    if (this.session) {
      throw new Error(`${this.options.label} must disconnect before changing credentials`);
    }
  }

  private requireSession(): ClientSession<TPlayerView> {
    if (!this.session) {
      throw new Error(`${this.options.label} is not connected`);
    }
    return this.session;
  }

  private pushTrace(
    event: TestRoomClientTraceEntry["event"],
    generation: number,
    revision?: number | null,
    detail?: string,
  ): void {
    const entry: TestRoomClientTraceEntry = {
      sequence: ++this.sequence,
      client: this.options.label,
      event,
      generation,
      ...(revision === undefined ? {} : { revision }),
      ...(detail === undefined ? {} : { detail }),
    };
    this.trace.push(entry);
    if (this.trace.length > this.traceLimit) {
      this.trace.splice(0, this.trace.length - this.traceLimit);
    }
  }

  private formatTrace(): string {
    return this.trace
      .map(entry => {
        const revision = entry.revision === undefined
          ? ""
          : ` rev=${String(entry.revision)}`;
        const detail = entry.detail ? ` ${entry.detail}` : "";
        return `#${entry.sequence} ${entry.client} ${entry.event} gen=${entry.generation}${revision}${detail}`;
      })
      .join("\n");
  }
}
