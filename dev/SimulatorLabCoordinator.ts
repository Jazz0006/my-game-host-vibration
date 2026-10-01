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
  joined: boolean;
  recoverable: boolean;
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
      const joined = managed.client.hasSession();
      const roomProjection = joined ? managed.client.getRoomProjection() : null;
      const player = roomProjection?.players.find(item => item.id === managed.playerId);
      const connection = joined ? managed.client.getConnectionState() : null;
      return {
        label: managed.label,
        name: player?.name ?? managed.name,
        playerId: managed.playerId,
        joined,
        recoverable: managed.client.hasCredentials(),
        seat: player?.seat ?? null,
        isHost: Boolean(player?.isHost),
        isGameModerator: Boolean(roomProjection?.viewer.isGameModerator),
        connectionStatus: connection?.status ?? "Idle",
        generation: connection?.generation ?? 0,
        roomRevision: joined ? managed.client.getRoomRevision() : null,
        playerRevision: joined ? managed.client.getPlayerRevision() : null,
        roomProjection,
        playerView: joined ? managed.client.getPlayerView() : null,
        trace: managed.client.captureTrace(),
      };
    });

    return {
      initialized: clients.length > 0,
      gameType: "botc",
      roomId: this.roomId,
      roomRevision:
        clients.find(client => client.roomRevision !== null)?.roomRevision ?? null,
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

  async resetDevices(deviceCount = 8): Promise<SimulatorLabState> {
    if (!Number.isInteger(deviceCount) || deviceCount < 1 || deviceCount > 15) {
      throw new Error("Simulator device count must be an integer from 1 to 15");
    }

    this.disposeClients();
    this.runtime = new InMemoryCloudflareMultiplayerHarness();
    this.roomId = null;

    for (let number = 1; number <= deviceCount; number += 1) {
      this.attach(this.createClient(`P${number}`, `Player ${number}`));
    }

    this.emit();
    return this.getState();
  }

  async createRoom(label: string, name?: string): Promise<SimulatorLabState> {
    const managed = this.requireDevice(label);
    if (managed.client.hasSession()) {
      throw new Error(`${label} has already entered a room`);
    }
    if (this.roomId) {
      throw new Error("Simulator already has an active room; use another device to join it");
    }

    if (name?.trim()) managed.name = name.trim();
    const created = await managed.client.createRoom(managed.name);
    managed.playerId = created.playerId;
    this.roomId = created.roomId;
    await managed.client.connect();
    this.emit();
    return this.getState();
  }

  async joinRoom(
    label: string,
    roomCode: string,
    name?: string,
  ): Promise<SimulatorLabState> {
    const managed = this.requireDevice(label);
    if (managed.client.hasSession()) {
      throw new Error(`${label} has already entered a room`);
    }
    if (name?.trim()) managed.name = name.trim();

    const joined = await managed.client.joinRoom(roomCode, managed.name);
    managed.playerId = joined.playerId;
    if (!this.roomId) this.roomId = joined.roomId;
    await managed.client.connect();
    await this.waitForOnlineClients(joined.revision);
    this.emit();
    return this.getState();
  }

  async reset(playerCount = 8): Promise<SimulatorLabState> {
    if (!Number.isInteger(playerCount) || playerCount < 5 || playerCount > 15) {
      throw new Error("Simulator BotC player count must be an integer from 5 to 15");
    }

    await this.resetDevices(playerCount);
    await this.createRoom("P1", "Player 1");
    const roomId = this.roomId;
    if (!roomId) throw new Error("Simulator room bootstrap failed");

    for (let number = 2; number <= playerCount; number += 1) {
      await this.joinRoom(`P${number}`, roomId, `Player ${number}`);
    }

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

  closeDevice(label: string): SimulatorLabState {
    const managed = this.requireDevice(label);
    if (!managed.client.hasSession()) {
      throw new Error(`${label} has no active session to close`);
    }
    managed.client.disconnect();
    this.emit();
    return this.getState();
  }

  async continueDevice(label: string): Promise<SimulatorLabState> {
    const managed = this.requireDevice(label);
    if (managed.client.hasSession()) {
      throw new Error(`${label} already has an active session`);
    }
    if (!managed.client.hasCredentials()) {
      throw new Error(`${label} has no recoverable room credentials`);
    }
    await managed.client.connect();
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
    const managed = this.clients.find(item => item.playerId === playerId && item.playerId);
    if (!managed) throw new Error(`Unknown simulator player: ${playerId}`);
    return managed;
  }

  private requireDevice(label: string): ManagedClient {
    const normalized = label.trim();
    const managed = this.clients.find(item => item.label === normalized);
    if (!managed) throw new Error(`Unknown simulator device: ${label}`);
    return managed;
  }

  private async waitForOnlineClients(revision: number | null): Promise<void> {
    if (revision === null) return;
    await Promise.all(
      this.clients
        .filter(item =>
          item.client.hasSession() &&
          item.client.getConnectionState().status === "Connected"
        )
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
