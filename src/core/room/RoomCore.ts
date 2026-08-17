import type { PublicRoomPlayer, RoomPlayer, RoomState } from "./types.js";

const MAX_PLAYER_NAME_LENGTH = 20;

function normalizePlayerName(name: string): string {
  return name.trim().slice(0, MAX_PLAYER_NAME_LENGTH);
}

function comparablePlayerName(name: string): string {
  return normalizePlayerName(name).toLocaleLowerCase();
}

export class RoomCore<
  TGameState = unknown,
  TGameConfig = unknown,
> {
  constructor(readonly state: RoomState<TGameState, TGameConfig>) {}

  getPlayer(playerId: string): RoomPlayer | undefined {
    return this.state.players.find(player => player.id === playerId);
  }

  publicPlayers(): PublicRoomPlayer[] {
    return this.state.players.map(({ id, name, seat, isHost }) => ({
      id,
      name,
      seat,
      isHost,
    }));
  }

  hasPlayerName(name: string, exceptPlayerId?: string): boolean {
    const normalized = comparablePlayerName(name);
    return this.state.players.some(player =>
      player.id !== exceptPlayerId && comparablePlayerName(player.name) === normalized
    );
  }

  addPlayer(player: Omit<RoomPlayer, "seat">): RoomPlayer {
    if (this.getPlayer(player.id)) {
      throw new Error("player already exists in room");
    }

    const normalizedName = normalizePlayerName(player.name);
    if (!normalizedName) throw new Error("player name cannot be empty");
    if (this.hasPlayerName(normalizedName)) {
      throw new Error("player name already exists in room");
    }

    const added: RoomPlayer = {
      ...player,
      name: normalizedName,
      seat: this.state.players.length + 1,
    };
    this.state.players.push(added);
    return added;
  }

  renamePlayer(playerId: string, name: string): RoomPlayer {
    const player = this.requirePlayer(playerId);
    const normalizedName = normalizePlayerName(name);
    if (!normalizedName) throw new Error("player name cannot be empty");
    if (this.hasPlayerName(normalizedName, playerId)) {
      throw new Error("player name already exists in room");
    }
    player.name = normalizedName;
    return player;
  }

  removePlayer(playerId: string): RoomPlayer | undefined {
    const index = this.state.players.findIndex(player => player.id === playerId);
    if (index < 0) return undefined;

    const [removed] = this.state.players.splice(index, 1);
    this.normalizeSeats();
    return removed;
  }

  movePlayerSeat(playerId: string, insertIndex: number): void {
    const originalIndex = this.state.players.findIndex(player => player.id === playerId);
    if (originalIndex < 0) throw new Error("player not found in room");
    if (!Number.isInteger(insertIndex) || insertIndex < 0 || insertIndex >= this.state.players.length) {
      throw new Error("invalid seat index");
    }

    const [player] = this.state.players.splice(originalIndex, 1);
    if (!player) throw new Error("player not found in room");
    const adjustedIndex = insertIndex > originalIndex ? insertIndex - 1 : insertIndex;
    this.state.players.splice(adjustedIndex, 0, player);
    this.normalizeSeats();
  }

  transferHost(targetPlayerId: string): void {
    const target = this.requirePlayer(targetPlayerId);
    for (const player of this.state.players) player.isHost = false;
    target.isHost = true;
  }

  normalizeSeats(): void {
    this.state.players.forEach((player, index) => {
      player.seat = index + 1;
    });
  }

  private requirePlayer(playerId: string): RoomPlayer {
    const player = this.getPlayer(playerId);
    if (!player) throw new Error("player not found in room");
    return player;
  }
}
