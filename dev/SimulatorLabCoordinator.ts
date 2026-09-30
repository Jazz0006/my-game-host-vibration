import crypto from "node:crypto";
import type { ClientRoomProjection } from "../src/protocol/client/ClientRoomProjection.js";
import { InMemoryCloudflareMultiplayerHarness } from "./InMemoryCloudflareMultiplayerHarness.js";
import {
  TestRoomClient,
  type TestRoomClientTraceEntry,
} from "./TestRoomClient.js";

type SimulatorPlayerView = unknown;

type ManagedClient = {
  label: string;
  name: string;
  playerId: string;
  client: TestRoomClient<SimulatorPlayerView>;
  unsubscribe: () => void;
};

export type SimulatorLabClientState = {
  label: string;
  name: string;
  playerId: string;
  seat: number | null;
  isHost: boolean;
  isGameModerator: boolean;
  connectionStatus: string;
  generation: number;
  roomRevision: number | null;
  playerRevision: number | null;
  roomProjection: ClientRoomProjection | null;
  playerView: SimulatorPlayerView | null;
  trace: TestRoomClientTraceEntry[];
};

export type SimulatorLabState = {
  initialized: boolean;
  gameType: "botc";
  roomId: string | null;
  roomRevision: number | null;
  playerCount: number;
  clients: SimulatorLabClientState[];
};

export type SimulatorLabListener = (state: SimulatorLabState) => void;

function commandRevision(result: unknown): number | null {
  if (!result || typeof result !== "object" || Array.isArray(result)) return null;
  const revision = (result as { revision?: unknown }).revision;
  return Number.isSafeInteger(revision) && Number(revision) >= 0
    ? Number(revision)
    : null;
}

export class SimulatorLabCoordinator {
  private runtime = new InMemoryCloudflareMultiplayerHarness();
  private readonly clients: ManagedClient[] = [];
  private readonly listeners = new Set<SimulatorLabListener>();
  private roomId: string | null = null;

  getState(): SimulatorLabState {
    const clients = this.clients.map(managed => {
      const roomProjection = managed.client.getRoomProjection();
      const player = roomProjection?.players.find(item => item.id === managed.playerId);
      const connection = managed.client.getConnectionState();
      return {
        label: managed.label,
        name: player?.name ?? managed.name,
        playerId: managed.playerId,
        seat: player?.seat ?? null,
        isHost: Boolean(player?.isHost),
        isGameModerator: Boolean(roomProjection?.viewer.isGameModerator),
        connectionStatus: connection.status,
        generation: connection.generation,
        roomRevision: managed.client.getRoomRevision(),
        playerRevision: managed.client.getPlayerRevision(),
        roomProjection,
        playerView: managed.client.getPlayerView(),
        trace: managed.client.captureTrace(),
      };
    });

    return {
      initialized: clients.length > 0,
      gameType: "botc",
      roomId: this.roomId,
      roomRevision: clients[0]?.roomRevision ?? null,
      playerCount: clients.length,
      clients,
    };
  }

  subscribe(listener: SimulatorLabListener): () => void {
    this.listeners.add(listener);
    listener(this.getState());
    return () => {
      this.listeners.delete(listener);
    };
  }

  async reset(playerCount = 8): Promise<SimulatorLabState> {
    if (!Number.isInteger(playerCount) || playerCount < 5 || playerCount > 15) {
      throw new Error("Simulator BotC player count must be an integer from 5 to 15");
    }

    this.disposeClients();
    this.runtime = new InMemoryCloudflareMultiplayerHarness();
    this.roomId = null;

    const host = this.createClient("P1", "Player 1");
    const created = await host.client.createRoom(host.name);
    host.playerId = created.playerId;
    this.roomId = created.roomId;
    await host.client.connect();
    this.attach(host);

    for (let number = 2; number <= playerCount; number += 1) {
      const managed = this.createClient(`P${number}`, `Player ${number}`);
      const joined = await managed.client.joinRoom(created.roomId, managed.name);
      managed.playerId = joined.playerId;
      await managed.client.connect();
      this.attach(managed);
    }

    const finalRevision = playerCount - 1;
    await Promise.all(
      this.clients.map(item => item.client.waitForRevision(finalRevision)),
    );
    this.emit();
    return this.getState();
  }

  async sendCommand(
    playerId: string,
    type: string,
    payload: unknown,
    commandId = `sim-${crypto.randomUUID()}`,
  ): Promise<{ result: unknown; state: SimulatorLabState }> {
    if (!type.trim()) throw new Error("Semantic command type is required");
    const actor = this.requireClient(playerId);
    const result = await actor.client.sendCommand(
      type.trim(),
      payload,
      commandId,
    );
    await this.waitForOnlineClients(commandRevision(result));
    this.emit();
    return { result, state: this.getState() };
  }

  async setModerator(playerId: string | null): Promise<SimulatorLabState> {
    const host = this.clients.find(item => item.client.getRoomProjection()?.viewer.isHost);
    if (!host) throw new Error("Simulator room has no Room Owner client");

    const assignment = playerId
      ? { mode: "human" as const, playerId: this.requireClient(playerId).playerId }
      : { mode: "automatic" as const };

    const result = await host.client.sendCommand(
      "room.setGameModerator",
      { assignment },
      `sim-${crypto.randomUUID()}`,
    );
    await this.waitForOnlineClients(commandRevision(result));
    this.emit();
    return this.getState();
  }

  disconnectPlayer(playerId: string): SimulatorLabState {
    const managed = this.requireClient(playerId);
    this.runtime.disconnectPlayer(managed.playerId, "simulator requested disconnect");
    this.emit();
    return this.getState();
  }

  async reconnectPlayer(playerId: string): Promise<SimulatorLabState> {
    const managed = this.requireClient(playerId);
    await managed.client.reconnect();
    this.emit();
    return this.getState();
  }

  dispose(): void {
    this.disposeClients();
    this.listeners.clear();
    this.roomId = null;
  }

  private createClient(label: string, name: string): ManagedClient {
    return {
      label,
      name,
      playerId: "",
      unsubscribe: () => undefined,
      client: new TestRoomClient<SimulatorPlayerView>({
        label,
        gameType: "botc",
        baseUrl: this.runtime.baseUrl,
        fetch: this.runtime.fetch,
        webSocketFactory: this.runtime.webSocketFactory,
      }),
    };
  }

  private attach(managed: ManagedClient): void {
    this.clients.push(managed);
    managed.unsubscribe = managed.client.subscribe(() => this.emit());
  }

  private requireClient(playerId: string): ManagedClient {
    const managed = this.clients.find(item => item.playerId === playerId);
    if (!managed) throw new Error(`Unknown simulator player: ${playerId}`);
    return managed;
  }

  private async waitForOnlineClients(revision: number | null): Promise<void> {
    if (revision === null) return;
    await Promise.all(
      this.clients
        .filter(item => item.client.getConnectionState().status === "Connected")
        .map(item => item.client.waitForRevision(revision)),
    );
  }

  private disposeClients(): void {
    for (const managed of this.clients) {
      managed.unsubscribe();
      managed.client.disconnect();
    }
    this.clients.length = 0;
  }

  private emit(): void {
    if (this.listeners.size === 0) return;
    const state = this.getState();
    for (const listener of this.listeners) listener(state);
  }
}
